'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, AlertTriangle, UserPlus, LogOut, Trash2 } from 'lucide-react'
import { Profile } from '@/lib/supabase'
import {
  adminCreateUser, adminDeactivateUser, adminReactivateUser, adminDeleteUser,
  listProfiles, NewUserInput,
} from '@/lib/auth'
import { useAuth } from '@/components/AuthGuard'

const ROLE_LABEL: Record<Profile['role'], string> = {
  admin: 'Admin', manager: 'Manager', executive: 'Viewer',
}

const EMPTY_FORM: NewUserInput = { email: '', password: '', full_name: '', role: 'executive' }
const isActive = (p: Profile) => p.is_active !== false

export default function AdminUsersPage() {
  const router = useRouter()
  const { profile, isAdmin, signOut } = useAuth()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [form, setForm] = useState<NewUserInput>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [formOk, setFormOk] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Profile | null>(null)

  const reload = useCallback(async () => {
    setLoadError(null)
    const res = await listProfiles()
    if (res.error !== null) { setLoadError(res.error); setLoading(false); return }
    setProfiles(res.data)
    setLoading(false)
  }, [])

  useEffect(() => { reload() }, [reload])

  async function createUser(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null); setFormOk(null); setSaving(true)
    const res = await adminCreateUser(form)
    setSaving(false)
    if (res.error !== null) { setFormError(res.error); return }
    setFormOk(`Login created for ${form.email}. Share the password with them securely.`)
    setForm(EMPTY_FORM)
    await reload()
  }

  const activeAdmins = profiles.filter(p => p.role === 'admin' && isActive(p) && p.auth_user_id).length
  const isSelf = (p: Profile) => !!profile && (p.id === profile.id || (!!p.auth_user_id && p.auth_user_id === profile.auth_user_id))
  const isLastAdmin = (p: Profile) => p.role === 'admin' && isActive(p) && activeAdmins <= 1

  async function runAction(p: Profile, fn: () => Promise<{ error: string | null }>) {
    setRowError(null); setBusyId(p.id)
    const res = await fn()
    setBusyId(null)
    if (res.error !== null) { setRowError(res.error); return false }
    await reload()
    return true
  }

  if (!isAdmin) return (
    <div className="flex flex-col items-center justify-center h-screen gap-3">
      <AlertTriangle size={28} style={{ color: '#E8650D' }} />
      <p className="text-gray-600 text-sm">Only administrators can manage users.</p>
      <a href="/" className="text-sm font-medium" style={{ color: '#E8650D' }}>Back to dashboard</a>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex items-center justify-between px-6" style={{ background: '#1A1A1A', height: 52 }}>
        <span className="text-sm font-semibold tracking-widest" style={{ color: '#E8650D' }}>WINGS GROUP</span>
        <span className="text-xs text-gray-400">Activation — User Management</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-300">{profile?.full_name ?? ''}</span>
          <button onClick={signOut} aria-label="Sign out"
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors">
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        <button onClick={() => router.push('/')}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 mb-5 transition-colors">
          <ArrowLeft size={16} /> Back to dashboard
        </button>

        <div className="grid grid-cols-5 gap-5">
          {/* Create user */}
          <form onSubmit={createUser} className="col-span-2 bg-white border border-gray-100 rounded-2xl p-5 self-start">
            <div className="flex items-center gap-2 mb-4">
              <UserPlus size={16} style={{ color: '#E8650D' }} />
              <h2 className="text-sm font-semibold text-gray-800">Create login ID</h2>
            </div>
            <div className="space-y-3">
              <input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })}
                placeholder="Full name" aria-label="Full name" required
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400" />
              <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                placeholder="Email" aria-label="Email" type="email" required
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400" />
              <input value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                placeholder="Temporary password (min 8 chars)" aria-label="Temporary password" type="text" required minLength={8}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400" />
              <select value={form.role} aria-label="Role"
                onChange={e => setForm({ ...form, role: e.target.value as NewUserInput['role'] })}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-orange-400">
                <option value="executive">Viewer — sees metrics only</option>
                <option value="manager">Manager — can edit data</option>
                <option value="admin">Admin — full access + user management</option>
              </select>
              {formError && <p role="alert" className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{formError}</p>}
              {formOk && <p role="status" className="text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2">{formOk}</p>}
            </div>
            <button type="submit" disabled={saving}
              className="w-full mt-4 px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
              style={{ background: '#E8650D' }}>
              {saving ? 'Creating…' : 'Create user'}
            </button>
          </form>

          {/* Directory */}
          <div className="col-span-3 bg-white border border-gray-100 rounded-2xl overflow-hidden self-start">
            <div className="px-4 py-3 border-b border-gray-100 text-sm font-semibold text-gray-800">
              Team directory ({profiles.length})
            </div>
            {rowError && <div role="alert" className="px-4 py-2 text-xs text-red-600 bg-red-50 border-b border-red-100">{rowError}</div>}
            {loading ? (
              <div className="p-6 animate-pulse space-y-3" aria-busy="true">
                {[...Array(5)].map((_, i) => <div key={i} className="h-8 bg-gray-100 rounded" />)}
              </div>
            ) : loadError ? (
              <div className="p-6 text-sm text-red-600">{loadError}</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">Name</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">Role</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map(p => {
                    const active = isActive(p)
                    const self = isSelf(p)
                    const busy = busyId === p.id
                    const lockAdmin = isLastAdmin(p)
                    return (
                      <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-800">{p.full_name}{self && <span className="text-xs text-gray-400 font-normal"> · you</span>}</div>
                          <div className="text-xs text-gray-400">{p.email ?? '—'}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium"
                            style={p.role === 'admin'
                              ? { background: '#FDF1E7', color: '#B34E00' }
                              : { background: '#F1EFE8', color: '#5F5E5A' }}>
                            {ROLE_LABEL[p.role]}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {!p.auth_user_id ? (
                            <span className="text-xs text-gray-400">No login yet</span>
                          ) : active ? (
                            <span className="text-xs font-medium text-green-700">Active</span>
                          ) : (
                            <span className="text-xs font-medium text-gray-500">Deactivated</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            {self ? (
                              <span className="text-xs text-gray-300">—</span>
                            ) : (
                              <>
                                {active ? (
                                  <button onClick={() => runAction(p, () => adminDeactivateUser(p.id))}
                                    disabled={busy || lockAdmin}
                                    title={lockAdmin ? 'Cannot deactivate the last active admin' : 'Revoke login, keep record'}
                                    className="px-2.5 py-1 text-xs font-medium border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                                    {busy ? '…' : 'Deactivate'}
                                  </button>
                                ) : (
                                  <button onClick={() => runAction(p, () => adminReactivateUser(p.id))}
                                    disabled={busy}
                                    className="px-2.5 py-1 text-xs font-medium border rounded-lg disabled:opacity-40"
                                    style={{ borderColor: '#E8650D', color: '#E8650D' }}>
                                    {busy ? '…' : 'Reactivate'}
                                  </button>
                                )}
                                <button onClick={() => { setRowError(null); setConfirmDelete(p) }}
                                  disabled={busy || lockAdmin}
                                  title={lockAdmin ? 'Cannot delete the last active admin' : 'Permanently delete'}
                                  aria-label={`Permanently delete ${p.full_name}`}
                                  className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-30">
                                  <Trash2 size={14} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <p className="text-xs text-gray-400 mt-4">
          <strong>Deactivate</strong> revokes a person&apos;s login but keeps their record, assigned clients and history — reversible.
          <strong> Delete</strong> permanently removes the login and the profile row and cannot be undone. The last active admin is protected from both.
          Role changes still happen in Supabase → Table Editor → profiles (in-app role editing is a TODO).
        </p>
      </div>

      {/* Permanent delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}
          onClick={() => busyId ? null : setConfirmDelete(null)}>
          <div role="dialog" aria-modal="true" aria-label="Confirm permanent delete"
            className="bg-white rounded-2xl p-6 w-full max-w-sm mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={18} className="text-red-600" />
              <h2 className="text-lg font-semibold">Permanently delete user?</h2>
            </div>
            <p className="text-sm text-gray-600 mb-1">
              This removes <strong>{confirmDelete.full_name}</strong>&apos;s login and profile for good.
            </p>
            <p className="text-xs text-gray-400 mb-4">
              Their name will no longer appear on clients they were assigned to or files they uploaded. This cannot be undone — consider <em>Deactivate</em> if you might restore them later.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)} disabled={busyId === confirmDelete.id}
                className="flex-1 px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
              <button
                onClick={async () => {
                  const target = confirmDelete
                  const okDone = await runAction(target, () => adminDeleteUser(target.id))
                  if (okDone) setConfirmDelete(null)
                }}
                disabled={busyId === confirmDelete.id}
                className="flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50">
                {busyId === confirmDelete.id ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
