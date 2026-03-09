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
import Breadcrumbs from '@mui/material/Breadcrumbs'
import Link from '@mui/material/Link'
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import NavigateNextRoundedIcon from '@mui/icons-material/NavigateNextRounded'
import { usePathname } from 'next/navigation'
import { useSidebar } from './SidebarContext'
import { SIDEBAR_EXPANDED_WIDTH, SIDEBAR_COLLAPSED_WIDTH } from './AppSidebar'

interface TopBarProps {
  email: string
  role: 'employee' | 'manager'
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

export default function TopBar({ email, role, signOutAction }: TopBarProps) {
  const pathname = usePathname()
  const { collapsed } = useSidebar()
  const crumbs = buildBreadcrumbs(pathname)
  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH

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
            <Avatar
              sx={{
                width: 32,
                height: 32,
                fontSize: '0.75rem',
                fontWeight: 700,
                bgcolor: stringToColor(email),
                cursor: 'default',
              }}
            >
              {stringToInitials(email)}
            </Avatar>
          </Tooltip>
          <Tooltip title="Sign out" placement="bottom">
            <form action={signOutAction}>
              <IconButton
                type="submit"
                size="small"
                aria-label="Sign out"
                sx={{ color: 'text.secondary', '&:hover': { color: 'error.main' } }}
              >
                <LogoutRoundedIcon fontSize="small" />
              </IconButton>
            </form>
          </Tooltip>
        </Box>
      </Toolbar>
    </AppBar>
  )
}
