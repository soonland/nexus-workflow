import { useState, type ReactNode } from 'react'
import { IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip } from '@mui/material'
import { useColorScheme } from '@mui/material/styles'
import BrightnessAutoRoundedIcon from '@mui/icons-material/BrightnessAutoRounded'
import DarkModeRoundedIcon from '@mui/icons-material/DarkModeRounded'
import LightModeRoundedIcon from '@mui/icons-material/LightModeRounded'

type Mode = 'system' | 'light' | 'dark'

const OPTIONS: Array<{ mode: Mode; label: string; icon: ReactNode }> = [
  { mode: 'system', label: 'System', icon: <BrightnessAutoRoundedIcon fontSize="small" /> },
  { mode: 'light', label: 'Light', icon: <LightModeRoundedIcon fontSize="small" /> },
  { mode: 'dark', label: 'Dark', icon: <DarkModeRoundedIcon fontSize="small" /> },
]

/** Top-bar menu to pick the theme variant. MUI remembers the choice in this browser. */
export function ThemeMenu() {
  const { mode, setMode } = useColorScheme()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  if (!mode) return null
  const current = OPTIONS.find((o) => o.mode === mode) ?? OPTIONS[0]!

  return (
    <>
      <Tooltip title={`Theme: ${current.label}`}>
        <IconButton color="inherit" aria-label="Theme" aria-haspopup="menu" onClick={(e) => setAnchor(e.currentTarget)} sx={{ mr: 1 }}>
          {current.icon}
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {OPTIONS.map((o) => (
          <MenuItem
            key={o.mode}
            selected={o.mode === mode}
            onClick={() => {
              setMode(o.mode)
              setAnchor(null)
            }}
          >
            <ListItemIcon>{o.icon}</ListItemIcon>
            <ListItemText>{o.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
