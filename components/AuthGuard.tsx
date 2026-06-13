'use client'
// Wraps every page (mounted in app/layout.tsx). Redirects logged-out users to
// /login and exposes the session + profile via useAuth(). This is UX only —
// real enforcement is RLS: without a valid JWT the database returns nothing.

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Session } from '@supabase/supabase-js'
import { Profile } from '@/lib/supabase'
import { getSession, getCurrentProfile, onAuthChange, signOut as authSignOut } from '@/lib/auth'

type AuthContextValue = {
  session: Session | null
  profile: Profile | null
  /** admin only */
  isAdmin: boolean
  /** admin or manager — can write data and upload files */
  canWrite: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  session: null, profile: null, isAdmin: false, canWrite: false,
  signOut: async () => {},
})

export const useAuth = () => useContext(AuthContext)

function FullPageSpinner() {
  return (
    <div className="flex items-center justify-center h-screen bg-gray-50" aria-busy="true" aria-label="Checking sign-in">
      <div className="text-center">
        <div className="w-10 h-10 rounded-2xl mx-auto mb-3 flex items-center justify-center text-white font-bold animate-pulse" style={{ background: '#E8650D' }}>W</div>
        <p className="text-xs text-gray-400">Checking sign-in…</p>
      </div>
    </div>
  )
}

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [checked, setChecked] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) { setProfile(null); return }
    const res = await getCurrentProfile(s)
    // A profile load failure must not lock the user out — degrade to viewer.
    setProfile(res.error !== null ? null : res.data)
  }, [])

  useEffect(() => {
    let active = true
    ;(async () => {
      const s = await getSession()
      if (!active) return
      setSession(s)
      await loadProfile(s)
      if (active) setChecked(true)
    })()
    const unsubscribe = onAuthChange(async (s) => {
      if (!active) return
      setSession(s)
      await loadProfile(s)
    })
    return () => { active = false; unsubscribe() }
  }, [loadProfile])

  const isLoginPage = pathname === '/login'

  useEffect(() => {
    if (!checked) return
    if (!session && !isLoginPage) router.replace('/login')
    if (session && isLoginPage) router.replace('/')
  }, [checked, session, isLoginPage, router])

  const signOut = useCallback(async () => {
    await authSignOut()
    router.replace('/login')
  }, [router])

  if (!checked) return <FullPageSpinner />
  // Don't flash protected content while the redirect happens.
  if (!session && !isLoginPage) return <FullPageSpinner />

  const role = profile?.role ?? null
  return (
    <AuthContext.Provider value={{
      session, profile,
      isAdmin: role === 'admin',
      canWrite: role === 'admin' || role === 'manager',
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  )
}
