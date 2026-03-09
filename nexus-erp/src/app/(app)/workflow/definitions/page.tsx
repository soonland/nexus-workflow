import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Card from '@mui/material/Card'
import Chip from '@mui/material/Chip'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableRow from '@mui/material/TableRow'
import TableCell from '@mui/material/TableCell'
import Stack from '@mui/material/Stack'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import CancelRoundedIcon from '@mui/icons-material/CancelRounded'
import SchemaRoundedIcon from '@mui/icons-material/SchemaRounded'
import NextLink from 'next/link'
import Button from '@mui/material/Button'
import { listDefinitions, WorkflowDefinition } from '@/lib/workflow'

export default async function WorkflowDefinitionsPage() {
  const session = await auth()
  if (session?.user.role !== 'manager') redirect('/dashboard')

  let definitions: WorkflowDefinition[]
  try {
    definitions = await listDefinitions()
  } catch {
    definitions = []
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Typography variant="h2">Process Definitions</Typography>
        <Chip label={definitions.length} size="small" color="primary" />
      </Box>

      <Card>
        {definitions.length === 0 ? (
          <Stack alignItems="center" spacing={2} sx={{ py: 8 }}>
            <SchemaRoundedIcon sx={{ fontSize: 56, color: 'text.disabled' }} />
            <Typography variant="body1" color="text.secondary">
              No process definitions deployed yet.
            </Typography>
          </Stack>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Definition ID</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Version</TableCell>
                <TableCell>Deployable</TableCell>
                <TableCell>Deployed At</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {definitions.map((def) => (
                <TableRow key={`${def.id}-v${def.version}`} sx={{ '&:hover': { backgroundColor: 'action.hover' } }}>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500} sx={{ fontFamily: 'monospace' }}>
                      {def.id}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{def.name ?? '—'}</Typography>
                  </TableCell>
                  <TableCell>
                    <Chip label={`v${def.version}`} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell>
                    {def.isDeployable ? (
                      <CheckCircleRoundedIcon fontSize="small" color="success" />
                    ) : (
                      <CancelRoundedIcon fontSize="small" color="error" />
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {new Date(def.deployedAt).toLocaleString()}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      component={NextLink}
                      href={`/workflow/definitions/${def.id}`}
                      size="small"
                      variant="contained"
                    >
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </Box>
  )
}
