// Data layer — every Supabase read/write for the app lives here.
// UI components never touch `supabase` directly and never see a raw PostgrestError.

import { supabase, Client, Invoice, InvoiceFile, Proposal, ActivityLog } from './supabase'

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

export const formatBytes = (bytes: number | null | undefined): string => {
  const v = bytes ?? 0
  if (v >= 1048576) return (v / 1048576).toFixed(1) + ' MB'
  if (v >= 1024) return Math.round(v / 1024) + ' KB'
  return v + ' B'
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

// ---------- invoice file uploads ----------

export const INVOICE_FILE_MAX_BYTES = 10 * 1024 * 1024 // 10 MB
const INVOICE_FILE_TYPES: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
}
export const INVOICE_FILE_ACCEPT = Object.keys(INVOICE_FILE_TYPES).join(',')

export function validateInvoiceFile(file: File): string | null {
  if (!INVOICE_FILE_TYPES[file.type]) return 'Only PDF, JPG and PNG files are accepted.'
  if (file.size <= 0) return 'This file is empty.'
  if (file.size > INVOICE_FILE_MAX_BYTES) return 'File is larger than 10 MB — please compress it first.'
  if (!file.name.trim()) return 'File has no name.'
  return null
}

const BUCKET = 'invoice-files'

export type UploadOpts = { invoiceId?: string | null; description?: string | null }

export async function uploadInvoiceFile(
  clientId: string,
  file: File,
  uploadedByProfileId: string | null,
  opts: UploadOpts = {},
): Promise<Result<true>> {
  const validationError = validateInvoiceFile(file)
  if (validationError) return fail(validationError)
  // Path is namespaced by client and timestamped — collisions impossible,
  // original name preserved separately in the table for display.
  const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-100)
  const path = `${clientId}/${Date.now()}_${safeName}`

  const up = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  })
  if (up.error) return fail(`Could not upload file: ${up.error.message}`)

  const ins = await supabase.from('invoice_files').insert({
    client_id: clientId,
    invoice_id: opts.invoiceId ?? null,
    description: opts.description?.trim() || null,
    file_path: path,
    file_name: file.name,
    file_size_bytes: file.size,
    mime_type: file.type,
    uploaded_by: uploadedByProfileId,
  })
  if (ins.error) {
    // Don't leave an orphan object behind; best-effort cleanup.
    await supabase.storage.from(BUCKET).remove([path])
    return fail(`Could not record the upload: ${ins.error.message}`)
  }
  return ok(true)
}

export async function listInvoiceFiles(clientId: string): Promise<Result<InvoiceFile[]>> {
  const { data, error } = await supabase
    .from('invoice_files')
    .select('*, profiles(full_name)')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
  if (error) return fail(`Could not load files: ${error.message}`)
  return ok((data as InvoiceFile[]) ?? [])
}

/** Short-lived signed URL — the bucket is private, links expire in 5 minutes. */
export async function getInvoiceFileUrl(filePath: string): Promise<Result<string>> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(filePath, 300)
  if (error || !data?.signedUrl) return fail(`Could not open file: ${error?.message ?? 'no URL returned'}`)
  return ok(data.signedUrl)
}

// ---------- activity log (append-only notes / audit trail) ----------

export type ActivityInput = {
  clientId: string
  body: string
  authorId?: string | null
  authorName?: string | null
  invoiceId?: string | null
  kind?: ActivityLog['kind']
}

export function validateActivityBody(body: string): string | null {
  const b = body.trim()
  if (!b) return 'Write something first.'
  if (b.length > 2000) return 'Note is too long (max 2000 characters).'
  return null
}

export async function addActivity(input: ActivityInput): Promise<Result<true>> {
  const verr = validateActivityBody(input.body)
  if (verr) return fail(verr)
  const { error } = await supabase.from('activity_log').insert({
    client_id: input.clientId,
    invoice_id: input.invoiceId ?? null,
    author_id: input.authorId ?? null,
    author_name: input.authorName ?? null,
    kind: input.kind ?? 'note',
    body: input.body.trim(),
  })
  if (error) return fail(`Could not save note: ${error.message}`)
  return ok(true)
}

export async function listClientActivity(clientId: string): Promise<Result<ActivityLog[]>> {
  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) return fail(`Could not load activity: ${error.message}`)
  return ok((data as ActivityLog[]) ?? [])
}

/** Global feed across all clients (for the /activity page). */
export async function getRecentActivity(limit = 100): Promise<Result<ActivityLog[]>> {
  const { data, error } = await supabase
    .from('activity_log')
    .select('*, clients(name)')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return fail(`Could not load activity: ${error.message}`)
  return ok((data as ActivityLog[]) ?? [])
}

// ---------- CSV bulk invoice import ----------
// Expected columns (header row required, any order): amount, due_date, status
// status is optional and defaults to "pending". Max 500 rows per import.

const CSV_MAX_ROWS = 500

/** Minimal RFC-4180-ish line parser: handles quoted fields and embedded commas. */
function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') inQuotes = false
      else cur += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out.map(s => s.trim())
}

