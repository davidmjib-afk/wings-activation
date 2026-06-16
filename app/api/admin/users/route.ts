// Server-only route: manages login IDs with the service-role key.
// The key lives in a Vercel env var (SUPABASE_SERVICE_ROLE_KEY) and is never
// shipped to the browser. Every method requires a valid admin JWT.
//   POST   — create a login
//   PATCH  — deactivate / reactivate a login (reversible)
//   DELETE — permanently remove a login + its profile row (not reversible)

import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const VALID_ROLES = ['admin', 'manager', 'executive'] as const
type Role = (typeof VALID_ROLES)[number]
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const BAN_FOREVER = '876000h' // ~100 years

function service(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return null
  return createClient(url, serviceKey, { auth: { persistSession: false } })
}

// Authenticate + authorize the caller as an admin. Returns the caller's auth id
// on success, or a NextResponse to return immediately on failure.
async function requireAdmin(req: NextRequest, svc: SupabaseClient): Promise<{ authId: string } | NextResponse> {
  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const { data: caller, error: callerError } = await svc.auth.getUser(token)
  if (callerError || !caller.user) return NextResponse.json({ error: 'Session invalid — sign in again.' }, { status: 401 })
  const { data: callerProfile, error: profileError } = await svc
    .from('profiles').select('role').eq('auth_user_id', caller.user.id).maybeSingle()
  if (profileError) return NextResponse.json({ error: 'Could not verify permissions.' }, { status: 500 })
  if (callerProfile?.role !== 'admin') {
    return NextResponse.json({ error: 'Only administrators can manage users.' }, { status: 403 })
  }
  return { authId: caller.user.id }
}

type TargetProfile = { id: string; role: Role; auth_user_id: string | null; is_active: boolean | null; full_name: string }

async function loadTarget(svc: SupabaseClient, profileId: string): Promise<TargetProfile | null> {
  const { data } = await svc
    .from('profiles').select('id, role, auth_user_id, is_active, full_name').eq('id', profileId).maybeSingle()
  return (data as TargetProfile) ?? null
}

// Count admins that can still log in (active + linked to an auth user).
async function activeAdminCount(svc: SupabaseClient): Promise<number> {
  const { data } = await svc.from('profiles').select('id, role, is_active, auth_user_id')
  return ((data as TargetProfile[]) ?? []).filter(
    p => p.role === 'admin' && p.is_active !== false && p.auth_user_id,
  ).length
}

// ---------- POST: create ----------

type CreateBody = { email?: unknown; password?: unknown; full_name?: unknown; role?: unknown }

function parseCreate(raw: CreateBody): { email: string; password: string; full_name: string; role: Role } | string {
  const email = typeof raw.email === 'string' ? raw.email.trim() : ''
  const password = typeof raw.password === 'string' ? raw.password : ''
  const full_name = typeof raw.full_name === 'string' ? raw.full_name.trim() : ''
  const role = typeof raw.role === 'string' ? raw.role : ''
  if (!EMAIL_RE.test(email)) return 'A valid email is required.'
  if (password.length < 8) return 'Password must be at least 8 characters.'
  if (!full_name || full_name.length > 120) return 'Full name is required (max 120 characters).'
  if (!VALID_ROLES.includes(role as Role)) return 'Role must be admin, manager or executive.'
  return { email, password, full_name, role: role as Role }
}

export async function POST(req: NextRequest) {
  const svc = service()
  if (!svc) return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 })
  const auth = await requireAdmin(req, svc)
  if (auth instanceof NextResponse) return auth

  const raw = (await req.json().catch(() => null)) as CreateBody | null
  if (!raw) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  const parsed = parseCreate(raw)
  if (typeof parsed === 'string') return NextResponse.json({ error: parsed }, { status: 400 })

  const { error: createError } = await svc.auth.admin.createUser({
    email: parsed.email,
    password: parsed.password,
    email_confirm: true,
    user_metadata: { full_name: parsed.full_name, app_role: parsed.role },
  })
  if (createError) {
    const msg = createError.message.toLowerCase().includes('already')
      ? 'A user with this email already exists.'
      : `Could not create user: ${createError.message}`
    return NextResponse.json({ error: msg }, { status: 409 })
  }
  return NextResponse.json({ ok: true }, { status: 201 })
}

