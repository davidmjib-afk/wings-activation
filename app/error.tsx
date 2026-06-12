'use client'
// Route-level error boundary — an unexpected crash shows a recovery screen
// instead of a blank page. Next.js App Router picks this up automatically.

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      <div className="text-center max-w-sm">
        <div className="text-sm font-semibold tracking-widest mb-4" style={{ color: '#E8650D' }}>WINGS GROUP</div>
        <p className="text-sm font-medium text-gray-800 mb-1">Something went wrong</p>
        <p className="text-xs text-gray-500 mb-4">
          The page hit an unexpected error. Your data is safe — try reloading.
          {error.digest && <span className="block mt-1 text-gray-400">Error ref: {error.digest}</span>}
        </p>
        <button onClick={reset} className="px-4 py-2 text-sm font-medium text-white rounded-lg" style={{ background: '#E8650D' }}>
          Reload page
        </button>
      </div>
    </div>
  )
}
