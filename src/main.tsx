import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import type { InitialState } from './lib/api'
import { loadInitialState } from './lib/storage'
import { applyTheme, loadTheme } from './lib/theme'

// Apply the saved theme before anything renders so the first paint isn't dark-then-light.
applyTheme(loadTheme())

/** Loads state from the local server before showing the app. */
function Root() {
  const [state, setState] = useState<InitialState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadInitialState().then(setState, (err: unknown) =>
      setError(err instanceof Error ? err.message : String(err)),
    )
  }, [])

  if (error) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center">
        <h1 className="text-lg font-semibold text-white">Can't reach the Daily Focus server</h1>
        <p className="mt-2 text-sm text-slate-400">
          Your tasks are stored by the local dev server. Start it with{' '}
          <code className="rounded bg-white/10 px-1.5">npm run dev:detach</code> and reload.
        </p>
        <p className="mt-4 font-mono text-xs text-slate-600">{error}</p>
      </div>
    )
  }
  if (!state) {
    return <div className="py-24 text-center text-sm text-slate-500">Loading…</div>
  }
  return <App initial={state} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
