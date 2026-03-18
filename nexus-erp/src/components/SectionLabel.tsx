import Typography from '@mui/material/Typography'

const SectionLabel = ({ children, sx }: { children: React.ReactNode; sx?: object }) => (
  <Typography
    variant="overline"
    color="text.secondary"
    sx={{ display: 'block', mb: 2, letterSpacing: '0.08em', ...sx }}
  >
    {children}
  </Typography>
)

export default SectionLabel
