'use client'

import * as React from 'react'
import Snackbar from '@mui/material/Snackbar'
import Alert, { type AlertColor } from '@mui/material/Alert'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SnackbarOptions {
  message: string
  severity?: AlertColor        // 'success' | 'error' | 'warning' | 'info'
  duration?: number            // ms before auto-hide; defaults to 4000
}

interface SnackbarContextValue {
  showSnackbar: (options: SnackbarOptions) => void
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const SnackbarContext = React.createContext<SnackbarContextValue>({
  showSnackbar: () => {},
})

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export const SnackbarProvider = ({ children }: { children: React.ReactNode }) => {
  const [open, setOpen] = React.useState(false)
  const [current, setCurrent] = React.useState<Required<SnackbarOptions>>({
    message: '',
    severity: 'info',
    duration: 4000,
  })

  const showSnackbar = React.useCallback((options: SnackbarOptions) => {
    setCurrent({
      message: options.message,
      severity: options.severity ?? 'info',
      duration: options.duration ?? 4000,
    })
    setOpen(true)
  }, [])

  function handleClose(_event: React.SyntheticEvent | Event, reason?: string) {
    // Ignore clicks on the page backdrop — only auto-hide or explicit close
    if (reason === 'clickaway') return
    setOpen(false)
  }

  return (
    <SnackbarContext.Provider value={{ showSnackbar }}>
      {children}

      <Snackbar
        open={open}
        autoHideDuration={current.duration}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {/* Alert must be a direct child so MUI applies the correct role/aria */}
        <Alert
          onClose={handleClose}
          severity={current.severity}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {current.message}
        </Alert>
      </Snackbar>
    </SnackbarContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSnackbar(): SnackbarContextValue {
  return React.useContext(SnackbarContext)
}
