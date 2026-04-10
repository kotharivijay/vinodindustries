import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Sidebar from './Sidebar'
import AIChatBubble from './AIChatBubble'
import { RoleProvider } from './RoleContext'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const role = ((session as any).role ?? 'admin') as 'admin' | 'ksi'

  return (
    <RoleProvider role={role}>
      <div className="flex h-screen bg-[var(--bg)]">
        <Sidebar userName={session.user?.name} userEmail={session.user?.email} role={role} />

        {/* Main content — pt-14 on mobile to clear the fixed top bar */}
        <main className="flex-1 overflow-auto pt-14 md:pt-0">
          {children}
        </main>

        <AIChatBubble />
      </div>
    </RoleProvider>
  )
}
