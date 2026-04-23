import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import TokenClient from './TokenClient'

export default async function AttendanceTokenPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const captureSecret = process.env.ATTENDANCE_CAPTURE_SECRET || ''
  const appOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL || ''}`
    : ''

  return <TokenClient captureSecret={captureSecret} appOrigin={appOrigin} />
}
