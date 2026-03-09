import { createTheme } from '@mui/material/styles'

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#4F46E5',
      light: '#818CF8',
      dark: '#3730A3',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#64748B',
      light: '#94A3B8',
      dark: '#334155',
      contrastText: '#ffffff',
    },
    background: {
      default: '#F8FAFC',
      paper: '#ffffff',
    },
    text: {
      primary: '#0F172A',
      secondary: '#64748B',
    },
    divider: '#E2E8F0',
    success: { main: '#10B981', light: '#D1FAE5', dark: '#065F46' },
    warning: { main: '#F59E0B', light: '#FEF3C7', dark: '#92400E' },
    error:   { main: '#EF4444', light: '#FEE2E2', dark: '#991B1B' },
    info:    { main: '#3B82F6', light: '#DBEAFE', dark: '#1E3A8A' },
  },
  typography: {
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h1: { fontWeight: 700, fontSize: '2rem',     lineHeight: 1.25 },
    h2: { fontWeight: 700, fontSize: '1.5rem',   lineHeight: 1.33 },
    h3: { fontWeight: 600, fontSize: '1.25rem',  lineHeight: 1.40 },
    h4: { fontWeight: 600, fontSize: '1.125rem', lineHeight: 1.44 },
    h5: { fontWeight: 600, fontSize: '1rem',     lineHeight: 1.50 },
    h6: { fontWeight: 600, fontSize: '0.875rem', lineHeight: 1.57 },
    body1:    { fontSize: '0.9375rem', lineHeight: 1.6 },
    body2:    { fontSize: '0.875rem',  lineHeight: 1.57 },
    subtitle1: { fontSize: '0.9375rem', fontWeight: 500, lineHeight: 1.6 },
    subtitle2: { fontSize: '0.875rem',  fontWeight: 500, lineHeight: 1.57 },
    caption:  { fontSize: '0.75rem',   lineHeight: 1.66 },
    overline: {
      fontSize: '0.6875rem',
      fontWeight: 600,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
    },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { textTransform: 'none', fontWeight: 500, borderRadius: 8 },
        sizeMedium: { padding: '7px 16px' },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          border: '1px solid #E2E8F0',
          boxShadow: '0px 1px 3px rgba(15,23,42,0.08), 0px 1px 2px rgba(15,23,42,0.06)',
        },
      },
    },
    MuiPaper: {
      styleOverrides: { root: { backgroundImage: 'none' } },
    },
    MuiChip: {
      styleOverrides: { root: { borderRadius: 6, fontWeight: 500 } },
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          fontWeight: 600,
          fontSize: '0.75rem',
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color: '#64748B',
          backgroundColor: '#F8FAFC',
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: { root: { borderRadius: 8 } },
    },
    MuiTooltip: {
      styleOverrides: { tooltip: { fontSize: '0.75rem', borderRadius: 6 } },
    },
  },
})
