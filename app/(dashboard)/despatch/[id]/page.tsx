import DespatchDetailView from './DespatchDetailView'
export default async function DespatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <DespatchDetailView id={id} />
}
