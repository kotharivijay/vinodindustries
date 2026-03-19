import PublicNav from '@/components/PublicNav'

export default function Contact() {
  return (
    <>
      <PublicNav />
      <main className="flex min-h-screen flex-col items-center p-24">
        <h1 className="text-4xl font-bold mb-8">Contact Us</h1>
        <div className="max-w-2xl w-full">
          <div className="mb-6">
            <h2 className="text-2xl font-semibold mb-2">Address</h2>
            <p>Placeholder Address, City, State, PIN Code</p>
          </div>
          <div className="mb-6">
            <h2 className="text-2xl font-semibold mb-2">Email</h2>
            <p>info@vinodindustries.co.in</p>
          </div>
          <div className="mb-6">
            <h2 className="text-2xl font-semibold mb-2">Mobile</h2>
            <p>+91-XXXXXXXXXX</p>
          </div>
          <p className="text-sm text-gray-500">Please replace placeholders with actual contact information.</p>
        </div>
      </main>
    </>
  )
}
