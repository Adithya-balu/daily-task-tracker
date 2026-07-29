import { useState } from 'react'
import type { PomodoroSettings } from '../lib/types'

type Props = {
  settings: PomodoroSettings
  onSave: (s: PomodoroSettings) => void
  onClose: () => void
}

export function SettingsDialog({ settings, onSave, onClose }: Props) {
  const [work, setWork] = useState(String(settings.workMinutes))
  const [brk, setBrk] = useState(String(settings.breakMinutes))

  const save = () => {
    const workMinutes = Math.min(180, Math.max(1, Math.round(Number(work) || 25)))
    const breakMinutes = Math.min(60, Math.max(1, Math.round(Number(brk) || 5)))
    onSave({ workMinutes, breakMinutes })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="animate-pop-in w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900/95 p-6 shadow-2xl">
        <h2 className="mb-5 text-lg font-semibold text-white">Timer settings</h2>

        <div className="grid grid-cols-2 gap-4">
          <label className="text-sm text-slate-300">
            Focus (min)
            <input
              type="number"
              min={1}
              max={180}
              value={work}
              onChange={(e) => setWork(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-slate-100 outline-none focus:border-indigo-400/50"
            />
          </label>
          <label className="text-sm text-slate-300">
            Break (min)
            <input
              type="number"
              min={1}
              max={60}
              value={brk}
              onChange={(e) => setBrk(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-slate-100 outline-none focus:border-indigo-400/50"
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm text-slate-400 transition hover:text-slate-200"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="rounded-xl bg-indigo-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-indigo-400 active:scale-95"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
