'use client'

import { signOut } from 'next-auth/react'

export default function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: '/login' })}
      className="w-full text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg px-3 py-2 transition text-left"
    >
      Sign Out
    </button>
  )
}
