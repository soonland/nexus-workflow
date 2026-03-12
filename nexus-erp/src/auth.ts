import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { compare } from 'bcryptjs'
import { z } from 'zod'
import { db } from '@/db/client'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials)
        if (!parsed.success) return null

        const user = await db.user.findUnique({
          where: { email: parsed.data.email },
          include: { employee: { select: { id: true } } },
        })
        if (!user) return null

        const valid = await compare(parsed.data.password, user.passwordHash)
        if (!valid) return null

        return {
          id: user.id,
          email: user.email,
          role: user.role,
          employeeId: user.employee?.id ?? null,
          theme: user.theme ?? 'system',
          locale: user.locale ?? 'fr',
        }
      },
    }),
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = user.role
        token.employeeId = user.employeeId
        token.theme = user.theme
        token.locale = user.locale
      }
      return token
    },
    session({ session, token }) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      session.user.id = token.sub!
      session.user.role = token.role as 'employee' | 'manager'
      session.user.employeeId = token.employeeId as string | null
      session.user.theme = (token.theme as string) ?? 'system'
      session.user.locale = (token.locale as string) ?? 'fr'
      return session
    },
  },
  pages: {
    signIn: '/login',
  },
})
