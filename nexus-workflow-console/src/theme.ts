import { createTheme } from '@mui/material'

export const SIDEBAR_WIDTH = 216

declare module '@mui/material/styles' {
  interface Palette {
    /** The dark surface of the top bar (and any future dark chrome). */
    chrome: { main: string }
  }
  interface PaletteOptions {
    chrome?: { main: string }
  }
}

/** A restrained, dense look for a tool people work in all day: small type, compact tables. */
export const theme = createTheme({
  palette: {
    primary: { main: '#1e88e5' },
    chrome: { main: '#0b1b2e' },
    background: { default: '#f3f5f8' },
    text: { primary: '#1c2b3a', secondary: '#5b6b7b' },
  },
  shape: { borderRadius: 6 },
  typography: {
    fontFamily: '"Inter", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif',
    fontSize: 12.5,
    h5: { fontSize: '1.1rem', fontWeight: 600 },
    h6: { fontSize: '1rem' },
  },
  components: {
    MuiButtonBase: { defaultProps: { disableRipple: true } },
    MuiButton: { defaultProps: { size: 'small' }, styleOverrides: { root: { textTransform: 'none', fontWeight: 600 } } },
    MuiIconButton: { defaultProps: { size: 'small' } },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiSelect: { defaultProps: { size: 'small' } },
    MuiChip: { defaultProps: { size: 'small' }, styleOverrides: { root: { height: 20, fontSize: '0.7rem' } } },
    MuiListItemButton: { defaultProps: { dense: true } },
    MuiFormControl: { defaultProps: { size: 'small' } },
    MuiTablePagination: { styleOverrides: { toolbar: { minHeight: 40 } } },
    MuiDialogTitle: { styleOverrides: { root: { fontSize: '1rem', padding: '12px 20px' } } },
    MuiDialogContent: { styleOverrides: { root: { padding: '8px 20px' } } },
    MuiDialogActions: { styleOverrides: { root: { padding: '8px 16px' } } },
    MuiTable: { defaultProps: { size: 'small' } },
    MuiTableCell: {
      styleOverrides: {
        root: { padding: '4px 12px', lineHeight: 1.35 },
        head: {
          backgroundColor: '#f1f4f8',
          color: '#5b6b7b',
          fontSize: '0.7rem',
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        },
      },
    },
  },
})
