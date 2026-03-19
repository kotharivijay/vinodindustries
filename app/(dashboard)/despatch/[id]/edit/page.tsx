import DespatchEditForm from './DespatchEditForm'
export default function EditDespatchPage({ params }: { params: { id: string } }) {
  return <DespatchEditForm id={params.id} />
}
