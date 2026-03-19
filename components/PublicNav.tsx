import Link from 'next/link'

export default function PublicNav() {
  return (
    <nav className="bg-gray-800 text-white p-4">
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        <Link href="/" className="text-xl font-bold">Vinod Industries</Link>
        <div className="space-x-4">
          <Link href="/" className="hover:underline">Home</Link>
          <Link href="/products" className="hover:underline">Products</Link>
          <Link href="/gallery" className="hover:underline">Gallery</Link>
          <Link href="/contact" className="hover:underline">Contact</Link>
          <Link href="/login" className="bg-indigo-600 hover:bg-indigo-700 px-3 py-1 rounded-lg transition">Login</Link>
        </div>
      </div>
    </nav>
  )
}
