import PublicNav from '@/components/PublicNav'

const products = [
  {
    name: 'Poplin',
    brand: 'Kothari Gold',
    description: 'High-quality poplin fabric known for its smooth texture and durability.',
  },
]

export default function Products() {
  return (
    <>
      <PublicNav />
      <main className="flex min-h-screen flex-col items-center p-24">
        <h1 className="text-4xl font-bold mb-8">Our Products</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {products.map((product, index) => (
            <div key={index} className="border rounded-lg p-6 shadow-lg">
              <h2 className="text-2xl font-semibold">{product.name}</h2>
              <p className="text-lg text-gray-600">{product.brand}</p>
              <p className="mt-4">{product.description}</p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-sm text-gray-500">More products coming soon. Contact us for custom orders.</p>
      </main>
    </>
  )
}
