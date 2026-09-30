import type { SxProps, Theme } from '@mui/material/styles'
import Typography from '@mui/material/Typography'

const SectionLabel = ({ children, sx }: { children: React.ReactNode; sx?: SxProps<Theme> }) => (
  <Typography
    variant="overline"
    sx={{
      color: 'text.secondary',
      display: 'block',
      mb: 2,
      letterSpacing: '0.08em',
      ...sx
    }}>
    {children}
  </Typography>
)

export default SectionLabel
