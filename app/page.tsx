'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Client, Invoice } from '@/lib/supabase'
import {
  getDashboardData, createClientRecord, effectiveInvoiceStatus,
  daysSince, empInfo, ClientInput,
} from '@/lib/data'
import { changePassword, validateNewPassword } from '@/lib/auth'
import {
  LayoutDashboard, Users, Star, RefreshCw, FileText,
  TrendingUp, Settings, AlertTriangle, ChevronRight, LogOut, Shield, X,
} from 'lucide-react'
import { useAuth } from '@/components/AuthGuard'

type Tab = 'existing' | 'wishlist' | 'winback'
type Page = 'dashboard' | 'billing' | 'pipeline' | 'hygiene' | 'settings'

// ---------- settings: definition, defaults, persistence ----------
// Every toggle is stored per-user in localStorage so flipping it sticks across
// reloads and navigation. The subset listed in WIRED also changes the dashboard
// live; the rest persist their preference (back-end actions are a separate task).
const SETTING_GROUPS: { group: string; items: string[] }[] = [
  { group: 'Display', items: ['Dark mode', 'Compact table rows', 'Show currency in lakhs', 'Show currency in crores', 'Show decimal precision', 'Highlight at-risk rows', 'Show client logos', 'Show contract countdown', 'Sticky table headers', 'Show revenue share column'] },
  { group: 'Metrics', items: ['At-risk threshold (days)', 'Contract expiry warning (days)', 'Retention calculation period', 'Include wishlist in projections', 'Weight pipeline by stage', 'Auto-flag overdue invoices', 'Budget utilisation alerts', 'Average value excludes outliers', 'YoY growth comparison', 'Quarterly trend smoothing'] },
  { group: 'Alerts & data', items: ['Daily summary email', 'WhatsApp alerts for at-risk', 'Weekly data hygiene report', 'Invoice due reminders', 'Contract renewal reminders', 'New client notifications', 'Team activity digest', 'Auto-archive lost clients', 'Require notes on status change', 'Export to Excel weekly'] },
]

// Toggles that visibly change the dashboard the moment you flip them.
const WIRED = new Set<string>([
  'Dark mode', 'Compact table rows', 'Show currency in lakhs', 'Show currency in crores',
  'Show decimal precision', 'Highlight at-risk rows', 'Show contract countdown',
  'Sticky table headers', 'Show revenue share column',
])

// Defaults reproduce the CURRENT dashboard exactly, so nothing changes until the
// user opts in. Non-wired (cosmetic) toggles keep the original every-3rd-off
// pattern; wired toggles are pinned to today's behaviour.
const WIRED_DEFAULTS: Record<string, boolean> = {
  'Dark mode': false,
  'Compact table rows': false,
  'Show currency in lakhs': false,
  'Show currency in crores': false,
  'Show decimal precision': false,
  'Highlight at-risk rows': true,   // at-risk rows are highlighted today
  'Show contract countdown': false, // contract column shows the month today
  'Sticky table headers': false,
  'Show revenue share column': false,
}
const DEFAULT_SETTINGS: Record<string, boolean> = (() => {
  const out: Record<string, boolean> = {}
  for (const g of SETTING_GROUPS) g.items.forEach((label, i) => { out[label] = i % 3 !== 2 })
  Object.assign(out, WIRED_DEFAULTS)
  return out
})()

const SETTINGS_VERSION = 'v1'

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

const mv = (c: Client) => c.monthly_value ?? 0

// Controlled toggle — state lives in the parent so it can be persisted + wired.
function ToggleSwitch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className="rounded-full transition-colors flex-shrink-0"
      style={{ width: 38, height: 22, background: on ? '#E8650D' : '#d1d5db', position: 'relative' }}>
      <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 18, height: 18, borderRadius: '50%', background: 'white', transition: 'left 0.15s' }} />
    </button>
  )
}

// Scoped dark theme — injected only while Dark mode is on, restyling the utility
// classes this page uses. Kept here so app/globals.css stays untouched.
const DARK_CSS = `
.wings-root[data-theme="dark"]{background:#0f1115;color:#e5e7eb;}
.wings-root[data-theme="dark"] main{background:#0f1115 !important;}
.wings-root[data-theme="dark"] nav{background:#15181e !important;}
.wings-root[data-theme="dark"] .bg-white{background:#1a1d24 !important;}
.wings-root[data-theme="dark"] .bg-gray-50{background:#15181e !important;}
.wings-root[data-theme="dark"] .bg-gray-100{background:#1f2229 !important;}
.wings-root[data-theme="dark"] thead.bg-gray-50{background:#1f2229 !important;}
.wings-root[data-theme="dark"] .kpi-card{background:#1a1d24 !important;border-color:#2a2e37 !important;}
.wings-root[data-theme="dark"] .table-card{background:#1a1d24 !important;border-color:#2a2e37 !important;}
.wings-root[data-theme="dark"] .text-gray-900,.wings-root[data-theme="dark"] .text-gray-800,.wings-root[data-theme="dark"] .text-gray-700{color:#e5e7eb !important;}
.wings-root[data-theme="dark"] .text-gray-600,.wings-root[data-theme="dark"] .text-gray-500{color:#9ca3af !important;}
.wings-root[data-theme="dark"] .text-gray-400,.wings-root[data-theme="dark"] .text-gray-300{color:#6b7280 !important;}
.wings-root[data-theme="dark"] .border-gray-50,.wings-root[data-theme="dark"] .border-gray-100,.wings-root[data-theme="dark"] .border-gray-200{border-color:#2a2e37 !important;}
.wings-root[data-theme="dark"] .nav-item{color:#cbd5e1 !important;}
.wings-root[data-theme="dark"] input,.wings-root[data-theme="dark"] textarea,.wings-root[data-theme="dark"] select{background:#1f2229 !important;color:#e5e7eb !important;border-color:#2a2e37 !important;}
.wings-root[data-theme="dark"] .hover\\:bg-gray-50:hover{background:#1f2229 !important;}
`

