import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { PRIORITY_ORDER, type Priority, type Task, type TimeBlock } from '../lib/types'
import {
  formatDayLabel,
  formatDuration,
  formatHour,
  formatMinutes,
  minutesOfDay,
  shiftDayKey,
} from '../lib/time'
import { PRIORITY_STYLES } from './ui'

/** Pixel height of one hour on the timeline; 15 min = 14px. */
const HOUR_PX = 56
const SNAP_MIN = 15
const MIN_BLOCK_MIN = 15
const DEFAULT_BLOCK_MIN = 60
const DAY_MIN = 24 * 60
const GUTTER_PX = 56
/** Pointer must travel this far before a press counts as a drag. */
const DRAG_THRESHOLD_PX = 4
const TASK_DRAG_TYPE = 'application/x-daily-focus-task'

export type BlockInput = Omit<TimeBlock, 'id' | 'createdAt'>

type Props = {
  /** Day being planned (YYYY-MM-DD). */
  dayKey: string
  today: string
  tasks: Task[]
  blocks: TimeBlock[]
  activeTaskId: string | null
  onChangeDay: (dayKey: string) => void
  onAddBlock: (block: BlockInput) => TimeBlock
  onUpdateBlock: (id: string, patch: Partial<TimeBlock>) => void
  onDeleteBlock: (id: string) => void
  onFocus: (taskId: string) => void
  onOpenTask: (taskId: string) => void
}

type Drag =
  | { kind: 'create'; anchor: number; current: number; moved: boolean; startY: number }
  | {
      kind: 'move'
      id: string
      grabOffset: number
      duration: number
      start: number
      moved: boolean
      startY: number
    }
  | { kind: 'resize'; id: string; start: number; end: number; moved: boolean; startY: number }

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const snap = (min: number) => clamp(Math.round(min / SNAP_MIN) * SNAP_MIN, 0, DAY_MIN)
const toPx = (min: number) => (min / 60) * HOUR_PX

/**
 * Side-by-side layout for overlapping blocks (like Apple Calendar): blocks
 * that overlap in time share the width of their cluster, each in its own column.
 */
function layoutBlocks(blocks: TimeBlock[]): Map<string, { col: number; cols: number }> {
  const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin)
  const result = new Map<string, { col: number; cols: number }>()
  let cluster: TimeBlock[] = []
  let clusterEnd = -1

  const flush = () => {
    const colEnds: number[] = []
    const assigned = new Map<string, number>()
    for (const b of cluster) {
      let col = colEnds.findIndex((end) => end <= b.startMin)
      if (col === -1) {
        col = colEnds.length
        colEnds.push(b.endMin)
      } else {
        colEnds[col] = b.endMin
      }
      assigned.set(b.id, col)
    }
    for (const b of cluster) result.set(b.id, { col: assigned.get(b.id)!, cols: colEnds.length })
    cluster = []
    clusterEnd = -1
  }

  for (const b of sorted) {
    if (cluster.length && b.startMin >= clusterEnd) flush()
    cluster.push(b)
    clusterEnd = Math.max(clusterEnd, b.endMin)
  }
  if (cluster.length) flush()
  return result
}

/** First start time at or after `from` where a block of `duration` fits. */
function nextFreeStart(blocks: TimeBlock[], from: number, duration: number): number {
  let candidate = clamp(Math.ceil(from / SNAP_MIN) * SNAP_MIN, 0, DAY_MIN - duration)
  const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin)
  for (const b of sorted) {
    if (b.startMin < candidate + duration && b.endMin > candidate) {
      candidate = b.endMin
    }
  }
  return clamp(candidate, 0, DAY_MIN - duration)
}

