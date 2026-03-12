import { NextResponse } from 'next/server'
import createMiddleware from 'next-intl/middleware'
import { auth } from '@/auth'
import { routing } from '@/i18n/routing'

const handleI18nRouting = createMiddleware(routing)

export default auth((req) => {
  const { pathname } = req.nextUrl
  const isLoggedIn = !!req.auth

  // Extract locale from pathname (e.g. /fr/dashboard → 'fr')
  const pathnameLocale = (routing.locales as readonly string[]).find(
    (l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`),
  )
  const locale = pathnameLocale ?? routing.defaultLocale

  const pathWithoutLocale = pathnameLocale
    ? pathname.slice(`/${locale}`.length) || '/'
    : pathname

  const isAuthPage =
    pathWithoutLocale === '/login' || pathWithoutLocale === '/register'

  if (!isLoggedIn && !isAuthPage) {
    return NextResponse.redirect(new URL(`/${locale}/login`, req.nextUrl))
  }

  if (isLoggedIn && isAuthPage) {
    return NextResponse.redirect(new URL(`/${locale}/dashboard`, req.nextUrl))
  }

  return handleI18nRouting(req)
})

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
