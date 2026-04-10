import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'

export default withAuth(
  function middleware(req) {
    const role = req.nextauth.token?.role as string | undefined

    // KSI-only users: block VI, vault, select-company routes
    if (role === 'ksi') {
      const path = req.nextUrl.pathname
      if (
        path.startsWith('/vi') ||
        path.startsWith('/vault') ||
        path.startsWith('/select-company')
      ) {
        return NextResponse.redirect(new URL('/dashboard', req.url))
      }
    }

    return NextResponse.next()
  },
  {
    pages: {
      signIn: '/login',
    },
  }
)

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/grey/:path*',
    '/despatch/:path*',
    '/masters/:path*',
    '/dyeing/:path*',
    '/finish/:path*',
    '/fold/:path*',
    '/stock/:path*',
    '/lot/:path*',
    '/ksi/:path*',
    '/vi/:path*',
    '/vault/:path*',
    '/settings/:path*',
    '/select-company',
  ],
}
