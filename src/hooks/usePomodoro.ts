import { useCallback, useEffect, useRef, useState } from 'react'
import type { PomodoroSettings } from '../lib/types'

export type Phase = 'work' | 'break'

type PomodoroCallbacks = {
  settings: PomodoroSettings
  /** Called with focused seconds accrued during a work segment (on pause/stop/complete). */
  onFlushFocused: (taskId: string, seconds: number) => void
  /** Called once when a full work phase completes (to count a pomodoro). */
  onWorkComplete: (taskId: string) => void
  /** Called when a work phase finishes so the UI can prompt for resume notes. */
  onWorkPhaseEnd: (taskId: string) => void
}

/**
 * Single active timer across the whole app - starting a timer for one task
 * automatically flushes and replaces any timer already running.
 */
export function usePomodoro({
  settings,
  onFlushFocused,
  onWorkComplete,
  onWorkPhaseEnd,
}: PomodoroCallbacks) {
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('work')
  const [isRunning, setIsRunning] = useState(false)
  const [remaining, setRemaining] = useState(settings.workMinutes * 60)

  // Timestamp bookkeeping for drift-free countdown + focus accounting.
  const endsAtRef = useRef<number | null>(null)
  const runStartedAtRef = useRef<number | null>(null)
  const activeTaskIdRef = useRef<string | null>(null)
  const phaseRef = useRef<Phase>('work')

  activeTaskIdRef.current = activeTaskId
  phaseRef.current = phase

  const phaseDuration = useCallback(
    (p: Phase) => (p === 'work' ? settings.workMinutes : settings.breakMinutes) * 60,
    [settings],
  )

  /** Flush focused time accrued since the current work run segment began. */
  const flushFocused = useCallback(() => {
    const startedAt = runStartedAtRef.current
    const taskId = activeTaskIdRef.current
    runStartedAtRef.current = null
    if (startedAt == null || taskId == null) return
    if (phaseRef.current !== 'work') return
    const seconds = (Date.now() - startedAt) / 1000
    if (seconds >= 1) onFlushFocused(taskId, seconds)
  }, [onFlushFocused])

  const pause = useCallback(() => {
    if (!isRunning) return
    // Snapshot remaining from the authoritative endsAt.
    if (endsAtRef.current != null) {
      setRemaining(Math.max(0, Math.round((endsAtRef.current - Date.now()) / 1000)))
    }
    flushFocused()
    endsAtRef.current = null
    setIsRunning(false)
  }, [isRunning, flushFocused])

  const beginRun = useCallback((seconds: number) => {
    endsAtRef.current = Date.now() + seconds * 1000
    runStartedAtRef.current = Date.now()
    setIsRunning(true)
  }, [])

  const resume = useCallback(() => {
    if (isRunning || activeTaskIdRef.current == null) return
    beginRun(remaining)
  }, [isRunning, remaining, beginRun])

  /** Start (or restart) a fresh work session for a task. */
  const start = useCallback(
    (taskId: string) => {
      // Replacing a running timer: flush the previous segment first.
      if (isRunning) flushFocused()
      endsAtRef.current = null
      setActiveTaskId(taskId)
      setPhase('work')
      phaseRef.current = 'work'
      const dur = phaseDuration('work')
      setRemaining(dur)
      beginRun(dur)
    },
    [isRunning, flushFocused, phaseDuration, beginRun],
  )

  /** Fully stop and clear the active timer (flushing any focus time). */
  const stop = useCallback(() => {
    if (isRunning) flushFocused()
    endsAtRef.current = null
    runStartedAtRef.current = null
    setIsRunning(false)
    setActiveTaskId(null)
    setPhase('work')
    setRemaining(phaseDuration('work'))
  }, [isRunning, flushFocused, phaseDuration])

  /** Switch to the given phase (fresh, stopped). */
  const goToPhase = useCallback(
    (p: Phase, autoStart: boolean) => {
      if (isRunning) flushFocused()
      endsAtRef.current = null
      setPhase(p)
      phaseRef.current = p
      const dur = phaseDuration(p)
      setRemaining(dur)
      if (autoStart && activeTaskIdRef.current) beginRun(dur)
      else setIsRunning(false)
    },
    [isRunning, flushFocused, phaseDuration, beginRun],
  )

  const handlePhaseComplete = useCallback(() => {
    const taskId = activeTaskIdRef.current
    const finishedPhase = phaseRef.current
    // Flush focus + count pomodoro for a completed work phase.
    if (finishedPhase === 'work') {
      flushFocused()
      if (taskId) {
        onWorkComplete(taskId)
        onWorkPhaseEnd(taskId)
      }
    }
    endsAtRef.current = null
    setIsRunning(false)
    const nextPhase: Phase = finishedPhase === 'work' ? 'break' : 'work'
    setPhase(nextPhase)
    phaseRef.current = nextPhase
    setRemaining(phaseDuration(nextPhase))
  }, [flushFocused, onWorkComplete, onWorkPhaseEnd, phaseDuration])

  // Countdown loop.
  useEffect(() => {
    if (!isRunning) return
    const tick = () => {
      if (endsAtRef.current == null) return
      const left = Math.round((endsAtRef.current - Date.now()) / 1000)
      if (left <= 0) {
        setRemaining(0)
        handlePhaseComplete()
      } else {
        setRemaining(left)
      }
    }
    tick()
    // 1s cadence: we only display whole seconds, and the countdown is
    // timestamp-based so it stays accurate even if the interval is throttled.
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [isRunning, handlePhaseComplete])

  // If settings change while stopped, reflect new default duration.
  useEffect(() => {
    if (!isRunning && endsAtRef.current == null) {
      setRemaining(phaseDuration(phaseRef.current))
    }
  }, [settings, isRunning, phaseDuration])

  const total = phaseDuration(phase)

  return {
    activeTaskId,
    phase,
    isRunning,
    remaining,
    total,
    start,
    pause,
    resume,
    stop,
    goToPhase,
  }
}

export type UsePomodoro = ReturnType<typeof usePomodoro>
