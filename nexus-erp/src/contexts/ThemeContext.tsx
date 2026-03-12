'use client'

import * as React from 'react'
import type { ThemeId } from '@/lib/theme'

interface ThemeContextValue {
  themeId: ThemeId
  setThemeId: (id: ThemeId) => void
}

export const ThemeContext = React.createContext<ThemeContextValue>({
  themeId: 'system',
  setThemeId: () => {},
})

export function useTheme() {
  return React.useContext(ThemeContext)
}
