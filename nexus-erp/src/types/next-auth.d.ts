import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      role: 'employee' | 'manager'
      employeeId: string | null
    } & DefaultSession['user']
  }

  interface User {
    role: 'employee' | 'manager'
    employeeId: string | null
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    role: 'employee' | 'manager'
    employeeId: string | null
  }
}
