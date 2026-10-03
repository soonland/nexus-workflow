import type { ReactNode } from 'react'
import { Box, Breadcrumbs, Stack, Typography } from '@mui/material'

interface Props {
  title: string
  /** The sidebar section the page belongs to, shown as "Section / Title". */
  group: string
  subtitle?: string
  /** Buttons and filters, shown on the right. */
  children?: ReactNode
}

export function PageHeader({ title, group, subtitle, children }: Props) {
  return (
    <Stack direction="row" sx={{ alignItems: 'flex-start', justifyContent: 'space-between', gap: 1.5, mb: 1.5, flexWrap: 'wrap' }}>
      <Box>
        <Typography variant="h5" component="h1">
          {title}
        </Typography>
        <Breadcrumbs aria-label="breadcrumb" sx={{ fontSize: '0.8rem', mt: 0.25 }}>
          <Typography variant="inherit" color="text.secondary">
            {group}
          </Typography>
          <Typography variant="inherit" color="text.primary" sx={{ fontWeight: 600 }}>
            {title}
          </Typography>
        </Breadcrumbs>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {children && <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>{children}</Stack>}
    </Stack>
  )
}
