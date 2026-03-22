import DyeingDetailView from './DyeingDetailView'

export default async function DyeingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <DyeingDetailView id={id} />
}
