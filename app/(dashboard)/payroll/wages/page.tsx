import WagesClient from './WagesClient'

export const dynamic = 'force-dynamic'

export default function WagesPage() {
  // Initial data is loaded client-side because the user picks the month
  // and we want the page to render instantly before the fetch resolves.
  return <WagesClient />
}
