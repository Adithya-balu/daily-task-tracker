import { memo, useState } from 'react'
import type { Task, TaskStatus } from '../lib/types'
import { totalTokens, type AgentMap, type AgentState } from '../lib/agentTypes'
import { formatDuration } from '../lib/time'
import { formatTokens } from '../lib/format'
import { AgentBadge, PriorityChip } from './ui'

type Props = {
  tasks: Task[]
  activeTaskId: string | null
  agents: AgentMap
  projectNames: Record<string, string>
  /** Move/reorder: place `draggedId` in `status` just before `beforeId` (null = end). */
  onReorder: (draggedId: string, status: TaskStatus, beforeId: string | null) => void
  onFocus: (id: string) => void
  onDelete: (id: string) => void
  onOpen: (id: string) => void
}

const COLUMNS: { status: TaskStatus; title: string; accent: string }[] = [
  { status: 'todo', title: 'To do', accent: 'text-slate-300' },
  { status: 'in_progress', title: 'In progress', accent: 'text-indigo-300' },
  { status: 'done', title: 'Done', accent: 'text-emerald-300' },
]

type DropTarget = { status: TaskStatus; beforeId: string | null }

export const Board = memo(function Board({
  tasks,
  activeTaskId,
  agents,
  projectNames,
  onReorder,
  onFocus,
  onDelete,
  onOpen,
}: Props) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)

  const setTargetIfChanged = (status: TaskStatus, beforeId: string | null) => {
    setDropTarget((prev) =>
      prev && prev.status === status && prev.beforeId === beforeId
        ? prev
        : { status, beforeId },
    )
  }

  const clearDrag = () => {
    setDraggingId(null)
    setDropTarget(null)
  }

  const handleDrop = () => {
    if (draggingId && dropTarget) {
      onReorder(draggingId, dropTarget.status, dropTarget.beforeId)
    }
    clearDrag()
  }

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {COLUMNS.map((col) => {
        const items = tasks.filter((t) => t.status === col.status)
        const isOver = dropTarget?.status === col.status
        const showEndIndicator = isOver && dropTarget?.beforeId == null && !!draggingId

        return (
          <div
            key={col.status}
            onDragOver={(e) => {
              e.preventDefault()
              // Hovering the column (gaps / empty area) targets the column end.
              setTargetIfChanged(col.status, null)
            }}
            onDrop={handleDrop}
            className={`flex min-h-40 min-w-0 flex-col rounded-2xl border p-2.5 transition ${
              isOver
                ? 'border-indigo-400/50 bg-indigo-500/10'
                : 'border-white/10 bg-white/[0.02]'
            }`}
          >
            <div className="mb-2 flex items-center justify-between px-1.5">
              <span className={`text-xs font-semibold uppercase tracking-widest ${col.accent}`}>
                {col.title}
              </span>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-400">
                {items.length}
              </span>
            </div>

            <div className="flex flex-1 flex-col gap-2">
              {items.map((task, idx) => {
                const nextId = items[idx + 1]?.id ?? null
                const showIndicator =
                  isOver && dropTarget?.beforeId === task.id && draggingId !== task.id
                return (
                  <div key={task.id}>
                    <DropLine show={showIndicator} />
                    <BoardCard
                      task={task}
                      agent={agents[task.id]}
                      projectName={task.projectId ? projectNames[task.projectId] : undefined}
                      isActive={task.id === activeTaskId}
                      isDragging={task.id === draggingId}
                      onDragStart={() => setDraggingId(task.id)}
                      onDragEnd={clearDrag}
                      onHoverInsert={(beforeId) => setTargetIfChanged(col.status, beforeId)}
                      nextId={nextId}
                      onFocus={() => onFocus(task.id)}
                      onDelete={() => onDelete(task.id)}
                      onOpen={() => onOpen(task.id)}
                    />
                  </div>
                )
              })}

              <DropLine show={showEndIndicator && items.length > 0} />

              {items.length === 0 && (
                <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-white/10 py-6 text-xs text-slate-600">
                  {isOver ? 'Drop here' : 'Drag tasks here'}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
})

function DropLine({ show }: { show: boolean }) {
  if (!show) return null
  return <div className="my-0.5 h-0.5 rounded-full bg-indigo-400" />
}

type CardProps = {
  task: Task
  agent: AgentState | undefined
  projectName: string | undefined
  isActive: boolean
  isDragging: boolean
  nextId: string | null
  onDragStart: () => void
  onDragEnd: () => void
  onHoverInsert: (beforeId: string | null) => void
  onFocus: () => void
  onDelete: () => void
  onOpen: () => void
}

function BoardCard({
  task,
  agent,
  projectName,
  isActive,
  isDragging,
  nextId,
  onDragStart,
  onDragEnd,
  onHoverInsert,
  onFocus,
  onDelete,
  onOpen,
}: CardProps) {
  const isDone = task.status === 'done'
  const hasNotes = task.notes.trim().length > 0
  const planDone = task.plan.filter((s) => s.status === 'done').length
  const tokens = agent ? totalTokens(agent.totals) : 0

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', task.id)
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        // Top half -> insert before this card; bottom half -> before the next card.
        const rect = e.currentTarget.getBoundingClientRect()
        const isTopHalf = e.clientY < rect.top + rect.height / 2
        onHoverInsert(isTopHalf ? task.id : nextId)
      }}
      onClick={onOpen}
      className={`group cursor-grab rounded-xl border p-3 transition active:cursor-grabbing ${
        isDragging ? 'opacity-40' : 'opacity-100'
      } ${
        isActive
          ? 'border-indigo-500/50 bg-indigo-500/10'
          : 'border-white/10 bg-white/[0.04] hover:border-white/20'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="mt-1 shrink-0 text-slate-600">
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
            <circle cx="6" cy="5" r="1.4" />
            <circle cx="6" cy="10" r="1.4" />
            <circle cx="6" cy="15" r="1.4" />
            <circle cx="12" cy="5" r="1.4" />
            <circle cx="12" cy="10" r="1.4" />
            <circle cx="12" cy="15" r="1.4" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`min-w-0 flex-1 font-medium ${
                isDone ? 'text-slate-500 line-through' : 'text-slate-100'
              }`}
            >
              {task.title}
            </span>
            {hasNotes && (
              <span className="shrink-0 text-slate-500" title="Has notes">
                <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor">
                  <path d="M4 3h9l3 3v11a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1zm2 6h8v1.5H6V9zm0 3h8v1.5H6V12zm0-6h5v1.5H6V6z" />
                </svg>
              </span>
            )}
            {isActive && (
              <span className="shrink-0 rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-300">
                Active
              </span>
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            <PriorityChip priority={task.priority} />
            <AgentBadge status={agent?.status} openedIn={agent?.openedIn} />
            {projectName && (
              <span className="max-w-32 truncate rounded-full border border-white/10 px-2 py-0.5 text-slate-400">
                {projectName}
              </span>
            )}
            {task.plan.length > 0 && (
              <span title="Plan steps done">
                {planDone}/{task.plan.length} steps
              </span>
            )}
            {task.pomodorosCompleted > 0 && (
              <span>
                {task.pomodorosCompleted} pomo &middot; {formatDuration(task.focusedSeconds)}
              </span>
            )}
            {tokens > 0 && (
              <span className="text-violet-300/70" title="Claude tokens used on this task">
                {formatTokens(tokens)} tok
              </span>
            )}
          </div>

          {!isDone && task.resumeNote.trim() && (
            <div className="mt-1.5 flex min-w-0 items-center gap-1 text-xs text-emerald-300/80">
              <span className="shrink-0">Next:</span>
              <span className="truncate">{task.resumeNote.trim()}</span>
            </div>
          )}

          {!isDone && (
            <div className="mt-2 flex items-center gap-1">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onFocus()
                }}
                className="rounded-lg bg-indigo-500/90 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-indigo-400 active:scale-95"
              >
                {isActive ? 'Refocus' : 'Focus'}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete()
                }}
                title="Delete task"
                className="ml-auto rounded-lg p-1 text-slate-600 opacity-0 transition hover:text-rose-400 group-hover:opacity-100"
              >
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                  <path d="M8 3h4a1 1 0 011 1v1h3v2H4V5h3V4a1 1 0 011-1zm-2 6h8l-.7 8.1a1 1 0 01-1 .9H7.7a1 1 0 01-1-.9L6 9z" />
                </svg>
              </button>
            </div>
          )}

          {isDone && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
              title="Delete task"
              className="mt-2 rounded-lg p-1 text-slate-600 opacity-0 transition hover:text-rose-400 group-hover:opacity-100"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                <path d="M8 3h4a1 1 0 011 1v1h3v2H4V5h3V4a1 1 0 011-1zm-2 6h8l-.7 8.1a1 1 0 01-1 .9H7.7a1 1 0 01-1-.9L6 9z" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
