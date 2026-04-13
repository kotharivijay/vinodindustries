'use client'
import { redirect } from 'next/navigation'
export default function Page() {
  return (
    <div className="p-4 md:p-6 dark:text-gray-100">
      <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-4">Others</h1>
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-8 text-center">
        <p className="text-gray-400 text-sm">Coming soon — inventory tracking for Others.</p>
        <p className="text-[10px] text-gray-300 mt-2">Purchase entry, stock tracking, and reporting will be available here.</p>
      </div>
    </div>
  )
}
