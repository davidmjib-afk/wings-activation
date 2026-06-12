'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase, Client, Invoice, Proposal } from '@/lib/supabase'
import {
  ArrowLeft, TrendingUp, TrendingDown, AlertTriangle,
  CheckCircle, Clock, DollarSign, FileText, Phone,
  Mail, Calendar, User, Building, MapPin, Activity
} from 'lucide-react'

const formatRs = (n: number) =>
  'Rs ' + (n >= 100000
    ? (n / 100000).toFixed(1) + 'L'
    : n >= 1000
    ? (n / 1000).toFixed(0) + 'K'
    : n.toLocaleString('en-IN'))

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  growing:         { label: 'Growing',          color: '#27500A', bg: '#EAF3DE' },
  stable:          { label: 'Stable',            color: '#185FA5', bg: '#E6F1FB' },
  at_risk:         { label: 'At risk',           color: '#A32D2D', bg: '#FCEBEB' },
  lost:            { label: 'Lost',              color: '#5F5E5A', bg: '#F1EFE8' },
  negotiating:     { label: 'Negotiating',       color: '#854F0B', bg: '#FAEEDA' },
  ready_to_sign:   { label: 'Ready to sign',     color: '#27500A', bg: '#EAF3DE' },
  first_meeting:   { label: 'First meeting',     color: '#5F5E5A', bg: '#F1EFE8' },
  intro_made:      { label: 'Intro made',        color: '#185FA5', bg: '#E6F1FB' },
  in_conversation: { label: 'In conversation',   color: '#854F0B', bg: '#FAEEDA' },
  meeting_booked:  { label: 'Meeting booked',    color: '#27500A', bg: '#EAF3DE' },
  not_contacted:   { label: 'Not contacted',     color: '#A32D2D', bg: '#FCEBEB' },
  prospect:        { label: 'Proposal sent',     color: '#185FA5', bg: '#E6F1FB' },
}

const invoiceConfig: Record<string, { label: string; color: string; bg: string }> = {
  paid:      { label: 'Paid',      color: '#27500A', bg: '#EAF3DE' },
  overdue:   { label: 'Overdue',   color: '#A32D2D', bg: '#FCEBEB' },
  due_today: { label: 'Due today', color: '#B34E00', bg: '#FDF1E7' },
  pending:   { label: 'Pending',   color: '#5F5E5A', bg: '#F1EFE8' },
}

