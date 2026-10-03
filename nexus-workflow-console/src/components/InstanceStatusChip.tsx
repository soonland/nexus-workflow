import { Chip } from '@mui/material'
import type { InstanceStatus } from '../api/types'

const COLORS = { pending: 'default', active: 'success', suspended: 'warning', completed: 'info', terminated: 'error' } as const

export function InstanceStatusChip({ status }: { status: InstanceStatus }) {
  return <Chip size="small" label={status} color={COLORS[status]} variant={status === 'active' ? 'filled' : 'outlined'} />
}
