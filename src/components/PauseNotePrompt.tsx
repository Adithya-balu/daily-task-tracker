import { useEffect, useRef, useState } from 'react'

type Props = {
  taskTitle: string
  /** Existing resume note, pre-filled so it can be refined rather than retyped. */
  initialResumeNote: string
  onSubmit: (didText: string, nextStep: string) => void
  onSkip: () => void
}

/**
 * Shown when a work session is paused/ends. Captures what was just done
 * (appended to the session log) and the next step (saved as the resume note).
 */
export function PauseNotePrompt({ taskTitle, initialResumeNote, onSubmit, onSkip }: Props) {
  const [didText, setDidText] = useState('')
  const [nextStep, setNextStep] = useState(initialResumeNote)
  const firstFieldRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    firstFieldRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSkip()
      // Cmd/Ctrl+Enter to save quickly.
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onSubmit(didText, nextStep)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [didText, nextStep, onSubmit, onSkip])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="animate-pop-in w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900/95 p-6 shadow-2xl">
        <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-indigo-300">
          Pausing
        </div>
        <h2 className="mb-5 text-lg font-semibold text-white">{taskTitle}</h2>

        <label className="mb-1.5 block text-sm font-medium text-slate-300">
          What did you just get done?
        </label>
        <textarea
          ref={firstFieldRef}
          value={didText}
          onChange={(e) => setDidText(e.target.value)}
          rows={2}
          placeholder="Logged so you can see your progress later..."
          className="mb-4 w-full resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-indigo-400/50"
        />

        <label className="mb-1.5 block text-sm font-medium text-slate-300">
          Next step when you return
        </label>
        <textarea
          value={nextStep}
          onChange={(e) => setNextStep(e.target.value)}
          rows={2}
          placeholder="The one thing to pick up first, so you can dive right back in."
          className="mb-5 w-full resize-none rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-emerald-400/50"
        />

        <div className="flex items-center justify-between">
          <button
            onClick={onSkip}
            className="rounded-xl px-3 py-2 text-sm text-slate-400 transition hover:text-slate-200"
          >
            Skip
          </button>
          <button
            onClick={() => onSubmit(didText, nextStep)}
            className="rounded-xl bg-indigo-500 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:bg-indigo-400 active:scale-95"
          >
            Save &amp; pause
          </button>
        </div>
        <p className="mt-3 text-center text-xs text-slate-600">
          Tip: Cmd/Ctrl + Enter to save, Esc to skip
        </p>
      </div>
    </div>
  )
}
