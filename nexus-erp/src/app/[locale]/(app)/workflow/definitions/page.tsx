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
import Button from '@mui/material/Button'
import { getTranslations } from 'next-intl/server'
import { auth } from '@/auth'
import { listDefinitions, listInstances, WorkflowDefinition } from '@/lib/workflow'
import DeleteDefinitionButton from '@/components/DeleteDefinitionButton'

const WorkflowDefinitionsPage = async () => {
  const session = await auth()
  if (session?.user.role !== 'manager') redirect('/dashboard')

  const t = await getTranslations('workflow.definitions')

  let definitions: WorkflowDefinition[]
  let inUseIds = new Set<string>()
  try {
    const [defs, blocking] = await Promise.all([
      listDefinitions(),
      listInstances({ status: 'pending,active,suspended', pageSize: 1000 }),
    ])
    definitions = defs
    inUseIds = new Set(blocking.items.map((i) => i.definitionId))
  } catch {
    definitions = []
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Typography variant="h2">{t('title')}</Typography>
        <Chip label={definitions.length} size="small" color="primary" />
      </Box>

      <Card>
        {definitions.length === 0 ? (
          <Stack alignItems="center" spacing={2} sx={{ py: 8 }}>
            <SchemaRoundedIcon sx={{ fontSize: 56, color: 'text.disabled' }} />
            <Typography variant="body1" color="text.secondary">
              {t('noDefinitions')}
            </Typography>
          </Stack>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('columns.definitionId')}</TableCell>
                <TableCell>{t('columns.name')}</TableCell>
                <TableCell>{t('columns.version')}</TableCell>
                <TableCell>{t('columns.deployable')}</TableCell>
                <TableCell>{t('columns.deployedAt')}</TableCell>
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
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                      <DeleteDefinitionButton definitionId={def.id} disabled={inUseIds.has(def.id)} />
                      <Button
                       
                        href={`/workflow/definitions/${def.id}`}
                        size="small"
                        variant="contained"
                      >
                        {t('view')}
                      </Button>
                    </Stack>
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
export default WorkflowDefinitionsPage
