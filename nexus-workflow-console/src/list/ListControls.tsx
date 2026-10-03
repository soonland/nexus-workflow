import { InputAdornment, MenuItem, Stack, TableCell, TablePagination, TableSortLabel, TextField } from '@mui/material'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import { PAGE_SIZES, type Sort } from './useListView'

interface ToolbarProps {
  pageSize: number
  onPageSize(size: number): void
  /** Omit for lists that cannot be searched yet (the server pages them). */
  query?: string
  onQuery?(query: string): void
  searchLabel?: string
}

/** "20 entries per page" and a search box, above a table. */
export function ListToolbar({ pageSize, onPageSize, query, onQuery, searchLabel = 'Search' }: ToolbarProps) {
  return (
    <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 1.5, flexWrap: 'wrap' }} useFlexGap>
      <TextField
        select
        label="Entries per page"
        value={pageSize}
        onChange={(e) => onPageSize(Number(e.target.value))}
        sx={{ minWidth: 150 }}
      >
        {PAGE_SIZES.map((size) => (
          <MenuItem key={size} value={size}>
            {size}
          </MenuItem>
        ))}
      </TextField>
      {onQuery && (
        <TextField
          type="search"
          placeholder="Search…"
          value={query ?? ''}
          onChange={(e) => onQuery(e.target.value)}
          sx={{ flexGrow: 1, maxWidth: 480 }}
          slotProps={{
            htmlInput: { 'aria-label': searchLabel },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRoundedIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
      )}
    </Stack>
  )
}

interface SortHeaderProps {
  label: string
  sortKey: string
  sort: Sort | null
  onSort(key: string): void
  align?: 'left' | 'right'
}

/** A column header that sorts the table when clicked. */
export function SortHeader({ label, sortKey, sort, onSort, align }: SortHeaderProps) {
  const active = sort?.key === sortKey
  return (
    <TableCell {...(align ? { align } : {})} sortDirection={active ? sort.dir : false}>
      <TableSortLabel active={active} direction={active ? sort.dir : 'asc'} onClick={() => onSort(sortKey)}>
        {label}
      </TableSortLabel>
    </TableCell>
  )
}

interface FooterProps {
  page: number
  onPage(page: number): void
  pageSize: number
  /** Rows that match the search. */
  filteredCount: number
  /** Rows before searching. */
  totalCount: number
}

/** "Showing 1 to 20 of 45 entries (filtered from 120)", with previous / next. */
export function ListFooter({ page, onPage, pageSize, filteredCount, totalCount }: FooterProps) {
  return (
    <TablePagination
      component="div"
      count={filteredCount}
      page={page}
      rowsPerPage={pageSize}
      rowsPerPageOptions={[]}
      onPageChange={(_event, next) => onPage(next)}
      labelDisplayedRows={({ from, to, count }) =>
        count === 0
          ? 'No entries'
          : `Showing ${from} to ${to} of ${count} entries${filteredCount !== totalCount ? ` (filtered from ${totalCount})` : ''}`
      }
    />
  )
}
