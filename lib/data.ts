// Data layer — every Supabase read/write for the app lives here.
// UI components never touch `supabase` directly and never see a raw PostgrestError.

import { supabase, Client, Invoice, Proposal } from './supabase'

export type Result<T> = { data: T; error: null } | { data: null; error: string }

const ok = <T,>(data: T): Result<T> => ({ data, error: null })
const fail = <T,>(msg: string): Result<T> => ({ data: null, error: msg })

// ---------- shared helpers ----------

/** Null-safe currency formatter (Indian lakh notation). */
export const formatRs = (n: number | null | undefined) => {
  const v = n ?? 0
  return 'Rs ' + (v >= 100000 ? (v / 100000).toFixed(1) + 'L' : v.toLocaleString('en-IN'))
}

export const daysSince = (date: string | null | undefined): number | null => {
  if (!date) return null
  const t = new Date(date).getTime()
  if (Number.isNaN(t)) return null
  return Math.floor((Date.now() - t) / 86400000)
}

/**
 * Invoice status is DERIVED from due_date at read time, never trusted from the
 * stored column (a stored "due_today" is wrong tomorrow). "paid" is the only
 * stored state that wins.
 */
export type EffectiveInvoiceStatus = 'paid' | 'pending' | 'due_today' | 'overdue'
export const effectiveInvoiceStatus = (inv: Pick<Invoice, 'status' | 'due_date'>): EffectiveInvoiceStatus => {
  if (inv.status === 'paid') return 'paid'
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const due = new Date(inv.due_date); due.setHours(0, 0, 0, 0)
  if (Number.isNaN(due.getTime())) return 'pending'
  if (due.getTime() < today.getTime()) return 'overdue'
  if (due.getTime() === today.getTime()) return 'due_today'
  return 'pending'
}

// ---------- validation (zero-dependency; swap to zod when the repo adopts it) ----------

export type ClientInput = {
  name: string
  industry?: string
  city?: string
  segment: 'existing' | 'wishlist' | 'winback'
  status: string
  monthly_value?: string | number
  notes?: string
}

const MAX_MONTHLY_VALUE = 100_000_000 // Rs 10 crore/month sanity ceiling

export function validateClientInput(input: ClientInput): string | null {
  const name = input.name?.trim()
  if (!name) return 'Client name is required.'
  if (name.length > 120) return 'Client name must be 120 characters or fewer.'
  const mv = Number(input.monthly_value ?? 0)
  if (Number.isNaN(mv)) return 'Monthly value must be a number.'
  if (mv < 0) return 'Monthly value cannot be negative.'
  if (mv > MAX_MONTHLY_VALUE) return 'Monthly value looks too large — please double-check.'
  if (!['existing', 'wishlist', 'winback'].includes(input.segment)) return 'Invalid segment.'
  return null
}

export type InvoiceInput = { client_id: string; amount: string | number; due_date: string; status: string }

export function validateInvoiceInput(input: InvoiceInput): string | null {
  const amt = Number(input.amount)
  if (!input.amount || Number.isNaN(amt)) return 'Amount must be a number.'
  if (amt <= 0) return 'Amount must be greater than zero.'
  if (amt > MAX_MONTHLY_VALUE) return 'Amount looks too large — please double-check.'
  if (!input.due_date || Number.isNaN(new Date(input.due_date).getTime())) return 'A valid due date is required.'
  if (!['pending', 'paid', 'overdue', 'due_today'].includes(input.status)) return 'Invalid status.'
  return null
}

// ---------- reads ----------

export async function getDashboardData(): Promise<Result<{ clients: Client[]; invoices: Invoice[] }>> {
  const [clientsRes, invoicesRes] = await Promise.all([
    supabase
      .from('clients')
      .select('*, profiles(full_name, team, emp_code, role)')
      .order('monthly_value', { ascending: false }),
    supabase.from('invoices').select('*'),
  ])
  if (clientsRes.error) return fail(`Could not load clients: ${clientsRes.error.message}`)
  if (invoicesRes.error) return fail(`Could not load invoices: ${invoicesRes.error.message}`)
  return ok({
    clients: (clientsRes.data as Client[]) ?? [],
    invoices: (invoicesRes.data as Invoice[]) ?? [],
  })
}