export function DayPlanner({
  dayKey,
  today,
  tasks,
  blocks,
  activeTaskId,
  onChangeDay,
  onAddBlock,
  onUpdateBlock,
  onDeleteBlock,
  onFocus,
  onOpenTask,
}: Props) {
  const isToday = dayKey === today
  const scrollRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null)
  /** Start minute of a task card being dragged over the grid from the sidebar. */
  const [dropPreview, setDropPreview] = useState<number | null>(null)
  const [nowMin, setNowMin] = useState(() => minutesOfDay())

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])
  const dayBlocks = useMemo(() => blocks.filter((b) => b.dayKey === dayKey), [blocks, dayKey])
  const selected = selectedId ? (dayBlocks.find((b) => b.id === selectedId) ?? null) : null

  // Tick the current-time line once a minute.
  useEffect(() => {
    const id = setInterval(() => setNowMin(minutesOfDay()), 30_000)
    return () => clearInterval(id)
  }, [])

  // Scroll to just above "now" for today, or to the start of a working day otherwise.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const target = isToday ? Math.max(0, minutesOfDay() - 60) : 8 * 60
    el.scrollTop = toPx(target)
  }, [dayKey, isToday])

  // Selection follows the viewed day; a block from another day can't stay selected.
  useEffect(() => {
    if (selectedId && !dayBlocks.some((b) => b.id === selectedId)) setSelectedId(null)
  }, [dayBlocks, selectedId])

  // Keyboard: Esc deselects, Delete/Backspace removes the selected block.
  useEffect(() => {
    if (!selectedId) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (e.key === 'Escape') {
        setSelectedId(null)
        if (typing) (target as HTMLElement).blur()
        return
      }
      if (typing) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        onDeleteBlock(selectedId)
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, onDeleteBlock])

  const minuteAt = useCallback((clientY: number): number => {
    const grid = gridRef.current
    if (!grid) return 0
    const rect = grid.getBoundingClientRect()
    return clamp(((clientY - rect.top) / HOUR_PX) * 60, 0, DAY_MIN)
  }, [])

  const createBlock = useCallback(
    (input: Omit<BlockInput, 'dayKey'>) => {
      const created = onAddBlock({ ...input, dayKey })
      setSelectedId(created.id)
      if (!input.taskId) setJustCreatedId(created.id)
      return created
    },
    [onAddBlock, dayKey],
  )

  // ---- Pointer interactions on the grid (create / move / resize) ----
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    const resizeEl = target.closest<HTMLElement>('[data-resize-id]')
    const blockEl = target.closest<HTMLElement>('[data-block-id]')
    const minute = minuteAt(e.clientY)

    if (resizeEl) {
      const id = resizeEl.dataset.resizeId!
      const b = dayBlocks.find((x) => x.id === id)
      if (!b) return
      setDrag({ kind: 'resize', id, start: b.startMin, end: b.endMin, moved: false, startY: e.clientY })
    } else if (blockEl) {
      const id = blockEl.dataset.blockId!
      const b = dayBlocks.find((x) => x.id === id)
      if (!b) return
      setDrag({
        kind: 'move',
        id,
        grabOffset: minute - b.startMin,
        duration: b.endMin - b.startMin,
        start: b.startMin,
        moved: false,
        startY: e.clientY,
      })
    } else {
      setDrag({ kind: 'create', anchor: snap(minute), current: snap(minute), moved: false, startY: e.clientY })
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Capture is a nicety (keeps the drag alive outside the grid); not every browser grants it.
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return
    const minute = minuteAt(e.clientY)
    const moved = drag.moved || Math.abs(e.clientY - drag.startY) > DRAG_THRESHOLD_PX
    if (!moved) return
    switch (drag.kind) {
      case 'create':
        setDrag({ ...drag, current: snap(minute), moved })
        break
      case 'move': {
        const start = clamp(snap(minute - drag.grabOffset), 0, DAY_MIN - drag.duration)
        setDrag({ ...drag, start, moved })
        break
      }
      case 'resize': {
        const end = clamp(snap(minute), drag.start + MIN_BLOCK_MIN, DAY_MIN)
        setDrag({ ...drag, end, moved })
        break
      }
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    setDrag(null)
    switch (drag.kind) {
      case 'create': {
        if (!drag.moved) {
          // Plain click on empty space just clears the selection.
          setSelectedId(null)
          return
        }
        const start = Math.min(drag.anchor, drag.current)
        const end = Math.max(drag.anchor, drag.current, start + MIN_BLOCK_MIN)
        createBlock({ taskId: null, title: '', startMin: start, endMin: Math.min(end, DAY_MIN) })
        return
      }
      case 'move': {
        if (drag.moved) {
          onUpdateBlock(drag.id, { startMin: drag.start, endMin: drag.start + drag.duration })
        } else {
          setSelectedId((prev) => (prev === drag.id ? null : drag.id))
        }
        return
      }
      case 'resize': {
        if (drag.moved) onUpdateBlock(drag.id, { endMin: drag.end })
        return
      }
    }
  }

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.closest('[data-block-id]')) return
    const start = clamp(snap(minuteAt(e.clientY)), 0, DAY_MIN - MIN_BLOCK_MIN)
    createBlock({
      taskId: null,
      title: '',
      startMin: start,
      endMin: Math.min(DAY_MIN, start + DEFAULT_BLOCK_MIN),
    })
  }

  // ---- Task cards dragged in from the sidebar (HTML5 drag and drop) ----
  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(TASK_DRAG_TYPE)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    const start = clamp(snap(minuteAt(e.clientY)), 0, DAY_MIN - DEFAULT_BLOCK_MIN)
    setDropPreview((prev) => (prev === start ? prev : start))
  }
  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setDropPreview(null)
  }
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    const taskId = e.dataTransfer.getData(TASK_DRAG_TYPE)
    setDropPreview(null)
    if (!taskId || !taskById.has(taskId)) return
    e.preventDefault()
    const start = clamp(snap(minuteAt(e.clientY)), 0, DAY_MIN - DEFAULT_BLOCK_MIN)
    createBlock({ taskId, title: '', startMin: start, endMin: start + DEFAULT_BLOCK_MIN })
  }

  /** Puts a task (or a new free block) into the next open slot. */
  const scheduleNext = (taskId: string | null, title = '') => {
    const from = isToday ? nowMin : 9 * 60
    const start = nextFreeStart(dayBlocks, from, DEFAULT_BLOCK_MIN)
    createBlock({ taskId, title, startMin: start, endMin: start + DEFAULT_BLOCK_MIN })
  }

  // Blocks as drawn, with the in-flight drag applied to the one being edited.
  const displayBlocks = useMemo(() => {
    if (!drag || drag.kind === 'create' || !drag.moved) return dayBlocks
    return dayBlocks.map((b) => {
      if (b.id !== drag.id) return b
      if (drag.kind === 'move') return { ...b, startMin: drag.start, endMin: drag.start + drag.duration }
      return { ...b, endMin: drag.end }
    })
  }, [dayBlocks, drag])
  const layout = useMemo(() => layoutBlocks(displayBlocks), [displayBlocks])

  const createPreview =
    drag?.kind === 'create' && drag.moved
      ? {
          start: Math.min(drag.anchor, drag.current),
          end: Math.max(drag.anchor, drag.current, Math.min(drag.anchor, drag.current) + MIN_BLOCK_MIN),
        }
      : null

  const unscheduled = useMemo(() => {
    const scheduledIds = new Set(dayBlocks.map((b) => b.taskId).filter(Boolean))
    return tasks
      .filter((t) => t.status !== 'done' && !scheduledIds.has(t.id))
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'in_progress' ? -1 : 1
        return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.createdAt - b.createdAt
      })
  }, [tasks, dayBlocks])

  const plannedMin = dayBlocks.reduce((n, b) => n + (b.endMin - b.startMin), 0)
  const hours = Array.from({ length: 24 }, (_, h) => h)

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      {/* ---- Timeline ---- */}
      <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-1">
            <NavButton onClick={() => onChangeDay(shiftDayKey(dayKey, -1))} label="Previous day">
              ‹
            </NavButton>
            <button
              type="button"
              onClick={() => onChangeDay(today)}
              disabled={isToday}
              className="rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-300 transition hover:bg-white/10 disabled:cursor-default disabled:opacity-40"
            >
              Today
            </button>
            <NavButton onClick={() => onChangeDay(shiftDayKey(dayKey, 1))} label="Next day">
              ›
            </NavButton>
            <h2 className="ml-2 text-base font-semibold text-white">
              {formatDayLabel(dayKey)}
              {isToday && <span className="ml-2 text-xs font-medium text-indigo-300">Today</span>}
            </h2>
          </div>
          <div className="text-xs text-slate-500">
            {dayBlocks.length === 0
              ? 'Nothing planned yet'
              : `${dayBlocks.length} block${dayBlocks.length === 1 ? '' : 's'} · ${formatDuration(plannedMin * 60)} planned`}
          </div>
        </header>

        <div
          ref={scrollRef}
          className="relative h-[min(72vh,820px)] min-h-[420px] overflow-y-auto overscroll-contain"
        >
          <div
            ref={gridRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={onDoubleClick}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={`relative select-none touch-none ${
              drag?.kind === 'move' ? 'cursor-grabbing' : drag?.kind === 'resize' ? 'cursor-ns-resize' : 'cursor-crosshair'
            }`}
            style={{ height: HOUR_PX * 24 }}
          >
            {/* Hour rows */}
            {hours.map((h) => (
              <div key={h} className="absolute inset-x-0" style={{ top: h * HOUR_PX, height: HOUR_PX }}>
                <div className="absolute inset-x-0 top-0 border-t border-white/10" style={{ left: GUTTER_PX }} />
                <div
                  className="absolute inset-x-0 border-t border-dashed border-white/[0.05]"
                  style={{ left: GUTTER_PX, top: HOUR_PX / 2 }}
                />
                {h > 0 && !(isToday && Math.abs(h * 60 - nowMin) < 12) && (
                  <span
                    className="absolute -top-2 left-0 pr-2 text-right font-mono text-[10px] text-slate-500"
                    style={{ width: GUTTER_PX }}
                  >
                    {formatHour(h)}
                  </span>
                )}
              </div>
            ))}

            {/* Current time: centered on the exact minute (translate) and layered
                beneath blocks (z-[5] < z-10) so it never covers a block's title. */}
            {isToday && (
              <div
                className="pointer-events-none absolute inset-x-0 z-[5] flex -translate-y-1/2 items-center"
                style={{ top: toPx(nowMin) }}
              >
                <span className="font-mono text-[10px] font-semibold text-rose-400" style={{ width: GUTTER_PX, textAlign: 'right', paddingRight: 8 }}>
                  {formatMinutes(nowMin)}
                </span>
                <span className="-ml-1 h-2.5 w-2.5 rounded-full bg-rose-500" />
                <span className="h-px flex-1 bg-rose-500" />
              </div>
            )}

            {/* Blocks layer */}
            <div className="absolute inset-y-0 right-2" style={{ left: GUTTER_PX + 4 }}>
              {displayBlocks.map((b) => {
                const pos = layout.get(b.id) ?? { col: 0, cols: 1 }
                const task = b.taskId ? taskById.get(b.taskId) : undefined
                const isDragging = drag != null && drag.kind !== 'create' && drag.id === b.id && drag.moved
                return (
                  <BlockCard
                    key={b.id}
                    block={b}
                    task={task}
                    col={pos.col}
                    cols={pos.cols}
                    isSelected={b.id === selectedId}
                    isActive={!!b.taskId && b.taskId === activeTaskId}
                    isPast={isToday ? b.endMin <= nowMin : dayKey < today}
                    isDragging={isDragging}
                  />
                )
              })}

              {createPreview && (
                <GhostBlock start={createPreview.start} end={createPreview.end} label="New block" />
              )}
              {dropPreview != null && (
                <GhostBlock
                  start={dropPreview}
                  end={dropPreview + DEFAULT_BLOCK_MIN}
                  label="Drop to schedule"
                />
              )}
            </div>
          </div>
        </div>

        <footer className="border-t border-white/10 px-4 py-2 text-[11px] text-slate-500">
          Drag on empty time to block it &middot; double-click for a 1h block &middot; drag a block to move,
          its bottom edge to resize &middot; drag a task from the right onto the timeline
        </footer>
      </section>

      {/* ---- Sidebar ---- */}
      <aside className="flex flex-col gap-4">
        {selected ? (
          <BlockEditor
            key={selected.id}
            block={selected}
            task={selected.taskId ? taskById.get(selected.taskId) : undefined}
            tasks={tasks}
            autoFocusTitle={justCreatedId === selected.id}
            onChange={(patch) => onUpdateBlock(selected.id, patch)}
            onDelete={() => {
              onDeleteBlock(selected.id)
              setSelectedId(null)
            }}
            onFocus={onFocus}
            onOpenTask={onOpenTask}
            onClose={() => setSelectedId(null)}
          />
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 px-4 py-3 text-xs text-slate-500">
            Select a block to edit its time, link it to a task, or start focusing on it.
          </div>
        )}

        <QuickBlockInput onAdd={(title) => scheduleNext(null, title)} />

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-xs font-semibold uppercase tracking-widest text-slate-300">
              Unscheduled
            </span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-400">
              {unscheduled.length}
            </span>
          </div>
          {unscheduled.length === 0 ? (
            <p className="px-1 py-4 text-center text-xs text-slate-600">
              {tasks.some((t) => t.status !== 'done')
                ? 'Every open task has a slot on this day.'
                : 'No open tasks. Add some on the Today tab.'}
            </p>
          ) : (
            <ul className="flex max-h-[48vh] flex-col gap-1.5 overflow-y-auto pr-0.5">
              {unscheduled.map((t) => (
                <li key={t.id}>
                  <TaskChip task={t} onSchedule={() => scheduleNext(t.id)} onOpen={() => onOpenTask(t.id)} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  )
}

function NavButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-lg px-2 py-0.5 text-lg leading-none text-slate-400 transition hover:bg-white/10 hover:text-white"
    >
      {children}
    </button>
  )
}

const BLOCK_STYLE: Record<Priority | 'free' | 'done', string> = {
  high: 'border-rose-400 bg-rose-500/25 text-rose-50 hover:bg-rose-500/35',
  medium: 'border-amber-400 bg-amber-500/25 text-amber-50 hover:bg-amber-500/35',
  low: 'border-sky-400 bg-sky-500/25 text-sky-50 hover:bg-sky-500/35',
  free: 'border-indigo-400 bg-indigo-500/25 text-indigo-50 hover:bg-indigo-500/35',
  done: 'border-emerald-400/70 bg-emerald-500/15 text-emerald-100/80 hover:bg-emerald-500/25',
}

function blockTitle(block: TimeBlock, task: Task | undefined): string {
  if (task) return task.title
  return block.title.trim() || 'Untitled block'
}

function BlockCard({
  block,
  task,
  col,
  cols,
  isSelected,
  isActive,
  isPast,
  isDragging,
}: {
  block: TimeBlock
  task: Task | undefined
  col: number
  cols: number
  isSelected: boolean
  isActive: boolean
  isPast: boolean
  isDragging: boolean
}) {
  const height = toPx(block.endMin - block.startMin)
  const variant: keyof typeof BLOCK_STYLE = task
    ? task.status === 'done'
      ? 'done'
      : task.priority
    : 'free'
  const title = blockTitle(block, task)
  const showTime = height >= 40
  const compact = height < 26

  return (
    <div
      data-block-id={block.id}
      className={`absolute cursor-grab overflow-hidden rounded-lg border-l-[3px] px-2 transition-[background-color,opacity,box-shadow] active:cursor-grabbing ${
        BLOCK_STYLE[variant]
      } ${compact ? 'py-0' : 'py-1'} ${isPast && !isActive ? 'opacity-60' : ''} ${
        isDragging ? 'z-30 opacity-80 shadow-2xl' : 'z-10'
      } ${isSelected ? 'ring-2 ring-white/70' : ''} ${
        isActive ? 'shadow-lg shadow-indigo-500/30 ring-2 ring-indigo-300' : ''
      }`}
      style={{
        top: toPx(block.startMin),
        height: Math.max(height - 2, 12),
        left: `calc(${(col / cols) * 100}% + ${col === 0 ? 0 : 2}px)`,
        width: `calc(${100 / cols}% - ${cols > 1 ? 2 : 0}px)`,
      }}
      title={`${title} · ${formatMinutes(block.startMin)} – ${formatMinutes(block.endMin)}`}
    >
      <div className={`flex items-center gap-1.5 ${compact ? 'text-[10px] leading-3' : 'text-xs leading-4'}`}>
        {task && (
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              task.status === 'done' ? 'bg-emerald-400' : PRIORITY_STYLES[task.priority].dot
            }`}
          />
        )}
        <span className={`truncate font-semibold ${task?.status === 'done' ? 'line-through' : ''}`}>
          {title}
        </span>
        {isActive && (
          <span className="ml-auto shrink-0 rounded-full bg-indigo-400/40 px-1.5 text-[9px] font-bold uppercase tracking-wide">
            Now
          </span>
        )}
      </div>
      {showTime && (
        <div className="mt-0.5 truncate text-[10px] opacity-80">
          {formatMinutes(block.startMin)} – {formatMinutes(block.endMin)}
          <span className="opacity-70"> · {formatDuration((block.endMin - block.startMin) * 60)}</span>
        </div>
      )}
      {/* Resize handle */}
      <div
        data-resize-id={block.id}
        className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
        aria-hidden
      />
    </div>
  )
}

function GhostBlock({ start, end, label }: { start: number; end: number; label: string }) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-20 rounded-lg border border-dashed border-indigo-300/70 bg-indigo-400/20 px-2 py-1 text-xs text-indigo-100"
      style={{ top: toPx(start), height: Math.max(toPx(end - start) - 2, 12) }}
    >
      <span className="font-semibold">{label}</span>
      <span className="ml-1.5 opacity-80">
        {formatMinutes(start)} – {formatMinutes(end)}
      </span>
    </div>
  )
}

function TaskChip({
  task,
  onSchedule,
  onOpen,
}: {
  task: Task
  onSchedule: () => void
  onOpen: () => void
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'copy'
        e.dataTransfer.setData(TASK_DRAG_TYPE, task.id)
        e.dataTransfer.setData('text/plain', task.title)
      }}
      className="group flex cursor-grab items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-2 transition hover:border-white/20 active:cursor-grabbing"
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_STYLES[task.priority].dot}`} />
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 truncate text-left text-sm text-slate-200 hover:text-white"
        title="Open task"
      >
        {task.title}
      </button>
      <button
        type="button"
        onClick={onSchedule}
        title="Schedule in the next free hour"
        className="shrink-0 rounded-md px-1.5 text-base leading-none text-slate-500 opacity-0 transition hover:bg-white/10 hover:text-white group-hover:opacity-100"
      >
        +
      </button>
    </div>
  )
}

function QuickBlockInput({ onAdd }: { onAdd: (title: string) => void }) {
  const [value, setValue] = useState('')
  const submit = () => {
    const title = value.trim()
    if (!title) return
    onAdd(title)
    setValue('')
  }
  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') submit()
      }}
      placeholder="Block time: meeting, lunch, review… ↵"
      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-indigo-400/50"
    />
  )
}

