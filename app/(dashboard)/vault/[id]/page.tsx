import VaultEntityView from './VaultEntityView'

export default async function VaultEntityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <VaultEntityView id={id} />
}
