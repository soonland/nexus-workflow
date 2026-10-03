import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { filterAndSort, useListView } from './useListView'

interface Row {
  name: string
  n: number | null
  when: string
}
const rows: Row[] = [
  { name: 'Charlie', n: 10, when: '2026-01-03T00:00:00Z' },
  { name: 'alpha', n: 9, when: '2026-01-01T00:00:00Z' },
  { name: 'Bravo', n: null, when: '2026-01-02T00:00:00Z' },
  { name: 'v10', n: 2, when: '2026-01-04T00:00:00Z' },
  { name: 'v9', n: 2, when: '2026-01-05T00:00:00Z' },
]
const searchText = (r: Row) => `${r.name} ${r.n ?? ''}`
const sortValues = { name: (r: Row) => r.name, n: (r: Row) => r.n, when: (r: Row) => r.when }
const names = (list: Row[]) => list.map((r) => r.name)

describe('filterAndSort', () => {
  it('returns everything, in the original order, without a search or sort', () => {
    expect(names(filterAndSort(rows, '', searchText, null, sortValues))).toEqual(['Charlie', 'alpha', 'Bravo', 'v10', 'v9'])
  })

  it('searches case-insensitively in the text of the row, ignoring surrounding spaces', () => {
    expect(names(filterAndSort(rows, '  BRA ', searchText, null, sortValues))).toEqual(['Bravo'])
    expect(names(filterAndSort(rows, '10', searchText, null, sortValues))).toEqual(['Charlie', 'v10']) // matches the number too
    expect(filterAndSort(rows, 'nothing like this', searchText, null, sortValues)).toEqual([])
  })

  it('sorts text without caring about case, and in natural order ("v9" before "v10")', () => {
    expect(names(filterAndSort(rows, '', searchText, { key: 'name', dir: 'asc' }, sortValues))).toEqual(['alpha', 'Bravo', 'Charlie', 'v9', 'v10'])
    expect(names(filterAndSort(rows, '', searchText, { key: 'name', dir: 'desc' }, sortValues))).toEqual(['v10', 'v9', 'Charlie', 'Bravo', 'alpha'])
  })

  it('sorts numbers as numbers, and puts empty values last whichever way it sorts', () => {
    expect(filterAndSort(rows, '', searchText, { key: 'n', dir: 'asc' }, sortValues).map((r) => r.n)).toEqual([2, 2, 9, 10, null])
    expect(filterAndSort(rows, '', searchText, { key: 'n', dir: 'desc' }, sortValues).map((r) => r.n)).toEqual([10, 9, 2, 2, null])
  })

  it('keeps equal rows in their original order (stable), also when descending', () => {
    expect(names(filterAndSort(rows, '', searchText, { key: 'n', dir: 'asc' }, sortValues)).slice(0, 2)).toEqual(['v10', 'v9'])
    expect(names(filterAndSort(rows, '', searchText, { key: 'n', dir: 'desc' }, sortValues)).slice(2, 4)).toEqual(['v10', 'v9'])
  })

  it('sorts dates (as ISO text) in time order', () => {
    expect(names(filterAndSort(rows, '', searchText, { key: 'when', dir: 'desc' }, sortValues))).toEqual(['v9', 'v10', 'Charlie', 'Bravo', 'alpha'])
  })

  it('does not change the array it is given, and ignores a sort key it does not know', () => {
    const copy = [...rows]
    filterAndSort(rows, 'a', searchText, { key: 'name', dir: 'desc' }, sortValues)
    expect(rows).toEqual(copy)
    expect(names(filterAndSort(rows, '', searchText, { key: 'bogus', dir: 'asc' }, sortValues))).toEqual(names(rows))
  })
})

describe('useListView', () => {
  const many: Row[] = Array.from({ length: 45 }, (_, i) => ({ name: `item-${String(i).padStart(2, '0')}`, n: i, when: '2026-01-01T00:00:00Z' }))
  const setup = (items: Row[] | null = many, initialPageSize = 10) => renderHook(({ list }) => useListView(list, { searchText, sortValues, initialPageSize }), { initialProps: { list: items } })

  it('shows the first page and the counts', () => {
    const { result } = setup()

    expect(result.current.rows).toHaveLength(10)
    expect(result.current.rows[0]?.name).toBe('item-00')
    expect(result.current.filteredCount).toBe(45)
    expect(result.current.totalCount).toBe(45)
  })

  it('has nothing to show before the list has loaded', () => {
    const { result } = setup(null)
    expect(result.current.rows).toEqual([])
    expect(result.current.totalCount).toBe(0)
  })

  it('pages, and the last page is the short one', () => {
    const { result } = setup()

    act(() => result.current.setPage(4))

    expect(result.current.rows).toHaveLength(5)
    expect(result.current.rows[0]?.name).toBe('item-40')
  })

  it('goes back to the first page when the search, the sort or the page size changes', () => {
    const { result } = setup()
    act(() => result.current.setPage(3))
    act(() => result.current.setQuery('item'))
    expect(result.current.page).toBe(0)

    act(() => result.current.setPage(3))
    act(() => result.current.toggleSort('name'))
    expect(result.current.page).toBe(0)

    act(() => result.current.setPage(3))
    act(() => result.current.setPageSize(20))
    expect(result.current.page).toBe(0)
  })

  it('counts what matches, against the total', () => {
    const { result } = setup()

    act(() => result.current.setQuery('item-1'))

    expect(result.current.filteredCount).toBe(10)
    expect(result.current.totalCount).toBe(45)
  })

  it('sorts ascending on the first click of a column, descending on the second, and restarts on another column', () => {
    const { result } = setup()

    act(() => result.current.toggleSort('n'))
    expect(result.current.sort).toEqual({ key: 'n', dir: 'asc' })
    act(() => result.current.toggleSort('n'))
    expect(result.current.sort).toEqual({ key: 'n', dir: 'desc' })
    expect(result.current.rows[0]?.n).toBe(44)
    act(() => result.current.toggleSort('name'))
    expect(result.current.sort).toEqual({ key: 'name', dir: 'asc' })
  })

  it('steps back from a page that no longer exists when rows go away', () => {
    const { result, rerender } = setup()
    act(() => result.current.setPage(4))

    rerender({ list: many.slice(0, 40) }) // the last page is gone

    expect(result.current.page).toBe(3)
    expect(result.current.rows).toHaveLength(10)
  })
})
