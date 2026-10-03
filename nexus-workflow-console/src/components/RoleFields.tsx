import { MenuItem, Stack, TextField } from '@mui/material'
import type { MembershipRequest } from '../api/types'

export interface RoleChoice {
  role: 'operator' | 'tenant_manager'
  tenantId: string
}

export const emptyChoice = (canAssignOperator: boolean): RoleChoice => ({
  role: canAssignOperator ? 'operator' : 'tenant_manager',
  tenantId: '',
})

/** A choice is complete when it names a tenant (for tenant managers). */
export function toRequest(choice: RoleChoice): MembershipRequest | null {
  if (choice.role === 'operator') return { role: 'operator' }
  return choice.tenantId ? { role: 'tenant_manager', tenantId: choice.tenantId } : null
}

interface Props {
  value: RoleChoice
  onChange(value: RoleChoice): void
  /** Tenants that can be picked: all of them for operators, only the managed ones for managers. */
  tenantIds: string[]
  canAssignOperator: boolean
}

/** Pick a role and, for tenant managers, the tenant. */
export function RoleFields({ value, onChange, tenantIds, canAssignOperator }: Props) {
  return (
    <Stack direction="row" spacing={2}>
      <TextField
        select
        label="Role"
        value={value.role}
        onChange={(e) => onChange({ role: e.target.value as RoleChoice['role'], tenantId: value.tenantId })}
        sx={{ minWidth: 180 }}
      >
        {canAssignOperator && <MenuItem value="operator">Operator</MenuItem>}
        <MenuItem value="tenant_manager">Tenant manager</MenuItem>
      </TextField>
      {value.role === 'tenant_manager' && (
        <TextField
          select
          label="Tenant"
          value={value.tenantId}
          onChange={(e) => onChange({ ...value, tenantId: e.target.value })}
          fullWidth
        >
          {tenantIds.map((id) => (
            <MenuItem key={id} value={id}>
              {id}
            </MenuItem>
          ))}
        </TextField>
      )}
    </Stack>
  )
}
