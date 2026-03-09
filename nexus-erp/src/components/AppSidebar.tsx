'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'
import NextLink from 'next/link'
import Box from '@mui/material/Box'
import Drawer from '@mui/material/Drawer'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Typography from '@mui/material/Typography'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'

import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded'
import AccessTimeRoundedIcon from '@mui/icons-material/AccessTimeRounded'
import PeopleRoundedIcon from '@mui/icons-material/PeopleRounded'
import InboxRoundedIcon from '@mui/icons-material/InboxRounded'
import BusinessRoundedIcon from '@mui/icons-material/BusinessRounded'
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded'
import ReceiptRoundedIcon from '@mui/icons-material/ReceiptRounded'
import ShoppingCartRoundedIcon from '@mui/icons-material/ShoppingCartRounded'
import AccountTreeRoundedIcon from '@mui/icons-material/AccountTreeRounded'
import PlayCircleRoundedIcon from '@mui/icons-material/PlayCircleRounded'
import SchemaRoundedIcon from '@mui/icons-material/SchemaRounded'
import EventNoteRoundedIcon from '@mui/icons-material/EventNoteRounded'
import CorporateFareRoundedIcon from '@mui/icons-material/CorporateFareRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import ManageSearchRoundedIcon from '@mui/icons-material/ManageSearchRounded'
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded'
import MenuRoundedIcon from '@mui/icons-material/MenuRounded'

import { useSidebar } from './SidebarContext'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NavItem {
  label: string
  href: string
  icon: React.ReactElement
  managerOnly?: boolean
}

export interface NavSection {
  title: string
  items: NavItem[]
  managerOnly?: boolean
}

// ─── Nav structure ────────────────────────────────────────────────────────────

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: <DashboardRoundedIcon fontSize="small" /> },
    ],
  },
  {
    title: 'Operations',
    items: [
      { label: 'Timesheets', href: '/timesheets', icon: <AccessTimeRoundedIcon fontSize="small" /> },
      { label: 'Employees',  href: '/employees',  icon: <PeopleRoundedIcon fontSize="small" />, managerOnly: true },
      { label: 'Task Inbox', href: '/tasks',      icon: <InboxRoundedIcon fontSize="small" />,  managerOnly: true },
    ],
  },
  {
    title: 'B2B Portal',
    items: [
      { label: 'Organizations',  href: '/organizations',   icon: <BusinessRoundedIcon fontSize="small" /> },
      { label: 'Contracts',      href: '/contracts',        icon: <DescriptionRoundedIcon fontSize="small" /> },
      { label: 'Invoices',       href: '/invoices',         icon: <ReceiptRoundedIcon fontSize="small" /> },
      { label: 'Purchase Orders',href: '/purchase-orders',  icon: <ShoppingCartRoundedIcon fontSize="small" /> },
    ],
  },
  {
    title: 'Workflow',
    items: [
      { label: 'Active Instances',    href: '/workflow/instances',   icon: <PlayCircleRoundedIcon fontSize="small" /> },
      { label: 'Process Definitions', href: '/workflow/definitions', icon: <SchemaRoundedIcon fontSize="small" /> },
      { label: 'Event Log',           href: '/workflow/events',      icon: <EventNoteRoundedIcon fontSize="small" /> },
    ],
  },
  {
    title: 'Admin',
    managerOnly: true,
    items: [
      { label: 'Departments', href: '/departments',      icon: <CorporateFareRoundedIcon fontSize="small" /> },
      { label: 'Settings',    href: '/admin/settings',   icon: <SettingsRoundedIcon fontSize="small" /> },
      { label: 'Audit Log',   href: '/admin/audit-log',  icon: <ManageSearchRoundedIcon fontSize="small" /> },
    ],
  },
]

// ─── Constants ────────────────────────────────────────────────────────────────

export const SIDEBAR_EXPANDED_WIDTH = 240
export const SIDEBAR_COLLAPSED_WIDTH = 64

// ─── Component ────────────────────────────────────────────────────────────────

interface AppSidebarProps {
  role: 'employee' | 'manager'
}

