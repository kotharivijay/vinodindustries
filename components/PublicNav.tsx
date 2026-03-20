import Link from 'next/link'

export default function PublicNav() {
  return (
    <nav className="bg-gray-800 text-white p-4">
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        <Link href="/" className="text-xl font-bold">Vinod Industries</Link>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-4">
            <Link href="/" className="hover:underline text-sm">Home</Link>
            <Link href="/products" className="hover:underline text-sm">Products</Link>
            <Link href="/gallery" className="hover:underline text-sm">Gallery</Link>
            <Link href="/contact" className="hover:underline text-sm">Contact</Link>
          </div>
          <Link href="/login" className="bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 px-4 py-2 rounded-lg font-bold text-sm transition">
            Login
          </Link>
        </div>
      </div>
    </nav>
  )
}
