/** Requests desktop notification permission if not already decided. */
export function ensureNotificationPermission(): void {
  if (typeof Notification === 'undefined') return
  if (Notification.permission === 'default') {
    void Notification.requestPermission()
  }
}

export function sendNotification(title: string, body: string): void {
  if (typeof Notification === 'undefined') return
  if (Notification.permission === 'granted') {
    try {
      new Notification(title, { body, icon: '/focus.svg' })
    } catch {
      // Some browsers throw if constructed outside a SW; ignore.
    }
  }
}

/** Plays a short pleasant chime using the Web Audio API (no asset needed). */
export function playChime(): void {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const now = ctx.currentTime
    const notes = [523.25, 659.25, 783.99] // C5, E5, G5
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const start = now + i * 0.16
      const end = start + 0.35
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.0001, end)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(end)
    })
    setTimeout(() => void ctx.close(), 1200)
  } catch {
    // Audio not available - ignore.
  }
}
