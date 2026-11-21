import { useEffect, useRef, useState } from 'react'
import type { RunLogLine } from '../lib/agentTypes'

/** Streams one run's log (live while running, replayed afterwards). */
export function RunLog({ taskId, runId }: { taskId: string; runId: string }) {
  const [lines, setLines] = useState<RunLogLine[]>([])
  const [ended, setEnded] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)

  useEffect(() => {
    setLines([])
    setEnded(false)
    const es = new EventSource(
      `/api/tasks/${encodeURIComponent(taskId)}/runs/${encodeURIComponent(runId)}/events`,
    )
    es.onmessage = (m) => {
      const line = JSON.parse(m.data) as RunLogLine
      if (line.kind === 'end') {
        setEnded(true)
        // Close before the browser auto-reconnects and replays everything.
        es.close()
        return
      }
      setLines((prev) => [...prev, line])
    }
    return () => es.close()
  }, [taskId, runId])

  // Follow new output unless you've scrolled up to read.
  useEffect(() => {
    const el = boxRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [lines])

  return (
    <div
      ref={boxRef}
      onScroll={(e) => {
        const el = e.currentTarget
        stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
      }}
      className="flex max-h-96 flex-col gap-2 overflow-y-auto rounded-xl border border-white/10 bg-black/30 p-3 text-sm"
    >
      {lines.length === 0 && !ended && <div className="text-xs text-slate-500">Waiting for output…</div>}
      {lines.map((line, i) => (
        <LogLine key={i} line={line} />
      ))}
      {!ended && lines.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-violet-300">
          <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-violet-300/30 border-t-violet-300" />
          Working…
        </div>
      )}
    </div>
  )
}

function LogLine({ line }: { line: RunLogLine }) {
  const [open, setOpen] = useState(false)
  switch (line.kind) {
    case 'text':
      return <div className="whitespace-pre-wrap text-slate-200">{line.text}</div>
    case 'tool':
      return (
        <div className="flex min-w-0 gap-2 font-mono text-xs">
          <span className="shrink-0 text-violet-300">▸ {line.name}</span>
          <span className="truncate text-slate-400">{line.detail}</span>
        </div>
      )
    case 'tool_result': {
      const first = line.text.split('\n')[0]
      return (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`ml-4 text-left font-mono text-[11px] ${line.isError ? 'text-rose-300' : 'text-slate-500'}`}
        >
          {open ? <pre className="whitespace-pre-wrap">{line.text}</pre> : <span className="line-clamp-1">↳ {first}</span>}
        </button>
      )
    }
    case 'system':
      return <div className="text-xs text-slate-500">{line.text}</div>
    default:
      return null
  }
}
