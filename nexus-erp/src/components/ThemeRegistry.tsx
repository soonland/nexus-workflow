'use client'

import * as React from 'react'
import NextLink from 'next/link'
import createCache from '@emotion/cache'
import { useServerInsertedHTML } from 'next/navigation'
import { CacheProvider } from '@emotion/react'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import { getTheme, type ThemeId } from '@/lib/theme'
import { ThemeContext } from '@/contexts/ThemeContext'

interface ThemeRegistryProps {
  children: React.ReactNode
  initialTheme: string
}

const ThemeRegistry = ({ children, initialTheme }: ThemeRegistryProps) => {
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

  const [themeId, setThemeIdState] = React.useState<ThemeId>(
    (initialTheme as ThemeId) || 'system',
  )

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
    document.cookie = `nexus-theme=${id}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`
  }, [])

  // Extend the base theme with NextLink as the global ButtonBase LinkComponent so that
  // MUI components (Button, IconButton, CardActionArea…) with an `href` prop use
  // client-side navigation without needing component={NextLink} in every call site.
  const muiTheme = React.useMemo(
    () => createTheme(getTheme(resolvedId), {
      components: {
        MuiButtonBase: { defaultProps: { LinkComponent: NextLink } },
      },
    }),
    [resolvedId],
  )

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
export default ThemeRegistry