export async function getClientDetail(id: string): Promise<Result<{
  client: Client | null
  invoices: Invoice[]
  proposals: Proposal[]
  portfolioMonthlyTotal: number
}>> {
  const [clientRes, invRes, propRes, allRes] = await Promise.all([
    supabase.from('clients').select('*, profiles(full_name, email, role, team, emp_code)').eq('id', id).maybeSingle(),
    supabase.from('invoices').select('*').eq('client_id', id).order('due_date', { ascending: false }),
    supabase.from('proposals').select('*').eq('client_id', id).order('created_at', { ascending: false }),
    supabase.from('clients').select('monthly_value').eq('segment', 'existing'),
  ])
  if (clientRes.error) return fail(`Could not load client: ${clientRes.error.message}`)
  // Invoices/proposals failing shouldn't blank the whole profile — degrade gracefully.
  const portfolioMonthlyTotal = ((allRes.data as { monthly_value: number | null }[]) ?? [])
    .reduce((s, c) => s + (c.monthly_value ?? 0), 0)
  return ok({
    client: (clientRes.data as Client) ?? null,
    invoices: invRes.error ? [] : ((invRes.data as Invoice[]) ?? []),
    proposals: propRes.error ? [] : ((propRes.data as Proposal[]) ?? []),
    portfolioMonthlyTotal,
  })
}

// ---------- writes ----------

export async function createClientRecord(input: ClientInput): Promise<Result<true>> {
  const validationError = validateClientInput(input)
  if (validationError) return fail(validationError)
  const { error } = await supabase.from('clients').insert({
    name: input.name.trim(),
    industry: input.industry?.trim() || null,
    city: input.city?.trim() || null,
    segment: input.segment,
    status: input.status,
    monthly_value: Number(input.monthly_value) || 0,
    notes: input.notes?.trim() || null,
    last_contact: new Date().toISOString().slice(0, 10),
  })
  if (error) return fail(`Could not save client: ${error.message}`)
  return ok(true)
}

export async function createInvoice(input: InvoiceInput): Promise<Result<true>> {
  const validationError = validateInvoiceInput(input)
  if (validationError) return fail(validationError)
  const { error } = await supabase.from('invoices').insert({
    client_id: input.client_id,
    amount: Number(input.amount),
    due_date: input.due_date,
    status: input.status,
    paid_date: input.status === 'paid' ? new Date().toISOString().slice(0, 10) : null,
  })
  if (error) return fail(`Could not save invoice: ${error.message}`)
  return ok(true)
}

export async function logContactToday(clientId: string, currentStatus?: string): Promise<Result<true>> {
  const updates: { last_contact: string; status?: string } = {
    last_contact: new Date().toISOString().slice(0, 10),
  }
  if (currentStatus === 'at_risk') updates.status = 'stable'
  const { error } = await supabase.from('clients').update(updates).eq('id', clientId)
  if (error) return fail(`Could not log contact: ${error.message}`)
  return ok(true)
}

// ---------- team directory ----------
// Single source of truth (was duplicated/hardcoded in two pages). The migration
// adds team/emp_code columns to profiles; this map is only the fallback until
// those columns are populated.
export const EMP_FALLBACK: Record<string, { id: string; team: string; role: string }> = {
  'Arun Samuel':  { id: 'WG-EMP-001', team: 'Leadership', role: 'Chairman & MD' },
  'Priya Rajan':  { id: 'WG-EMP-002', team: 'Team North', role: 'Account Manager' },
  'Arjun Mehta':  { id: 'WG-EMP-003', team: 'Team West',  role: 'Account Executive' },
  'Rahul Sharma': { id: 'WG-EMP-004', team: 'Team South', role: 'Account Executive' },
  'Sneha Kapoor': { id: 'WG-EMP-005', team: 'Team East',  role: 'Account Executive' },
}

export const empInfo = (p?: Partial<{ full_name: string; team: string | null; emp_code: string | null }> | null) => {
  const name = p?.full_name ?? ''
  const fb = EMP_FALLBACK[name]
  return {
    name,
    team: p?.team || fb?.team || 'Team',
    id: p?.emp_code || fb?.id || '—',
    role: fb?.role || '',
  }
}
