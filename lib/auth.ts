import { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'

const approvedEmails = (process.env.APPROVED_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean)

const ksiEmails = (process.env.KSI_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean)

function getRole(email: string): 'admin' | 'ksi' | null {
  if (approvedEmails.includes(email)) return 'admin'
  if (ksiEmails.includes(email)) return 'ksi'
  return null
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false
      return getRole(user.email) !== null
    },
    async jwt({ token, account }) {
      if (account?.access_token) {
        token.accessToken = account.access_token
      }
      if (token.email) {
        token.role = getRole(token.email) ?? 'ksi'
      }
      return token
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken
      ;(session as any).role = token.role
      return session
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  secret: process.env.NEXTAUTH_SECRET,
}
