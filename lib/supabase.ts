import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  // Fail loudly at build/boot instead of silently rendering an empty dashboard.
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY env var')
}

export const supabase = createClient(supabaseUrl, supabaseKey)

// Nullable-correct types — DB columns that can be NULL are typed as such,
// so the compiler forces null handling instead of runtime crashes.
export type Profile = {
  id: string
  full_name: string
  email: string | null
  role: 'admin' | 'manager' | 'executive'
  team: string | null
  emp_code: string | null
}

export type Client = {
  id: string
  name: string
  industry: string | null
  city: string | null
  assigned_to: string | null
  segment: 'existing' | 'wishlist' | 'winback'
  status: string
  monthly_value: number | null
  contract_start: string | null
  contract_end: string | null
  last_contact: string | null
  reason_for_leaving: string | null
  left_date: string | null
  notes: string | null
  profiles?: Partial<Profile> | null
}

export type Invoice = {
  id: string
  client_id: string
  amount: number | null
  due_date: string
  paid_date: string | null
  status: 'pending' | 'paid' | 'overdue' | 'due_today'
}

export type Proposal = {
  id: string
  client_id: string
  title: string
  value: number | null
  campaign_budget: number | null
  actual_spend: number | null
  status: string
  sent_date: string | null
  signed_date: string | null
}
