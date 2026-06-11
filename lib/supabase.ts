import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseKey)

export type Profile = {
  id: string
  full_name: string
  email: string
  role: 'admin' | 'manager' | 'executive'
}

export type Client = {
  id: string
  name: string
  industry: string
  city: string
  assigned_to: string
  segment: 'existing' | 'wishlist' | 'winback'
  status: string
  monthly_value: number
  contract_start: string
  contract_end: string
  last_contact: string
  reason_for_leaving: string
  left_date: string
  notes: string
  profiles?: Profile
}

export type Invoice = {
  id: string
  client_id: string
  amount: number
  due_date: string
  status: 'pending' | 'paid' | 'overdue' | 'due_today'
}

export type Proposal = {
  id: string
  client_id: string
  title: string
  value: number
  campaign_budget: number
  actual_spend: number
  status: string
  sent_date: string
  signed_date: string
}
