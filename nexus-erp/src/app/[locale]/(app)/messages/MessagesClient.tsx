'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import Autocomplete from '@mui/material/Autocomplete'
import Avatar from '@mui/material/Avatar'
import Badge from '@mui/material/Badge'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import InputBase from '@mui/material/InputBase'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import Paper from '@mui/material/Paper'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import SendRoundedIcon from '@mui/icons-material/SendRounded'
import LinkRoundedIcon from '@mui/icons-material/LinkRounded'
import { useTranslations } from 'next-intl'

// ── Types ─────────────────────────────────────────────────────────────────────

interface UserOption {
  id: string
  name: string
  email: string
}

interface ConversationItem {
  id: string
  recipient: { id: string; name: string; email: string } | null
  lastMessage: { body: string; createdAt: string; senderId: string } | null
  hasUnread: boolean
  timesheet: { id: string; weekStart: string } | null
}

interface MessageItem {
  id: string
  body: string
  createdAt: string
  sender: { id: string; name: string }
}

interface ThreadData {
  messages: MessageItem[]
  total: number
  page: number
  pageSize: number
  otherLastReadAt: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function formatWeekStart(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Composer ──────────────────────────────────────────────────────────────────

interface ComposerProps {
  onSend: (body: string) => Promise<void>
  placeholder: string
  disabled?: boolean
}

const Composer = ({ onSend, placeholder, disabled }: ComposerProps) => {
  const [value, setValue] = useState('')
  const [sending, setSending] = useState(false)

  async function handleSend() {
    const trimmed = value.trim()
    if (!trimmed) return
    setSending(true)
    await onSend(trimmed)
    setValue('')
    setSending(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <Box sx={{ display: 'flex', gap: 1, p: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
      <InputBase
        multiline
        maxRows={4}
        fullWidth
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled || sending}
        placeholder={placeholder}
        sx={{
          flex: 1,
          fontSize: '0.875rem',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          px: 1.5,
          py: 0.75,
          '&.Mui-focused': { borderColor: 'primary.main' },
        }}
      />
      <IconButton
        color="primary"
        onClick={handleSend}
        disabled={!value.trim() || disabled || sending}
        aria-label="Send"
      >
        {sending ? <CircularProgress size={18} /> : <SendRoundedIcon />}
      </IconButton>
    </Box>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

interface MessagesClientProps {
  userId: string
  initialConversationId?: string
}

const MessagesClient = ({
  userId,
  initialConversationId,
}: MessagesClientProps) => {
  const t = useTranslations('messages')

  const [conversations, setConversations] = useState<ConversationItem[]>([])
  const [loadingConvs, setLoadingConvs] = useState(true)
  const [activeConvId, setActiveConvId] = useState<string | null>(initialConversationId ?? null)

  const [thread, setThread] = useState<ThreadData | null>(null)
  const [loadingThread, setLoadingThread] = useState(false)

  const [composing, setComposing] = useState(false)
  const [searchOptions, setSearchOptions] = useState<UserOption[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [selectedRecipient, setSelectedRecipient] = useState<UserOption | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Load conversations ─────────────────────────────────────────────────────

  const fetchConversations = useCallback(async () => {
    setLoadingConvs(true)
    const res = await fetch('/api/conversations')
    if (res.ok) setConversations(await res.json())
    setLoadingConvs(false)
  }, [])

  useEffect(() => { fetchConversations() }, [fetchConversations])

  // ── Load thread ────────────────────────────────────────────────────────────

  const fetchThread = useCallback(async (convId: string, page = 1) => {
    setLoadingThread(true)
    const res = await fetch(`/api/conversations/${convId}/messages?page=${page}`)
    if (res.ok) setThread(await res.json())
    setLoadingThread(false)
  }, [])

  useEffect(() => {
    if (!activeConvId) { setThread(null); return }
    fetchThread(activeConvId)
    // Mark as read
    fetch(`/api/conversations/${activeConvId}/read`, { method: 'POST' }).then(() => {
      setConversations((prev) =>
        prev.map((c) => c.id === activeConvId ? { ...c, hasUnread: false } : c),
      )
    })
  }, [activeConvId, fetchThread])

  // Scroll to bottom when messages load
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread?.messages])

  // ── Send message ───────────────────────────────────────────────────────────

  async function handleSend(body: string) {
    if (!activeConvId) return
    const res = await fetch(`/api/conversations/${activeConvId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    })
    if (res.ok) {
      const msg: MessageItem = await res.json()
      setThread((prev) =>
        prev ? { ...prev, messages: [...prev.messages, msg], total: prev.total + 1 } : prev,
      )
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConvId
            ? { ...c, lastMessage: { body: msg.body, createdAt: msg.createdAt, senderId: userId } }
            : c,
        ),
      )
    }
  }

  // ── Start new conversation ─────────────────────────────────────────────────

  async function handleSearchUser(q: string) {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    if (q.length < 1) { setSearchOptions([]); return }
    searchDebounceRef.current = setTimeout(async () => {
      setSearchLoading(true)
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`)
      if (res.ok) setSearchOptions(await res.json())
      setSearchLoading(false)
    }, 250)
  }

  async function handleStartConversation(recipient: UserOption) {
    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientId: recipient.id }),
    })
    if (res.ok) {
      const { id } = await res.json()
      setActiveConvId(id)
      setComposing(false)
      setSelectedRecipient(null)
      setSearchOptions([])
      fetchConversations()
    }
  }

  // ── Active conversation data ───────────────────────────────────────────────

  const activeConv = conversations.find((c) => c.id === activeConvId)

  // ── "Seen" receipt: find index of last message read by the other participant

  function getSeenIndex(): number {
    if (!thread || !thread.otherLastReadAt) return -1
    const otherRead = new Date(thread.otherLastReadAt)
    // Find the last message sent by me that was read by the other
    let lastIdx = -1
    for (let i = 0; i < thread.messages.length; i++) {
      const m = thread.messages[i]
      if (m.sender.id === userId && new Date(m.createdAt) <= otherRead) {
        lastIdx = i
      }
    }
    return lastIdx
  }

  const seenIdx = getSeenIndex()

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Box sx={{ display: 'flex', height: 'calc(100vh - 120px)', overflow: 'hidden', gap: 0 }}>

      {/* ── Left pane: conversation list ── */}
      <Paper
        variant="outlined"
        sx={{
          width: 280,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderRadius: 2,
          mr: 2,
        }}
      >
        {/* Header */}
        <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="subtitle1" fontWeight={700}>{t('title')}</Typography>
          <IconButton size="small" onClick={() => setComposing(true)} aria-label={t('newConversation')}>
            <AddRoundedIcon fontSize="small" />
          </IconButton>
        </Box>

        {/* New conversation compose row */}
        {composing && (
          <Box sx={{ p: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Autocomplete<UserOption>
              options={searchOptions}
              loading={searchLoading}
              getOptionLabel={(o) => o.name}
              value={selectedRecipient}
              onChange={(_e, val) => {
                if (val) handleStartConversation(val)
                else setSelectedRecipient(null)
              }}
              onInputChange={(_e, val) => handleSearchUser(val)}
              renderInput={(params) => (
                <TextField
                  {...params}
                  size="small"
                  placeholder={t('searchRecipient')}
                  autoFocus
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {searchLoading && <CircularProgress size={14} />}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
              renderOption={({ key, ...props }, option) => (
                <Box component="li" key={key} {...props} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start !important' }}>
                  <Typography variant="body2" fontWeight={500}>{option.name}</Typography>
                  <Typography variant="caption" color="text.secondary">{option.email}</Typography>
                </Box>
              )}
              noOptionsText={searchLoading ? '' : t('searchRecipient')}
              filterOptions={(x) => x}
            />
            <Button
              size="small"
              onClick={() => { setComposing(false); setSearchOptions([]) }}
              sx={{ mt: 0.5, color: 'text.secondary' }}
            >
              {/* Cancel */}
              <ArrowBackRoundedIcon fontSize="small" sx={{ mr: 0.5 }} />
            </Button>
          </Box>
        )}

        {/* Conversation list */}
        <Box sx={{ flex: 1, overflowY: 'auto' }}>
          {loadingConvs && (
            <Box sx={{ display: 'flex', justifyContent: 'center', pt: 4 }}>
              <CircularProgress size={24} />
            </Box>
          )}
          {!loadingConvs && conversations.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
              {t('noConversations')}
            </Typography>
          )}
          <List disablePadding>
            {conversations.map((conv) => {
              const isActive = conv.id === activeConvId
              const recipientName = conv.recipient?.name ?? t('unknownUser')
              return (
                <React.Fragment key={conv.id}>
                  <ListItemButton
                    selected={isActive}
                    onClick={() => setActiveConvId(conv.id)}
                    sx={{
                      px: 2,
                      py: 1.25,
                      gap: 1.5,
                      '&.Mui-selected': { backgroundColor: 'action.selected', color: 'text.primary' },
                    '&.Mui-selected:hover': { backgroundColor: 'action.focus' },
                    }}
                  >
                    <Badge color="primary" variant="dot" invisible={!conv.hasUnread}>
                      <Avatar sx={{ width: 36, height: 36, fontSize: '0.75rem', fontWeight: 700, bgcolor: 'secondary.main', color: 'secondary.contrastText', flexShrink: 0 }}>
                        {getInitials(recipientName)}
                      </Avatar>
                    </Badge>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <Typography variant="body2" fontWeight={conv.hasUnread ? 700 : 500} noWrap sx={{ flex: 1 }}>
                          {recipientName}
                        </Typography>
                        {conv.lastMessage && (
                          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, ml: 1 }}>
                            {formatTime(conv.lastMessage.createdAt)}
                          </Typography>
                        )}
                      </Box>
                      {conv.lastMessage && (
                        <Typography
                          variant="caption"
                          color={conv.hasUnread ? 'text.primary' : 'text.secondary'}
                          noWrap
                          fontWeight={conv.hasUnread ? 600 : 400}
                        >
                          {conv.lastMessage.senderId === userId ? `${t('you')}: ` : ''}{conv.lastMessage.body}
                        </Typography>
                      )}
                    </Box>
                  </ListItemButton>
                  <Divider />
                </React.Fragment>
              )
            })}
          </List>
        </Box>
      </Paper>

      {/* ── Right pane: thread ── */}
      <Paper
        variant="outlined"
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderRadius: 2,
          minWidth: 0,
        }}
      >
        {!activeConvId ? (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {conversations.length === 0 ? t('noConversations') : t('noMessages')}
            </Typography>
            <Button variant="outlined" size="small" startIcon={<AddRoundedIcon />} onClick={() => setComposing(true)}>
              {t('newConversation')}
            </Button>
          </Box>
        ) : (
          <>
            {/* Thread header */}
            <Box sx={{ px: 2.5, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Avatar sx={{ width: 32, height: 32, fontSize: '0.7rem', fontWeight: 700, bgcolor: 'secondary.main', color: 'secondary.contrastText' }}>
                {getInitials(activeConv?.recipient?.name ?? '?')}
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle2" fontWeight={700} noWrap>
                  {activeConv?.recipient?.name ?? t('unknownUser')}
                </Typography>
                {activeConv?.timesheet && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <LinkRoundedIcon sx={{ fontSize: 12, color: 'text.secondary' }} />
                    <Chip
                      component="a"
                      href={`/timesheets/${activeConv.timesheet.id}`}
                      label={t('linkedTimesheet', { weekStart: formatWeekStart(activeConv.timesheet.weekStart.toString()) })}
                      size="small"
                      variant="outlined"
                      clickable
                      sx={{ fontSize: '0.65rem', height: 18 }}
                    />
                  </Box>
                )}
              </Box>
            </Box>

            {/* Message list */}
            <Box sx={{ flex: 1, overflowY: 'auto', px: 2, py: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {loadingThread && (
                <Box sx={{ display: 'flex', justifyContent: 'center', pt: 4 }}>
                  <CircularProgress size={24} />
                </Box>
              )}

              {!loadingThread && thread && (
                <>
                  {/* Pagination — load previous */}
                  {thread.total > thread.page * thread.pageSize && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1 }}>
                      <Button
                        size="small"
                        onClick={() => fetchThread(activeConvId, thread.page + 1)}
                        sx={{ color: 'text.secondary' }}
                      >
                        Load more
                      </Button>
                    </Box>
                  )}

                  {thread.messages.length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mt: 4 }}>
                      {t('noMessages')}
                    </Typography>
                  )}

                  {thread.messages.map((msg, idx) => {
                    const isMe = msg.sender.id === userId
                    const showSeen = idx === seenIdx
                    return (
                      <Box key={msg.id}>
                        <Box
                          sx={{
                            display: 'flex',
                            flexDirection: isMe ? 'row-reverse' : 'row',
                            gap: 1,
                            alignItems: 'flex-end',
                          }}
                        >
                          {!isMe && (
                            <Avatar sx={{ width: 28, height: 28, fontSize: '0.65rem', fontWeight: 700, bgcolor: 'secondary.main', flexShrink: 0 }}>
                              {getInitials(msg.sender.name)}
                            </Avatar>
                          )}
                          <Box
                            sx={{
                              maxWidth: '70%',
                              px: 1.5,
                              py: 0.875,
                              borderRadius: isMe ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                              bgcolor: isMe ? 'primary.main' : 'action.selected',
                              color: isMe ? 'primary.contrastText' : 'text.primary',
                            }}
                          >
                            <Typography variant="body2" sx={{ wordBreak: 'break-word', lineHeight: 1.5 }}>
                              {msg.body}
                            </Typography>
                          </Box>
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start', mt: 0.25, mr: isMe ? 0.5 : 0, ml: isMe ? 0 : 4.5 }}>
                          <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem' }}>
                            {formatTime(msg.createdAt)}
                          </Typography>
                        </Box>
                        {showSeen && (
                          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mr: 0.5 }}>
                            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', fontStyle: 'italic' }}>
                              {t('seen')}
                            </Typography>
                          </Box>
                        )}
                      </Box>
                    )
                  })}
                  <div ref={messagesEndRef} />
                </>
              )}
            </Box>

            {/* Composer */}
            <Composer
              onSend={handleSend}
              placeholder={t('messagePlaceholder')}
            />
          </>
        )}
      </Paper>
    </Box>
  )
}

export default MessagesClient
