import { createTheme, type Theme } from '@mui/material/styles'

export type ThemeId = 'light' | 'dark' | 'system' | 'nexus-light-pro' | 'nexus-dark-pro'

export const THEMES: { id: ThemeId; label: string; swatch: string[] }[] = [
  { id: 'light',          label: 'Light',          swatch: ['#ffffff', '#F8FAFC', '#4F46E5'] },
  { id: 'dark',           label: 'Dark',           swatch: ['#0F172A', '#1E293B', '#818CF8'] },
  { id: 'system',         label: 'System Default', swatch: ['#ffffff', '#0F172A', '#6366F1'] },
  { id: 'nexus-light-pro', label: 'Nexus Light Pro', swatch: ['#F1F5F9', '#E2E8F0', '#0891B2'] },
  { id: 'nexus-dark-pro',  label: 'Nexus Dark Pro',  swatch: ['#0F2231', '#1E3A4A', '#38BDF8'] },
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
  },
}

const themes: Record<ThemeId, Theme> = {
  light: createTheme({
    ...shared,
    palette: {
      mode: 'light',
      primary:    { main: '#4F46E5', light: '#818CF8', dark: '#3730A3', contrastText: '#ffffff' },
      secondary:  { main: '#64748B', light: '#94A3B8', dark: '#334155', contrastText: '#ffffff' },
      background: { default: '#F8FAFC', paper: '#ffffff' },
      text:       { primary: '#0F172A', secondary: '#64748B' },
      divider:    '#E2E8F0',
      success: { main: '#10B981', light: '#D1FAE5', dark: '#065F46' },
      warning: { main: '#F59E0B', light: '#FEF3C7', dark: '#92400E' },
      error:   { main: '#EF4444', light: '#FEE2E2', dark: '#991B1B' },
      info:    { main: '#3B82F6', light: '#DBEAFE', dark: '#1E3A8A' },
    },
    components: {
      ...shared.components,
      MuiCard: { styleOverrides: { root: { borderRadius: 12, border: '1px solid #E2E8F0', boxShadow: '0px 1px 3px rgba(15,23,42,0.08), 0px 1px 2px rgba(15,23,42,0.06)' } } },
      MuiTableCell: { styleOverrides: { head: { fontWeight: 600, fontSize: '0.75rem', letterSpacing: '0.05em', textTransform: 'uppercase' as const, color: '#64748B', backgroundColor: '#F8FAFC' } } },
    },
  }),

  dark: createTheme({
    ...shared,
    palette: {
      mode: 'dark',
      primary:    { main: '#818CF8', light: '#A5B4FC', dark: '#4F46E5', contrastText: '#ffffff' },
      secondary:  { main: '#94A3B8', light: '#CBD5E1', dark: '#64748B', contrastText: '#ffffff' },
      background: { default: '#0F172A', paper: '#1E293B' },
      text:       { primary: '#F1F5F9', secondary: '#94A3B8' },
      divider:    '#334155',
      success: { main: '#10B981', light: '#064E3B', dark: '#6EE7B7' },
      warning: { main: '#F59E0B', light: '#451A03', dark: '#FCD34D' },
      error:   { main: '#F87171', light: '#450A0A', dark: '#FCA5A5' },
      info:    { main: '#60A5FA', light: '#172554', dark: '#93C5FD' },
    },
    components: {
      ...shared.components,
      MuiCard: { styleOverrides: { root: { borderRadius: 12, border: '1px solid #334155', boxShadow: '0px 1px 3px rgba(0,0,0,0.3)' } } },
      MuiTableCell: { styleOverrides: { head: { fontWeight: 600, fontSize: '0.75rem', letterSpacing: '0.05em', textTransform: 'uppercase' as const, color: '#94A3B8', backgroundColor: '#1E293B' } } },
    },
  }),

  'nexus-light-pro': createTheme({
    ...shared,
    palette: {
      mode: 'light',
      primary:    { main: '#0891B2', light: '#38BDF8', dark: '#0E7490', contrastText: '#ffffff' },
      secondary:  { main: '#64748B', light: '#94A3B8', dark: '#334155', contrastText: '#ffffff' },
      background: { default: '#F1F5F9', paper: '#ffffff' },
      text:       { primary: '#0F172A', secondary: '#64748B' },
      divider:    '#CBD5E1',
      success: { main: '#10B981', light: '#D1FAE5', dark: '#065F46' },
      warning: { main: '#F59E0B', light: '#FEF3C7', dark: '#92400E' },
      error:   { main: '#EF4444', light: '#FEE2E2', dark: '#991B1B' },
      info:    { main: '#0891B2', light: '#E0F2FE', dark: '#0E7490' },
    },
    components: {
      ...shared.components,
      MuiCard: { styleOverrides: { root: { borderRadius: 12, border: '1px solid #CBD5E1', boxShadow: '0px 1px 3px rgba(15,23,42,0.06)' } } },
      MuiTableCell: { styleOverrides: { head: { fontWeight: 600, fontSize: '0.75rem', letterSpacing: '0.05em', textTransform: 'uppercase' as const, color: '#64748B', backgroundColor: '#F1F5F9' } } },
    },
  }),

  'nexus-dark-pro': createTheme({
    ...shared,
    palette: {
      mode: 'dark',
      primary:    { main: '#38BDF8', light: '#7DD3FC', dark: '#0284C7', contrastText: '#0F172A' },
      secondary:  { main: '#94A3B8', light: '#CBD5E1', dark: '#64748B', contrastText: '#ffffff' },
      background: { default: '#0F2231', paper: '#1E3A4A' },
      text:       { primary: '#E2F0F9', secondary: '#94A3B8' },
      divider:    '#1E3A4A',
      success: { main: '#34D399', light: '#064E3B', dark: '#6EE7B7' },
      warning: { main: '#FBBF24', light: '#451A03', dark: '#FCD34D' },
      error:   { main: '#F87171', light: '#450A0A', dark: '#FCA5A5' },
      info:    { main: '#38BDF8', light: '#0C4A6E', dark: '#7DD3FC' },
    },
    components: {
      ...shared.components,
      MuiCard: { styleOverrides: { root: { borderRadius: 12, border: '1px solid #1E3A4A', boxShadow: '0px 1px 3px rgba(0,0,0,0.4)' } } },
      MuiTableCell: { styleOverrides: { head: { fontWeight: 600, fontSize: '0.75rem', letterSpacing: '0.05em', textTransform: 'uppercase' as const, color: '#94A3B8', backgroundColor: '#1E3A4A' } } },
    },
  }),

  // Resolved at runtime client-side — light is the SSR fallback
  system: createTheme({
    ...shared,
    palette: {
      mode: 'light',
      primary:    { main: '#4F46E5', light: '#818CF8', dark: '#3730A3', contrastText: '#ffffff' },
      secondary:  { main: '#64748B', light: '#94A3B8', dark: '#334155', contrastText: '#ffffff' },
      background: { default: '#F8FAFC', paper: '#ffffff' },
      text:       { primary: '#0F172A', secondary: '#64748B' },
      divider:    '#E2E8F0',
      success: { main: '#10B981', light: '#D1FAE5', dark: '#065F46' },
      warning: { main: '#F59E0B', light: '#FEF3C7', dark: '#92400E' },
      error:   { main: '#EF4444', light: '#FEE2E2', dark: '#991B1B' },
      info:    { main: '#3B82F6', light: '#DBEAFE', dark: '#1E3A8A' },
    },
    components: {
      ...shared.components,
      MuiCard: { styleOverrides: { root: { borderRadius: 12, border: '1px solid #E2E8F0', boxShadow: '0px 1px 3px rgba(15,23,42,0.08), 0px 1px 2px rgba(15,23,42,0.06)' } } },
      MuiTableCell: { styleOverrides: { head: { fontWeight: 600, fontSize: '0.75rem', letterSpacing: '0.05em', textTransform: 'uppercase' as const, color: '#64748B', backgroundColor: '#F8FAFC' } } },
    },
  }),
}

export function getTheme(id: ThemeId | string | null | undefined): Theme {
  if (id === 'system') {
    // Client-side resolution — caller handles matchMedia
    return themes.light
  }
  return themes[(id as ThemeId) ?? 'light'] ?? themes.light
}

// Keep backward compat export for any direct imports
export const theme = themes.light
