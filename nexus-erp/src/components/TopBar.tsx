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
import PaletteRoundedIcon from '@mui/icons-material/PaletteRounded'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import NavigateNextRoundedIcon from '@mui/icons-material/NavigateNextRounded'
import { usePathname, useRouter } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { useTheme } from '@/contexts/ThemeContext'
import { THEMES, type ThemeId } from '@/lib/theme'
import { useSidebar } from './SidebarContext'
import { SIDEBAR_EXPANDED_WIDTH, SIDEBAR_COLLAPSED_WIDTH } from './AppSidebar'

interface TopBarProps {
  email: string
  employeeId: string | null
  role: 'employee' | 'manager'
  signOutAction: () => Promise<void>
  userId: string
}

function buildBreadcrumbs(
  pathname: string,
  homeLabel: string,
  segmentLabels: Record<string, string>,
): { label: string; href: string }[] {
  const segments = pathname.split('/').filter(Boolean)
  const crumbs: { label: string; href: string }[] = [{ label: homeLabel, href: '/dashboard' }]
  let accumulated = ''
  for (const seg of segments) {
    accumulated += `/${seg}`
    if (/^[0-9a-f-]{8,}$/i.test(seg) || /^[a-zA-Z0-9]{20,}$/.test(seg) || seg === 'new') continue
    const label = segmentLabels[seg] ?? seg.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
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

const TopBar = ({ email, employeeId, role, signOutAction, userId }: TopBarProps) => {
  const pathname = usePathname()
  const router = useRouter()
  const { collapsed } = useSidebar()
  const { themeId, setThemeId } = useTheme()
  const t = useTranslations('topBar')
  const tNavItems = useTranslations('nav.items')
  const tNavSections = useTranslations('nav.sections')
  const segmentLabels: Record<string, string> = {
    timesheets: tNavItems('timesheets'),
    employees: tNavItems('employees'),
    dashboard: tNavItems('dashboard'),
    organizations: tNavItems('organizations'),
    contracts: tNavItems('contracts'),
    invoices: tNavItems('invoices'),
    departments: tNavItems('departments'),
    groups: tNavItems('groups'),
    tasks: tNavItems('taskInbox'),
    workflow: tNavSections('workflow'),
    instances: tNavItems('activeInstances'),
    definitions: tNavItems('processDefinitions'),
    events: tNavItems('eventLog'),
    settings: tNavItems('settings'),
    admin: tNavSections('admin'),
  }
  const crumbs = buildBreadcrumbs(pathname, t('home'), segmentLabels)
  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH

  const [anchor, setAnchor] = React.useState<null | HTMLElement>(null)
  const open = Boolean(anchor)

  const handleThemeChange = React.useCallback(
    async (id: ThemeId) => {
      setThemeId(id)
      try {
        await fetch(`/api/users/${userId}/preferences`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ theme: id }),
        })
      } catch {
        // Non-critical — localStorage already updated
      }
    },
    [setThemeId, userId],
  )

  return (
    <AppBar
      elevation={0}
      position="fixed"
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
          aria-label="breadcrumb"
          separator={<NavigateNextRoundedIcon fontSize="small" />}
          sx={{ flex: 1, '& .MuiBreadcrumbs-ol': { flexWrap: 'nowrap' } }}
        >
          {crumbs.map((crumb, i) => {
            const isLast = i === crumbs.length - 1
            return isLast ? (
              <Typography key={crumb.href} sx={{ fontWeight: 600, color: 'text.primary' }} variant="body2">
                {crumb.label}
              </Typography>
            ) : (
              <Link key={crumb.href} href={crumb.href} sx={{ color: 'text.secondary' }} underline="hover" variant="body2">
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

          <Tooltip placement="bottom" title={email}>
            <IconButton
              aria-controls={open ? 'account-menu' : undefined}
              aria-expanded={open ? 'true' : undefined}
              aria-haspopup="true"
              aria-label={t('accountMenu')}
              size="small"
              sx={{ p: 0 }}
              onClick={(e) => setAnchor(e.currentTarget)}
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
            anchorEl={anchor}
            anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
            id="account-menu"
            open={open}
            slotProps={{ paper: { elevation: 2, sx: { minWidth: 220, mt: 1 } } }}
            transformOrigin={{ horizontal: 'right', vertical: 'top' }}
            onClose={() => setAnchor(null)}
          >
            <Box sx={{ px: 2, py: 1.5 }}>
              <Typography fontWeight={600} noWrap variant="body2">{email}</Typography>
              <Typography color="text.secondary" sx={{ textTransform: 'capitalize' }} variant="caption">{role}</Typography>
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
                {t('myProfile')}
              </MenuItem>
            )}

            {/* Theme selector */}
            <Box sx={{ px: 2, pt: 1, pb: 0.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                <PaletteRoundedIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                <Typography color="text.secondary" variant="caption">{t('theme')}</Typography>
              </Box>
              {THEMES.map((t) => (
                <MenuItem
                  dense
                  key={t.id}
                  selected={themeId === t.id}
                  sx={{ borderRadius: 1, px: 1, gap: 1 }}
                  onClick={() => handleThemeChange(t.id)}
                >
                  {/* Colour swatches */}
                  <Box sx={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
                    {t.swatch.map((colour, i) => (
                      <Box
                        key={i}
                        sx={{
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          backgroundColor: colour,
                          border: '1px solid',
                          borderColor: 'divider',
                        }}
                      />
                    ))}
                  </Box>
                  <Typography sx={{ flex: 1 }} variant="body2">{t.label}</Typography>
                  {themeId === t.id && <CheckRoundedIcon sx={{ fontSize: 14, color: 'primary.main' }} />}
                </MenuItem>
              ))}
            </Box>

            <Divider sx={{ mt: 0.5 }} />
            <form action={signOutAction}>
              <MenuItem component="button" sx={{ width: '100%', color: 'error.main' }} type="submit">
                <ListItemIcon sx={{ color: 'error.main' }}><LogoutRoundedIcon fontSize="small" /></ListItemIcon>
                {t('signOut')}
              </MenuItem>
            </form>
          </Menu>
        </Box>
      </Toolbar>
    </AppBar>
  )
}
export default TopBar
