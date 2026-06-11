'use client'
import { useEffect, useState } from 'react'
import { supabase, Client, Invoice } from '@/lib/supabase'
import {
  LayoutDashboard, Users, Star, RefreshCw, FileText,
  TrendingUp, Settings, AlertTriangle, ChevronRight
} from 'lucide-react'

type Tab = 'existing' | 'wishlist' | 'winback'
type Page = 'dashboard' | 'billing' | 'pipeline'

const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    growing: 'badge badge-green',
    stable: 'badge badge-blue',
    at_risk: 'badge badge-red',
    lost: 'badge badge-gray',
    negotiating: 'badge badge-amber',
    ready_to_sign: 'badge badge-green',
    first_meeting: 'badge badge-gray',
    intro_made: 'badge badge-blue',
    in_conversation: 'badge badge-amber',
    meeting_booked: 'badge badge-green',
    not_contacted: 'badge badge-red',
    prospect: 'badge badge-blue',
  }
  const label: Record<string, string> = {
    growing: 'Growing', stable: 'Stable', at_risk: 'At risk',
    lost: 'Lost', negotiating: 'Negotiating', ready_to_sign: 'Ready to sign',
    first_meeting: 'First meeting', intro_made: 'Intro made',
    in_conversation: 'In conversation', meeting_booked: 'Meeting booked',
    not_contacted: 'Not contacted', prospect: 'Proposal sent',
  }
  return <span className={map[status] || 'badge badge-gray'}>{label[status] || status}</span>
}

const invoiceBadge = (status: string) => {
  const map: Record<string, string> = {
    paid: 'badge badge-green', overdue: 'badge badge-red',
    due_today: 'badge badge-orange', pending: 'badge badge-gray',
  }
  const label: Record<string, string> = {
    paid: 'Paid', overdue: 'Overdue', due_today: 'Due today', pending: 'Pending',
  }
  return <span className={map[status] || 'badge badge-gray'}>{label[status] || status}</span>
}

const daysSince = (date: string | null) => {
  if (!date) return null
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 86400000)
  return diff
}

const formatRs = (n: number) =>
  'Rs ' + (n >= 100000
    ? (n / 100000).toFixed(1) + 'L'
    : n.toLocaleString('en-IN'))

