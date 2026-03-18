'use client'

import NextLink from 'next/link'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import Chip from '@mui/material/Chip'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import { useTranslations } from 'next-intl'

// ── Types ──────────────────────────────────────────────────────────────────────

type ExpenseStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED_MANAGER'
  | 'APPROVED_ACCOUNTING'
  | 'REJECTED'
  | 'REIMBURSED'

interface ExpenseRow {
  id: string
  status: ExpenseStatus
  createdAt: string
  lineItems: { amount: number }[]
  employee: { fullName: string }
}

interface ExpensesTableProps {
  expenses: ExpenseRow[]
  showEmployee: boolean
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<
  ExpenseStatus,
  'default' | 'warning' | 'info' | 'success' | 'error'
> = {
  DRAFT: 'default',
  SUBMITTED: 'warning',
  APPROVED_MANAGER: 'info',
  APPROVED_ACCOUNTING: 'success',
  REJECTED: 'error',
  REIMBURSED: 'success',
}

// ── Component ──────────────────────────────────────────────────────────────────

const ExpensesTable = ({ expenses, showEmployee }: ExpensesTableProps) => {
  const t = useTranslations('expenses')

  return (
    <Card>
      {expenses.length === 0 ? (
        <Box sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            {t('noExpenses')}
          </Typography>
        </Box>
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              {showEmployee && <TableCell>{t('columns.employee')}</TableCell>}
              <TableCell>{t('columns.date')}</TableCell>
              <TableCell>{t('columns.total')}</TableCell>
              <TableCell>{t('columns.status')}</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {expenses.map((exp) => {
              const total = exp.lineItems.reduce(
                (sum, item) => sum + item.amount,
                0,
              )
              return (
                <TableRow
                  key={exp.id}
                  sx={{ '&:hover': { backgroundColor: 'action.hover' } }}
                >
                  {showEmployee && (
                    <TableCell>
                      <Typography variant="body2" fontWeight={500}>
                        {exp.employee.fullName}
                      </Typography>
                    </TableCell>
                  )}
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {new Date(exp.createdAt).toLocaleDateString()}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {total.toFixed(2)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={t(`status.${exp.status}`)}
                      size="small"
                      color={STATUS_COLORS[exp.status]}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      component={NextLink}
                      href={`/expenses/${exp.id}`}
                      size="small"
                      variant="text"
                    >
                      {t('view')}
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </Card>
  )
}
export default ExpensesTable
