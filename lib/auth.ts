// Auth layer — every Supabase Auth interaction lives here, mirroring lib/data.ts.
// UI components never call supabase.auth directly.

import { Session } from '@supabase/supabase-js'
import { supabase, Profile } from './supabase'

export type AuthResult<T> = { data: T; error: null } | { data: null; error: string }

const ok = <T,>(data: T): AuthResult<T> => ({ data, error: null })
const fail = <T,>(msg: string): AuthResult<T> => ({ data: null, error: msg })

// ---------- validation ----------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateLoginInput(email: string, password: string): string | null {
  if (!EMAIL_RE.test(email.trim())) return 'Enter a valid email address.'
  if (!password) return 'Password is required.'
  return null
}

export type NewUserInput = {
  email: string
  password: string
  full_name: string
  role: 'admin' | 'manager' | 'executive'
}

export function validateNewUserInput(input: NewUserInput): string | null {
  if (!EMAIL_RE.test(input.email.trim())) return 'Enter a valid email address.'
  if (input.password.length < 8) return 'Password must be at least 8 characters.'
  const name = input.full_name.trim()
  if (!name) return 'Full name is required.'
  if (name.length > 120) return 'Full name must be 120 characters or fewer.'
  if (!['admin', 'manager', 'executive'].includes(input.role)) return 'Invalid role.'
  return null
}

// ---------- session ----------

export async function signIn(email: string, password: string): Promise<AuthResult<true>> {
  const validationError = validateLoginInput(email, password)
  if (validationError) return fail(validationError)
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  if (error) {
    // Don't leak whether the email exists.
    if (error.message.toLowerCase().includes('invalid')) return fail('Incorrect email or password.')
    return fail(`Could not sign in: ${error.message}`)
  }
  return ok(true)
}

export async function signOut(): Promise<AuthResult<true>> {
  const { error } = await supabase.auth.signOut()
  if (error) return fail(`Could not sign out: ${error.message}`)
  return ok(true)
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession()
  return data.session
}

/** Fires callback on login/logout; returns an unsubscribe function. */
export function onAuthChange(callback: (session: Session | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session))
  return () => data.subscription.unsubscribe()
}

/** Profile for the logged-in user — linked by auth_user_id, email as fallback
 *  (covers pre-migration profiles that haven't been linked yet). */
export async function getCurrentProfile(session: Session): Promise<AuthResult<Profile | null>> {
  const byId = await supabase
    .from('profiles').select('*').eq('auth_user_id', session.user.id).maybeSingle()
  if (byId.error) return fail(`Could not load your profile: ${byId.error.message}`)
  if (byId.data) return ok(byId.data as Profile)
  const email = session.user.email
  if (!email) return ok(null)
  const byEmail = await supabase
    .from('profiles').select('*').eq('email', email).maybeSingle()
  if (byEmail.error) return fail(`Could not load your profile: ${byEmail.error.message}`)
  return ok((byEmail.data as Profile) ?? null)
}

// ---------- self-service: change own password ----------

export function validateNewPassword(next: string, confirm: string): string | null {
  if (next.length < 8) return 'New password must be at least 8 characters.'
  if (next.length > 72) return 'New password must be 72 characters or fewer.'
  if (next !== confirm) return 'The two passwords do not match.'
  return null
}

export async function changePassword(newPassword: string): Promise<AuthResult<true>> {
  if (newPassword.length < 8) return fail('New password must be at least 8 characters.')
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) {
    if (error.message.toLowerCase().includes('should be different')) {
      return fail('New password must be different from your current one.')
    }
    return fail(`Could not update password: ${error.message}`)
  }
  return ok(true)
}

// ---------- admin: manage login IDs (all via the service-role server route) ----------

async function adminFetch(method: 'POST' | 'PATCH' | 'DELETE', body: unknown): Promise<AuthResult<true>> {
  const session = await getSession()
  if (!session) return fail('Your session has expired — please sign in again.')
  const res = await fetch('/api/admin/users', {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    return fail(data?.error ?? `Request failed (HTTP ${res.status}).`)
  }
  return ok(true)
}

export async function adminCreateUser(input: NewUserInput): Promise<AuthResult<true>> {
  const validationError = validateNewUserInput(input)
  if (validationError) return fail(validationError)
  return adminFetch('POST', {
    email: input.email.trim(),
    password: input.password,
    full_name: input.full_name.trim(),
    role: input.role,
  })
}

/** Revoke login but keep the profile + history. Reversible. */
export async function adminDeactivateUser(profileId: string): Promise<AuthResult<true>> {
  if (!profileId) return fail('Missing user.')
  return adminFetch('PATCH', { profile_id: profileId, action: 'deactivate' })
}

/** Restore a deactivated user's login. */
export async function adminReactivateUser(profileId: string): Promise<AuthResult<true>> {
  if (!profileId) return fail('Missing user.')
  return adminFetch('PATCH', { profile_id: profileId, action: 'reactivate' })
}

/** Permanently remove the login AND the profile row. Not reversible. */
export async function adminDeleteUser(profileId: string): Promise<AuthResult<true>> {
  if (!profileId) return fail('Missing user.')
  return adminFetch('DELETE', { profile_id: profileId })
}

export async function listProfiles(): Promise<AuthResult<Profile[]>> {
  const { data, error } = await supabase
    .from('profiles').select('*').order('full_name', { ascending: true })
  if (error) return fail(`Could not load users: ${error.message}`)
  return ok((data as Profile[]) ?? [])
}
