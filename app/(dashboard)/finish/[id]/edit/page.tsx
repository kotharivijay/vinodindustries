import FinishEditForm from './FinishEditForm'
export default async function EditFinishPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <FinishEditForm id={id} />
}
