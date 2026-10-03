import { useEffect, useState } from 'react'
import { Alert, Box, CircularProgress, Typography } from '@mui/material'
import type { TenantApi } from '../api/client'

/** The landing page of a tenant manager's tenant. The tenant screens (#417-#419) hang off this. */
export function TenantOverviewPage({ api, tenantId }: { api: TenantApi; tenantId: string }) {
  const [definitions, setDefinitions] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDefinitions(null)
    setError(null)
    api
      .listDefinitions()
      .then((list) => {
        if (!cancelled) setDefinitions(list.length)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the tenant')
      })
    return () => {
      cancelled = true
    }
  }, [api])

  return (
    <Box>
      <Typography variant="h5" component="h1" gutterBottom>
        {tenantId}
      </Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {!error && definitions === null && <CircularProgress aria-label="Loading the tenant" />}
      {definitions !== null && (
        <Typography color="text.secondary">
          {definitions} workflow {definitions === 1 ? 'definition' : 'definitions'} deployed.
        </Typography>
      )}
    </Box>
  )
}
