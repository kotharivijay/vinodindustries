import PublicNav from '@/components/PublicNav'
import Link from 'next/link'

export default function Home() {
  return (
    <>
      <PublicNav />
      <main className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 flex flex-col items-center justify-center px-6 py-16 text-center">
        <div className="w-20 h-20 bg-indigo-600 rounded-3xl flex items-center justify-center mb-6 shadow-lg">
          <span className="text-white text-3xl font-bold">KSI</span>
        </div>

        <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-900 mb-3">Kothari Synthetic Industries</h1>
        <p className="text-gray-500 text-lg mb-10 max-w-sm">Leading textile manufacturer specializing in high-quality fabrics.</p>

        <Link
          href="/login"
          className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-bold text-lg px-10 py-4 rounded-2xl shadow-xl shadow-indigo-200 transition-all mb-12"
        >
          🔐 Staff Login
        </Link>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-2xl">
          <a href="/products" className="bg-white rounded-xl border border-gray-200 px-5 py-5 hover:shadow-md transition text-left">
            <h2 className="text-lg font-semibold mb-1">Products →</h2>
            <p className="text-sm text-gray-500">Poplin under Kothari Gold brand.</p>
          </a>
          <a href="/gallery" className="bg-white rounded-xl border border-gray-200 px-5 py-5 hover:shadow-md transition text-left">
            <h2 className="text-lg font-semibold mb-1">Gallery →</h2>
            <p className="text-sm text-gray-500">Manufacturing process photos.</p>
          </a>
          <a href="/contact" className="bg-white rounded-xl border border-gray-200 px-5 py-5 hover:shadow-md transition text-left">
            <h2 className="text-lg font-semibold mb-1">Contact →</h2>
            <p className="text-sm text-gray-500">Get in touch for inquiries.</p>
          </a>
        </div>
      </main>
    </>
  )
}