export default function AppSidebar({ role }: AppSidebarProps) {
  const pathname = usePathname()
  const { collapsed, setCollapsed } = useSidebar()
  const isManager = role === 'manager'
  const width = collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH

  return (
    <Drawer
      variant="permanent"
      sx={{
        width,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width,
          boxSizing: 'border-box',
          borderRight: '1px solid',
          borderColor: 'divider',
          backgroundColor: 'background.paper',
          overflowX: 'hidden',
          transition: (t) =>
            t.transitions.create('width', {
              easing: t.transitions.easing.sharp,
              duration: collapsed
                ? t.transitions.duration.leavingScreen
                : t.transitions.duration.enteringScreen,
            }),
        },
      }}
    >
      {/* Brand header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          px: collapsed ? 1 : 2,
          height: 64,
          borderBottom: '1px solid',
          borderColor: 'divider',
          flexShrink: 0,
        }}
      >
        {!collapsed && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box
              sx={{
                width: 28,
                height: 28,
                borderRadius: '6px',
                background: 'linear-gradient(135deg, #4F46E5 0%, #818CF8 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <AccountTreeRoundedIcon sx={{ fontSize: 16, color: '#fff' }} />
            </Box>
            <Typography
              variant="subtitle1"
              sx={{ fontWeight: 700, color: 'text.primary', letterSpacing: '-0.01em' }}
            >
              Nexus ERP
            </Typography>
          </Box>
        )}
        <IconButton
          size="small"
          onClick={() => setCollapsed((c) => !c)}
          sx={{ color: 'text.secondary' }}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <MenuRoundedIcon fontSize="small" /> : <ChevronLeftRoundedIcon fontSize="small" />}
        </IconButton>
      </Box>

      {/* Nav sections */}
      <Box sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', py: 1 }}>
        {NAV_SECTIONS.map((section, si) => {
          if (section.managerOnly && !isManager) return null
          const visibleItems = section.items.filter((item) => !item.managerOnly || isManager)
          if (visibleItems.length === 0) return null

          return (
            <Box key={section.title} sx={{ mb: 0.5 }}>
              {!collapsed && (
                <Typography
                  variant="overline"
                  sx={{ px: 2, py: 0.75, display: 'block', color: 'text.secondary' }}
                >
                  {section.title}
                </Typography>
              )}
              {collapsed && si > 0 && <Divider sx={{ mx: 1, my: 0.5 }} />}

              <List disablePadding sx={{ px: 1 }}>
                {visibleItems.map((item) => {
                  const active =
                    item.href === '/dashboard'
                      ? pathname === '/dashboard'
                      : pathname.startsWith(item.href)

                  return (
                    <ListItem key={item.href} disablePadding sx={{ mb: 0.25 }}>
                      <Tooltip title={collapsed ? item.label : ''} placement="right" arrow>
                        <ListItemButton
                          component={NextLink}
                          href={item.href}
                          selected={active}
                          sx={{
                            minHeight: 40,
                            px: 1.5,
                            justifyContent: collapsed ? 'center' : 'flex-start',
                            borderRadius: '8px',
                            '&.Mui-selected': {
                              backgroundColor: 'primary.main',
                              color: 'primary.contrastText',
                              '& .MuiListItemIcon-root': { color: 'primary.contrastText' },
                              '&:hover': { backgroundColor: 'primary.dark' },
                            },
                            '&:hover': { backgroundColor: 'action.hover' },
                          }}
                        >
                          <ListItemIcon
                            sx={{
                              minWidth: 0,
                              mr: collapsed ? 0 : 1.5,
                              color: active ? 'inherit' : 'text.secondary',
                              justifyContent: 'center',
                            }}
                          >
                            {item.icon}
                          </ListItemIcon>
                          {!collapsed && (
                            <ListItemText
                              primary={item.label}
                              primaryTypographyProps={{
                                variant: 'body2',
                                fontWeight: active ? 600 : 400,
                                noWrap: true,
                              }}
                            />
                          )}
                        </ListItemButton>
                      </Tooltip>
                    </ListItem>
                  )
                })}
              </List>
            </Box>
          )
        })}
      </Box>
    </Drawer>
  )
}
