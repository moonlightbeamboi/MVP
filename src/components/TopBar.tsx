import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { busSim } from '../lib/gps/busSim'
import { getBackend } from '../lib/store'
import { BackendBadge } from './ui'
import { IconActivity, IconBus, IconEye, IconMap, IconInfo } from './icons'

const nav = [
  { to: '/', label: 'Overview', icon: <IconEye width={14} height={14} />, end: true },
  { to: '/bus-unit', label: 'Bus Unit', icon: <IconCamera width={14} height={14} /> },
  { to: '/control-room', label: 'Control Room', icon: <IconMap width={14} height={14} /> },
  { to: '/how-it-works', label: 'Architecture', icon: <IconInfo width={14} height={14} /> },
]

function IconCamera(p: { width?: number; height?: number }) {
  return (
    <svg width={p.width ?? 14} height={p.height ?? 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  )
}

export default function TopBar() {
  const [mode, setMode] = useState<'firebase' | 'local' | null>(null)
  const [clock, setClock] = useState(() => new Date())
  const [pos, setPos] = useState<{ lat: number; lng: number; kph: number; gpsMode: string } | null>(null)

  useEffect(() => {
    void getBackend().then((b) => setMode(b.mode))
    const t = window.setInterval(() => setClock(new Date()), 1000)
    const un = busSim.subscribe((s) => setPos({ lat: s.lat, lng: s.lng, kph: s.speedKph, gpsMode: s.gpsMode }))
    return () => {
      window.clearInterval(t)
      un()
    }
  }, [])

  function resetDemoData() {
    if (!window.confirm('Clear all locally stored events and fleet history, then reload?')) return
    for (const k of ['urbaneye.events', 'urbaneye.fleet', 'urbaneye.alertPlates']) localStorage.removeItem(k)
    window.location.reload()
  }

  return (
    <header className="sticky top-0 z-[1200] border-b border-slate-800/70 bg-[#070b12]/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-4">
        <NavLink to="/" className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-300">
            <IconEye width={17} height={17} />
          </span>
          <span>
            <span className="block text-[0.95rem] font-bold leading-none tracking-tight">UrbanEye</span>
            <span className="block text-[0.58rem] font-semibold uppercase tracking-[0.18em] text-slate-500">Fleet Urban Intelligence</span>
          </span>
        </NavLink>

        <nav className="ml-4 hidden items-center gap-1 md:flex">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[0.8rem] font-semibold transition ${
                  isActive ? 'bg-cyan-500/10 text-cyan-300' : 'text-slate-400 hover:text-slate-100'
                }`
              }
            >
              {n.icon}
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {pos && (
            <span className="hud-chip mono hidden items-center gap-1.5 lg:flex" style={{ color: '#7dd3fc' }}>
              <IconBus width={13} height={13} />
              {busSim.busId} · {pos.lat.toFixed(4)}, {pos.lng.toFixed(4)} · {pos.kph} km/h
              <span className="ml-1 rounded bg-slate-700/60 px-1 text-[0.55rem] font-bold uppercase tracking-wider" style={{ color: pos.gpsMode === 'device' ? '#34d399' : '#94a3b8' }}>
                {pos.gpsMode === 'device' ? 'real GPS' : 'sim GPS'}
              </span>
            </span>
          )}
          <span className="hud-chip mono hidden items-center gap-1.5 sm:flex" style={{ color: '#cbd5e1' }}>
            <IconActivity width={12} height={12} />
            {clock.toLocaleTimeString([], { hour12: false })}
          </span>
          <BackendBadge mode={mode} />
          <button
            className="hidden rounded-lg border border-slate-700/70 px-2 py-1 text-[0.65rem] font-semibold text-slate-400 transition hover:border-amber-500/50 hover:text-amber-300 xl:block"
            onClick={resetDemoData}
            title="Clear all locally stored events and reload"
          >
            Reset demo data
          </button>
        </div>
      </div>

      <nav className="flex items-center gap-1 overflow-x-auto border-t border-slate-800/60 px-3 py-1.5 md:hidden">
        {nav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              `flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1 text-[0.75rem] font-semibold ${
                isActive ? 'bg-cyan-500/10 text-cyan-300' : 'text-slate-400'
              }`
            }
          >
            {n.icon}
            {n.label}
          </NavLink>
        ))}
      </nav>
    </header>
  )
}
