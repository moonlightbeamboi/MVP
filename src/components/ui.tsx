import type { ReactNode } from 'react'
import { SEVERITY_COLOR, STATUS_LABEL, type Severity, type EventStatus } from '../types'
import { IconDatabase } from './icons'

export function Panel({ title, right, children, className = '' }: {
  title?: string
  right?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <header className="flex items-center justify-between px-4 pt-3 pb-2">
          <h3 className="microlabel">{title}</h3>
          {right}
        </header>
      )}
      <div className={title ? 'px-4 pb-3' : 'p-4'}>{children}</div>
    </section>
  )
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.68rem] font-bold uppercase tracking-wide"
      style={{ color: SEVERITY_COLOR[severity], background: `${SEVERITY_COLOR[severity]}1a`, border: `1px solid ${SEVERITY_COLOR[severity]}55` }}
    >
      {severity}
    </span>
  )
}

export function StatusBadge({ status }: { status: EventStatus }) {
  const styles: Record<EventStatus, string> = {
    new: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
    acknowledged: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
    in_progress: 'bg-violet-500/15 text-violet-300 border-violet-500/40',
    resolved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.68rem] font-bold uppercase tracking-wide ${styles[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  )
}

export function StatCard({ label, value, sub, accent = '#22d3ee' }: {
  label: string
  value: ReactNode
  sub?: string
  accent?: string
}) {
  return (
    <div className="panel px-4 py-3">
      <div className="microlabel">{label}</div>
      <div className="mono mt-1 text-2xl font-bold leading-none" style={{ color: accent }}>{value}</div>
      {sub && <div className="mt-1 text-[0.7rem] text-slate-500">{sub}</div>}
    </div>
  )
}

export function Toggle({ on, onChange, label, hint }: {
  on: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <button type="button" className="flex w-full items-center justify-between gap-3 py-1.5 text-left" onClick={() => onChange(!on)}>
      <span>
        <span className="block text-[0.8rem] font-medium text-slate-200">{label}</span>
        {hint && <span className="block text-[0.66rem] text-slate-500">{hint}</span>}
      </span>
      <span className={`switch ${on ? 'switch-on' : ''}`} aria-checked={on} role="switch" />
    </button>
  )
}

export function BackendBadge({ mode }: { mode: 'firebase' | 'local' | null }) {
  if (!mode) {
    return (
      <span className="hud-chip flex items-center gap-1.5" style={{ color: '#94a3b8' }}>
        <span className="h-1.5 w-1.5 rounded-full bg-slate-500" /> connecting…
      </span>
    )
  }
  return mode === 'firebase' ? (
    <span className="hud-chip flex items-center gap-1.5" style={{ color: '#34d399' }}>
      <IconDatabase width={12} height={12} /> Firebase live
    </span>
  ) : (
    <span className="hud-chip flex items-center gap-1.5" style={{ color: '#fbbf24' }} title="Firebase not configured — using offline local store">
      <IconDatabase width={12} height={12} /> Local demo store
    </span>
  )
}