export type CsvImportResult = { inserted: number; errors: string[] }

export async function importInvoicesCsv(clientId: string, csvText: string): Promise<Result<CsvImportResult>> {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lines.length < 2) return fail('CSV must have a header row plus at least one data row.')
  if (lines.length - 1 > CSV_MAX_ROWS) return fail(`Too many rows — maximum ${CSV_MAX_ROWS} per import.`)

  const header = parseCsvLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'))
  const amountIdx = header.indexOf('amount')
  const dueIdx = header.findIndex(h => h === 'due_date' || h === 'duedate' || h === 'due')
  const statusIdx = header.indexOf('status')
  if (amountIdx === -1 || dueIdx === -1) {
    return fail('CSV header must include "amount" and "due_date" columns (status is optional).')
  }

  const errors: string[] = []
  const rows: { client_id: string; amount: number; due_date: string; status: string; paid_date: string | null }[] = []

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i])
    const rawStatus = statusIdx !== -1 ? (cells[statusIdx] ?? '').toLowerCase() : ''
    const status = rawStatus === '' ? 'pending' : rawStatus
    const input: InvoiceInput = {
      client_id: clientId,
      amount: cells[amountIdx] ?? '',
      due_date: cells[dueIdx] ?? '',
      status,
    }
    const rowError = validateInvoiceInput(input)
    if (rowError) { errors.push(`Row ${i + 1}: ${rowError}`); continue }
    rows.push({
      client_id: clientId,
      amount: Number(input.amount),
      due_date: input.due_date,
      status,
      paid_date: status === 'paid' ? new Date().toISOString().slice(0, 10) : null,
    })
  }

  if (rows.length === 0) return fail(`No valid rows to import. ${errors[0] ?? ''}`)

  const { error } = await supabase.from('invoices').insert(rows)
  if (error) return fail(`Import failed at the database: ${error.message}`)
  return ok({ inserted: rows.length, errors })
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
  files: InvoiceFile[]
  activity: ActivityLog[]
  portfolioMonthlyTotal: number
}>> {
  const [clientRes, invRes, propRes, filesRes, activityRes, allRes] = await Promise.all([
    supabase.from('clients').select('*, profiles(full_name, email, role, team, emp_code)').eq('id', id).maybeSingle(),
    supabase.from('invoices').select('*').eq('client_id', id).order('due_date', { ascending: false }),
    supabase.from('proposals').select('*').eq('client_id', id).order('created_at', { ascending: false }),
    supabase.from('invoice_files').select('*, profiles(full_name)').eq('client_id', id).order('created_at', { ascending: false }),
    supabase.from('activity_log').select('*').eq('client_id', id).order('created_at', { ascending: false }).limit(200),
    supabase.from('clients').select('monthly_value').eq('segment', 'existing'),
  ])
  if (clientRes.error) return fail(`Could not load client: ${clientRes.error.message}`)
  // Secondary data failing shouldn't blank the whole profile — degrade gracefully.
  const portfolioMonthlyTotal = ((allRes.data as { monthly_value: number | null }[]) ?? [])
    .reduce((s, c) => s + (c.monthly_value ?? 0), 0)
  return ok({
    client: (clientRes.data as Client) ?? null,
    invoices: invRes.error ? [] : ((invRes.data as Invoice[]) ?? []),
    proposals: propRes.error ? [] : ((propRes.data as Proposal[]) ?? []),
    files: filesRes.error ? [] : ((filesRes.data as InvoiceFile[]) ?? []),
    activity: activityRes.error ? [] : ((activityRes.data as ActivityLog[]) ?? []),
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

/** Creates an invoice and returns its new id (so a PDF can be attached to it). */
export async function createInvoice(input: InvoiceInput): Promise<Result<{ id: string }>> {
  const validationError = validateInvoiceInput(input)
  if (validationError) return fail(validationError)
  const { data, error } = await supabase.from('invoices').insert({
    client_id: input.client_id,
    amount: Number(input.amount),
    due_date: input.due_date,
    status: input.status,
    paid_date: input.status === 'paid' ? new Date().toISOString().slice(0, 10) : null,
  }).select('id').single()
  if (error || !data) return fail(`Could not save invoice: ${error?.message ?? 'no id returned'}`)
  return ok({ id: data.id as string })
}

export async function logContactToday(
  clientId: string,
  currentStatus?: string,
  author?: { id: string | null; name: string | null },
): Promise<Result<true>> {
  const updates: { last_contact: string; status?: string } = {
    last_contact: new Date().toISOString().slice(0, 10),
  }
  if (currentStatus === 'at_risk') updates.status = 'stable'
  const { error } = await supabase.from('clients').update(updates).eq('id', clientId)
  if (error) return fail(`Could not log contact: ${error.message}`)
  // Best-effort activity entry — never blocks the contact log itself.
  await supabase.from('activity_log').insert({
    client_id: clientId,
    author_id: author?.id ?? null,
    author_name: author?.name ?? null,
    kind: 'contact',
    body: 'Logged contact' + (updates.status ? ' (status moved to stable)' : ''),
  })
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
