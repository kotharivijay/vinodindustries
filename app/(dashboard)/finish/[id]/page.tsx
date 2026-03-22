import FinishDetailView from './FinishDetailView'

export default async function FinishDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <FinishDetailView id={id} />
}
