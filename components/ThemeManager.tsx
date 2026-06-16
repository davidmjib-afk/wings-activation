'use client'
// Applies the user's dark/light choice on EVERY page. The dashboard's Settings
// toggle writes localStorage['wings.theme'] and fires a 'wings:theme' event;
// this component (mounted once in app/layout.tsx) reflects it onto <html> and
// ships the dark stylesheet globally so all routes — dashboard, client pages,
// admin, login, activity — pick it up.

import { useEffect } from 'react'

const DARK_CSS = `
html[data-theme="dark"], html[data-theme="dark"] body { background:#0f1115 !important; color:#e5e7eb; }
html[data-theme="dark"] main { background:#0f1115 !important; }
html[data-theme="dark"] nav { background:#15181e !important; }
html[data-theme="dark"] .bg-white { background:#1a1d24 !important; }
html[data-theme="dark"] .bg-gray-50 { background:#15181e !important; }
html[data-theme="dark"] .bg-gray-100 { background:#1f2229 !important; }
html[data-theme="dark"] thead.bg-gray-50, html[data-theme="dark"] thead { background:#1f2229 !important; }
html[data-theme="dark"] .kpi-card { background:#1a1d24 !important; border-color:#2a2e37 !important; }
html[data-theme="dark"] .table-card { background:#1a1d24 !important; border-color:#2a2e37 !important; }
html[data-theme="dark"] .nav-item { color:#cbd5e1 !important; }
html[data-theme="dark"] .text-gray-900, html[data-theme="dark"] .text-gray-800, html[data-theme="dark"] .text-gray-700 { color:#e5e7eb !important; }
html[data-theme="dark"] .text-gray-600, html[data-theme="dark"] .text-gray-500 { color:#9ca3af !important; }
html[data-theme="dark"] .text-gray-400, html[data-theme="dark"] .text-gray-300 { color:#6b7280 !important; }
html[data-theme="dark"] .border-gray-50, html[data-theme="dark"] .border-gray-100, html[data-theme="dark"] .border-gray-200 { border-color:#2a2e37 !important; }
html[data-theme="dark"] input, html[data-theme="dark"] textarea, html[data-theme="dark"] select { background:#1f2229 !important; color:#e5e7eb !important; border-color:#2a2e37 !important; }
html[data-theme="dark"] .hover\\:bg-gray-50:hover { background:#1f2229 !important; }
html[data-theme="dark"] .hover\\:bg-orange-50:hover { background:#2a1f17 !important; }
`

export default function ThemeManager() {
  useEffect(() => {
    const apply = () => {
      let dark = false
      try { dark = localStorage.getItem('wings.theme') === 'dark' } catch { /* private mode */ }
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    const onCustom = () => apply()
    const onStorage = (e: StorageEvent) => { if (!e.key || e.key === 'wings.theme') apply() }
    window.addEventListener('wings:theme', onCustom)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('wings:theme', onCustom)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  return <style id="wings-dark-css" dangerouslySetInnerHTML={{ __html: DARK_CSS }} />
}
