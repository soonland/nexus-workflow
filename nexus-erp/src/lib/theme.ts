import { createTheme, type Theme } from '@mui/material/styles'

export type ThemeId = 'default' | 'nexus-premium-light' | 'nexus-premium-dark'

export const THEMES: { id: ThemeId; label: string; swatch: string[] }[] = [
  { id: 'default',            label: 'Default',            swatch: ['#F5F7FA', '#FFFFFF', '#3D4FB5'] },
  { id: 'nexus-premium-light', label: 'Nexus Premium Light', swatch: ['#F8F9F8', '#EEFAF8', '#0F766E'] },
  { id: 'nexus-premium-dark',  label: 'Nexus Premium Dark',  swatch: ['#0D1B2A', '#112236', '#00B4D8'] },
]

const shared = {
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
      textTransform: 'uppercase' as const,
    },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { textTransform: 'none' as const, fontWeight: 500, borderRadius: 8 },
        sizeMedium: { padding: '7px 16px' },
      },
    },
    MuiPaper: {
      styleOverrides: { root: { backgroundImage: 'none' } },
    },
    MuiChip: {
      styleOverrides: { root: { borderRadius: 6, fontWeight: 500 } },
    },
    MuiListItemButton: {
      styleOverrides: { root: { borderRadius: 8 } },
    },
    MuiTooltip: {
      styleOverrides: { tooltip: { fontSize: '0.75rem', borderRadius: 6 } },
    },
    MuiTypography: {
      styleOverrides: {
        root: ({ ownerState, theme }: { ownerState: { variant?: string }; theme: { palette: { text: { primary: string } } } }) => ({
          ...(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(ownerState.variant ?? '') && {
            color: theme.palette.text.primary,
          }),
        }),
      },
    },
  },
}

const themes: Record<ThemeId, Theme> = {
  default: createTheme({
    ...shared,
    palette: {
      mode: 'light',
      primary:    { main: '#3D4FB5', light: '#6B7FD4', dark: '#2A3785', contrastText: '#ffffff' },
      secondary:  { main: '#6B7280', light: '#9CA3AF', dark: '#374151', contrastText: '#ffffff' },
      background: { default: '#F5F7FA', paper: '#ffffff' },
      text:       { primary: '#1A1F36', secondary: '#697386' },
      divider:    '#E2E5EE',
      success: { main: '#1B7F4F', light: '#4CAF7D', dark: '#145C39' },
      warning: { main: '#B45309', light: '#D97706', dark: '#7C3D0C' },
      error:   { main: '#C62828', light: '#EF5350', dark: '#8E0000' },
      info:    { main: '#0277BD', light: '#29B6F6', dark: '#01579B' },
    },
    components: {
      ...shared.components,
      MuiCard: { styleOverrides: { root: { borderRadius: 12, border: '1px solid #E2E5EE', boxShadow: '0px 1px 3px rgba(0,0,0,0.08)' } } },
      MuiTableCell: { styleOverrides: { head: { fontWeight: 600, fontSize: '0.75rem', letterSpacing: '0.05em', textTransform: 'uppercase' as const, color: '#697386', backgroundColor: '#EEF0F8' } } },
    },
  }),

  'nexus-premium-light': createTheme({
    ...shared,
    palette: {
      mode: 'light',
      primary:    { main: '#0F766E', light: '#3DA89F', dark: '#094F49', contrastText: '#ffffff' },
      secondary:  { main: '#B45309', light: '#D97706', dark: '#7C3D0C', contrastText: '#ffffff' },
      background: { default: '#F8F9F8', paper: '#ffffff' },
      text:       { primary: '#0D1F1E', secondary: '#4A6B6A' },
      divider:    '#C9E6E3',
      success: { main: '#166534', light: '#4ADE80', dark: '#14532D' },
      warning: { main: '#B45309', light: '#D97706', dark: '#7C3D0C' },
      error:   { main: '#C62828', light: '#EF5350', dark: '#8E0000' },
      info:    { main: '#0E7490', light: '#22D3EE', dark: '#0C4A6E' },
    },
    components: {
      ...shared.components,
      MuiCard: { styleOverrides: { root: { borderRadius: 12, border: '1px solid #C9E6E3', boxShadow: '0px 2px 8px rgba(15,118,110,0.10)' } } },
      MuiTableCell: { styleOverrides: { head: { fontWeight: 600, fontSize: '0.75rem', letterSpacing: '0.05em', textTransform: 'uppercase' as const, color: '#4A6B6A', backgroundColor: '#E0F2F0' } } },
    },
  }),

  'nexus-premium-dark': createTheme({
    ...shared,
    palette: {
      mode: 'dark',
      primary:    { main: '#00B4D8', light: '#48CAE4', dark: '#0096C7', contrastText: '#0D1B2A' },
      secondary:  { main: '#7C3AED', light: '#A78BFA', dark: '#5B21B6', contrastText: '#ffffff' },
      background: { default: '#0D1B2A', paper: '#112236' },
      text:       { primary: '#E2E8F0', secondary: '#94A3B8' },
      divider:    'rgba(0,180,216,0.15)',
      success: { main: '#22C55E', light: '#4ADE80', dark: '#15803D' },
      warning: { main: '#F59E0B', light: '#FCD34D', dark: '#B45309' },
      error:   { main: '#F87171', light: '#FCA5A5', dark: '#DC2626' },
      info:    { main: '#38BDF8', light: '#7DD3FC', dark: '#0284C7' },
    },
    components: {
      ...shared.components,
      MuiCard: { styleOverrides: { root: { borderRadius: 12, border: '1px solid rgba(0,180,216,0.15)', boxShadow: '0px 4px 16px rgba(0,0,0,0.40)' } } },
      MuiTableCell: { styleOverrides: { head: { fontWeight: 600, fontSize: '0.75rem', letterSpacing: '0.05em', textTransform: 'uppercase' as const, color: '#E2E8F0', backgroundColor: '#112236' } } },
    },
  }),
}

export function getTheme(id: ThemeId | string | null | undefined): Theme {
  return themes[(id as ThemeId)] ?? themes.default
}

// Keep backward compat export for any direct imports
export const theme = themes.default
