import PublicNav from '@/components/PublicNav'

const stages = [
  { name: 'Grey Checking', description: 'Inspecting raw grey fabric for quality.' },
  { name: 'Grey Cleaning', description: 'Cleaning the grey fabric to remove impurities.' },
  { name: 'Dyeing', description: 'Applying dyes to achieve desired colors.' },
  { name: 'Finishing', description: 'Final treatments for texture and appearance.' },
  { name: 'Packing', description: 'Packaging finished products for delivery.' },
]

export default function Gallery() {
  return (
    <>
      <PublicNav />
      <main className="flex min-h-screen flex-col items-center p-24">
        <h1 className="text-4xl font-bold mb-8">Manufacturing Process Gallery</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {stages.map((stage, index) => (
            <div key={index} className="border rounded-lg p-6 shadow-lg">
              <div className="w-full h-48 bg-gray-200 flex items-center justify-center mb-4">
                <span className="text-gray-500">Placeholder Image</span>
              </div>
              <h2 className="text-2xl font-semibold">{stage.name}</h2>
              <p className="mt-2">{stage.description}</p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-sm text-gray-500">Images are placeholders. Replace with actual manufacturing photos.</p>
      </main>
    </>
  )
}
