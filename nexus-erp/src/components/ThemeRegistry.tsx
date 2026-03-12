'use client'

import * as React from 'react'
import createCache from '@emotion/cache'
import { useServerInsertedHTML } from 'next/navigation'
import { CacheProvider } from '@emotion/react'
import { ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import { getTheme } from '@/lib/theme'
import type { ThemeId } from '@/lib/theme'
import { ThemeContext } from '@/contexts/ThemeContext'

interface ThemeRegistryProps {
  children: React.ReactNode
  initialTheme: string
}

export default function ThemeRegistry({ children, initialTheme }: ThemeRegistryProps) {
  const [{ cache, flush }] = React.useState(() => {
    const cache = createCache({ key: 'mui' })
    cache.compat = true
    const prevInsert = cache.insert.bind(cache)
    let inserted: string[] = []
    cache.insert = (...args: Parameters<typeof prevInsert>) => {
      const serialized = args[1]
      if (cache.inserted[serialized.name] === undefined) {
        inserted.push(serialized.name)
      }
      return prevInsert(...args)
    }
    return {
      cache,
      flush: () => {
        const out = inserted
        inserted = []
        return out
      },
    }
  })

  useServerInsertedHTML(() => {
    const names = flush()
    if (names.length === 0) return null
    let styles = ''
    for (const name of names) {
      styles += cache.inserted[name]
    }
    return (
      <style
        key={cache.key}
        data-emotion={`${cache.key} ${names.join(' ')}`}
        dangerouslySetInnerHTML={{ __html: styles }}
      />
    )
  })

  const [themeId, setThemeIdState] = React.useState<ThemeId>(() => {
    // On the client, prefer localStorage over the server-side initial value
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem('nexus-theme')
      if (stored) return stored as ThemeId
    }
    return (initialTheme as ThemeId) || 'system'
  })

  // Resolve "system" to light/dark based on OS preference
  const [systemDark, setSystemDark] = React.useState(false)
  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    setSystemDark(mq.matches)
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const resolvedId: ThemeId =
    themeId === 'system' ? (systemDark ? 'dark' : 'light') : themeId

  const setThemeId = React.useCallback((id: ThemeId) => {
    setThemeIdState(id)
    window.localStorage.setItem('nexus-theme', id)
  }, [])

  const muiTheme = getTheme(resolvedId)

  return (
    <ThemeContext.Provider value={{ themeId, setThemeId }}>
      <CacheProvider value={cache}>
        <ThemeProvider theme={muiTheme}>
          <CssBaseline />
          {children}
        </ThemeProvider>
      </CacheProvider>
    </ThemeContext.Provider>
  )
}
