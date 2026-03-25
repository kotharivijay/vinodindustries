'use client'

import { signIn } from 'next-auth/react'

export default function LoginForm({ error }: { error?: string }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-10 w-full max-w-md text-center">
        {/* Logo / Branding */}
        <div className="mb-8">
          <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-2xl font-bold">KSI</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Kothari Synthetic Industries</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">Textile Management System</p>
        </div>

        {/* Error message */}
        {error === 'AccessDenied' && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6 text-sm text-left">
            <strong>Access Denied</strong>
            <p className="mt-1 text-red-600">Your Gmail account is not authorized. Contact admin.</p>
          </div>
        )}
        {error && error !== 'AccessDenied' && (
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 rounded-lg p-4 mb-6 text-sm">
            Sign-in error. Please try again.
          </div>
        )}

        {/* Google Sign In */}
        <button
          onClick={() => signIn('google', { callbackUrl: '/dashboard' })}
          className="w-full flex items-center justify-center gap-3 bg-indigo-600 rounded-xl px-6 py-4 text-white font-bold text-base hover:bg-indigo-700 active:bg-indigo-800 transition-all shadow-lg shadow-indigo-200"
        >
          <span className="bg-white rounded-full p-1 flex items-center justify-center">
            <GoogleIcon />
          </span>
          Sign in with Google
        </button>

        <p className="text-xs text-gray-400 dark:text-gray-500 mt-8">
          Only authorized Gmail accounts can access this system.
        </p>
      </div>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  )
}
