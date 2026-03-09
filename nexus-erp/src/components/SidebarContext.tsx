'use client'

import * as React from 'react'

interface SidebarContextValue {
  collapsed: boolean
  setCollapsed: (v: boolean | ((prev: boolean) => boolean)) => void
}

const SidebarContext = React.createContext<SidebarContextValue>({
  collapsed: false,
  setCollapsed: () => {},
})

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = React.useState(false)
  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed }}>
      {children}
    </SidebarContext.Provider>
  )
}

export const useSidebar = () => React.useContext(SidebarContext)
