'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signIn } from '@/lib/auth'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const res = await signIn(email, password)
    setBusy(false)
    if (res.error !== null) { setError(res.error); return }
    router.replace('/')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="flex items-center px-6" style={{ background: '#1A1A1A', height: 52 }}>
        <span className="text-sm font-semibold tracking-widest" style={{ color: '#E8650D' }}>WINGS GROUP</span>
        <span className="text-xs text-gray-400 ml-3">Activation — Sign in</span>
      </div>

      <div className="flex-1 flex items-center justify-center px-4">
        <form onSubmit={submit} aria-label="Sign in"
          className="bg-white border border-gray-100 rounded-2xl p-8 w-full max-w-sm shadow-sm">
          <div className="w-12 h-12 rounded-2xl mb-5 flex items-center justify-center text-white text-lg font-bold" style={{ background: '#E8650D' }}>W</div>
          <h1 className="text-xl font-semibold text-gray-900 mb-1">Sign in</h1>
          <p className="text-sm text-gray-400 mb-6">Wings Activation client intelligence</p>

          <label htmlFor="login-email" className="block text-xs font-medium text-gray-500 mb-1">Email</label>
          <input id="login-email" type="email" autoComplete="email" required value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg mb-4 focus:outline-none focus:border-orange-400" />

          <label htmlFor="login-password" className="block text-xs font-medium text-gray-500 mb-1">Password</label>
          <input id="login-password" type="password" autoComplete="current-password" required value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg mb-4 focus:outline-none focus:border-orange-400" />

          {error && <p role="alert" className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-4">{error}</p>}

          <button type="submit" disabled={busy || !email || !password}
            className="w-full px-4 py-2.5 text-sm font-medium text-white rounded-lg disabled:opacity-50"
            style={{ background: '#E8650D' }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="text-xs text-gray-400 mt-5 text-center">
            No account? Ask your administrator for an invite.
          </p>
        </form>
      </div>
    </div>
  )
}
