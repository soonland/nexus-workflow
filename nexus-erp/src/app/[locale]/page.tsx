import { redirect } from 'next/navigation'

// `/` redirects to `/<defaultLocale>`; send that on to the dashboard.
// Unauthenticated users are redirected to the login page by src/proxy.ts before reaching this.
const LocaleHome = async ({ params }: { params: Promise<{ locale: string }> }) => {
  const { locale } = await params
  redirect(`/${locale}/dashboard`)
}

export default LocaleHome
