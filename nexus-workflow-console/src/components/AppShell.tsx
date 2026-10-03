import { useState, type ReactNode } from 'react'
import {
  AppBar,
  Box,
  Button,
  Collapse,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Toolbar,
  Typography,
} from '@mui/material'
import AccountTreeRoundedIcon from '@mui/icons-material/AccountTreeRounded'
import AssignmentRoundedIcon from '@mui/icons-material/AssignmentRounded'
import BusinessRoundedIcon from '@mui/icons-material/BusinessRounded'
import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import MenuRoundedIcon from '@mui/icons-material/MenuRounded'
import PeopleAltRoundedIcon from '@mui/icons-material/PeopleAltRounded'
import PlayCircleOutlineRoundedIcon from '@mui/icons-material/PlayCircleOutlineRounded'
import WebhookRoundedIcon from '@mui/icons-material/WebhookRounded'
import { SIDEBAR_WIDTH } from '../theme'

export type Screen = 'definitions' | 'instances' | 'tasks' | 'webhooks' | 'tenants' | 'users'

const SCREENS: Record<Screen, { label: string; group: string; icon: ReactNode }> = {
  definitions: { label: 'Definitions', group: 'Workflows', icon: <AccountTreeRoundedIcon fontSize="small" /> },
  instances: { label: 'Instances', group: 'Workflows', icon: <PlayCircleOutlineRoundedIcon fontSize="small" /> },
  tasks: { label: 'Tasks', group: 'Workflows', icon: <AssignmentRoundedIcon fontSize="small" /> },
  webhooks: { label: 'Webhooks', group: 'Workflows', icon: <WebhookRoundedIcon fontSize="small" /> },
  tenants: { label: 'Tenants', group: 'Platform', icon: <BusinessRoundedIcon fontSize="small" /> },
  users: { label: 'Users', group: 'People', icon: <PeopleAltRoundedIcon fontSize="small" /> },
}

interface Props {
  /** The screens this person may open, in sidebar order. */
  screens: Screen[]
  screen: Screen | undefined
  onSelect(screen: Screen): void
  tenantId: string | null
  tenantIds: string[]
  onSelectTenant(tenantId: string): void
  /** Who is signed in, for the top bar. */
  who: string
  onSignOut(): void
  children: ReactNode
}

export function AppShell({ screens, screen, onSelect, tenantId, tenantIds, onSelectTenant, who, onSignOut, children }: Props) {
  const [open, setOpen] = useState(true)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  // Sidebar sections in order of first appearance
  const groups = [...new Set(screens.map((s) => SCREENS[s].group))]

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar position="fixed" elevation={0} sx={{ zIndex: (t) => t.zIndex.drawer + 1, bgcolor: 'chrome.main' }}>
        <Toolbar variant="dense" sx={{ minHeight: 44 }}>
          <IconButton color="inherit" edge="start" aria-label="Toggle navigation" onClick={() => setOpen(!open)} sx={{ mr: 1 }}>
            <MenuRoundedIcon />
          </IconButton>
          <Typography variant="h6" component="div" sx={{ fontWeight: 300, letterSpacing: '0.02em' }}>
            Nexus<strong>Workflow</strong>
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          {tenantId && (
            <Box sx={{ mr: 2 }}>
              {tenantIds.length > 1 ? (
                <Select
                  size="small"
                  value={tenantId}
                  onChange={(e) => onSelectTenant(e.target.value)}
                  slotProps={{ input: { 'aria-label': 'Tenant' } }}
                  sx={{ color: 'inherit', bgcolor: 'rgba(255,255,255,0.08)', '& .MuiSvgIcon-root': { color: 'inherit' }, '& fieldset': { border: 0 } }}
                >
                  {tenantIds.map((id) => (
                    <MenuItem key={id} value={id}>
                      {id}
                    </MenuItem>
                  ))}
                </Select>
              ) : (
                <Typography variant="body2">Tenant: {tenantId}</Typography>
              )}
            </Box>
          )}
          <Typography variant="body2" sx={{ mr: 1, opacity: 0.85 }}>
            {who}
          </Typography>
          <Button color="inherit" size="small" startIcon={<LogoutRoundedIcon />} onClick={onSignOut}>
            Sign out
          </Button>
        </Toolbar>
      </AppBar>

      <Drawer
        variant="persistent"
        open={open}
        sx={{ width: open ? SIDEBAR_WIDTH : 0, flexShrink: 0, '& .MuiDrawer-paper': { width: SIDEBAR_WIDTH, boxSizing: 'border-box', borderRight: 1, borderColor: 'divider' } }}
      >
        <Toolbar variant="dense" sx={{ minHeight: 44 }} />
        <nav aria-label="Main">
          <List disablePadding sx={{ pt: 0.5 }}>
            {groups.map((group) => {
              const isOpen = !collapsed[group]
              return (
                <Box key={group}>
                  <ListItemButton onClick={() => setCollapsed({ ...collapsed, [group]: isOpen })} aria-expanded={isOpen} aria-label={group}>
                    <ListItemText primary={group} slotProps={{ primary: { sx: { fontWeight: 600, fontSize: '0.8rem', color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.05em' } } }} />
                    {isOpen ? <ExpandLessRoundedIcon fontSize="small" /> : <ExpandMoreRoundedIcon fontSize="small" />}
                  </ListItemButton>
                  <Collapse in={isOpen} unmountOnExit>
                    <List disablePadding>
                      {screens
                        .filter((s) => SCREENS[s].group === group)
                        .map((s) => (
                          <ListItemButton
                            key={s}
                            selected={s === screen}
                            aria-current={s === screen ? 'page' : undefined}
                            onClick={() => onSelect(s)}
                            sx={{ pl: 2.5, py: 0.25, borderLeft: 3, borderColor: s === screen ? 'primary.main' : 'transparent' }}
                          >
                            <ListItemIcon sx={{ minWidth: 32 }}>{SCREENS[s].icon}</ListItemIcon>
                            <ListItemText primary={SCREENS[s].label} />
                          </ListItemButton>
                        ))}
                    </List>
                  </Collapse>
                </Box>
              )
            })}
          </List>
        </nav>
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, bgcolor: 'background.default' }}>
        <Toolbar variant="dense" sx={{ minHeight: 44 }} />
        <Box sx={{ p: { xs: 1, md: 2 } }}>
          <Paper elevation={0} variant="outlined" sx={{ p: { xs: 1.5, md: 2 }, minHeight: 300 }}>
            {children}
          </Paper>
        </Box>
      </Box>
    </Box>
  )
}