const DURATIONS = [15, 30, 45, 60, 90, 120]

const toHHMM = (min: number) => {
  const m = clamp(min, 0, DAY_MIN - 1)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
const fromHHMM = (value: string): number | null => {
  const [h, m] = value.split(':').map(Number)
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null
  return clamp(h * 60 + m, 0, DAY_MIN)
}

function BlockEditor({
  block,
  task,
  tasks,
  autoFocusTitle,
  onChange,
  onDelete,
  onFocus,
  onOpenTask,
  onClose,
}: {
  block: TimeBlock
  task: Task | undefined
  tasks: Task[]
  autoFocusTitle: boolean
  onChange: (patch: Partial<TimeBlock>) => void
  onDelete: () => void
  onFocus: (taskId: string) => void
  onOpenTask: (taskId: string) => void
  onClose: () => void
}) {
  const duration = block.endMin - block.startMin
  const linkable = tasks.filter((t) => t.status !== 'done' || t.id === block.taskId)

  const setStart = (value: string) => {
    const start = fromHHMM(value)
    if (start == null) return
    const s = clamp(start, 0, DAY_MIN - MIN_BLOCK_MIN)
    onChange({ startMin: s, endMin: clamp(s + duration, s + MIN_BLOCK_MIN, DAY_MIN) })
  }
  const setEnd = (value: string) => {
    const end = fromHHMM(value)
    if (end == null) return
    onChange({ endMin: clamp(end, block.startMin + MIN_BLOCK_MIN, DAY_MIN) })
  }
  const setDuration = (min: number) => {
    const start = clamp(block.startMin, 0, DAY_MIN - min)
    onChange({ startMin: start, endMin: start + min })
  }

  return (
    <section className="animate-pop-in rounded-2xl border border-indigo-500/30 bg-indigo-500/[0.07] p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-widest text-indigo-300">
          {task ? 'Task block' : 'Time block'}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-1.5 text-slate-500 transition hover:text-slate-200"
          title="Close (Esc)"
        >
          ✕
        </button>
      </div>

      {task ? (
        <div className="mb-3">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_STYLES[task.priority].dot}`} />
            <button
              type="button"
              onClick={() => onOpenTask(task.id)}
              className={`min-w-0 flex-1 truncate text-left text-sm font-semibold text-white hover:underline ${
                task.status === 'done' ? 'line-through opacity-70' : ''
              }`}
              title="Open task"
            >
              {task.title}
            </button>
          </div>
          {task.resumeNote.trim() && (
            <p className="mt-1.5 line-clamp-2 text-xs text-emerald-300/80">Next: {task.resumeNote.trim()}</p>
          )}
        </div>
      ) : (
        <input
          autoFocus={autoFocusTitle}
          value={block.title}
          onChange={(e) => onChange({ title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          placeholder="What is this time for?"
          className="mb-3 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white placeholder:font-normal placeholder:text-slate-500 outline-none focus:border-indigo-400/50"
        />
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
          Start
          <input
            type="time"
            step={SNAP_MIN * 60}
            value={toHHMM(block.startMin)}
            onChange={(e) => setStart(e.target.value)}
            className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 font-mono text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-indigo-400/50"
          />
        </label>
        <label className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
          End
          <input
            type="time"
            step={SNAP_MIN * 60}
            value={toHHMM(block.endMin === DAY_MIN ? DAY_MIN - 1 : block.endMin)}
            onChange={(e) => setEnd(e.target.value)}
            className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 font-mono text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-indigo-400/50"
          />
        </label>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {DURATIONS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDuration(d)}
            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${
              duration === d
                ? 'border-indigo-400/50 bg-indigo-500/20 text-indigo-100'
                : 'border-white/10 text-slate-400 hover:text-slate-200'
            }`}
          >
            {d < 60 ? `${d}m` : `${d / 60}h`}
          </button>
        ))}
      </div>

      <label className="mt-3 block text-[11px] font-semibold uppercase tracking-widest text-slate-500">
        Linked task
        <select
          value={block.taskId ?? ''}
          onChange={(e) => onChange({ taskId: e.target.value || null })}
          className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 text-sm normal-case tracking-normal text-slate-200 outline-none focus:border-indigo-400/50"
        >
          <option value="">None (free block)</option>
          {linkable.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-4 flex items-center gap-2">
        {task && task.status !== 'done' && (
          <button
            type="button"
            onClick={() => onFocus(task.id)}
            className="rounded-lg bg-indigo-500/90 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-400 active:scale-95"
          >
            Focus now
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          className="ml-auto rounded-lg px-2.5 py-1.5 text-xs text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-300"
          title="Delete block (Del)"
        >
          Delete
        </button>
      </div>
    </section>
  )
}

/** Compact "now / next" summary of today's plan, shown on the Today tab. */
export function ScheduleStrip({
  blocks,
  tasks,
  onPlan,
  onFocus,
}: {
  blocks: TimeBlock[]
  tasks: Task[]
  onPlan: () => void
  onFocus: (taskId: string) => void
}) {
  const [nowMin, setNowMin] = useState(() => minutesOfDay())
  useEffect(() => {
    const id = setInterval(() => setNowMin(minutesOfDay()), 30_000)
    return () => clearInterval(id)
  }, [])

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])
  const sorted = useMemo(() => [...blocks].sort((a, b) => a.startMin - b.startMin), [blocks])
  const current = sorted.find((b) => b.startMin <= nowMin && nowMin < b.endMin) ?? null
  const next = sorted.find((b) => b.startMin > nowMin) ?? null
  const remaining = sorted.filter((b) => b.endMin > nowMin).length

  const render = (label: string, b: TimeBlock, tone: string) => {
    const task = b.taskId ? taskById.get(b.taskId) : undefined
    return (
      <div className="flex min-w-0 items-center gap-2">
        <span className={`shrink-0 text-[10px] font-bold uppercase tracking-widest ${tone}`}>{label}</span>
        <span className="truncate text-sm text-slate-100">{blockTitle(b, task)}</span>
        <span className="shrink-0 font-mono text-xs text-slate-500">
          {label === 'Now' ? `until ${formatMinutes(b.endMin)}` : formatMinutes(b.startMin)}
        </span>
        {task && task.status !== 'done' && (
          <button
            type="button"
            onClick={() => onFocus(task.id)}
            className="shrink-0 rounded-md bg-indigo-500/80 px-2 py-0.5 text-[11px] font-semibold text-white transition hover:bg-indigo-400"
          >
            Focus
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2.5">
      {blocks.length === 0 ? (
        <span className="text-sm text-slate-500">No time blocks for today.</span>
      ) : (
        <>
          {current && render('Now', current, 'text-rose-300')}
          {next && render('Next', next, 'text-indigo-300')}
          {!current && !next && (
            <span className="text-sm text-slate-500">All planned blocks for today are over.</span>
          )}
        </>
      )}
      <button
        type="button"
        onClick={onPlan}
        className="ml-auto shrink-0 text-xs font-semibold text-indigo-300 transition hover:text-indigo-200"
      >
        {blocks.length === 0 ? 'Plan your day →' : `Plan (${remaining} left) →`}
      </button>
    </div>
  )
}
