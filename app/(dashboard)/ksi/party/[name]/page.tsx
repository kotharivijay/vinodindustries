import PartyView from './PartyView'

export default async function KSIPartyPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  return <PartyView name={decodeURIComponent(name)} />
}
