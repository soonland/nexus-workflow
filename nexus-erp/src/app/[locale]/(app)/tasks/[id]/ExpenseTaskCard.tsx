import React from 'react'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import Grid from '@mui/material/Grid'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { getTranslations } from 'next-intl/server'
import type { Employee, ExpenseLineItem, ExpenseReport, User } from '@prisma/client'

type Report = ExpenseReport & {
  employee: Employee & { user: Pick<User, 'email'> }
  lineItems: ExpenseLineItem[]
}

const STATUS_COLOR: Record<string, 'default' | 'warning' | 'success' | 'error' | 'info'> = {
  DRAFT: 'default',
  SUBMITTED: 'warning',
  APPROVED_MANAGER: 'info',
  APPROVED_ACCOUNTING: 'success',
  REJECTED: 'error',
  REIMBURSED: 'success',
}

const ExpenseTaskCard = async ({ report }: { report: Report }) => {
  const t = await getTranslations('tasks.expenseReview')

  const total = report.lineItems.reduce((sum, item) => sum + Number(item.amount), 0)

  const borderColor = 'divider'
  const cellSx = { px: 2, py: 1.5, borderTop: '1px solid', borderColor }

  return (
    <Card sx={{ borderLeft: '3px solid', borderColor: 'primary.main' }}>
      <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
        <Typography variant="h5" sx={{ mb: 0.5 }}>{t('title')}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5 }}>
          <Typography variant="body2" color="text.secondary">
            {report.employee.fullName} &middot; {report.employee.user.email}
          </Typography>
          <Chip
            label={t(`status.${report.status}`)}
            size="small"
            color={STATUS_COLOR[report.status] ?? 'default'}
          />
        </Box>

        {/* Line items table — hidden on xs */}
        <Grid
          container
          sx={{ display: { xs: 'none', md: 'flex' }, border: '1px solid', borderColor, borderRadius: 1, overflow: 'hidden', mb: 2 }}
        >
          {/* Header */}
          {[t('columns.date'), t('columns.category'), t('columns.amount'), t('columns.description')].map((h, i) => (
            <Grid
              key={h}
              size={3}
              sx={{
                px: 2, py: 1,
                bgcolor: 'action.hover',
                ...(i > 0 && { borderLeft: '1px solid', borderColor }),
              }}
            >
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {h}
              </Typography>
            </Grid>
          ))}

          {/* Data rows */}
          {report.lineItems.map((item) => (
            <React.Fragment key={item.id}>
              <Grid size={3} sx={cellSx}>
                <Typography variant="body2">
                  {new Date(item.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </Typography>
              </Grid>
              <Grid size={3} sx={{ ...cellSx, borderLeft: '1px solid', borderColor }}>
                <Typography variant="body2">
                  {t(`category.${item.category}`)}
                </Typography>
              </Grid>
              <Grid size={3} sx={{ ...cellSx, borderLeft: '1px solid', borderColor }}>
                <Typography variant="body2" fontWeight={500}>
                  ${Number(item.amount).toFixed(2)}
                </Typography>
              </Grid>
              <Grid size={3} sx={{ ...cellSx, borderLeft: '1px solid', borderColor }}>
                <Typography variant="body2" color={item.description ? 'text.primary' : 'text.disabled'}>
                  {item.description ?? '—'}
                </Typography>
              </Grid>
            </React.Fragment>
          ))}
        </Grid>

        {/* Footer: total + receipt */}
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="body1" fontWeight={600}>
            {t('total')}: ${total.toFixed(2)}
          </Typography>
          {report.receiptPath && (
            <Link href={report.receiptPath} target="_blank" rel="noopener noreferrer" variant="body2">
              {t('viewReceipt')}
            </Link>
          )}
        </Stack>

        {/* Mobile-friendly stacked layout for small screens */}
        <Box sx={{ display: { xs: 'block', md: 'none' }, mt: 2 }}>
          {report.lineItems.map((item, idx) => (
            <React.Fragment key={item.id}>
              {idx > 0 && <Divider sx={{ my: 1.5 }} />}
              <Stack spacing={0.5}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="body2" fontWeight={500}>
                    {t(`category.${item.category}`)}
                  </Typography>
                  <Typography variant="body2" fontWeight={500}>
                    ${Number(item.amount).toFixed(2)}
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {new Date(item.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {item.description && ` — ${item.description}`}
                </Typography>
              </Stack>
            </React.Fragment>
          ))}
        </Box>
      </CardContent>
    </Card>
  )
}
export default ExpenseTaskCard