// Accessible modal shell: Escape closes, overlay click closes, dialog semantics.
function Modal({ onClose, label, maxWidth = 'max-w-lg', children }: {
  onClose: () => void; label: string; maxWidth?: string; children: React.ReactNode
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={label}
        className={`bg-white rounded-2xl p-6 w-full ${maxWidth} mx-4 shadow-xl max-h-[80vh] overflow-y-auto`}
        onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

function SkeletonDashboard() {
  return (
    <div className="p-6 animate-pulse" aria-busy="true" aria-label="Loading dashboard">
      <div className="h-6 w-64 bg-gray-200 rounded mb-6" />
      <div className="grid grid-cols-4 gap-3 mb-3">
        {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-gray-100 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-4 gap-3 mb-4">
        {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-gray-100 rounded-xl" />)}
      </div>
      <div className="h-72 bg-gray-100 rounded-xl" />
    </div>
  )
}

export default function Dashboard() {
  const { profile, isAdmin, signOut } = useAuth()
  const [clients, setClients] = useState<Client[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('existing')
  const [page, setPage] = useState<Page>('dashboard')
  const [activeNav, setActiveNav] = useState('dashboard')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<string>('monthly_value')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [kpiView, setKpiView] = useState<string | null>(null)
  const [empView, setEmpView] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showAccount, setShowAccount] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', industry: '', city: '', segment: 'existing', status: 'stable', monthly_value: '', notes: '' })

  // ---------- settings state (persisted per user) ----------
  const settingsKey = useMemo(
    () => `wings.settings.${SETTINGS_VERSION}.${profile?.id ?? profile?.email ?? 'anon'}`,
    [profile?.id, profile?.email],
  )
  const [settings, setSettings] = useState<Record<string, boolean>>(DEFAULT_SETTINGS)
  const [settingsLoaded, setSettingsLoaded] = useState(false)

  useEffect(() => {
    setSettingsLoaded(false)
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(settingsKey) : null
      setSettings(raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS)
    } catch {
      setSettings(DEFAULT_SETTINGS)
    }
    setSettingsLoaded(true)
  }, [settingsKey])

  useEffect(() => {
    if (!settingsLoaded) return
    try { window.localStorage.setItem(settingsKey, JSON.stringify(settings)) } catch { /* ignore quota/private-mode */ }
  }, [settings, settingsKey, settingsLoaded])

  const setSetting = (label: string, val: boolean) => setSettings(s => ({ ...s, [label]: val }))
  const on = useCallback((label: string) => settings[label] ?? false, [settings])

  // Live-wired settings
  const dark = on('Dark mode')
  const compact = on('Compact table rows')
  const highlightRisk = on('Highlight at-risk rows')
  const stickyHead = on('Sticky table headers')
  const revShare = on('Show revenue share column')
  const countdown = on('Show contract countdown')
  const rowPad = compact ? 'py-1.5' : 'py-3'
  const headClass = `bg-gray-50 border-b border-gray-100${stickyHead ? ' sticky top-0 z-10' : ''}`

  // Currency formatter that respects the lakhs/crores/decimal toggles.
  // With all three off it matches the original formatRs exactly.
  const money = useCallback((n: number | null | undefined) => {
    const v = n ?? 0
    const dec = settings['Show decimal precision'] ?? false
    const crore = settings['Show currency in crores'] ?? false
    const lakh = settings['Show currency in lakhs'] ?? false
    const places = dec ? 2 : 1
    if (crore && v >= 10000000) return `Rs ${(v / 10000000).toFixed(places)} Cr`
    if ((lakh || crore) && v >= 100000) return `Rs ${(v / 100000).toFixed(places)} L`
    if (!lakh && !crore && v >= 100000) return `Rs ${(v / 100000).toFixed(places)}L`
    return `Rs ${dec
      ? v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : Math.round(v).toLocaleString('en-IN')}`
  }, [settings])

  const reload = useCallback(async () => {
    setLoadError(null)
    const res = await getDashboardData()
    if (res.error !== null) { setLoadError(res.error); setLoading(false); return }
    setClients(res.data.clients)
    // Invoice status is derived from due_date so it never goes stale.
    setInvoices(res.data.invoices.map(i => ({ ...i, status: effectiveInvoiceStatus(i) })))
    setLoading(false)
  }, [])

  useEffect(() => { reload() }, [reload])

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  async function addClient() {
    setFormError(null)
    setSaving(true)
    const res = await createClientRecord(form as ClientInput)
    setSaving(false)
    if (res.error !== null) { setFormError(res.error); return }
    await reload()
    setShowAdd(false)
    setForm({ name: '', industry: '', city: '', segment: 'existing', status: 'stable', monthly_value: '', notes: '' })
  }

  const existing = clients.filter(c => c.segment === 'existing')
  const wishlist = clients.filter(c => c.segment === 'wishlist')
  const winback  = clients.filter(c => c.segment === 'winback')
  const atRisk   = clients.filter(c => c.status === 'at_risk')
  const overdue  = invoices.filter(i => i.status === 'overdue')
  const totalMonthly = existing.reduce((s, c) => s + mv(c), 0)
  const pipelineVal  = wishlist.reduce((s, c) => s + mv(c), 0)
  const winbackVal   = winback.reduce((s, c)  => s + mv(c), 0)
  const outstanding  = invoices.filter(i => i.status !== 'paid').reduce((s, i) => s + (i.amount ?? 0), 0)
  // Retention is computed from live data (was a hardcoded 87%).
  const retentionPct = existing.length + winback.length > 0
    ? Math.round((existing.length / (existing.length + winback.length)) * 100)
    : null

  const navGo = (navId: string, pg: Page) => { setActiveNav(navId); setPage(pg) }

  const segBase = tab === 'existing' ? existing : tab === 'wishlist' ? wishlist : winback
  const segFiltered = search
    ? segBase.filter(c => (c.name + ' ' + (c.industry || '') + ' ' + (c.city || '')).toLowerCase().includes(search.toLowerCase()))
    : segBase
  const statusOrder: Record<string, number> = { growing: 3, stable: 2, at_risk: 1, ready_to_sign: 4, negotiating: 3, first_meeting: 2, intro_made: 1, meeting_booked: 4, in_conversation: 3, prospect: 2, not_contacted: 1, lost: 0 }
  const segClients = [...segFiltered].sort((a, b) => {
    let va: string | number, vb: string | number
    if (sortKey === 'name') { va = a.name.toLowerCase(); vb = b.name.toLowerCase() }
    else if (sortKey === 'monthly_value') { va = mv(a); vb = mv(b) }
    else if (sortKey === 'status') { va = statusOrder[a.status] ?? 0; vb = statusOrder[b.status] ?? 0 }
    else if (sortKey === 'last_contact') { va = a.last_contact ? new Date(a.last_contact).getTime() : 0; vb = b.last_contact ? new Date(b.last_contact).getTime() : 0 }
    else if (sortKey === 'assigned') { va = (a.profiles?.full_name || '').toLowerCase(); vb = (b.profiles?.full_name || '').toLowerCase() }
    else if (sortKey === 'contract_end') { va = a.contract_end ? new Date(a.contract_end).getTime() : 0; vb = b.contract_end ? new Date(b.contract_end).getTime() : 0 }
    else if (sortKey === 'left_date') { va = a.left_date ? new Date(a.left_date).getTime() : 0; vb = b.left_date ? new Date(b.left_date).getTime() : 0 }
    else { va = 0; vb = 0 }
    if (va < vb) return sortDir === 'asc' ? -1 : 1
    if (va > vb) return sortDir === 'asc' ? 1 : -1
    return 0
  })
  const arrow = (key: string) => sortKey === key ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''

  const staleDays = (cl: Client) => daysSince(cl.last_contact) ?? 9999
  const staleClients = clients.filter(cl => cl.segment !== 'winback' && staleDays(cl) > 7)
  const staleByEmp: Record<string, Client[]> = {}
  staleClients.forEach(cl => {
    const n = cl.profiles?.full_name || 'Unassigned'
    if (!staleByEmp[n]) staleByEmp[n] = []
    staleByEmp[n].push(cl)
  })
  const empClients = (name: string) => clients.filter(cl => cl.profiles?.full_name === name)

  if (loading) return <SkeletonDashboard />

  if (loadError) return (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center max-w-sm">
        <AlertTriangle size={28} className="mx-auto mb-3" style={{ color: '#E8650D' }} />
        <p className="text-sm font-medium text-gray-800 mb-1">Couldn&apos;t load the dashboard</p>
        <p className="text-xs text-gray-500 mb-4">{loadError}</p>
        <button onClick={() => { setLoading(true); reload() }}
          className="px-4 py-2 text-sm font-medium text-white rounded-lg" style={{ background: '#E8650D' }}>
          Try again
        </button>
      </div>
    </div>
  )

  const myName = profile?.full_name ?? 'Signed in'
  const myInitials = (profile?.full_name ?? 'U').split(' ').map(w => w.charAt(0)).join('').slice(0, 2).toUpperCase()

  return (
    <div className="wings-root flex flex-col h-screen" data-theme={dark ? 'dark' : 'light'}>
      <style>{DARK_CSS}</style>
      {/* Topbar */}
      <div className="flex items-center justify-between px-6 flex-shrink-0" style={{ background: '#1A1A1A', height: 52 }}>
        <span className="text-sm font-semibold tracking-widest" style={{ color: '#E8650D' }}>WINGS GROUP</span>
        <span className="text-xs text-gray-400">Activation — Client Intelligence Platform</span>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <a href="/admin/users" aria-label="Manage users"
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors">
              <Shield size={13} /> Manage users
            </a>
          )}
          <button onClick={() => setShowAccount(true)} aria-label="View your account details"
            className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 rounded-full px-3 py-1 transition-colors">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-semibold" style={{ background: '#E8650D' }}>
              {myInitials}
            </div>
            <span className="text-xs text-gray-300">{myName}</span>
          </button>
          <button onClick={signOut} aria-label="Sign out and switch user"
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors">
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <nav aria-label="Main navigation" className="w-52 bg-white border-r border-gray-100 flex flex-col flex-shrink-0 overflow-y-auto">
          <div className="px-4 pt-5 pb-3">
            <div className="text-sm font-semibold text-gray-800">Activation</div>
            <div className="text-xs text-gray-400">Client intelligence</div>
          </div>
          <div className="h-px bg-gray-100 mx-4" />

          <div className="text-xs text-gray-400 px-4 pt-3 pb-1 uppercase tracking-wider font-medium">Overview</div>
          <button className={`nav-item w-full text-left ${activeNav === 'dashboard' ? 'active' : ''}`} onClick={() => navGo('dashboard', 'dashboard')}>
            <LayoutDashboard size={16} /> Dashboard
          </button>

          <div className="text-xs text-gray-400 px-4 pt-3 pb-1 uppercase tracking-wider font-medium">Clients</div>
          <button className={`nav-item w-full text-left ${activeNav === 'existing' ? 'active' : ''}`} onClick={() => { navGo('existing', 'dashboard'); setTab('existing') }}>
            <Users size={16} /> Existing
            <span className="ml-auto text-xs bg-orange-100 text-orange-700 rounded-full px-2 py-0.5 font-semibold">{existing.length}</span>
          </button>
          <button className={`nav-item w-full text-left ${activeNav === 'wishlist' ? 'active' : ''}`} onClick={() => { navGo('wishlist', 'dashboard'); setTab('wishlist') }}>
            <Star size={16} /> Wish list
            <span className="ml-auto text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 font-semibold">{wishlist.length}</span>
          </button>
          <button className={`nav-item w-full text-left ${activeNav === 'winback' ? 'active' : ''}`} onClick={() => { navGo('winback', 'dashboard'); setTab('winback') }}>
            <RefreshCw size={16} /> Win back
            <span className="ml-auto text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5 font-semibold">{winback.length}</span>
          </button>

          <div className="text-xs text-gray-400 px-4 pt-3 pb-1 uppercase tracking-wider font-medium">Finance</div>
          <button className={`nav-item w-full text-left ${activeNav === 'billing' ? 'active' : ''}`} onClick={() => navGo('billing', 'billing')}>
            <FileText size={16} /> Billing
            {overdue.length > 0 && <span className="ml-auto text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5 font-semibold">{overdue.length}</span>}
          </button>
          <button className={`nav-item w-full text-left ${activeNav === 'pipeline' ? 'active' : ''}`} onClick={() => navGo('pipeline', 'pipeline')}>
            <TrendingUp size={16} /> Pipeline
          </button>

          <div className="text-xs text-gray-400 px-4 pt-3 pb-1 uppercase tracking-wider font-medium">Team</div>
          <button className={`nav-item w-full text-left ${activeNav === 'hygiene' ? 'active' : ''}`} onClick={() => navGo('hygiene', 'hygiene')}>
            <AlertTriangle size={16} /> Data hygiene
            {staleClients.length > 0 && <span className="ml-auto text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 font-semibold">{staleClients.length}</span>}
          </button>
          <button className={`nav-item w-full text-left ${activeNav === 'settings' ? 'active' : ''}`} onClick={() => navGo('settings', 'settings')}>
            <Settings size={16} /> Settings
          </button>
        </nav>

        {/* Main */}
        <main className="flex-1 overflow-y-auto p-6">

          {/* DASHBOARD PAGE */}
          {page === 'dashboard' && <>
            <div className="mb-5">
              <p className="text-xs text-gray-400 mb-1">Wings Activation</p>
              <h1 className="text-xl font-semibold">Client intelligence dashboard</h1>
              <p className="text-sm text-gray-500 mt-0.5">All {existing.length} active clients, pipeline, billing and win-back in one place</p>
            </div>

            {/* KPIs row 1 */}
            <div className="grid grid-cols-4 gap-3 mb-3">
              <button onClick={() => setKpiView('active')} className="kpi-card highlight cursor-pointer hover:shadow-md transition-shadow text-left">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">Active clients</div>
                <div className="text-3xl font-semibold">{existing.length}</div>
                <div className="text-xs text-green-600 mt-1.5">↑ Growing year on year</div>
              </button>
              <button onClick={() => setKpiView('revenue')} className="kpi-card cursor-pointer hover:shadow-md transition-shadow text-left">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">Monthly revenue</div>
                <div className="text-3xl font-semibold">{money(totalMonthly)}</div>
                <div className="text-xs text-gray-400 mt-1.5">{money(totalMonthly * 12)} annualised</div>
              </button>
              <button onClick={() => setKpiView('pipeline')} className="kpi-card cursor-pointer hover:shadow-md transition-shadow text-left">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">Pipeline value</div>
                <div className="text-3xl font-semibold">{money(pipelineVal)}</div>
                <div className="text-xs text-gray-400 mt-1.5">{wishlist.length} open prospects</div>
              </button>
              <button onClick={() => setKpiView('winback')} className="kpi-card cursor-pointer hover:shadow-md transition-shadow text-left">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">Win-back opportunity</div>
                <div className="text-3xl font-semibold">{money(winbackVal)}</div>
                <div className="text-xs text-red-500 mt-1.5">{winback.length} lapsed clients</div>
              </button>
            </div>

            {/* KPIs row 2 */}
            <div className="grid grid-cols-4 gap-3 mb-4">
              <button onClick={() => setKpiView('at_risk')} className="kpi-card cursor-pointer hover:shadow-md transition-shadow text-left">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">At-risk clients</div>
                <div className="text-3xl font-semibold text-red-600">{atRisk.length}</div>
                <div className="text-xs text-red-400 mt-1.5">Needs immediate action</div>
              </button>
              <button onClick={() => setKpiView('avg')} className="kpi-card cursor-pointer hover:shadow-md transition-shadow text-left">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">Avg client value</div>
                <div className="text-3xl font-semibold">{existing.length ? money(Math.round(totalMonthly / existing.length)) : 'Rs 0'}</div>
                <div className="text-xs text-gray-400 mt-1.5">Per month</div>
              </button>
              <button onClick={() => setKpiView('outstanding')} className="kpi-card cursor-pointer hover:shadow-md transition-shadow text-left">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">Outstanding invoices</div>
                <div className="text-3xl font-semibold">{money(outstanding)}</div>
                <div className="text-xs text-red-400 mt-1.5">{overdue.length} overdue</div>
              </button>
              <button onClick={() => setKpiView('retention')} className="kpi-card cursor-pointer hover:shadow-md transition-shadow text-left">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">Retention rate</div>
                <div className="text-3xl font-semibold">{retentionPct !== null ? `${retentionPct}%` : '—'}</div>
                <div className="text-xs text-gray-400 mt-1.5">Active ÷ (active + lost)</div>
              </button>
            </div>

            {/* At risk alert */}
            {atRisk.length > 0 && (
              <button onClick={() => setKpiView('at_risk')} className="w-full flex items-start gap-3 rounded-xl p-3.5 mb-4 border cursor-pointer hover:shadow-md transition-shadow text-left" style={{ background: '#FDF1E7', borderColor: '#E8650D' }}>
                <AlertTriangle size={18} style={{ color: '#E8650D', flexShrink: 0, marginTop: 1 }} />
                <div className="text-sm" style={{ color: '#B34E00' }}>
                  <strong>{atRisk.length} clients are at risk of churning.</strong>{' '}
                  {atRisk.map(c => `${c.name} — last contacted ${daysSince(c.last_contact) ?? '?'} days ago`).join('. ')}.
                </div>
              </button>
            )}

            {/* Segment tabs */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex gap-2" role="tablist" aria-label="Client segments">
                {(['existing', 'wishlist', 'winback'] as Tab[]).map(t => (
                  <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                    className={`px-4 py-1.5 rounded-full text-xs font-medium border transition-all ${tab === t ? 'text-white border-transparent' : 'text-gray-500 border-gray-200 bg-white hover:border-orange-300'}`}
                    style={tab === t ? { background: '#E8650D', borderColor: '#E8650D' } : {}}>
                    {t === 'existing' ? `Existing (${existing.length})` : t === 'wishlist' ? `Wish list (${wishlist.length})` : `Win back (${winback.length})`}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search clients..." aria-label="Search clients"
                  className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-orange-400 w-48" />
                <button onClick={() => setShowAdd(true)}
                  className="px-4 py-1.5 rounded-lg text-sm font-medium text-white"
                  style={{ background: '#E8650D' }}>
                  + Add client
                </button>
              </div>
            </div>

            {/* Clients table */}
            <div className="table-card mb-4">
              <table className="w-full text-sm">
                <thead className={headClass}>
                  <tr>
                    <th onClick={() => toggleSort('name')} className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-orange-600">Client{arrow('name')}</th>
                    <th onClick={() => toggleSort('monthly_value')} className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-orange-600">Monthly value{arrow('monthly_value')}</th>
                    {tab === 'existing' && revShare && <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider select-none">Rev share</th>}
                    <th onClick={() => toggleSort('status')} className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-orange-600">Status{arrow('status')}</th>
                    <th onClick={() => tab !== 'winback' && toggleSort('last_contact')} className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-orange-600">
                      {tab === 'winback' ? 'Reason left' : <>Last contact{arrow('last_contact')}</>}
                    </th>
                    <th onClick={() => toggleSort('assigned')} className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-orange-600">Assigned to{arrow('assigned')}</th>
                    {tab === 'existing' && <th onClick={() => toggleSort('contract_end')} className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-orange-600">Contract ends{arrow('contract_end')}</th>}
                    {tab === 'winback' && <th onClick={() => toggleSort('left_date')} className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-orange-600">Left date{arrow('left_date')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {segClients.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">
                      {search ? `No clients match "${search}"` : 'No clients in this segment yet'}
                    </td></tr>
                  )}
                  {segClients.map(c => {
                    const days = daysSince(c.last_contact)
                    const isAtRisk = c.status === 'at_risk'
                    const emp = empInfo(c.profiles)
                    const sharePct = totalMonthly > 0 ? (mv(c) / totalMonthly * 100) : 0
                    const contractDays = c.contract_end ? daysSince(c.contract_end) : null
                    return (
                      <tr key={c.id} className={`border-b border-gray-50 hover:bg-orange-50 transition-colors ${isAtRisk && highlightRisk ? 'bg-red-50/30' : ''}`}>
                        <td className={`px-4 ${rowPad}`}>
                          <a href={`/client/${c.id}`} className="block hover:text-orange-600 transition-colors">
                            <div className="font-medium text-gray-900 hover:text-orange-600">{c.name}</div>
                            <div className="text-xs text-gray-400">{[c.industry, c.city].filter(Boolean).join(' — ') || '—'}</div>
                          </a>
                        </td>
                        <td className={`px-4 ${rowPad} font-semibold`}>{money(c.monthly_value)}</td>
                        {tab === 'existing' && revShare && (
                          <td className={`px-4 ${rowPad} text-sm text-gray-500`}>{sharePct.toFixed(1)}%</td>
                        )}
                        <td className={`px-4 ${rowPad}`}>{statusBadge(c.status)}</td>
                        <td className={`px-4 ${rowPad}`}>
                          {tab === 'winback'
                            ? <span className="text-xs text-gray-500">{c.reason_for_leaving || 'Not logged'}</span>
                            : days !== null
                              ? <span className={`text-sm ${days > 30 ? 'text-red-600 font-medium' : 'text-gray-600'}`}>{days === 0 ? 'Today' : `${days}d ago`}</span>
                              : <span className="text-xs text-red-500">Never contacted</span>
                          }
                        </td>
                        <td className={`px-4 ${rowPad} text-sm`}>
                          {emp.name ? (
                            <button onClick={() => setEmpView(emp.name)} className="text-left hover:text-orange-600">
                              <div className="text-gray-700 font-medium">{emp.name}</div>
                              <div className="text-xs text-gray-400">{emp.team} · {emp.id}</div>
                            </button>
                          ) : <span className="text-gray-400">—</span>}
                        </td>
                        {tab === 'existing' && (
                          <td className={`px-4 ${rowPad} text-sm text-gray-500`}>
                            {c.contract_end
                              ? (countdown && contractDays !== null
                                  ? (contractDays <= 0
                                      ? <span className="text-red-600 font-medium">Expired</span>
                                      : <span className={contractDays <= 60 ? 'text-amber-600 font-medium' : ''}>{`in ${contractDays}d`}</span>)
                                  : new Date(c.contract_end).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }))
                              : '—'}
                          </td>
                        )}
                        {tab === 'winback' && (
                          <td className={`px-4 ${rowPad} text-sm text-gray-500`}>
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
                  <span className="text-xs text-red-500 font-medium">{money(winbackVal)} recoverable</span>
                </div>
                {[...winback].sort((a, b) => mv(b) - mv(a)).slice(0, 5).map(c => (
                  <a key={c.id} href={`/client/${c.id}`} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0 hover:bg-orange-50 px-1 rounded transition-colors">
                    <span className="text-sm text-gray-600 hover:text-orange-600">{c.name}</span>
                    <span className="text-sm font-medium text-red-600">{money(c.monthly_value)}</span>
                  </a>
                ))}
              </div>
              <div className="bg-white border border-gray-100 rounded-xl p-4">
                <button className="w-full flex items-center justify-between mb-3 cursor-pointer" onClick={() => navGo('pipeline', 'pipeline')}>
                  <span className="text-sm font-semibold hover:text-orange-600">Wish list pipeline</span>
                  <ChevronRight size={14} className="text-gray-400" />
                </button>
                {wishlist.slice(0, 5).map(c => (
                  <a key={c.id} href={`/client/${c.id}`} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0 hover:bg-orange-50 px-1 rounded transition-colors">
                    <span className="text-sm text-gray-600 hover:text-orange-600">{c.name}</span>
                    {statusBadge(c.status)}
                  </a>
                ))}
              </div>
              <div className="bg-white border border-gray-100 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold">Invoice status</span>
                  <span className="text-xs text-gray-400">{invoices.length} total</span>
                </div>
                {[
                  { label: 'Paid',      key: 'paid',      val: invoices.filter(i => i.status === 'paid').length,      cls: 'text-green-600' },
                  { label: 'Pending',   key: 'pending',   val: invoices.filter(i => i.status === 'pending').length,   cls: 'text-gray-600' },
                  { label: 'Due today', key: 'due_today', val: invoices.filter(i => i.status === 'due_today').length, cls: 'text-orange-600' },
                  { label: 'Overdue',   key: 'overdue',   val: invoices.filter(i => i.status === 'overdue').length,   cls: 'text-red-600' },
                ].map(r => (
                  <button key={r.label} onClick={() => setKpiView('inv_' + r.key)} className="w-full flex justify-between items-center py-2 border-b border-gray-50 last:border-0 cursor-pointer hover:bg-orange-50 px-1 rounded transition-colors">
                    <span className="text-sm text-gray-600">{r.label}</span>
                    <span className={`text-sm font-semibold ${r.cls}`}>{r.val}</span>
                  </button>
                ))}
                <div className="flex justify-between items-center pt-2 mt-1 border-t border-gray-100">
                  <span className="text-sm font-medium text-gray-700">Outstanding</span>
                  <span className="text-sm font-semibold text-red-600">{money(outstanding)}</span>
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
                { label: 'Total billed', val: money(invoices.reduce((s, i) => s + (i.amount ?? 0), 0)), sub: 'This cycle', color: '' },
                { label: 'Collected', val: money(invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.amount ?? 0), 0)), sub: 'Paid invoices', color: 'text-green-600' },
                { label: 'Outstanding', val: money(outstanding), sub: `${invoices.filter(i => i.status !== 'paid').length} invoices`, color: 'text-red-600' },
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
                <thead className={headClass}>
                  <tr>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">Client</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">Amount</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">Due date</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-400">No invoices yet</td></tr>
                  )}
                  {invoices.map(inv => {
                    const client = clients.find(c => c.id === inv.client_id)
                    return (
                      <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className={`px-4 ${rowPad} font-medium`}>{client ? <a href={`/client/${client.id}`} className="hover:text-orange-600">{client.name}</a> : 'Unknown'}</td>
                        <td className={`px-4 ${rowPad} font-semibold`}>{money(inv.amount)}</td>
                        <td className={`px-4 ${rowPad} text-gray-500`}>{new Date(inv.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                        <td className={`px-4 ${rowPad}`}>{invoiceBadge(inv.status)}</td>
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
              <p className="text-sm text-gray-500 mt-0.5">{wishlist.length} prospects worth {money(pipelineVal)} per month</p>
            </div>
            <div className="table-card">
              <table className="w-full text-sm">
                <thead className={headClass}>
                  <tr>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">Prospect</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">Est. monthly value</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">Stage</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">Notes</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {wishlist.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">No prospects yet — add one from the dashboard</td></tr>
                  )}
                  {wishlist.map(c => (
                    <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className={`px-4 ${rowPad}`}>
                        <a href={`/client/${c.id}`} className="block">
                          <div className="font-medium hover:text-orange-600">{c.name}</div>
                          <div className="text-xs text-gray-400">{[c.industry, c.city].filter(Boolean).join(' — ') || '—'}</div>
                        </a>
                      </td>
                      <td className={`px-4 ${rowPad} font-semibold`}>{money(c.monthly_value)}</td>
                      <td className={`px-4 ${rowPad}`}>{statusBadge(c.status)}</td>
                      <td className={`px-4 ${rowPad} text-xs text-gray-500 max-w-xs truncate`}>{c.notes || '—'}</td>
                      <td className={`px-4 ${rowPad} text-sm text-gray-600`}>{c.profiles?.full_name || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>}

          {/* DATA HYGIENE PAGE */}
          {page === 'hygiene' && <>
            <div className="mb-5">
              <p className="text-xs text-gray-400 mb-1">Team accountability</p>
              <h1 className="text-xl font-semibold">Data hygiene</h1>
              <p className="text-sm text-gray-500 mt-0.5">{staleClients.length} clients have had no contact logged in over 7 days</p>
            </div>
            {Object.keys(staleByEmp).length === 0 ? (
              <div className="bg-white border border-gray-100 rounded-xl p-8 text-center text-gray-400">All client records are up to date. Excellent discipline.</div>
            ) : Object.entries(staleByEmp).sort((a, b) => b[1].length - a[1].length).map(([emp, list]) => (
              <div key={emp} className="bg-white border border-gray-100 rounded-xl p-4 mb-3">
                <div className="flex items-center justify-between mb-2">
                  <button onClick={() => setEmpView(emp)} className="text-left">
                    <span className="text-sm font-semibold hover:text-orange-600">{emp}</span>
                    <span className="text-xs text-gray-400 ml-2">{empInfo({ full_name: emp }).team} · {empInfo({ full_name: emp }).id}</span>
                  </button>
                  <span className="text-xs font-semibold text-amber-700 bg-amber-100 rounded-full px-2.5 py-0.5">{list.length} overdue updates</span>
                </div>
                <div className="text-xs text-gray-500 mb-2">Likely cause: no interaction logged since last touchpoint. Follow up with {emp.split(' ')[0]} to confirm whether contact happened but was not recorded, or whether the client has genuinely not been engaged.</div>
                {[...list].sort((a, b) => staleDays(b) - staleDays(a)).map(cl => (
                  <a key={cl.id} href={`/client/${cl.id}`} className="flex justify-between items-center py-1.5 border-b border-gray-50 last:border-0 hover:bg-orange-50 px-1 rounded">
                    <span className="text-sm text-gray-600 hover:text-orange-600">{cl.name}</span>
                    <span className={`text-xs font-medium ${staleDays(cl) > 30 ? 'text-red-600' : 'text-amber-600'}`}>{staleDays(cl) === 9999 ? 'Never contacted' : `${staleDays(cl)}d since contact`}</span>
                  </a>
                ))}
              </div>
            ))}
          </>}

          {/* SETTINGS PAGE */}
          {page === 'settings' && <>
            <div className="mb-5">
              <p className="text-xs text-gray-400 mb-1">Customisation</p>
              <h1 className="text-xl font-semibold">Settings</h1>
              <p className="text-sm text-gray-500 mt-0.5">Configure how metrics are calculated and displayed</p>
            </div>
            {SETTING_GROUPS.map(g => (
              <div key={g.group} className="bg-white border border-gray-100 rounded-xl p-4 mb-3">
                <div className="text-sm font-semibold mb-3">{g.group}</div>
                {g.items.map(label => (
                  <div key={label} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
                    <span className="text-sm text-gray-600 flex items-center gap-2">
                      {label}
                      {WIRED.has(label) && <span className="text-[10px] font-semibold text-green-700 bg-green-100 rounded-full px-1.5 py-0.5">Live</span>}
                    </span>
                    <ToggleSwitch on={on(label)} onChange={v => setSetting(label, v)} label={label} />
                  </div>
                ))}
              </div>
            ))}
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs text-gray-400">
                Your choices are saved automatically to this device. Toggles marked <span className="font-semibold text-green-700">Live</span> change the dashboard right away; the rest store your preference (back-end actions like emails/exports are wired separately).
              </p>
              <button
                onClick={() => setSettings(DEFAULT_SETTINGS)}
                className="ml-4 flex-shrink-0 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">
                Reset to defaults
              </button>
            </div>
          </>}

        </main>
      </div>

      {/* KPI Breakdown Modal */}
      {kpiView && (() => {
        const Row = ({ name, right, href }: { name: string; right: React.ReactNode; href?: string }) => (
          href ? <a href={href} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0 hover:bg-orange-50 px-1 rounded"><span className="text-sm text-gray-700 hover:text-orange-600">{name}</span><span className="text-sm font-medium">{right}</span></a>
            : <div className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0"><span className="text-sm text-gray-700">{name}</span><span className="text-sm font-medium">{right}</span></div>
        )
        let title = '', formula = '', summary = '', rows: React.ReactNode = null
        if (kpiView === 'active') {
          title = `Active clients — ${existing.length}`
          formula = 'Count of all clients in the Existing segment'
          summary = `${existing.filter(x => x.status === 'growing').length} growing, ${existing.filter(x => x.status === 'stable').length} stable, ${existing.filter(x => x.status === 'at_risk').length} at risk. Growth accounts are carrying the portfolio; protect the at-risk names first.`
          rows = existing.map(x => <Row key={x.id} name={x.name} right={statusBadge(x.status)} href={`/client/${x.id}`} />)
        } else if (kpiView === 'revenue') {
          title = `Monthly revenue — ${money(totalMonthly)}`
          formula = 'Sum of monthly value across all existing clients'
          const top = [...existing].sort((a, b) => mv(b) - mv(a))
          summary = totalMonthly > 0
            ? `Top 5 clients contribute ${Math.round(top.slice(0, 5).reduce((s, x) => s + mv(x), 0) / totalMonthly * 100)}% of revenue. Concentration is ${top[0] ? Math.round(mv(top[0]) / totalMonthly * 100) : 0}% in ${top[0]?.name || ''} alone — diversification matters.`
            : 'No revenue recorded yet.'
          rows = top.map(x => <Row key={x.id} name={x.name} right={<>{money(x.monthly_value)} <span className="text-xs text-gray-400">({totalMonthly > 0 ? (mv(x) / totalMonthly * 100).toFixed(1) : '0.0'}%)</span></>} href={`/client/${x.id}`} />)
        } else if (kpiView === 'pipeline') {
          title = `Pipeline value — ${money(pipelineVal)}`
          formula = 'Sum of estimated monthly value across all wish-list prospects'
          summary = `${wishlist.filter(x => x.status === 'ready_to_sign').length} ready to sign, ${wishlist.filter(x => x.status === 'negotiating').length} negotiating. Closing just the ready-to-sign names adds ${money(wishlist.filter(x => x.status === 'ready_to_sign').reduce((s, x) => s + mv(x), 0))} per month.`
          rows = [...wishlist].sort((a, b) => mv(b) - mv(a)).map(x => <Row key={x.id} name={x.name} right={<>{money(x.monthly_value)} {statusBadge(x.status)}</>} href={`/client/${x.id}`} />)
        } else if (kpiView === 'winback') {
          title = `Win-back opportunity — ${money(winbackVal)}`
          formula = 'Sum of last known monthly value across lapsed clients'
          summary = `${winback.filter(x => x.status === 'meeting_booked' || x.status === 'in_conversation').length} of ${winback.length} are already re-engaged. Recovering the top 3 alone returns ${money([...winback].sort((a, b) => mv(b) - mv(a)).slice(0, 3).reduce((s, x) => s + mv(x), 0))} per month.`
          rows = [...winback].sort((a, b) => mv(b) - mv(a)).map(x => <Row key={x.id} name={x.name} right={<>{money(x.monthly_value)} {statusBadge(x.status)}</>} href={`/client/${x.id}`} />)
        } else if (kpiView === 'at_risk') {
          title = `At-risk clients — ${atRisk.length}`
          formula = 'Existing clients flagged at-risk, prioritised by days since last contact'
          summary = `Combined exposure of ${money(atRisk.reduce((s, x) => s + mv(x), 0))} per month. Prioritise the longest-silent names — one call each this week converts this list back to stable.`
          rows = [...atRisk].sort((a, b) => (b.last_contact ? 0 : 1) - (a.last_contact ? 0 : 1) || new Date(a.last_contact || 0).getTime() - new Date(b.last_contact || 0).getTime()).map(x => {
            const d = daysSince(x.last_contact)
            return <Row key={x.id} name={x.name} right={<span className="text-red-600">{d === null ? 'Never contacted' : `${d}d ago`} · {money(x.monthly_value)}</span>} href={`/client/${x.id}`} />
          })
        } else if (kpiView === 'avg') {
          const avg = existing.length ? totalMonthly / existing.length : 0
          title = `Average client value — ${existing.length ? money(Math.round(avg)) : 'Rs 0'}`
          formula = `Monthly revenue ${money(totalMonthly)} ÷ ${existing.length} active clients`
          summary = `${existing.filter(x => mv(x) > avg).length} clients sit above the average. Clients below the line are upsell candidates; those far above need retention insurance.`
          rows = [...existing].sort((a, b) => mv(b) - mv(a)).map(x => <Row key={x.id} name={x.name} right={<span className={mv(x) >= avg ? 'text-green-700' : 'text-gray-500'}>{money(x.monthly_value)} {mv(x) >= avg ? '▲ above avg' : '▼ below avg'}</span>} href={`/client/${x.id}`} />)
        } else if (kpiView === 'outstanding') {
          title = `Outstanding invoices — ${money(outstanding)}`
          formula = 'Sum of all invoices not yet marked paid'
          const unpaid = invoices.filter(i => i.status !== 'paid')
          summary = `${unpaid.filter(i => i.status === 'overdue').length} overdue worth ${money(unpaid.filter(i => i.status === 'overdue').reduce((s, i) => s + (i.amount ?? 0), 0))}. Chase overdue first — that cash is already earned.`
          rows = [...unpaid].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)).map(inv => {
            const cl = clients.find(x => x.id === inv.client_id)
            return <Row key={inv.id} name={cl?.name || 'Unknown'} right={<>{money(inv.amount)} <span className={inv.status === 'overdue' ? 'text-red-600 text-xs' : 'text-gray-400 text-xs'}>{inv.status.replace('_', ' ')}</span></>} href={cl ? `/client/${cl.id}` : undefined} />
          })
        } else if (kpiView === 'retention') {
          title = `Retention rate — ${retentionPct !== null ? `${retentionPct}%` : 'N/A'}`
          formula = `Active clients (${existing.length}) ÷ active + lost (${existing.length + winback.length})`
          summary = `Of the tracked portfolio, ${retentionPct ?? 0}% remain active. The ${winback.length} names in win-back are the lost share; recovering even a third pushes retention meaningfully higher. This becomes a true trailing-12-month metric once real contract history is loaded.`
          rows = <>
            <Row name="Growing" right={<span className="text-green-700">{existing.filter(x => x.status === 'growing').length} clients</span>} />
            <Row name="Stable" right={<span className="text-blue-700">{existing.filter(x => x.status === 'stable').length} clients</span>} />
            <Row name="At risk" right={<span className="text-red-600">{existing.filter(x => x.status === 'at_risk').length} clients</span>} />
            <Row name="Lost (win-back pool)" right={<span className="text-gray-500">{winback.length} clients</span>} />
          </>
        } else if (kpiView.startsWith('inv_')) {
          const st = kpiView.slice(4)
          const list = invoices.filter(i => i.status === st)
          title = `${st.replace('_', ' ').replace(/^./, ch => ch.toUpperCase())} invoices — ${list.length}`
          formula = `All invoices currently ${st.replace('_', ' ')} (status derived from due date)`
          summary = `Total value ${money(list.reduce((s, i) => s + (i.amount ?? 0), 0))}.`
          rows = [...list].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)).map(inv => {
            const cl = clients.find(x => x.id === inv.client_id)
            return <Row key={inv.id} name={cl?.name || 'Unknown'} right={<>{money(inv.amount)} <span className="text-xs text-gray-400">due {new Date(inv.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span></>} href={cl ? `/client/${cl.id}` : undefined} />
          })
        }
        return (
          <Modal onClose={() => setKpiView(null)} label={title}>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="text-xs text-gray-400 mt-1">Formula: {formula}</p>
            <div className="text-sm rounded-lg p-3 my-3" style={{ background: '#FDF1E7', color: '#B34E00' }}>{summary}</div>
            <div>{rows}</div>
            <button onClick={() => setKpiView(null)} className="mt-4 w-full px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">Close</button>
          </Modal>
        )
      })()}

      {/* Employee Modal */}
      {empView && (() => {
        const info = empInfo({ full_name: empView })
        const list = empClients(empView)
        const stale = list.filter(cl => staleDays(cl) > 7 && cl.segment !== 'winback')
        const value = list.filter(cl => cl.segment === 'existing').reduce((s, cl) => s + mv(cl), 0)
        return (
          <Modal onClose={() => setEmpView(null)} label={`Employee profile: ${empView}`} maxWidth="max-w-md">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold" style={{ background: '#E8650D' }}>{empView.split(' ').map(w => w[0]).join('')}</div>
              <div>
                <h2 className="text-lg font-semibold">{empView}</h2>
                <p className="text-xs text-gray-400">{info.id} · {info.team}{info.role ? ` · ${info.role}` : ''}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="bg-gray-50 rounded-lg p-3 text-center"><div className="text-lg font-semibold">{list.length}</div><div className="text-xs text-gray-400">Clients</div></div>
              <div className="bg-gray-50 rounded-lg p-3 text-center"><div className="text-lg font-semibold">{money(value)}</div><div className="text-xs text-gray-400">Portfolio /mo</div></div>
              <div className="bg-gray-50 rounded-lg p-3 text-center"><div className={`text-lg font-semibold ${stale.length ? 'text-amber-600' : 'text-green-700'}`}>{stale.length}</div><div className="text-xs text-gray-400">Overdue updates</div></div>
            </div>
            <div className="text-sm rounded-lg p-3 mb-3" style={{ background: '#FDF1E7', color: '#B34E00' }}>
              {empView.split(' ')[0]} manages {list.length} accounts worth {money(value)} monthly. {stale.length === 0 ? 'All records are current — strong data discipline.' : `${stale.length} client record${stale.length > 1 ? 's' : ''} ha${stale.length > 1 ? 've' : 's'} not been updated in over a week — follow up on logging discipline.`}
            </div>
            <div className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-1">Assigned clients</div>
            {list.map(cl => (
              <a key={cl.id} href={`/client/${cl.id}`} className="flex justify-between items-center py-1.5 border-b border-gray-50 last:border-0 hover:bg-orange-50 px-1 rounded">
                <span className="text-sm text-gray-700 hover:text-orange-600">{cl.name}</span>
                <span className="text-xs text-gray-400">{cl.segment}</span>
              </a>
            ))}
            <button onClick={() => setEmpView(null)} className="mt-4 w-full px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">Close</button>
          </Modal>
        )
      })()}

      {/* Account Modal */}
      {showAccount && (
        <AccountModal
          profile={profile}
          onClose={() => setShowAccount(false)}
          onSignOut={signOut}
        />
      )}

      {/* Add Client Modal */}
      {showAdd && (
        <Modal onClose={() => { if (!saving) { setShowAdd(false); setFormError(null) } }} label="Add new client" maxWidth="max-w-md">
          <h2 className="text-lg font-semibold mb-4">Add new client</h2>
          <div className="space-y-3">
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="Client name *" aria-label="Client name (required)" maxLength={120}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400" />
            <div className="grid grid-cols-2 gap-3">
              <input value={form.industry} onChange={e => setForm({ ...form, industry: e.target.value })}
                placeholder="Industry" aria-label="Industry" className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400" />
              <input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })}
                placeholder="City" aria-label="City" className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <select value={form.segment} aria-label="Segment"
                onChange={e => setForm({ ...form, segment: e.target.value, status: e.target.value === 'existing' ? 'stable' : e.target.value === 'wishlist' ? 'first_meeting' : 'not_contacted' })}
                className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-orange-400">
                <option value="existing">Existing client</option>
                <option value="wishlist">Wish list prospect</option>
                <option value="winback">Win back</option>
              </select>
              <select value={form.status} aria-label="Status" onChange={e => setForm({ ...form, status: e.target.value })}
                className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-orange-400">
                {form.segment === 'existing' && <>
                  <option value="growing">Growing</option>
                  <option value="stable">Stable</option>
                  <option value="at_risk">At risk</option>
                </>}
                {form.segment === 'wishlist' && <>
                  <option value="intro_made">Intro made</option>
                  <option value="first_meeting">First meeting</option>
                  <option value="negotiating">Negotiating</option>
                  <option value="ready_to_sign">Ready to sign</option>
                </>}
                {form.segment === 'winback' && <>
                  <option value="not_contacted">Not contacted</option>
                  <option value="in_conversation">In conversation</option>
                  <option value="meeting_booked">Meeting booked</option>
                </>}
              </select>
            </div>
            <input value={form.monthly_value} onChange={e => setForm({ ...form, monthly_value: e.target.value })}
              placeholder="Monthly value (Rs)" aria-label="Monthly value in rupees" type="number" min={0}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400" />
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
              placeholder="Notes" aria-label="Notes" rows={2} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400" />
            {formError && (
              <p role="alert" className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{formError}</p>
            )}
          </div>
          <div className="flex gap-3 mt-5">
            <button onClick={() => { setShowAdd(false); setFormError(null) }} disabled={saving} className="flex-1 px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
            <button onClick={addClient} disabled={saving || !form.name.trim()}
              className="flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
              style={{ background: '#E8650D' }}>
              {saving ? 'Saving...' : 'Add client'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ---------- Account details modal ----------
// Shows the signed-in user's profile, lets them change their own password, and
// sign out. Read-only profile fields (edits go through the admin page / RLS).
function AccountModal({ profile, onClose, onSignOut }: {
  profile: ReturnType<typeof useAuth>['profile']
  onClose: () => void
  onSignOut: () => Promise<void>
}) {
  const info = empInfo(profile ?? undefined)
  const roleLabel: Record<string, string> = { admin: 'Administrator', manager: 'Manager', executive: 'Executive (viewer)' }
  const [pwOpen, setPwOpen] = useState(false)
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwErr, setPwErr] = useState<string | null>(null)
  const [pwOk, setPwOk] = useState(false)

  async function submitPassword() {
    setPwErr(null)
    const v = validateNewPassword(pw1, pw2)
    if (v) { setPwErr(v); return }
    setPwBusy(true)
    const res = await changePassword(pw1)
    setPwBusy(false)
    if (res.error !== null) { setPwErr(res.error); return }
    setPwOk(true)
    setPw1(''); setPw2('')
  }

  const fullName = profile?.full_name ?? 'Signed in'
  const initials = fullName.split(' ').map(w => w.charAt(0)).join('').slice(0, 2).toUpperCase()

  const Field = ({ label, value }: { label: string; value: string }) => (
    <div className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-400 uppercase tracking-wider">{label}</span>
      <span className="text-sm text-gray-800 font-medium">{value}</span>
    </div>
  )

  return (
    <Modal onClose={onClose} label={`Account: ${fullName}`} maxWidth="max-w-md">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold" style={{ background: '#E8650D' }}>{initials}</div>
          <div>
            <h2 className="text-lg font-semibold">{fullName}</h2>
            <p className="text-xs text-gray-400">{profile?.role ? roleLabel[profile.role] ?? profile.role : 'No role assigned'}</p>
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl px-3 mb-3">
        <Field label="Email" value={profile?.email || '—'} />
        <Field label="Role" value={profile?.role ? roleLabel[profile.role] ?? profile.role : '—'} />
        <Field label="Team" value={info.team} />
        <Field label="Employee code" value={info.id} />
        {info.role ? <Field label="Title" value={info.role} /> : null}
      </div>

      {/* Change password */}
      {!pwOpen ? (
        <button onClick={() => { setPwOpen(true); setPwOk(false); setPwErr(null) }}
          className="w-full px-4 py-2 mb-2 text-sm font-medium border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50">
          Change password
        </button>
      ) : (
        <div className="border border-gray-100 rounded-xl p-3 mb-2">
          <div className="text-sm font-semibold mb-2">Change password</div>
          <input type="password" autoComplete="new-password" value={pw1} onChange={e => setPw1(e.target.value)}
            placeholder="New password (min 8 characters)" aria-label="New password"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg mb-2 focus:outline-none focus:border-orange-400" />
          <input type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)}
            placeholder="Confirm new password" aria-label="Confirm new password"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg mb-2 focus:outline-none focus:border-orange-400" />
          {pwErr && <p role="alert" className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-2">{pwErr}</p>}
          {pwOk && <p className="text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2 mb-2">Password updated. It is active immediately.</p>}
          <div className="flex gap-2">
            <button onClick={() => { setPwOpen(false); setPw1(''); setPw2(''); setPwErr(null) }} disabled={pwBusy}
              className="flex-1 px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50">
              {pwOk ? 'Done' : 'Cancel'}
            </button>
            <button onClick={submitPassword} disabled={pwBusy || !pw1 || !pw2}
              className="flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50" style={{ background: '#E8650D' }}>
              {pwBusy ? 'Updating…' : 'Update password'}
            </button>
          </div>
        </div>
      )}

      <button onClick={onSignOut}
        className="w-full px-4 py-2 mt-1 text-sm font-medium rounded-lg text-white flex items-center justify-center gap-2"
        style={{ background: '#1A1A1A' }}>
        <LogOut size={14} /> Sign out
      </button>
    </Modal>
  )
}
