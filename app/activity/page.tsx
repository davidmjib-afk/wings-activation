'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, AlertTriangle, LogOut, Clock } from 'lucide-react'
import { ActivityLog } from '@/lib/supabase'
import { getRecentActivity, daysSince } from '@/lib/data'
import { useAuth } from '@/components/AuthGuard'

const KIND_LABEL: Record<ActivityLog['kind'], string> = {
  note: 'Note', contact: 'Contact', invoice: 'Invoice', status: 'Status', file: 'File', system: 'System',
}
const KIND_COLOR: Record<ActivityLog['kind'], { color: string; bg: string }> = {
  note:    { color: '#185FA5', bg: '#E6F1FB' },
  contact: { color: '#27500A', bg: '#EAF3DE' },
  invoice: { color: '#854F0B', bg: '#FAEEDA' },
  status:  { color: '#B34E00', bg: '#FDF1E7' },
  file:    { color: '#5F5E5A', bg: '#F1EFE8' },
  system:  { color: '#5F5E5A', bg: '#F1EFE8' },
}

const when = (iso: string) => {
  const d = daysSince(iso)
  const t = new Date(iso)
  const time = t.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  if (d === 0) return `Today ${time}`
  if (d === 1) return `Yesterday ${time}`
  return t.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function ActivityFeedPage() {
  const router = useRouter()
  const { profile, signOut } = useAuth()
  const [items, setItems] = useState<ActivityLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<'all' | ActivityLog['kind']>('all')

  const reload = useCallback(async () => {
    setError(null)
    const res = await getRecentActivity(200)
    if (res.error !== null) { setError(res.error); setLoading(false); return }
    setItems(res.data)
    setLoading(false)
  }, [])

  useEffect(() => { reload() }, [reload])

  const shown = kindFilter === 'all' ? items : items.filter(i => i.kind === kindFilter)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex items-center justify-between px-6" style={{ background: '#1A1A1A', height: 52 }}>
        <span className="text-sm font-semibold tracking-widest" style={{ color: '#E8650D' }}>WINGS GROUP</span>
        <span className="text-xs text-gray-400">Activation — Activity Feed</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-300">{profile?.full_name ?? ''}</span>
          <button onClick={signOut} aria-label="Sign out"
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors">
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-6">
        <button onClick={() => router.push('/')}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 mb-5 transition-colors">
          <ArrowLeft size={16} /> Back to dashboard
        </button>

        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2"><Clock size={18} style={{ color: '#E8650D' }} /> Activity feed</h1>
            <p className="text-sm text-gray-500 mt-0.5">Everything logged across all clients, newest first</p>
          </div>
          <select value={kindFilter} onChange={e => setKindFilter(e.target.value as typeof kindFilter)}
            aria-label="Filter by type"
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-orange-400">
            <option value="all">All types</option>
            <option value="note">Notes</option>
            <option value="contact">Contacts</option>
            <option value="invoice">Invoices</option>
            <option value="status">Status</option>
            <option value="file">Files</option>
          </select>
        </div>

        {loading ? (
          <div className="space-y-3 animate-pulse" aria-busy="true">
            {[...Array(6)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-xl" />)}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-16">
            <AlertTriangle size={24} style={{ color: '#E8650D' }} />
            <p className="text-sm text-gray-500">{error}</p>
            <button onClick={() => { setLoading(true); reload() }} className="px-4 py-2 text-sm font-medium text-white rounded-lg" style={{ background: '#E8650D' }}>Try again</button>
          </div>
        ) : shown.length === 0 ? (
          <div className="bg-white border border-gray-100 rounded-xl p-10 text-center text-gray-400">
            Nothing logged yet. Notes, contacts and invoices added on client pages appear here.
          </div>
        ) : (
          <div className="bg-white border border-gray-100 rounded-xl divide-y divide-gray-50">
            {shown.map(a => {
              const c = KIND_COLOR[a.kind] ?? KIND_COLOR.note
              return (
                <div key={a.id} className="px-4 py-3 flex items-start gap-3">
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 mt-0.5"
                    style={{ background: c.bg, color: c.color }}>{KIND_LABEL[a.kind] ?? 'Note'}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-gray-800 whitespace-pre-wrap break-words">{a.body}</div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {a.clients?.name ? (
                        <a href={`/client/${a.client_id}`} className="font-medium hover:text-orange-600">{a.clients.name}</a>
                      ) : 'Unknown client'}
                      {' · '}{a.author_name || '—'}{' · '}{when(a.created_at)}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