export default function ClientDetail() {
  const params = useParams()
  const router = useRouter()
  const [client, setClient] = useState<Client | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [allClients, setAllClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview' | 'invoices' | 'proposals' | 'metrics'>('overview')
  const [logging, setLogging] = useState(false)
  const [showInv, setShowInv] = useState(false)
  const [invForm, setInvForm] = useState({ amount: '', due_date: '', status: 'pending' })
  const [savingInv, setSavingInv] = useState(false)

  async function reloadAll() {
    const [{ data: c }, { data: inv }] = await Promise.all([
      supabase.from('clients').select('*, profiles(full_name, email, role)').eq('id', params.id).single(),
      supabase.from('invoices').select('*').eq('client_id', params.id).order('due_date', { ascending: false }),
    ])
    setClient(c as Client)
    setInvoices((inv as Invoice[]) || [])
  }

  async function logContact() {
    setLogging(true)
    const today = new Date().toISOString().slice(0, 10)
    const updates: Record<string, any> = { last_contact: today }
    if (client?.status === 'at_risk') updates.status = 'stable'
    await supabase.from('clients').update(updates).eq('id', params.id)
    await reloadAll()
    setLogging(false)
  }

  async function addInvoice() {
    if (!invForm.amount || !invForm.due_date) return
    setSavingInv(true)
    await supabase.from('invoices').insert({
      client_id: params.id, amount: Number(invForm.amount),
      due_date: invForm.due_date, status: invForm.status,
      paid_date: invForm.status === 'paid' ? new Date().toISOString().slice(0, 10) : null,
    })
    await reloadAll()
    setSavingInv(false); setShowInv(false)
    setInvForm({ amount: '', due_date: '', status: 'pending' })
  }

  useEffect(() => {
    async function load() {
      const [{ data: c }, { data: inv }, { data: prop }, { data: all }] = await Promise.all([
        supabase.from('clients').select('*, profiles(full_name, email, role)').eq('id', params.id).single(),
        supabase.from('invoices').select('*').eq('client_id', params.id).order('due_date', { ascending: false }),
        supabase.from('proposals').select('*').eq('client_id', params.id).order('created_at', { ascending: false }),
        supabase.from('clients').select('monthly_value, segment').eq('segment', 'existing'),
      ])
      setClient(c as Client)
      setInvoices((inv as Invoice[]) || [])
      setProposals((prop as Proposal[]) || [])
      setAllClients((all as Client[]) || [])
      setLoading(false)
    }
    load()
  }, [params.id])

  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center">
        <div className="w-8 h-8 border-2 rounded-full animate-spin mx-auto mb-3" style={{ borderColor: '#E8650D', borderTopColor: 'transparent' }} />
        <p className="text-sm text-gray-500">Loading client profile...</p>
      </div>
    </div>
  )

  if (!client) return (
    <div className="flex items-center justify-center h-screen">
      <p className="text-gray-500">Client not found.</p>
    </div>
  )

  const daysSince = (date: string | null) => {
    if (!date) return null
    return Math.floor((Date.now() - new Date(date).getTime()) / 86400000)
  }

  const totalBilled = invoices.reduce((s, i) => s + i.amount, 0)
  const totalPaid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0)
  const totalOutstanding = invoices.filter(i => i.status !== 'paid').reduce((s, i) => s + i.amount, 0)
  const totalProposalValue = proposals.reduce((s, p) => s + p.value, 0)
  const signedProposals = proposals.filter(p => p.status === 'signed')
  const totalSigned = signedProposals.reduce((s, p) => s + p.value, 0)
  const totalSpend = proposals.reduce((s, p) => s + (p.actual_spend || 0), 0)
  const totalBudget = proposals.reduce((s, p) => s + (p.campaign_budget || 0), 0)
  const budgetUtilisation = totalBudget > 0 ? Math.round((totalSpend / totalBudget) * 100) : 0
  const annualisedValue = client.monthly_value * 12
  const totalMonthlyAll = allClients.reduce((s, c) => s + c.monthly_value, 0)
  const revenueShare = totalMonthlyAll > 0 ? ((client.monthly_value / totalMonthlyAll) * 100).toFixed(1) : '0'
  const contractDaysLeft = client.contract_end
    ? Math.floor((new Date(client.contract_end).getTime() - Date.now()) / 86400000)
    : null
  const lastContactDays = daysSince(client.last_contact)
  const st = statusConfig[client.status] || statusConfig['stable']

  const Metric = ({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) => (
    <div className="bg-white border border-gray-100 rounded-xl p-4">
      <div className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-1.5">{label}</div>
      <div className={`text-2xl font-semibold ${color || 'text-gray-900'}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Topbar */}
      <div className="flex items-center justify-between px-6 flex-shrink-0" style={{ background: '#1A1A1A', height: 52 }}>
        <span className="text-sm font-semibold tracking-widest" style={{ color: '#E8650D' }}>WINGS GROUP</span>
        <span className="text-xs text-gray-400">Activation — Client Profile</span>
        <div className="flex items-center gap-2 bg-gray-800 rounded-full px-3 py-1">
          <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-semibold" style={{ background: '#E8650D' }}>AS</div>
          <span className="text-xs text-gray-300">Arun Samuel</span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* Back button */}
        <button onClick={() => router.back()}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 mb-5 transition-colors">
          <ArrowLeft size={16} /> Back to dashboard
        </button>

        {/* Client header */}
        <div className="bg-white border border-gray-100 rounded-2xl p-6 mb-5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-lg font-bold flex-shrink-0"
                style={{ background: '#E8650D' }}>
                {client.name.charAt(0)}
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-gray-900">{client.name}</h1>
                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                  <span className="flex items-center gap-1 text-sm text-gray-500"><Building size={13} />{client.industry}</span>
                  <span className="flex items-center gap-1 text-sm text-gray-500"><MapPin size={13} />{client.city}</span>
                  {client.profiles && (
                    <span className="flex items-center gap-1 text-sm text-gray-500"><User size={13} />{(client.profiles as any).full_name}</span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={logContact} disabled={logging}
                className="px-4 py-1.5 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50"
                style={{ borderColor: '#E8650D', color: '#E8650D' }}>
                {logging ? 'Logging...' : 'Log contact today'}
              </button>
              <button onClick={() => setShowInv(true)}
                className="px-4 py-1.5 rounded-lg text-sm font-medium text-white"
                style={{ background: '#E8650D' }}>
                + Invoice
              </button>
              <span className="px-3 py-1.5 rounded-full text-sm font-medium" style={{ background: st.bg, color: st.color }}>
                {st.label}
              </span>
              <div className="text-right">
                <div className="text-2xl font-bold" style={{ color: '#E8650D' }}>{formatRs(client.monthly_value)}</div>
                <div className="text-xs text-gray-400">per month</div>
              </div>
            </div>
          </div>

          {/* Quick stats bar */}
          <div className="grid grid-cols-5 gap-4 mt-5 pt-5 border-t border-gray-100">
            <div className="text-center">
              <div className="text-lg font-semibold">{formatRs(annualisedValue)}</div>
              <div className="text-xs text-gray-400 mt-0.5">Annualised value</div>
            </div>
            <div className="text-center">
              <div className={`text-lg font-semibold ${lastContactDays && lastContactDays > 30 ? 'text-red-600' : 'text-gray-900'}`}>
                {lastContactDays !== null ? `${lastContactDays}d ago` : 'Never'}
              </div>
              <div className="text-xs text-gray-400 mt-0.5">Last contact</div>
            </div>
            <div className="text-center">
              <div className={`text-lg font-semibold ${contractDaysLeft !== null && contractDaysLeft < 60 ? 'text-amber-600' : 'text-gray-900'}`}>
                {contractDaysLeft !== null ? `${contractDaysLeft}d` : 'N/A'}
              </div>
              <div className="text-xs text-gray-400 mt-0.5">Contract remaining</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold">{revenueShare}%</div>
              <div className="text-xs text-gray-400 mt-0.5">Revenue share</div>
            </div>
            <div className="text-center">
              <div className={`text-lg font-semibold ${budgetUtilisation > 90 ? 'text-amber-600' : budgetUtilisation < 30 ? 'text-red-500' : 'text-gray-900'}`}>
                {budgetUtilisation}%
              </div>
              <div className="text-xs text-gray-400 mt-0.5">Budget utilised</div>
            </div>
          </div>
        </div>

        {/* Alert if at risk */}
        {client.status === 'at_risk' && (
          <div className="flex items-start gap-3 rounded-xl p-4 mb-5 border" style={{ background: '#FCEBEB', borderColor: '#E24B4A' }}>
            <AlertTriangle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-700">
              <strong>This client is at risk.</strong> Last contacted {lastContactDays} days ago.
              {contractDaysLeft !== null && contractDaysLeft < 90 && ` Contract expires in ${contractDaysLeft} days.`}
              {' '}Immediate outreach recommended.
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 mb-5">
          {(['overview', 'invoices', 'proposals', 'metrics'] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              className="px-5 py-2 rounded-full text-sm font-medium border transition-all capitalize"
              style={activeTab === t
                ? { background: '#E8650D', color: 'white', borderColor: '#E8650D' }
                : { background: 'white', color: '#666', borderColor: '#e5e7eb' }}>
              {t === 'overview' ? 'Overview' : t === 'invoices' ? `Invoices (${invoices.length})` : t === 'proposals' ? `Proposals (${proposals.length})` : 'All metrics'}
            </button>
          ))}
        </div>

        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <div className="space-y-5">
            <div className="grid grid-cols-4 gap-3">
              <Metric label="Monthly value" value={formatRs(client.monthly_value)} sub="Current billing" />
              <Metric label="Annualised value" value={formatRs(annualisedValue)} sub="Projected annual" />
              <Metric label="Total billed" value={formatRs(totalBilled)} sub={`${invoices.length} invoices`} />
              <Metric label="Outstanding" value={formatRs(totalOutstanding)}
                sub={`${invoices.filter(i => i.status !== 'paid').length} unpaid`}
                color={totalOutstanding > 0 ? 'text-red-600' : 'text-green-700'} />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white border border-gray-100 rounded-xl p-4 col-span-2">
                <div className="text-sm font-semibold text-gray-800 mb-3">Client details</div>
                <div className="grid grid-cols-2 gap-y-3 text-sm">
                  {[
                    { label: 'Industry',         value: client.industry || 'Not set' },
                    { label: 'City',             value: client.city || 'Not set' },
                    { label: 'Segment',          value: client.segment.charAt(0).toUpperCase() + client.segment.slice(1) },
                    { label: 'Assigned to',      value: (client.profiles as any)?.full_name || 'Unassigned' },
                    { label: 'Contract start',   value: client.contract_start ? new Date(client.contract_start).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A' },
                    { label: 'Contract end',     value: client.contract_end ? new Date(client.contract_end).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A' },
                    { label: 'Last contact',     value: client.last_contact ? new Date(client.last_contact).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Never' },
                    { label: 'Revenue share',    value: `${revenueShare}% of total portfolio` },
                  ].map(r => (
                    <div key={r.label}>
                      <div className="text-xs text-gray-400 mb-0.5">{r.label}</div>
                      <div className="font-medium text-gray-800">{r.value}</div>
                    </div>
                  ))}
                </div>
                {client.notes && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <div className="text-xs text-gray-400 mb-1">Notes</div>
                    <div className="text-sm text-gray-700">{client.notes}</div>
                  </div>
                )}
                {client.reason_for_leaving && (
                  <div className="mt-3 p-3 bg-red-50 rounded-lg">
                    <div className="text-xs text-red-400 mb-1">Reason for leaving</div>
                    <div className="text-sm text-red-700">{client.reason_for_leaving}</div>
                  </div>
                )}
              </div>

              <div className="bg-white border border-gray-100 rounded-xl p-4">
                <div className="text-sm font-semibold text-gray-800 mb-3">Financial snapshot</div>
                {[
                  { label: 'Total billed',      value: formatRs(totalBilled),        color: '' },
                  { label: 'Total collected',   value: formatRs(totalPaid),          color: 'text-green-700' },
                  { label: 'Outstanding',       value: formatRs(totalOutstanding),   color: totalOutstanding > 0 ? 'text-red-600' : 'text-green-700' },
                  { label: 'Campaign budget',   value: formatRs(totalBudget),        color: '' },
                  { label: 'Actual spend',      value: formatRs(totalSpend),         color: '' },
                  { label: 'Budget utilised',   value: `${budgetUtilisation}%`,      color: budgetUtilisation > 90 ? 'text-amber-600' : '' },
                  { label: 'Signed contracts',  value: formatRs(totalSigned),        color: 'text-green-700' },
                ].map(r => (
                  <div key={r.label} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
                    <span className="text-xs text-gray-500">{r.label}</span>
                    <span className={`text-sm font-semibold ${r.color || 'text-gray-800'}`}>{r.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent invoices preview */}
            {invoices.length > 0 && (
              <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                  <span className="text-sm font-semibold">Recent invoices</span>
                  <button onClick={() => setActiveTab('invoices')} className="text-xs font-medium" style={{ color: '#E8650D' }}>View all</button>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">Amount</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">Due date</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.slice(0, 4).map(inv => {
                      const ic = invoiceConfig[inv.status] || invoiceConfig['pending']
                      return (
                        <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="px-4 py-3 font-semibold">{formatRs(inv.amount)}</td>
                          <td className="px-4 py-3 text-gray-500">{new Date(inv.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                          <td className="px-4 py-3">
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-medium" style={{ background: ic.bg, color: ic.color }}>{ic.label}</span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* INVOICES TAB */}
        {activeTab === 'invoices' && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              <Metric label="Total billed" value={formatRs(totalBilled)} />
              <Metric label="Collected" value={formatRs(totalPaid)} color="text-green-700" />
              <Metric label="Outstanding" value={formatRs(totalOutstanding)} color={totalOutstanding > 0 ? 'text-red-600' : 'text-green-700'} />
              <Metric label="Collection rate" value={totalBilled > 0 ? `${Math.round((totalPaid / totalBilled) * 100)}%` : '0%'} />
            </div>
            {invoices.length === 0 ? (
              <div className="bg-white border border-gray-100 rounded-xl p-8 text-center text-gray-400">No invoices yet</div>
            ) : (
              <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Amount</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Due date</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Paid date</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map(inv => {
                      const ic = invoiceConfig[inv.status] || invoiceConfig['pending']
                      return (
                        <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="px-4 py-3 font-semibold">{formatRs(inv.amount)}</td>
                          <td className="px-4 py-3 text-gray-600">{new Date(inv.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                          <td className="px-4 py-3 text-gray-500">{inv.paid_date ? new Date(inv.paid_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td>
                          <td className="px-4 py-3">
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-medium" style={{ background: ic.bg, color: ic.color }}>{ic.label}</span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* PROPOSALS TAB */}
        {activeTab === 'proposals' && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              <Metric label="Total proposals" value={String(proposals.length)} />
              <Metric label="Proposals value" value={formatRs(totalProposalValue)} />
              <Metric label="Signed value" value={formatRs(totalSigned)} color="text-green-700" />
              <Metric label="Win rate" value={proposals.length > 0 ? `${Math.round((signedProposals.length / proposals.length) * 100)}%` : '0%'} />
            </div>
            {proposals.length === 0 ? (
              <div className="bg-white border border-gray-100 rounded-xl p-8 text-center text-gray-400">No proposals yet</div>
            ) : (
              <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Title</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Value</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Campaign budget</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Actual spend</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Sent date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proposals.map(p => {
                      const utilisation = p.campaign_budget > 0 ? Math.round((p.actual_spend / p.campaign_budget) * 100) : 0
                      return (
                        <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium">{p.title}</td>
                          <td className="px-4 py-3 font-semibold">{formatRs(p.value)}</td>
                          <td className="px-4 py-3">{formatRs(p.campaign_budget)}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden" style={{ minWidth: 60 }}>
                                <div className="h-full rounded-full" style={{ width: `${Math.min(utilisation, 100)}%`, background: utilisation > 90 ? '#EF9F27' : '#E8650D' }} />
                              </div>
                              <span className="text-xs text-gray-500">{utilisation}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-medium capitalize"
                              style={{
                                background: p.status === 'signed' ? '#EAF3DE' : p.status === 'lost' ? '#FCEBEB' : '#FAEEDA',
                                color: p.status === 'signed' ? '#27500A' : p.status === 'lost' ? '#A32D2D' : '#854F0B'
                              }}>
                              {p.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-500">{p.sent_date ? new Date(p.sent_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ALL METRICS TAB */}
        {activeTab === 'metrics' && (
          <div className="space-y-4">
            <div className="bg-white border border-gray-100 rounded-xl p-5">
              <div className="text-sm font-semibold text-gray-800 mb-4">Client health and retention</div>
              <div className="grid grid-cols-3 gap-3">
                <Metric label="Client health score" value={st.label} sub="Current status" color={client.status === 'at_risk' ? 'text-red-600' : client.status === 'growing' ? 'text-green-700' : 'text-gray-800'} />
                <Metric label="Days since last contact" value={lastContactDays !== null ? `${lastContactDays} days` : 'Never'} color={lastContactDays !== null && lastContactDays > 30 ? 'text-red-600' : ''} />
                <Metric label="Contract days remaining" value={contractDaysLeft !== null ? `${contractDaysLeft} days` : 'N/A'} color={contractDaysLeft !== null && contractDaysLeft < 60 ? 'text-amber-600' : ''} />
                <Metric label="Monthly value" value={formatRs(client.monthly_value)} sub="Current billing" />
                <Metric label="Annualised value" value={formatRs(annualisedValue)} sub="Projected 12 months" />
                <Metric label="Revenue share" value={`${revenueShare}%`} sub="Of total portfolio" />
              </div>
            </div>

            <div className="bg-white border border-gray-100 rounded-xl p-5">
              <div className="text-sm font-semibold text-gray-800 mb-4">Billing and financial metrics</div>
              <div className="grid grid-cols-3 gap-3">
                <Metric label="Total billed" value={formatRs(totalBilled)} sub={`${invoices.length} invoices`} />
                <Metric label="Total collected" value={formatRs(totalPaid)} color="text-green-700" />
                <Metric label="Outstanding balance" value={formatRs(totalOutstanding)} color={totalOutstanding > 0 ? 'text-red-600' : 'text-green-700'} />
                <Metric label="Collection rate" value={totalBilled > 0 ? `${Math.round((totalPaid / totalBilled) * 100)}%` : 'N/A'} />
                <Metric label="Overdue invoices" value={String(invoices.filter(i => i.status === 'overdue').length)} color={invoices.filter(i => i.status === 'overdue').length > 0 ? 'text-red-600' : 'text-green-700'} />
                <Metric label="Campaign budget utilised" value={`${budgetUtilisation}%`} color={budgetUtilisation > 90 ? 'text-amber-600' : budgetUtilisation < 30 ? 'text-red-500' : ''} />
              </div>
            </div>

            <div className="bg-white border border-gray-100 rounded-xl p-5">
              <div className="text-sm font-semibold text-gray-800 mb-4">Pipeline and proposals</div>
              <div className="grid grid-cols-3 gap-3">
                <Metric label="Total proposals" value={String(proposals.length)} />
                <Metric label="Total proposal value" value={formatRs(totalProposalValue)} />
                <Metric label="Signed contract value" value={formatRs(totalSigned)} color="text-green-700" />
                <Metric label="Win rate" value={proposals.length > 0 ? `${Math.round((signedProposals.length / proposals.length) * 100)}%` : 'N/A'} />
                <Metric label="Total actual spend" value={formatRs(totalSpend)} />
                <Metric label="Total campaign budget" value={formatRs(totalBudget)} />
              </div>
            </div>

            <div className="bg-white border border-gray-100 rounded-xl p-5">
              <div className="text-sm font-semibold text-gray-800 mb-4">Contract information</div>
              <div className="grid grid-cols-3 gap-3">
                <Metric label="Contract start" value={client.contract_start ? new Date(client.contract_start).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : 'N/A'} />
                <Metric label="Contract end" value={client.contract_end ? new Date(client.contract_end).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : 'N/A'} />
                <Metric label="Days remaining" value={contractDaysLeft !== null ? `${contractDaysLeft} days` : 'N/A'} color={contractDaysLeft !== null && contractDaysLeft < 60 ? 'text-amber-600' : ''} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add Invoice Modal */}
      {showInv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setShowInv(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">Add invoice — {client.name}</h2>
            <div className="space-y-3">
              <input value={invForm.amount} onChange={e => setInvForm({ ...invForm, amount: e.target.value })}
                placeholder="Amount (Rs)" type="number" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400" />
              <input value={invForm.due_date} onChange={e => setInvForm({ ...invForm, due_date: e.target.value })}
                type="date" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400" />
              <select value={invForm.status} onChange={e => setInvForm({ ...invForm, status: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-orange-400">
                <option value="pending">Pending</option>
                <option value="paid">Paid</option>
                <option value="overdue">Overdue</option>
                <option value="due_today">Due today</option>
              </select>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowInv(false)} className="flex-1 px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={addInvoice} disabled={savingInv || !invForm.amount || !invForm.due_date}
                className="flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
                style={{ background: '#E8650D' }}>
                {savingInv ? 'Saving...' : 'Add invoice'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
