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

interface Task {
  id: string
  name: string
  assignee?: string
  status: string
  createdAt: string
}

export default async function TasksPage() {
  const session = await auth()
  if (session?.user.role !== 'manager') redirect('/dashboard')

  // Personal tasks assigned directly to this user
  const personalResult = await listTasks({ assignee: session.user.id, status: 'open', pageSize: 50 })
  const allTasks: Task[] = [...personalResult.items]
  const seen = new Set(personalResult.items.map((t) => t.id))

  // Department tasks — if this user belongs to a department, fetch tasks assigned to it
  const employee = await db.employee.findUnique({
    where: { userId: session.user.id },
    select: { departmentId: true },
  })
  if (employee?.departmentId) {
    const deptResult = await listTasks({
      assignee: `dept:${employee.departmentId}`,
      status: 'open',
      pageSize: 50,
    })
    for (const task of deptResult.items) {
      if (!seen.has(task.id)) allTasks.push(task)
    }
  }

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
