import type { ReactNode } from 'react'
import { THEMES, type Theme } from '../lib/theme'

export type View = 'today' | 'plan' | 'history' | 'ai'

type Counts = {
  /** Tasks finished today (shown next to Today). */
  doneToday: number
  /** Completed tasks from earlier days. */
  history: number
  /** Time blocks planned for today. */
  blocks: number
}

type Props = {
  view: View
  counts: Counts
  dateLabel: string
  theme: Theme
  onChange: (view: View) => void
  onThemeChange: (theme: Theme) => void
  onOpenProjects: () => void
  onOpenSettings: () => void
}

type NavItem = { view: View; label: string; icon: ReactNode; count: number; countLabel?: string }

type NavGroup = { title: string; items: NavItem[] }

function groupsFor(counts: Counts): NavGroup[] {
  return [
    {
      title: 'Tasks',
      items: [
        { view: 'today', label: 'Today', icon: <SunIcon />, count: counts.doneToday, countLabel: 'done' },
        { view: 'history', label: 'History', icon: <ClockIcon />, count: counts.history },
      ],
    },
    {
      title: "Today's plan",
      items: [{ view: 'plan', label: 'Plan', icon: <CalendarIcon />, count: counts.blocks }],
    },
    {
      title: 'AI',
      items: [{ view: 'ai', label: 'Workflows & agents', icon: <SparkIcon />, count: 0 }],
    },
  ]
}

/** Left navigation: view groups, with Projects and Settings pinned at the bottom. */
export function Sidebar({
  view,
  counts,
  dateLabel,
  theme,
  onChange,
  onThemeChange,
  onOpenProjects,
  onOpenSettings,
}: Props) {
  const groups = groupsFor(counts)
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-white/10 bg-white/[0.02] px-4 py-6 md:flex">
      <div className="px-2">
        <h1 className="text-xl font-bold tracking-tight text-white">Daily Focus</h1>
        <p className="mt-0.5 text-xs text-slate-500">{dateLabel}</p>
      </div>

      <nav className="mt-7 flex flex-1 flex-col gap-6">
        {groups.map((group) => (
          <div key={group.title}>
            <div className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              {group.title}
            </div>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <li key={item.view}>
                  <NavButton item={item} active={view === item.view} onClick={() => onChange(item.view)} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="mt-6 flex flex-col gap-0.5 border-t border-white/10 pt-4">
        <FooterButton onClick={onOpenProjects} title="Projects: working folders, Claude defaults, shared references">
          <FolderIcon />
          Projects
        </FooterButton>
        <FooterButton onClick={onOpenSettings} title="Timer settings">
          <GearIcon />
          Settings
        </FooterButton>
        <div className="mt-2 flex items-center justify-between gap-2 px-2">
          <span className="text-xs text-slate-500">Appearance</span>
          <ThemeSwitch theme={theme} onChange={onThemeChange} />
        </div>
      </div>
    </aside>
  )
}

/** Narrow-screen replacement for the sidebar: one scrollable row of the same views. */
export function MobileNav({
  view,
  counts,
  dateLabel,
  theme,
  onChange,
  onThemeChange,
  onOpenProjects,
  onOpenSettings,
}: Props) {
  const items = groupsFor(counts).flatMap((g) => g.items)
  return (
    <div className="mb-6 md:hidden">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Daily Focus</h1>
          <p className="mt-0.5 text-xs text-slate-500">{dateLabel}</p>
        </div>
        <div className="flex items-center gap-1">
          <ThemeSwitch theme={theme} onChange={onThemeChange} />
          <IconButton onClick={onOpenProjects} title="Projects">
            <FolderIcon />
          </IconButton>
          <IconButton onClick={onOpenSettings} title="Timer settings">
            <GearIcon />
          </IconButton>
        </div>
      </div>
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-white/10 bg-white/[0.03] p-1">
        {items.map((item) => (
          <button
            key={item.view}
            type="button"
            onClick={() => onChange(item.view)}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              view === item.view ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {item.label}
            {item.count > 0 && <span className="text-xs text-slate-500">{item.count}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

const THEME_LABEL: Record<Theme, string> = { light: 'Light', dark: 'Dark', system: 'Match system' }

/** Three-way Light / Dark / System segmented control. */
function ThemeSwitch({ theme, onChange }: { theme: Theme; onChange: (t: Theme) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      className="flex overflow-hidden rounded-lg border border-white/10 bg-white/5"
    >
      {THEMES.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={theme === t}
          title={THEME_LABEL[t]}
          onClick={() => onChange(t)}
          className={`p-1.5 transition ${
            theme === t ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          {t === 'light' ? <SunIcon /> : t === 'dark' ? <MoonIcon /> : <MonitorIcon />}
        </button>
      ))}
    </div>
  )
}

function NavButton({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm font-medium transition ${
        active
          ? 'bg-indigo-500/15 text-white ring-1 ring-inset ring-indigo-400/30'
          : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
      }`}
    >
      <span className={`shrink-0 ${active ? 'text-indigo-300' : 'text-slate-500'}`}>{item.icon}</span>
      <span className="flex-1 truncate text-left">{item.label}</span>
      {item.count > 0 && (
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${
            active ? 'bg-indigo-400/20 text-indigo-100' : 'bg-white/10 text-slate-400'
          }`}
          title={item.countLabel ? `${item.count} ${item.countLabel}` : undefined}
        >
          {item.count}
          {item.countLabel ? ` ${item.countLabel}` : ''}
        </span>
      )}
    </button>
  )
}

function FooterButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void
  title: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-slate-400 transition hover:bg-white/5 hover:text-slate-200 [&>svg]:shrink-0 [&>svg]:text-slate-500"
    >
      {children}
    </button>
  )
}

function IconButton({ onClick, title, children }: { onClick: () => void; title: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="rounded-lg border border-white/10 p-2 text-slate-400 transition hover:bg-white/5 hover:text-slate-200"
    >
      {children}
    </button>
  )
}

const iconProps = {
  viewBox: '0 0 24 24',
  className: 'h-4 w-4',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function SunIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg {...iconProps}>
      <path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" />
    </svg>
  )
}

function MonitorIcon() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4M7 14h4v4H7z" />
    </svg>
  )
}

function SparkIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
      <path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7L19 15z" />
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  )
}
