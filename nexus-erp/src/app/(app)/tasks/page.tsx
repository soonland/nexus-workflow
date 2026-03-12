import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import NextLink from 'next/link'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import Chip from '@mui/material/Chip'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableRow from '@mui/material/TableRow'
import TableCell from '@mui/material/TableCell'
import Stack from '@mui/material/Stack'
import InboxRoundedIcon from '@mui/icons-material/InboxRounded'
import { listTasks } from '@/lib/workflow'
import { db } from '@/db/client'
import { getEffectivePermissions } from '@/lib/permissions'

interface Task {
  id: string
  name: string
  assignee?: string
  status: string
  createdAt: string
}

export default async function TasksPage() {
  const session = await auth()
  if (!session) redirect('/login')

  // Build all assignee patterns this user matches (including group-inherited permissions)
  const effectivePerms = await getEffectivePermissions(session.user.id, db)
  const patterns = [
    `user:${session.user.id}`,
    `role:${session.user.role}`,
    ...effectivePerms.map((key) => `perm:${key}`),
  ]

  // Fetch tasks for all patterns in parallel, deduplicate by id
  const results = await Promise.all(
    patterns.map((a) => listTasks({ assignee: a, status: 'open', pageSize: 50 })),
  )
  const seen = new Set<string>()
  const allTasks: Task[] = results.flatMap((r) => r.items).filter((t) => {
    if (seen.has(t.id)) return false
    seen.add(t.id)
    return true
  })

  const tasks = allTasks
  const total = tasks.length

  return (
    <Box>
      {/* Page header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Typography variant="h2">Task Inbox</Typography>
        {total > 0 && (
          <Chip label={total} size="small" color="primary" />
        )}
      </Box>

      <Card>
        {tasks.length === 0 ? (
          <Stack alignItems="center" spacing={2} sx={{ py: 8 }}>
            <InboxRoundedIcon sx={{ fontSize: 56, color: 'text.disabled' }} />
            <Typography variant="body1" color="text.secondary">
              No pending tasks. You are all caught up!
            </Typography>
          </Stack>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Task Name</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Created</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {tasks.map((task) => (
                <TableRow
                  key={task.id}
                  sx={{ '&:hover': { backgroundColor: 'action.hover' } }}
                >
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>
                      {task.name}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip label={task.status} size="small" color="warning" />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {new Date(task.createdAt).toLocaleDateString()}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      component={NextLink}
                      href={`/tasks/${task.id}`}
                      size="small"
                      variant="contained"
                      color="primary"
                    >
                      Review
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
