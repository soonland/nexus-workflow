import { useCallback, useMemo, useState } from 'react'

export type SortDirection = 'asc' | 'desc'
export interface Sort {
  key: string
  dir: SortDirection
}
type SortValue = string | number | null | undefined

export const PAGE_SIZES = [10, 20, 50, 100]

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Empty values go last whichever way it sorts; numbers compare as numbers, text as text (so "v10" follows "v9"). */
function compare(a: SortValue, b: SortValue, dir: SortDirection): number {
  const aEmpty = a === null || a === undefined || a === ''
  const bEmpty = b === null || b === undefined || b === ''
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1
  const order = typeof a === 'number' && typeof b === 'number' ? a - b : collator.compare(String(a), String(b))
  return dir === 'asc' ? order : -order
}

/** The rows that match the search, in the chosen order. The original array is not touched, and ties keep their order. */
export function filterAndSort<T>(
  items: readonly T[],
  query: string,
  searchText: (item: T) => string,
  sort: Sort | null,
  sortValues: Record<string, (item: T) => SortValue>,
): T[] {
  const needle = query.trim().toLowerCase()
  const matching = needle === '' ? [...items] : items.filter((item) => searchText(item).toLowerCase().includes(needle))
  const valueOf = sort ? sortValues[sort.key] : undefined
  if (!sort || !valueOf) return matching
  return matching
    .map((item, index) => ({ item, index }))
    .sort((x, y) => compare(valueOf(x.item), valueOf(y.item), sort.dir) || x.index - y.index)
    .map(({ item }) => item)
}

interface Options<T> {
  /** Everything a person can see in a row, as one string: what the search looks in. */
  searchText(item: T): string
  /** One entry per sortable column. */
  sortValues: Record<string, (item: T) => SortValue>
  defaultSort?: Sort
  initialPageSize?: number
}

/**
 * Search, sort and page a list that is held in memory. Changing the search, the sort or the page size
 * goes back to the first page; a page that no longer exists (the last row was deleted) is stepped back from.
 */
export function useListView<T>(items: T[] | null, options: Options<T>) {
  const { searchText, sortValues, defaultSort, initialPageSize = 20 } = options
  const [query, setQueryState] = useState('')
  const [sort, setSort] = useState<Sort | null>(defaultSort ?? null)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSizeState] = useState(initialPageSize)

  const matching = useMemo(() => filterAndSort(items ?? [], query, searchText, sort, sortValues), [items, query, sort, searchText, sortValues])

  const lastPage = Math.max(0, Math.ceil(matching.length / pageSize) - 1)
  const currentPage = Math.min(page, lastPage)

  const setQuery = useCallback((next: string) => {
    setQueryState(next)
    setPage(0)
  }, [])
  const setPageSize = useCallback((next: number) => {
    setPageSizeState(next)
    setPage(0)
  }, [])
  /** Clicking a column sorts by it ascending; clicking it again reverses. */
  const toggleSort = useCallback((key: string) => {
    setSort((current) => (current?.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
    setPage(0)
  }, [])

  return {
    query,
    setQuery,
    sort,
    toggleSort,
    page: currentPage,
    setPage,
    pageSize,
    setPageSize,
    rows: matching.slice(currentPage * pageSize, (currentPage + 1) * pageSize),
    filteredCount: matching.length,
    totalCount: items?.length ?? 0,
  }
}
