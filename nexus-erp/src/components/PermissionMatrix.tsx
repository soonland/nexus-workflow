'use client'

import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Stack from '@mui/material/Stack'
import Chip from '@mui/material/Chip'
import Checkbox from '@mui/material/Checkbox'
import Tooltip from '@mui/material/Tooltip'
import Divider from '@mui/material/Divider'
import CheckBoxIcon from '@mui/icons-material/CheckBox'
import HorizontalRuleRoundedIcon from '@mui/icons-material/HorizontalRuleRounded'
import NextLink from 'next/link'
import {
  RESOURCES,
  CRUD_ACTIONS,
  RESOURCE_LABELS,
  ACTION_LABELS,
  WORKFLOW_PERMISSIONS,
} from '@/lib/permissions'

// ── Types ────────────────────────────────────────────────────────────────────

export interface InheritedSource {
  id: string
  label: string
  type: 'group' | 'department'
  href: string
}

interface PermissionMatrixProps {
  allPermissions: Array<{ key: string; label: string; type: string }>
  grantedKeys: Set<string>
  onToggle: (key: string, checked: boolean) => void
  inheritedSources?: Record<string, InheritedSource[]>
}

// ── Cell indicator ────────────────────────────────────────────────────────────

function PermCell({
  permKey,
  grantedKeys,
  onToggle,
  inheritedSources,
  exists,
}: {
  permKey: string
  grantedKeys: Set<string>
  onToggle: (key: string, checked: boolean) => void
  inheritedSources?: Record<string, InheritedSource[]>
  exists: boolean
}) {
  if (!exists) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }} />
  }

  if (inheritedSources === undefined) {
    // Simple checkbox mode (group/dept forms)
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <Checkbox
          size="small"
          checked={grantedKeys.has(permKey)}
          onChange={(e) => onToggle(permKey, e.target.checked)}
          sx={{ p: 0.5 }}
        />
      </Box>
    )
  }

  const isDirect = grantedKeys.has(permKey)
  const sources = inheritedSources[permKey] ?? []
  const isInherited = sources.length > 0

  if (isDirect) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <Checkbox
          size="small"
          checked
          onChange={(e) => onToggle(permKey, e.target.checked)}
          sx={{ p: 0.5 }}
        />
      </Box>
    )
  }

  if (isInherited) {
    const tooltipTitle = `Inherited via ${sources.map((s) => s.label).join(', ')}`
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <Tooltip title={tooltipTitle} placement="top">
          <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', cursor: 'default' }}>
            <CheckBoxIcon fontSize="small" sx={{ opacity: 0.35, color: 'action.active' }} />
          </Box>
        </Tooltip>
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <Box
        sx={{
          p: 0.5,
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          color: 'text.disabled',
          '&:hover': { color: 'text.secondary' },
        }}
        onClick={() => onToggle(permKey, true)}
      >
        <HorizontalRuleRoundedIcon fontSize="small" />
      </Box>
    </Box>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PermissionMatrix({
  allPermissions,
  grantedKeys,
  onToggle,
  inheritedSources,
}: PermissionMatrixProps) {
  const permKeySet = new Set(allPermissions.map((p) => p.key))

  return (
    <Box>
      {/* ── CRUD section ──────────────────────────────────────────────────── */}
      <Typography
        variant="overline"
        color="text.secondary"
        sx={{ display: 'block', mb: 1.5, letterSpacing: '0.08em' }}
      >
        Permissions
      </Typography>

      {/* Legend (only shown in three-state mode) */}
      {inheritedSources !== undefined && (
        <Stack direction="row" gap={2} sx={{ mb: 1.5, pl: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <HorizontalRuleRoundedIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.7rem' }}>None</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <CheckBoxIcon sx={{ fontSize: 14, opacity: 0.35, color: 'action.active' }} />
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.7rem' }}>Inherited</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <CheckBoxIcon sx={{ fontSize: 14, color: 'primary.main' }} />
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.7rem' }}>Direct</Typography>
          </Box>
        </Stack>
      )}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: '1fr repeat(4, 60px)',
          alignItems: 'center',
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          overflow: 'hidden',
        }}
      >
        {/* Header row */}
        <Box
          sx={{
            display: 'contents',
          }}
        >
          <Box
            sx={{
              px: 1.5,
              py: 1,
              backgroundColor: 'action.hover',
              borderBottom: 1,
              borderColor: 'divider',
            }}
          />
          {CRUD_ACTIONS.map((action) => (
            <Box
              key={action}
              sx={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                px: 0.5,
                py: 1,
                backgroundColor: 'action.hover',
                borderBottom: 1,
                borderColor: 'divider',
              }}
            >
              <Typography
                variant="caption"
                fontWeight={600}
                color="text.secondary"
                sx={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}
              >
                {ACTION_LABELS[action]}
              </Typography>
            </Box>
          ))}
        </Box>

        {/* Resource rows */}
        {RESOURCES.map((resource, rowIdx) => {
          const isLast = rowIdx === RESOURCES.length - 1
          return (
            <Box key={resource} sx={{ display: 'contents' }}>
              {/* Label cell */}
              <Box
                sx={{
                  px: 1.5,
                  py: 0.75,
                  borderBottom: isLast ? 0 : 1,
                  borderColor: 'divider',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <Typography variant="body2" fontWeight={500}>
                  {RESOURCE_LABELS[resource]}
                </Typography>
              </Box>

              {/* Action cells */}
              {CRUD_ACTIONS.map((action) => {
                const key = `${resource}:${action}`
                return (
                  <Box
                    key={action}
                    sx={{
                      borderBottom: isLast ? 0 : 1,
                      borderColor: 'divider',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      py: 0.5,
                    }}
                  >
                    <PermCell
                      permKey={key}
                      grantedKeys={grantedKeys}
                      onToggle={onToggle}
                      inheritedSources={inheritedSources}
                      exists={permKeySet.has(key)}
                    />
                  </Box>
                )
              })}
            </Box>
          )
        })}
      </Box>

      {/* ── Workflow section ───────────────────────────────────────────────── */}
      <Divider sx={{ my: 2.5 }} />

      <Typography
        variant="overline"
        color="text.secondary"
        sx={{ display: 'block', mb: 1.5, letterSpacing: '0.08em' }}
      >
        Workflow
      </Typography>

      <Stack spacing={0.25}>
        {Object.entries(WORKFLOW_PERMISSIONS).map(([key, label]) => {
          const isDirect = grantedKeys.has(key)
          const sources = inheritedSources ? (inheritedSources[key] ?? []) : []
          const isInherited = sources.length > 0

          return (
            <Box
              key={key}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                py: 0.5,
                px: 1,
                borderRadius: 1,
                '&:hover': { backgroundColor: 'action.hover' },
              }}
            >
              {/* Indicator */}
              {inheritedSources === undefined ? (
                <Checkbox
                  size="small"
                  checked={grantedKeys.has(key)}
                  onChange={(e) => onToggle(key, e.target.checked)}
                  sx={{ p: 0.5 }}
                />
              ) : isDirect ? (
                <Checkbox
                  size="small"
                  checked
                  onChange={(e) => onToggle(key, e.target.checked)}
                  sx={{ p: 0.5 }}
                />
              ) : isInherited ? (
                <Tooltip
                  title={`Inherited via ${sources.map((s) => s.label).join(', ')}`}
                  placement="right"
                >
                  <Box sx={{ p: 0.5, display: 'flex', alignItems: 'center', cursor: 'default' }}>
                    <CheckBoxIcon fontSize="small" sx={{ opacity: 0.35, color: 'action.active' }} />
                  </Box>
                </Tooltip>
              ) : (
                <Box
                  sx={{
                    p: 0.5,
                    display: 'flex',
                    alignItems: 'center',
                    cursor: 'pointer',
                    color: 'text.disabled',
                    '&:hover': { color: 'text.secondary' },
                  }}
                  onClick={() => onToggle(key, true)}
                >
                  <HorizontalRuleRoundedIcon fontSize="small" />
                </Box>
              )}

              {/* Label */}
              <Typography
                variant="body2"
                sx={{ flex: 1 }}
                fontWeight={isDirect || isInherited ? 500 : 400}
                color={isDirect || isInherited ? 'text.primary' : 'text.secondary'}
              >
                {label}
              </Typography>

              {/* Inherited badges (three-state mode only) */}
              {inheritedSources !== undefined && isInherited && (
                <Stack direction="row" gap={0.5} flexWrap="wrap" justifyContent="flex-end">
                  {sources.map((src) => (
                    <Chip
                      key={src.id}
                      label={src.label}
                      size="small"
                      variant="outlined"
                      component={NextLink}
                      href={src.href}
                      clickable
                      sx={{ height: 20, fontSize: '0.65rem', opacity: 0.75 }}
                    />
                  ))}
                </Stack>
              )}
            </Box>
          )
        })}
      </Stack>
    </Box>
  )
}
