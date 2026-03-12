'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import NextLink from 'next/link'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import Autocomplete from '@mui/material/Autocomplete'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import Grid from '@mui/material/Grid'
import Alert from '@mui/material/Alert'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import InputLabel from '@mui/material/InputLabel'
import FormControl from '@mui/material/FormControl'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import { useSnackbar } from '@/components/SnackbarContext'

export interface OrganizationData {
  name: string
  legalName: string | null
  industry: string | null
  taxId: string | null
  registrationNo: string | null
  status: 'active' | 'inactive' | 'archived'
  email: string | null
  phone: string | null
  website: string | null
  street: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  country: string | null
  ownerId: string | null
}

interface EmployeeOption {
  id: string
  fullName: string
}

interface OrganizationFormProps {
  mode: 'create' | 'edit'
  orgId?: string
  defaultValues?: Partial<OrganizationData>
  allEmployees: EmployeeOption[]
  isManager: boolean
  isOwner: boolean
  workflowInstanceId?: string | null
}

type SaveStatus = 'idle' | 'saving'

const OrganizationForm = ({
  mode,
  orgId,
  defaultValues = {},
  allEmployees,
  isManager,
  isOwner,
  workflowInstanceId: initialWorkflowInstanceId,
}: OrganizationFormProps) => {
  const router = useRouter()
  const { showSnackbar } = useSnackbar()

  // Identity fields
  const [name, setName] = useState(defaultValues.name ?? '')
  const [legalName, setLegalName] = useState(defaultValues.legalName ?? '')
  const [industry, setIndustry] = useState(defaultValues.industry ?? '')
  const [taxId, setTaxId] = useState(defaultValues.taxId ?? '')
  const [registrationNo, setRegistrationNo] = useState(defaultValues.registrationNo ?? '')

  // Contact fields
  const [email, setEmail] = useState(defaultValues.email ?? '')
  const [phone, setPhone] = useState(defaultValues.phone ?? '')
  const [website, setWebsite] = useState(defaultValues.website ?? '')
  const [street, setStreet] = useState(defaultValues.street ?? '')
  const [city, setCity] = useState(defaultValues.city ?? '')
  const [stateField, setStateField] = useState(defaultValues.state ?? '')
  const [postalCode, setPostalCode] = useState(defaultValues.postalCode ?? '')
  const [country, setCountry] = useState(defaultValues.country ?? '')

  // Owner field
  const [owner, setOwner] = useState<EmployeeOption | null>(
    allEmployees.find((e) => e.id === defaultValues.ownerId) ?? null
  )

  // Status
  const [status, setStatus] = useState<OrganizationData['status']>(defaultValues.status ?? 'active')

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')

  // Workflow state
  const [workflowInstanceId, setWorkflowInstanceId] = useState<string | null>(initialWorkflowInstanceId ?? null)

  // Request status change dialog
  const [requestDialogOpen, setRequestDialogOpen] = useState(false)
  const [requestedStatus, setRequestedStatus] = useState<'active' | 'inactive'>(
    defaultValues.status === 'active' ? 'inactive' : 'active'
  )
  const [statusChangeReason, setStatusChangeReason] = useState('')
  const [requestSubmitting, setRequestSubmitting] = useState(false)

  // Deny dialog (manager)
  const [denyDialogOpen, setDenyDialogOpen] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')
  const [decidingAction, setDecidingAction] = useState(false)

  const canEditContact = isManager || isOwner
  const isReadOnly = !isManager && !isOwner

  async function handleSave() {
    if (!name.trim()) return
    setSaveStatus('saving')
    try {
      if (mode === 'create') {
        const payload = {
          name: name.trim(),
          legalName: legalName.trim() || null,
          industry: industry.trim() || null,
          taxId: taxId.trim() || null,
          registrationNo: registrationNo.trim() || null,
          email: email.trim() || null,
          phone: phone.trim() || null,
          website: website.trim() || null,
          street: street.trim() || null,
          city: city.trim() || null,
          state: stateField.trim() || null,
          postalCode: postalCode.trim() || null,
          country: country.trim() || null,
          ownerId: owner?.id ?? null,
        }
        const res = await fetch('/api/organizations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error ?? `Error ${res.status}`)
        }
        const org = await res.json()
        router.push(`/organizations/${org.id}`)
      } else {
        // Edit mode: fire identity + contact patches in parallel
        const calls: Promise<Response>[] = []

        if (isManager) {
          calls.push(
            fetch(`/api/organizations/${orgId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: name.trim(),
                legalName: legalName.trim() || null,
                industry: industry.trim() || null,
                taxId: taxId.trim() || null,
                registrationNo: registrationNo.trim() || null,
              }),
            })
          )
        }

        if (canEditContact) {
          calls.push(
            fetch(`/api/organizations/${orgId}/contact`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: email.trim() || null,
                phone: phone.trim() || null,
                website: website.trim() || null,
                street: street.trim() || null,
                city: city.trim() || null,
                state: stateField.trim() || null,
                postalCode: postalCode.trim() || null,
                country: country.trim() || null,
              }),
            })
          )
        }

        const results = await Promise.all(calls)
        for (const res of results) {
          if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            throw new Error(data.error ?? `Error ${res.status}`)
          }
        }

        showSnackbar({ message: 'Changes saved.', severity: 'success' })
        router.refresh()
      }
    } catch (e) {
      showSnackbar({ message: e instanceof Error ? e.message : 'Unknown error', severity: 'error' })
    } finally {
      setSaveStatus('idle')
    }
  }

  async function handleOwnerChange(_: React.SyntheticEvent, newOwner: EmployeeOption | null) {
    setOwner(newOwner)
    if (mode === 'edit' && orgId) {
      try {
        const res = await fetch(`/api/organizations/${orgId}/owner`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ownerId: newOwner?.id ?? null }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error ?? `Error ${res.status}`)
        }
        showSnackbar({ message: 'Account owner updated.', severity: 'success' })
      } catch (e) {
        showSnackbar({ message: e instanceof Error ? e.message : 'Unknown error', severity: 'error' })
      }
    }
  }

  async function handleStatusAction(action: 'deactivate' | 'reactivate' | 'archive') {
    if (!orgId) return
    try {
      const res = await fetch(`/api/organizations/${orgId}/${action}`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Error ${res.status}`)
      }
      if (action === 'archive') {
        showSnackbar({ message: 'Organization archived.', severity: 'success' })
        router.push('/organizations')
      } else {
        const newStatus = action === 'deactivate' ? 'inactive' : 'active'
        setStatus(newStatus)
        showSnackbar({
          message: action === 'deactivate' ? 'Organization deactivated.' : 'Organization reactivated.',
          severity: 'success',
        })
        router.refresh()
      }
    } catch (e) {
      showSnackbar({ message: e instanceof Error ? e.message : 'Unknown error', severity: 'error' })
    }
  }

  async function handleCancelRequest() {
    if (!orgId) return
    try {
      const res = await fetch(`/api/organizations/${orgId}/request-status-change`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Error ${res.status}`)
      }
      setWorkflowInstanceId(null)
      showSnackbar({ message: 'Status change request cancelled.', severity: 'success' })
      router.refresh()
    } catch (e) {
      showSnackbar({ message: e instanceof Error ? e.message : 'Unknown error', severity: 'error' })
    }
  }

  async function handleRequestStatusChange() {
    if (!orgId || !statusChangeReason.trim()) return
    setRequestSubmitting(true)
    try {
      const res = await fetch(`/api/organizations/${orgId}/request-status-change`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestedStatus, statusChangeReason: statusChangeReason.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Error ${res.status}`)
      }
      const data = await res.json()
      setWorkflowInstanceId(data.workflowInstanceId)
      setRequestDialogOpen(false)
      setStatusChangeReason('')
      showSnackbar({ message: 'Status change request submitted.', severity: 'success' })
      router.refresh()
    } catch (e) {
      showSnackbar({ message: e instanceof Error ? e.message : 'Unknown error', severity: 'error' })
    } finally {
      setRequestSubmitting(false)
    }
  }

  async function handleDecision(decision: 'approved' | 'denied') {
    if (!orgId) return
    setDecidingAction(true)
    try {
      const res = await fetch(`/api/organizations/${orgId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          ...(decision === 'denied' && rejectionReason.trim() ? { rejectionReason: rejectionReason.trim() } : {}),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Error ${res.status}`)
      }
      setDenyDialogOpen(false)
      setRejectionReason('')
      showSnackbar({
        message: decision === 'approved' ? 'Status change approved.' : 'Status change denied.',
        severity: 'success',
      })
      router.refresh()
    } catch (e) {
      showSnackbar({ message: e instanceof Error ? e.message : 'Unknown error', severity: 'error' })
    } finally {
      setDecidingAction(false)
    }
  }

  // Available statuses excluding current
  const availableStatuses = (['active', 'inactive'] as const).filter((s) => s !== status)

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <IconButton component={NextLink} href="/organizations" size="small">
          <ArrowBackRoundedIcon />
        </IconButton>
        <Typography variant="h3">
          {mode === 'create' ? 'New Organization' : (defaultValues.name ?? 'Organization')}
        </Typography>
      </Box>

      <Stack spacing={3} sx={{ maxWidth: 800 }}>
        {/* Identity Card */}
        <Card>
          <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
            <Stack spacing={3} divider={<Divider />}>
              <Box>
                <Typography variant="overline" color="text.secondary">Identity</Typography>
                <Grid container spacing={2} sx={{ mt: 1.5 }}>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label="Organization Name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      fullWidth
                      size="small"
                      required
                      disabled={!isManager}
                      autoFocus={mode === 'create'}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label="Legal Name"
                      value={legalName}
                      onChange={(e) => setLegalName(e.target.value)}
                      fullWidth
                      size="small"
                      disabled={!isManager}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label="Industry"
                      value={industry}
                      onChange={(e) => setIndustry(e.target.value)}
                      fullWidth
                      size="small"
                      disabled={!isManager}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label="Tax ID"
                      value={taxId}
                      onChange={(e) => setTaxId(e.target.value)}
                      fullWidth
                      size="small"
                      disabled={!isManager}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label="Registration No."
                      value={registrationNo}
                      onChange={(e) => setRegistrationNo(e.target.value)}
                      fullWidth
                      size="small"
                      disabled={!isManager}
                    />
                  </Grid>
                </Grid>
              </Box>
            </Stack>
          </CardContent>
        </Card>

        {/* Contact & Address Card */}
        <Card>
          <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
            <Stack spacing={3} divider={<Divider />}>
              <Box>
                <Typography variant="overline" color="text.secondary">Contact & Address</Typography>
                <Grid container spacing={2} sx={{ mt: 1.5 }}>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label="Email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      fullWidth
                      size="small"
                      type="email"
                      disabled={!canEditContact}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label="Phone"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      fullWidth
                      size="small"
                      disabled={!canEditContact}
                    />
                  </Grid>
                  <Grid size={12}>
                    <TextField
                      label="Website"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      fullWidth
                      size="small"
                      disabled={!canEditContact}
                    />
                  </Grid>
                  <Grid size={12}>
                    <TextField
                      label="Street"
                      value={street}
                      onChange={(e) => setStreet(e.target.value)}
                      fullWidth
                      size="small"
                      disabled={!canEditContact}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label="City"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      fullWidth
                      size="small"
                      disabled={!canEditContact}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label="State / Province"
                      value={stateField}
                      onChange={(e) => setStateField(e.target.value)}
                      fullWidth
                      size="small"
                      disabled={!canEditContact}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label="Postal Code"
                      value={postalCode}
                      onChange={(e) => setPostalCode(e.target.value)}
                      fullWidth
                      size="small"
                      disabled={!canEditContact}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label="Country"
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      fullWidth
                      size="small"
                      disabled={!canEditContact}
                    />
                  </Grid>
                </Grid>
              </Box>
            </Stack>
          </CardContent>
        </Card>

        {/* Account Owner Card */}
        <Card>
          <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
            <Stack spacing={3} divider={<Divider />}>
              <Box>
                <Typography variant="overline" color="text.secondary">Account Owner</Typography>
                <Box sx={{ mt: 1.5 }}>
                  <Autocomplete
                    options={allEmployees}
                    value={owner}
                    onChange={handleOwnerChange}
                    getOptionLabel={(e) => e.fullName}
                    isOptionEqualToValue={(option, value) => option.id === value.id}
                    disabled={!isManager}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Account Owner"
                        size="small"
                        placeholder="Search employees…"
                        helperText={isManager ? 'The employee responsible for this organization.' : undefined}
                      />
                    )}
                    noOptionsText="No employees found"
                  />
                </Box>
              </Box>
            </Stack>
          </CardContent>
        </Card>

        {/* Status Actions (manager only, edit mode only) */}
        {isManager && mode === 'edit' && (
          <Card>
            <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
              <Typography variant="overline" color="text.secondary">Status Actions</Typography>
              <Stack direction="row" spacing={1.5} sx={{ mt: 1.5 }}>
                {status === 'active' && (
                  <Button
                    size="small"
                    variant="outlined"
                    color="warning"
                    onClick={() => handleStatusAction('deactivate')}
                  >
                    Deactivate
                  </Button>
                )}
                {status === 'inactive' && (
                  <Button
                    size="small"
                    variant="outlined"
                    color="success"
                    onClick={() => handleStatusAction('reactivate')}
                  >
                    Reactivate
                  </Button>
                )}
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  onClick={() => handleStatusAction('archive')}
                >
                  Archive
                </Button>
              </Stack>
            </CardContent>
          </Card>
        )}

        {/* Pending decision card (manager view, edit mode only) */}
        {isManager && mode === 'edit' && workflowInstanceId && (
          <Card variant="outlined">
            <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
              <Typography variant="overline" color="text.secondary">Pending Status Change Request</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
                A status change request is awaiting your approval.
              </Typography>
              <Stack direction="row" spacing={1.5}>
                <Button
                  size="small"
                  variant="contained"
                  color="success"
                  disabled={decidingAction}
                  onClick={() => handleDecision('approved')}
                >
                  Approve
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  disabled={decidingAction}
                  onClick={() => setDenyDialogOpen(true)}
                >
                  Deny
                </Button>
              </Stack>
            </CardContent>
          </Card>
        )}

        {/* Owner workflow section (owner only, not manager, edit mode only) */}
        {isOwner && !isManager && mode === 'edit' && (
          <Card>
            <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
              <Typography variant="overline" color="text.secondary">Status Change</Typography>
              <Box sx={{ mt: 1.5 }}>
                {workflowInstanceId ? (
                  <Alert
                    severity="info"
                    action={
                      <Button
                        color="inherit"
                        size="small"
                        onClick={handleCancelRequest}
                      >
                        Cancel
                      </Button>
                    }
                  >
                    A status change request is pending manager approval.
                  </Alert>
                ) : (
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => {
                      setRequestedStatus(availableStatuses[0] ?? 'inactive')
                      setStatusChangeReason('')
                      setRequestDialogOpen(true)
                    }}
                    disabled={availableStatuses.length === 0}
                  >
                    Request Status Change
                  </Button>
                )}
              </Box>
            </CardContent>
          </Card>
        )}

        {/* Save / Cancel actions */}
        {!isReadOnly && (
          <Box>
            <Stack direction="row" spacing={1.5} justifyContent="flex-end">
              <Button component={NextLink} href="/organizations" variant="text" size="small">
                Cancel
              </Button>
              <Button
                variant="contained"
                size="small"
                onClick={handleSave}
                disabled={!name.trim() || saveStatus === 'saving'}
              >
                {saveStatus === 'saving'
                  ? mode === 'create' ? 'Creating…' : 'Saving…'
                  : mode === 'create' ? 'Create Organization' : 'Save Changes'}
              </Button>
            </Stack>
          </Box>
        )}
      </Stack>

      {/* Request Status Change Dialog */}
      <Dialog open={requestDialogOpen} onClose={() => setRequestDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Request Status Change</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth size="small">
              <InputLabel id="requested-status-label">Requested Status</InputLabel>
              <Select
                labelId="requested-status-label"
                value={requestedStatus}
                label="Requested Status"
                onChange={(e) => setRequestedStatus(e.target.value as 'active' | 'inactive')}
              >
                {availableStatuses.map((s) => (
                  <MenuItem key={s} value={s}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="Reason for Status Change"
              value={statusChangeReason}
              onChange={(e) => setStatusChangeReason(e.target.value)}
              fullWidth
              size="small"
              multiline
              rows={3}
              required
              placeholder="Explain why this status change is needed…"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRequestDialogOpen(false)} variant="text" size="small">
            Cancel
          </Button>
          <Button
            onClick={handleRequestStatusChange}
            variant="contained"
            size="small"
            disabled={!statusChangeReason.trim() || requestSubmitting}
          >
            {requestSubmitting ? 'Submitting…' : 'Submit Request'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Deny Dialog */}
      <Dialog open={denyDialogOpen} onClose={() => setDenyDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Deny Status Change Request</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Rejection Reason"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              fullWidth
              size="small"
              multiline
              rows={3}
              placeholder="Provide a reason for denial (optional)…"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDenyDialogOpen(false)} variant="text" size="small">
            Cancel
          </Button>
          <Button
            onClick={() => handleDecision('denied')}
            variant="contained"
            color="error"
            size="small"
            disabled={decidingAction}
          >
            {decidingAction ? 'Denying…' : 'Deny Request'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
export default OrganizationForm
