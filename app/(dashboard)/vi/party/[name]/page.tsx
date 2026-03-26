import PartyView from './PartyView'

export default async function PartyPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  return <PartyView name={decodeURIComponent(name)} />
}
