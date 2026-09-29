import { useState } from 'react'
import { useEventsStore } from '../state/eventsStore'
import MapView from './MapView'
import IncidentsPanel from './IncidentsPanel'
import Analytics from './Analytics'
import WatchlistPanel from './WatchlistPanel'
import type { UrbanEvent } from '../types'

type Tab = 'map' | 'incidents' | 'watchlist' | 'analytics'

const TABS: { id: Tab; label: string }[] = [
  { id: 'map', label: 'Live Map' },
  { id: 'incidents', label: 'Incident Management' },
  { id: 'watchlist', label: 'Vehicle Watchlist' },
  { id: 'analytics', label: 'Analytics & Insights' },
]

export default function DashboardPage() {
  const [tab, setTab] = useState<Tab>('map')
  const select = useEventsStore((s) => s.select)

  function showOnMap(e: UrbanEvent) {
    select(e.id)
    setTab('map')
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-slate-100">Traffic Control Room</h1>
          <p className="text-[0.72rem] text-slate-500">Live view of everything the bus fleet senses on its route</p>
        </div>
        <div className="ml-auto flex gap-1 rounded-xl border border-slate-800/80 bg-[#0b1220] p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`rounded-lg px-3.5 py-1.5 text-[0.78rem] font-semibold transition ${
                tab === t.id ? 'bg-cyan-500/15 text-cyan-300' : 'text-slate-400 hover:text-slate-200'
              }`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'map' && <MapView />}
      {tab === 'incidents' && <IncidentsPanel onShowOnMap={showOnMap} />}
      {tab === 'watchlist' && <WatchlistPanel onShowOnMap={showOnMap} />}
      {tab === 'analytics' && <Analytics />}
    </div>
  )
}