// ---------- PATCH: deactivate / reactivate ----------

export async function PATCH(req: NextRequest) {
  const svc = service()
  if (!svc) return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 })
  const auth = await requireAdmin(req, svc)
  if (auth instanceof NextResponse) return auth

  const raw = (await req.json().catch(() => null)) as { profile_id?: unknown; action?: unknown } | null
  const profileId = typeof raw?.profile_id === 'string' ? raw.profile_id : ''
  const action = raw?.action === 'deactivate' || raw?.action === 'reactivate' ? raw.action : ''
  if (!profileId || !action) return NextResponse.json({ error: 'profile_id and a valid action are required.' }, { status: 400 })

  const target = await loadTarget(svc, profileId)
  if (!target) return NextResponse.json({ error: 'User not found.' }, { status: 404 })
  if (target.auth_user_id === auth.authId) {
    return NextResponse.json({ error: 'You cannot change the status of your own account.' }, { status: 400 })
  }

  if (action === 'deactivate') {
    if (target.role === 'admin' && (await activeAdminCount(svc)) <= 1) {
      return NextResponse.json({ error: 'Cannot deactivate the last active administrator.' }, { status: 400 })
    }
    if (target.auth_user_id) {
      const { error } = await svc.auth.admin.updateUserById(target.auth_user_id, { ban_duration: BAN_FOREVER })
      if (error) return NextResponse.json({ error: `Could not revoke login: ${error.message}` }, { status: 500 })
    }
    const { error } = await svc.from('profiles').update({ is_active: false }).eq('id', profileId)
    if (error) return NextResponse.json({ error: `Could not deactivate: ${error.message}` }, { status: 500 })
  } else {
    if (target.auth_user_id) {
      const { error } = await svc.auth.admin.updateUserById(target.auth_user_id, { ban_duration: 'none' })
      if (error) return NextResponse.json({ error: `Could not restore login: ${error.message}` }, { status: 500 })
    }
    const { error } = await svc.from('profiles').update({ is_active: true }).eq('id', profileId)
    if (error) return NextResponse.json({ error: `Could not reactivate: ${error.message}` }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

// ---------- DELETE: permanent ----------

export async function DELETE(req: NextRequest) {
  const svc = service()
  if (!svc) return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 })
  const auth = await requireAdmin(req, svc)
  if (auth instanceof NextResponse) return auth

  const raw = (await req.json().catch(() => null)) as { profile_id?: unknown } | null
  const profileId = typeof raw?.profile_id === 'string' ? raw.profile_id : ''
  if (!profileId) return NextResponse.json({ error: 'profile_id is required.' }, { status: 400 })

  const target = await loadTarget(svc, profileId)
  if (!target) return NextResponse.json({ error: 'User not found.' }, { status: 404 })
  if (target.auth_user_id === auth.authId) {
    return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 })
  }
  if (target.role === 'admin' && (await activeAdminCount(svc)) <= 1) {
    return NextResponse.json({ error: 'Cannot delete the last active administrator.' }, { status: 400 })
  }

  // Remove the auth login first (frees the email for reuse), then the profile row.
  if (target.auth_user_id) {
    const { error } = await svc.auth.admin.deleteUser(target.auth_user_id)
    if (error) return NextResponse.json({ error: `Could not delete login: ${error.message}` }, { status: 500 })
  }
  const { error } = await svc.from('profiles').delete().eq('id', profileId)
  if (error) return NextResponse.json({ error: `Login removed but profile delete failed: ${error.message}` }, { status: 500 })

  return NextResponse.json({ ok: true })
}