export default function Dashboard() {
  const [clients, setClients] = useState<Client[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('existing')
  const [page, setPage] = useState<Page>('dashboard')
  const [activeNav, setActiveNav] = useState('dashboard')

  useEffect(() => {
    async function load() {
      const [{ data: c }, { data: i }] = await Promise.all([
        supabase.from('clients').select('*, profiles(full_name)').order('monthly_value', { ascending: false }),
        supabase.from('invoices').select('*'),
      ])
      setClients((c as Client[]) || [])
      setInvoices((i as Invoice[]) || [])
      setLoading(false)
    }
    load()
  }, [])

  const existing = clients.filter(c => c.segment === 'existing')
  const wishlist = clients.filter(c => c.segment === 'wishlist')
  const winback  = clients.filter(c => c.segment === 'winback')
  const atRisk   = clients.filter(c => c.status === 'at_risk')
  const overdue  = invoices.filter(i => i.status === 'overdue')
  const totalMonthly = existing.reduce((s, c) => s + c.monthly_value, 0)
  const pipelineVal  = wishlist.reduce((s, c) => s + c.monthly_value, 0)
  const winbackVal   = winback.reduce((s, c)  => s + c.monthly_value, 0)
  const outstanding  = invoices.filter(i => i.status !== 'paid').reduce((s, i) => s + i.amount, 0)

  const navGo = (navId: string, pg: Page) => { setActiveNav(navId); setPage(pg) }

  const segClients = tab === 'existing' ? existing : tab === 'wishlist' ? wishlist : winback

  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center">
        <div className="w-8 h-8 border-2 rounded-full animate-spin mx-auto mb-3" style={{ borderColor: '#E8650D', borderTopColor: 'transparent' }} />
        <p className="text-sm text-gray-500">Loading Wings Activation...</p>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col h-screen">
      {/* Topbar */}
      <div className="flex items-center justify-between px-6 h-13 flex-shrink-0" style={{ background: '#1A1A1A', height: 52 }}>
        <span className="text-sm font-semibold tracking-widest" style={{ color: '#E8650D' }}>WINGS GROUP</span>
        <span className="text-xs text-gray-400">Activation — Client Intelligence Platform</span>
        <div className="flex items-center gap-2 bg-gray-800 rounded-full px-3 py-1">
          <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-semibold" style={{ background: '#E8650D' }}>AS</div>
          <span className="text-xs text-gray-300">Arun Samuel</span>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-52 bg-white border-r border-gray-100 flex flex-col flex-shrink-0 overflow-y-auto">
          <div className="px-4 pt-5 pb-3">
            <div className="text-sm font-semibold text-gray-800">Activation</div>
            <div className="text-xs text-gray-400">Client intelligence</div>
          </div>
          <div className="h-px bg-gray-100 mx-4" />

          <div className="text-xs text-gray-400 px-4 pt-3 pb-1 uppercase tracking-wider font-medium">Overview</div>
          <div className={`nav-item ${activeNav === 'dashboard' ? 'active' : ''}`} onClick={() => navGo('dashboard','dashboard')}>
            <LayoutDashboard size={16} /> Dashboard
          </div>

          <div className="text-xs text-gray-400 px-4 pt-3 pb-1 uppercase tracking-wider font-medium">Clients</div>
          <div className={`nav-item ${activeNav === 'existing' ? 'active' : ''}`} onClick={() => { navGo('existing','dashboard'); setTab('existing') }}>
            <Users size={16} /> Existing
            <span className="ml-auto text-xs bg-orange-100 text-orange-700 rounded-full px-2 py-0.5 font-semibold">{existing.length}</span>
          </div>
          <div className={`nav-item ${activeNav === 'wishlist' ? 'active' : ''}`} onClick={() => { navGo('wishlist','dashboard'); setTab('wishlist') }}>
            <Star size={16} /> Wish list
            <span className="ml-auto text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 font-semibold">{wishlist.length}</span>
          </div>
          <div className={`nav-item ${activeNav === 'winback' ? 'active' : ''}`} onClick={() => { navGo('winback','dashboard'); setTab('winback') }}>
            <RefreshCw size={16} /> Win back
            <span className="ml-auto text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5 font-semibold">{winback.length}</span>
          </div>

          <div className="text-xs text-gray-400 px-4 pt-3 pb-1 uppercase tracking-wider font-medium">Finance</div>
          <div className={`nav-item ${activeNav === 'billing' ? 'active' : ''}`} onClick={() => navGo('billing','billing')}>
            <FileText size={16} /> Billing
            {overdue.length > 0 && <span className="ml-auto text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5 font-semibold">{overdue.length}</span>}
          </div>
          <div className={`nav-item ${activeNav === 'pipeline' ? 'active' : ''}`} onClick={() => navGo('pipeline','pipeline')}>
            <TrendingUp size={16} /> Pipeline
          </div>

          <div className="text-xs text-gray-400 px-4 pt-3 pb-1 uppercase tracking-wider font-medium">Team</div>
          <div className="nav-item"><Settings size={16} /> Settings</div>
        </div>

        {/* Main */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* DASHBOARD PAGE */}
          {page === 'dashboard' && <>
            <div className="mb-5">
              <p className="text-xs text-gray-400 mb-1">Wings Activation</p>
              <h1 className="text-xl font-semibold">Client intelligence dashboard</h1>
              <p className="text-sm text-gray-500 mt-0.5">All {existing.length} active clients, pipeline, billing and win-back in one place</p>
            </div>

            {/* KPIs row 1 */}
            <div className="grid grid-cols-4 gap-3 mb-3">
              <div className="kpi-card highlight">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">Active clients</div>
                <div className="text-3xl font-semibold">{existing.length}</div>
                <div className="text-xs text-green-600 mt-1.5">↑ Growing year on year</div>
              </div>
              <div className="kpi-card">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">Monthly revenue</div>
                <div className="text-3xl font-semibold">{formatRs(totalMonthly)}</div>
                <div className="text-xs text-gray-400 mt-1.5">{formatRs(totalMonthly * 12)} annualised</div>
              </div>
              <div className="kpi-card">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">Pipeline value</div>
                <div className="text-3xl font-semibold">{formatRs(pipelineVal)}</div>
                <div className="text-xs text-gray-400 mt-1.5">{wishlist.length} open prospects</div>
              </div>
              <div className="kpi-card">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">Win-back opportunity</div>
                <div className="text-3xl font-semibold">{formatRs(winbackVal)}</div>
                <div className="text-xs text-red-500 mt-1.5">{winback.length} lapsed clients</div>
              </div>
            </div>

            {/* KPIs row 2 */}
            <div className="grid grid-cols-4 gap-3 mb-4">
              <div className="kpi-card">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">At-risk clients</div>
                <div className="text-3xl font-semibold text-red-600">{atRisk.length}</div>
                <div className="text-xs text-red-400 mt-1.5">Needs immediate action</div>
              </div>
              <div className="kpi-card">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">Avg client value</div>
                <div className="text-3xl font-semibold">{existing.length ? formatRs(Math.round(totalMonthly / existing.length)) : 'Rs 0'}</div>
                <div className="text-xs text-gray-400 mt-1.5">Per month</div>
              </div>
              <div className="kpi-card">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">Outstanding invoices</div>
                <div className="text-3xl font-semibold">{formatRs(outstanding)}</div>
                <div className="text-xs text-red-400 mt-1.5">{overdue.length} overdue</div>
              </div>
              <div className="kpi-card">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">Retention rate</div>
                <div className="text-3xl font-semibold">87%</div>
                <div className="text-xs text-green-600 mt-1.5">↑ 3% vs last year</div>
              </div>
            </div>

            {/* At risk alert */}
            {atRisk.length > 0 && (
              <div className="flex items-start gap-3 rounded-xl p-3.5 mb-4 border" style={{ background: '#FDF1E7', borderColor: '#E8650D' }}>
                <AlertTriangle size={18} style={{ color: '#E8650D', flexShrink: 0, marginTop: 1 }} />
                <div className="text-sm" style={{ color: '#B34E00' }}>
                  <strong>{atRisk.length} clients are at risk of churning.</strong>{' '}
                  {atRisk.map(c => `${c.name} — last contacted ${daysSince(c.last_contact)} days ago`).join('. ')}.
                </div>
              </div>
            )}

            {/* Segment tabs */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex gap-2">
                {(['existing','wishlist','winback'] as Tab[]).map(t => (
                  <button key={t} onClick={() => setTab(t)}
                    className={`px-4 py-1.5 rounded-full text-xs font-medium border transition-all ${tab === t ? 'text-white border-transparent' : 'text-gray-500 border-gray-200 bg-white hover:border-orange-300'}`}
                    style={tab === t ? { background: '#E8650D', borderColor: '#E8650D' } : {}}>
                    {t === 'existing' ? `Existing (${existing.length})` : t === 'wishlist' ? `Wish list (${wishlist.length})` : `Win back (${winback.length})`}
                  </button>
                ))}
              </div>
            </div>

            {/* Clients table */}
            <div className="table-card mb-4">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">Client</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">Monthly value</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">
                      {tab === 'winback' ? 'Reason left' : 'Last contact'}
                    </th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">Assigned to</th>
                    {tab === 'existing' && <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">Contract ends</th>}
                    {tab === 'winback' && <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">Left date</th>}
                  </tr>
                </thead>
                <tbody>
                  {segClients.map((c, i) => {
                    const days = daysSince(c.last_contact)
                    const isAtRisk = c.status === 'at_risk'
                    return (
                      <tr key={c.id} className={`border-b border-gray-50 hover:bg-gray-50 ${isAtRisk ? 'bg-red-50/30' : ''}`}>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{c.name}</div>
                          <div className="text-xs text-gray-400">{c.industry} — {c.city}</div>
                        </td>
                        <td className="px-4 py-3 font-semibold">{formatRs(c.monthly_value)}</td>
                        <td className="px-4 py-3">{statusBadge(c.status)}</td>
                        <td className="px-4 py-3">
                          {tab === 'winback'
                            ? <span className="text-xs text-gray-500">{c.reason_for_leaving || 'Not logged'}</span>
                            : days !== null
                              ? <span className={`text-sm ${days > 30 ? 'text-red-600 font-medium' : 'text-gray-600'}`}>{days === 0 ? 'Today' : `${days}d ago`}</span>
                              : <span className="text-xs text-red-500">Never contacted</span>
                          }
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {(c.profiles as any)?.full_name || '—'}
                        </td>
                        {tab === 'existing' && (
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {c.contract_end ? new Date(c.contract_end).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '—'}
                          </td>
                        )}
                        {tab === 'winback' && (
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {c.left_date ? new Date(c.left_date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '—'}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Bottom grid */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white border border-gray-100 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold">Win-back priority</span>
                  <span className="text-xs text-red-500 font-medium">{formatRs(winbackVal)} recoverable</span>
                </div>
                {winback.sort((a,b) => b.monthly_value - a.monthly_value).slice(0,5).map(c => (
                  <div key={c.id} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
                    <span className="text-sm text-gray-600">{c.name}</span>
                    <span className="text-sm font-medium text-red-600">{formatRs(c.monthly_value)}</span>
                  </div>
                ))}
              </div>
              <div className="bg-white border border-gray-100 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold">Wish list pipeline</span>
                  <ChevronRight size={14} className="text-gray-400" />
                </div>
                {wishlist.slice(0,5).map(c => (
                  <div key={c.id} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
                    <span className="text-sm text-gray-600">{c.name}</span>
                    {statusBadge(c.status)}
                  </div>
                ))}
              </div>
              <div className="bg-white border border-gray-100 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold">Invoice status</span>
                  <span className="text-xs text-gray-400">{invoices.length} total</span>
                </div>
                {[
                  { label: 'Paid',      val: invoices.filter(i=>i.status==='paid').length,      cls: 'text-green-600' },
                  { label: 'Pending',   val: invoices.filter(i=>i.status==='pending').length,   cls: 'text-gray-600' },
                  { label: 'Due today', val: invoices.filter(i=>i.status==='due_today').length, cls: 'text-orange-600' },
                  { label: 'Overdue',   val: invoices.filter(i=>i.status==='overdue').length,   cls: 'text-red-600' },
                ].map(r => (
                  <div key={r.label} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
                    <span className="text-sm text-gray-600">{r.label}</span>
                    <span className={`text-sm font-semibold ${r.cls}`}>{r.val}</span>
                  </div>
                ))}
                <div className="flex justify-between items-center pt-2 mt-1 border-t border-gray-100">
                  <span className="text-sm font-medium text-gray-700">Outstanding</span>
                  <span className="text-sm font-semibold text-red-600">{formatRs(outstanding)}</span>
                </div>
              </div>
            </div>
          </>}

          {/* BILLING PAGE */}
          {page === 'billing' && <>
            <div className="mb-5">
              <p className="text-xs text-gray-400 mb-1">Finance</p>
              <h1 className="text-xl font-semibold">Billing tracker</h1>
              <p className="text-sm text-gray-500 mt-0.5">All invoices across {existing.length} active clients</p>
            </div>
            <div className="grid grid-cols-4 gap-3 mb-4">
              {[
                { label: 'Total billed', val: formatRs(invoices.reduce((s,i)=>s+i.amount,0)), sub: 'This cycle', color: '' },
                { label: 'Collected', val: formatRs(invoices.filter(i=>i.status==='paid').reduce((s,i)=>s+i.amount,0)), sub: 'Paid invoices', color: 'text-green-600' },
                { label: 'Outstanding', val: formatRs(outstanding), sub: `${invoices.filter(i=>i.status!=='paid').length} invoices`, color: 'text-red-600' },
                { label: 'Overdue', val: String(overdue.length), sub: 'Needs action', color: 'text-red-600' },
              ].map(k => (
                <div key={k.label} className="kpi-card">
                  <div className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">{k.label}</div>
                  <div className={`text-3xl font-semibold ${k.color}`}>{k.val}</div>
                  <div className="text-xs text-gray-400 mt-1.5">{k.sub}</div>
                </div>
              ))}
            </div>
            <div className="table-card">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">Client</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">Amount</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">Due date</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map(inv => {
                    const client = clients.find(c => c.id === inv.client_id)
                    return (
                      <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium">{client?.name || 'Unknown'}</td>
                        <td className="px-4 py-3 font-semibold">{formatRs(inv.amount)}</td>
                        <td className="px-4 py-3 text-gray-500">{new Date(inv.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                        <td className="px-4 py-3">{invoiceBadge(inv.status)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>}

          {/* PIPELINE PAGE */}
          {page === 'pipeline' && <>
            <div className="mb-5">
              <p className="text-xs text-gray-400 mb-1">Finance</p>
              <h1 className="text-xl font-semibold">Pipeline</h1>
              <p className="text-sm text-gray-500 mt-0.5">{wishlist.length} prospects worth {formatRs(pipelineVal)} per month</p>
            </div>
            <div className="table-card">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">Prospect</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">Est. monthly value</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">Stage</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">Notes</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {wishlist.map(c => (
                    <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-gray-400">{c.industry} — {c.city}</div>
                      </td>
                      <td className="px-4 py-3 font-semibold">{formatRs(c.monthly_value)}</td>
                      <td className="px-4 py-3">{statusBadge(c.status)}</td>
                      <td className="px-4 py-3 text-xs text-gray-500 max-w-xs truncate">{c.notes || '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{(c.profiles as any)?.full_name || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>}

        </div>
      </div>
    </div>
  )
}
