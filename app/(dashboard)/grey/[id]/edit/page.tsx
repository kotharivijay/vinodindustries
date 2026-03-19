import GreyEditForm from './GreyEditForm'

export default function EditGreyPage({ params }: { params: { id: string } }) {
  return <GreyEditForm id={params.id} />
}
