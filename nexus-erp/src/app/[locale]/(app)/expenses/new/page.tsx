import { redirect } from 'next/navigation'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { getTranslations } from 'next-intl/server'
import { auth } from '@/auth'
import NewExpenseForm from '@/components/NewExpenseForm'

const NewExpensePage = async () => {
  const session = await auth()
  if (!session?.user.employeeId) redirect('/expenses')

  const t = await getTranslations('expenses')

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h2">{t('new.title')}</Typography>
      </Box>
      <NewExpenseForm />
    </Box>
  )
}

export default NewExpensePage
