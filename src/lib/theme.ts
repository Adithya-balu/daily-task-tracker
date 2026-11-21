import { useCallback, useEffect, useState } from 'react'
import { loadPref, savePref } from './storage'

export type Theme = 'light' | 'dark' | 'system'
export const THEMES: Theme[] = ['light', 'dark', 'system']

const PREF_KEY = 'daily-focus.pref.theme'
const media = () => window.matchMedia('(prefers-color-scheme: light)')

export function loadTheme(): Theme {
  const v = loadPref(PREF_KEY)
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'dark'
}

/** The theme actually shown: 'system' follows the OS setting. */
export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme
  return media().matches ? 'light' : 'dark'
}

/** Sets data-theme on <html>; the stylesheet does the rest. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = resolveTheme(theme)
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(loadTheme)

  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system') return
    const mq = media()
    const onChange = () => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  const setTheme = useCallback((t: Theme) => {
    savePref(PREF_KEY, t)
    setThemeState(t)
  }, [])

  return [theme, setTheme]
}
