import RegisterClient from './RegisterClient'

export const dynamic = 'force-dynamic'

export default function RegisterPage() {
  // Month-driven; data is fetched client-side so the month picker re-queries
  // without a full navigation (matches the Wages page pattern).
  return <RegisterClient />
}
