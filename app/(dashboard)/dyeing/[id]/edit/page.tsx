import DyeingEditForm from './DyeingEditForm'
export default async function EditDyeingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <DyeingEditForm id={id} />
}
