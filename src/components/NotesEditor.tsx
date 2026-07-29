import { useLayoutEffect, useRef, useState } from 'react'

/** Matches a markdown task-list line: "- [ ] text" or "- [x] text" (indent allowed). */
const CHECKBOX_RE = /^(\s*)[-*] \[([ xX])\] (.*)$/

type Props = {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
  /** Tailwind classes controlling the preview's max height / scroll. */
  previewClassName?: string
}

export function NotesEditor({
  value,
  onChange,
  placeholder,
  rows = 6,
  previewClassName = '',
}: Props) {
  const hasContent = value.trim().length > 0
  const [editing, setEditing] = useState(!hasContent)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Caret position to restore after a programmatic value change (list continuation).
  const pendingCaretRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    if (pendingCaretRef.current != null && textareaRef.current) {
      const pos = pendingCaretRef.current
      textareaRef.current.selectionStart = pos
      textareaRef.current.selectionEnd = pos
      pendingCaretRef.current = null
    }
  }, [value])

  const lines = value.split('\n')

  /** Enter continues a checklist; Enter on an empty item exits the list. */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return
    const ta = e.currentTarget
    const start = ta.selectionStart
    const end = ta.selectionEnd
    if (start !== end) return

    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const rawLineEnd = value.indexOf('\n', start)
    const lineEnd = rawLineEnd === -1 ? value.length : rawLineEnd
    const currentLine = value.slice(lineStart, lineEnd)
    const m = currentLine.match(CHECKBOX_RE)
    if (!m) return

    e.preventDefault()
    if (m[3].trim() === '') {
      // Empty checklist item: remove the marker and drop out of the list.
      const next = value.slice(0, lineStart) + value.slice(lineEnd)
      pendingCaretRef.current = lineStart
      onChange(next)
    } else {
      // Continue the checklist with a fresh unchecked item at the same indent.
      const insert = `\n${m[1]}- [ ] `
      const next = value.slice(0, start) + insert + value.slice(end)
      pendingCaretRef.current = start + insert.length
      onChange(next)
    }
  }

  const toggleLine = (idx: number) => {
    const next = lines.map((line, i) => {
      if (i !== idx) return line
      const m = line.match(CHECKBOX_RE)
      if (!m) return line
      const checked = m[2].toLowerCase() === 'x'
      return `${m[1]}- [${checked ? ' ' : 'x'}] ${m[3]}`
    })
    onChange(next.join('\n'))
  }

  const addChecklistItem = () => {
    const needsBreak = value.length > 0 && !value.endsWith('\n')
    onChange(`${value}${needsBreak ? '\n' : ''}- [ ] `)
    setEditing(true)
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-1">
        <button
          type="button"
          onClick={addChecklistItem}
          className="flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs font-medium text-slate-300 transition hover:bg-white/10"
          title="Add a checklist item"
        >
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6l2 2 3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3 14l2 2 3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M11 6h6M11 14h6" strokeLinecap="round" />
          </svg>
          Checklist item
        </button>
        {hasContent && (
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            className="ml-auto rounded-md px-2 py-1 text-xs font-medium text-slate-400 transition hover:bg-white/10 hover:text-slate-200"
          >
            {editing ? 'Preview' : 'Edit'}
          </button>
        )}
      </div>

      {editing ? (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => hasContent && setEditing(false)}
          rows={rows}
          placeholder={
            placeholder ?? 'Details, plan, links... Use "- [ ] task" for checkboxes.'
          }
          className="w-full resize-y rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm leading-relaxed text-slate-100 placeholder:text-slate-500 outline-none focus:border-indigo-400/50"
        />
      ) : (
        <div
          onClick={() => setEditing(true)}
          className={`cursor-text rounded-lg border border-transparent px-1 py-1 text-sm leading-relaxed ${previewClassName}`}
        >
          {lines.map((line, i) => {
            const m = line.match(CHECKBOX_RE)
            if (m) {
              const checked = m[2].toLowerCase() === 'x'
              return (
                <label
                  key={i}
                  onClick={(e) => e.stopPropagation()}
                  className="flex cursor-pointer items-start gap-2 py-0.5"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleLine(i)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-500"
                  />
                  <span className={checked ? 'text-slate-500 line-through' : 'text-slate-200'}>
                    {m[3] || '\u00a0'}
                  </span>
                </label>
              )
            }
            if (line.trim() === '') return <div key={i} className="h-3" />
            return (
              <p key={i} className="whitespace-pre-wrap text-slate-200">
                {line}
              </p>
            )
          })}
        </div>
      )}
    </div>
  )
}
