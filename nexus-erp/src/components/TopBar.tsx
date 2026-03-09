'use client'

import * as React from 'react'
import AppBar from '@mui/material/AppBar'
import Toolbar from '@mui/material/Toolbar'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Avatar from '@mui/material/Avatar'
import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import ListItemIcon from '@mui/material/ListItemIcon'
import Divider from '@mui/material/Divider'
import Breadcrumbs from '@mui/material/Breadcrumbs'
import Link from '@mui/material/Link'
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import PersonRoundedIcon from '@mui/icons-material/PersonRounded'
import NavigateNextRoundedIcon from '@mui/icons-material/NavigateNextRounded'
import { usePathname, useRouter } from 'next/navigation'
import { useSidebar } from './SidebarContext'
import { SIDEBAR_EXPANDED_WIDTH, SIDEBAR_COLLAPSED_WIDTH } from './AppSidebar'

interface TopBarProps {
  email: string
  role: 'employee' | 'manager'
  employeeId: string | null
  signOutAction: () => Promise<void>
}

function buildBreadcrumbs(pathname: string): { label: string; href: string }[] {
  const segments = pathname.split('/').filter(Boolean)
  const crumbs: { label: string; href: string }[] = [{ label: 'Home', href: '/dashboard' }]
  let accumulated = ''
  for (const seg of segments) {
    accumulated += `/${seg}`
    if (/^[0-9a-f-]{8,}$/i.test(seg)) continue
    const label = seg.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    crumbs.push({ label, href: accumulated })
  }
  return crumbs
}

function stringToInitials(email: string) {
  const parts = email.split('@')[0].split(/[._-]/)
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

function stringToColor(str: string) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  const colors = ['#4F46E5', '#7C3AED', '#0891B2', '#059669', '#D97706', '#DC2626']
  return colors[Math.abs(hash) % colors.length]
}

export default function TopBar({ email, role, employeeId, signOutAction }: TopBarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { collapsed } = useSidebar()
  const crumbs = buildBreadcrumbs(pathname)
  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH

  const [anchor, setAnchor] = React.useState<null | HTMLElement>(null)
  const open = Boolean(anchor)

  return (
    <AppBar
      position="fixed"
      elevation={0}
      sx={{
        width: `calc(100% - ${sidebarWidth}px)`,
        ml: `${sidebarWidth}px`,
        backgroundColor: 'background.paper',
        borderBottom: '1px solid',
        borderColor: 'divider',
        color: 'text.primary',
        transition: (t) =>
          t.transitions.create(['width', 'margin-left'], {
            easing: t.transitions.easing.sharp,
            duration: collapsed
              ? t.transitions.duration.leavingScreen
              : t.transitions.duration.enteringScreen,
          }),
      }}
    >
      <Toolbar sx={{ gap: 2, minHeight: '64px !important' }}>
        <Breadcrumbs
          separator={<NavigateNextRoundedIcon fontSize="small" />}
          aria-label="breadcrumb"
          sx={{ flex: 1, '& .MuiBreadcrumbs-ol': { flexWrap: 'nowrap' } }}
        >
          {crumbs.map((crumb, i) => {
            const isLast = i === crumbs.length - 1
            return isLast ? (
              <Typography key={crumb.href} variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
                {crumb.label}
              </Typography>
            ) : (
              <Link key={crumb.href} href={crumb.href} underline="hover" variant="body2" sx={{ color: 'text.secondary' }}>
                {crumb.label}
              </Link>
            )
          })}
        </Breadcrumbs>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Chip
            label={role}
            size="small"
            sx={{
              backgroundColor: role === 'manager' ? 'primary.light' : 'secondary.light',
              color: role === 'manager' ? 'primary.dark' : 'secondary.dark',
              fontWeight: 600,
              fontSize: '0.6875rem',
              height: 22,
              textTransform: 'capitalize',
            }}
          />

          <Tooltip title={email} placement="bottom">
            <IconButton
              size="small"
              onClick={(e) => setAnchor(e.currentTarget)}
              aria-label="Account menu"
              aria-controls={open ? 'account-menu' : undefined}
              aria-haspopup="true"
              aria-expanded={open ? 'true' : undefined}
              sx={{ p: 0 }}
            >
              <Avatar
                sx={{
                  width: 32,
                  height: 32,
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  bgcolor: stringToColor(email),
                }}
              >
                {stringToInitials(email)}
              </Avatar>
            </IconButton>
          </Tooltip>

          <Menu
            id="account-menu"
            anchorEl={anchor}
            open={open}
            onClose={() => setAnchor(null)}
            slotProps={{ paper: { elevation: 2, sx: { minWidth: 200, mt: 1 } } }}
            transformOrigin={{ horizontal: 'right', vertical: 'top' }}
            anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
          >
            <Box sx={{ px: 2, py: 1.5 }}>
              <Typography variant="body2" fontWeight={600} noWrap>{email}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'capitalize' }}>{role}</Typography>
            </Box>
            <Divider />
            {employeeId && (
              <MenuItem
                onClick={() => {
                  setAnchor(null)
                  router.push(`/employees/${employeeId}`)
                }}
              >
                <ListItemIcon><PersonRoundedIcon fontSize="small" /></ListItemIcon>
                My Profile
              </MenuItem>
            )}
            <form action={signOutAction}>
              <MenuItem component="button" type="submit" sx={{ width: '100%', color: 'error.main' }}>
                <ListItemIcon sx={{ color: 'error.main' }}><LogoutRoundedIcon fontSize="small" /></ListItemIcon>
                Sign out
              </MenuItem>
            </form>
          </Menu>
        </Box>
      </Toolbar>
    </AppBar>
  )
}
