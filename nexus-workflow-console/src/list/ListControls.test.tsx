import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Table, TableBody, TableHead, TableRow } from '@mui/material'
import { ListFooter, ListToolbar, SortHeader } from './ListControls'

describe('ListToolbar', () => {
  it('types into the search box and changes the page size', async () => {
    const onQuery = vi.fn()
    const onPageSize = vi.fn()
    const user = userEvent.setup()
    render(<ListToolbar pageSize={20} onPageSize={onPageSize} query="" onQuery={onQuery} />)

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'a')
    await user.click(screen.getByRole('combobox', { name: 'Entries per page' }))
    await user.click(await screen.findByRole('option', { name: '50' }))

    expect(onQuery).toHaveBeenCalledWith('a')
    expect(onPageSize).toHaveBeenCalledWith(50)
  })

  it('has no search box for a list that cannot be searched', () => {
    render(<ListToolbar pageSize={20} onPageSize={() => undefined} />)
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Entries per page' })).toBeInTheDocument()
  })
})

describe('SortHeader', () => {
  const renderHeader = (sort: { key: string; dir: 'asc' | 'desc' } | null, onSort = vi.fn()) => {
    render(
      <Table>
        <TableHead>
          <TableRow>
            <SortHeader label="Name" sortKey="name" sort={sort} onSort={onSort} />
          </TableRow>
        </TableHead>
        <TableBody />
      </Table>,
    )
    return onSort
  }

  it('reports a click with its key', async () => {
    const onSort = renderHeader(null)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Name' }))
    expect(onSort).toHaveBeenCalledWith('name')
  })

  it('tells assistive technology which way it is sorted', () => {
    renderHeader({ key: 'name', dir: 'desc' })
    expect(screen.getByRole('columnheader', { name: /name/i })).toHaveAttribute('aria-sort', 'descending')
  })

  it('says nothing about sorting when another column is the sorted one', () => {
    renderHeader({ key: 'other', dir: 'asc' })
    expect(screen.getByRole('columnheader', { name: /name/i })).not.toHaveAttribute('aria-sort')
  })
})

describe('ListFooter', () => {
  const footer = (props: Partial<Parameters<typeof ListFooter>[0]> = {}) =>
    render(<ListFooter page={0} onPage={() => undefined} pageSize={20} filteredCount={45} totalCount={45} {...props} />)

  it('says which entries are showing', () => {
    footer({ page: 2 })
    expect(screen.getByText('Showing 41 to 45 of 45 entries')).toBeInTheDocument()
  })

  it('says when the search has narrowed the list', () => {
    footer({ filteredCount: 7, totalCount: 45 })
    expect(screen.getByText('Showing 1 to 7 of 7 entries (filtered from 45)')).toBeInTheDocument()
  })

  it('says so when there is nothing', () => {
    footer({ filteredCount: 0, totalCount: 0 })
    expect(screen.getByText('No entries')).toBeInTheDocument()
  })

  it('moves between pages', async () => {
    const onPage = vi.fn()
    render(<ListFooter page={0} onPage={onPage} pageSize={20} filteredCount={45} totalCount={45} />)
    const nav = within(screen.getByText(/Showing/).closest('div')!.parentElement!)

    await userEvent.setup().click(nav.getByRole('button', { name: /next page/i }))

    expect(onPage).toHaveBeenCalledWith(1)
  })
})
