import { Chip } from '@mui/material'
import type { TenantStatus } from '../api/types'

const COLORS = { active: 'success', suspended: 'warning', deleting: 'error' } as const

export function StatusChip({ status }: { status: TenantStatus }) {
  return <Chip size="small" label={status} color={COLORS[status]} variant={status === 'active' ? 'filled' : 'outlined'} />
}
