// Server-only route: creates login IDs with the service-role key.
// The key lives in a Vercel env var (SUPABASE_SERVICE_ROLE_KEY) and is never
// shipped to the browser. Caller must present a valid JWT belonging to an
// admin profile. Public self-signup is disabled in the Supabase dashboard,
// so this route is the ONLY way accounts get created.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const VALID_ROLES = ['admin', 'manager', 'executive'] as const
type Role = (typeof VALID_ROLES)[number]
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Body = { email?: unknown; password?: unknown; full_name?: unknown; role?: unknown }

function parseBody(raw: Body): { email: string; password: string; full_name: string; role: Role } | string {
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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 })
  }
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  // 1. Authenticate the caller from their bearer token.
  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const { data: caller, error: callerError } = await svc.auth.getUser(token)
  if (callerError || !caller.user) return NextResponse.json({ error: 'Session invalid — sign in again.' }, { status: 401 })

  // 2. Authorize: caller's profile must be admin.
  const { data: callerProfile, error: profileError } = await svc
    .from('profiles').select('role').eq('auth_user_id', caller.user.id).maybeSingle()
  if (profileError) return NextResponse.json({ error: 'Could not verify permissions.' }, { status: 500 })
  if (callerProfile?.role !== 'admin') {
    return NextResponse.json({ error: 'Only administrators can create users.' }, { status: 403 })
  }

  // 3. Validate input at the boundary.
  const raw = (await req.json().catch(() => null)) as Body | null
  if (!raw) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  const parsed = parseBody(raw)
  if (typeof parsed === 'string') return NextResponse.json({ error: parsed }, { status: 400 })

  // 4. Create the auth user. The handle_new_user trigger links/creates the
  //    profile row and reads full_name + app_role from this metadata.
  const { error: createError } = await svc.auth.admin.createUser({
    email: parsed.email,
    password: parsed.password,
    email_confirm: true, // internal tool — no confirmation email round-trip
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
