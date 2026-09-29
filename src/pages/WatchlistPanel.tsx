import { useMemo, useState } from 'react'
import { useWatchlistStore } from '../state/watchlistStore'
import { useEventsStore } from '../state/eventsStore'
import { Panel } from '../components/ui'
import { SeverityBadge, StatusBadge } from '../components/ui'
import { timeAgo, coordLabel } from '../lib/format'
import { IconAlert, IconX } from '../components/icons'
import type { UrbanEvent } from '../types'

/**
 * Vehicle watchlist: add plates that should be flagged when the on-board OCR
 * reads them on the road (stolen vehicles, restricted zones, batch-mates'
 * prank plates — whatever the demo needs).
 */
export default function WatchlistPanel({ onShowOnMap }: { onShowOnMap: (e: UrbanEvent) => void }) {
  const { plates, add, remove, matchedEventIds } = useWatchlistStore()
  const events = useEventsStore((s) => s.events)
  const select = useEventsStore((s) => s.select)
  const [input, setInput] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const matchedEvents = useMemo(
    () => events.filter((e) => matchedEventIds.includes(e.id) || (e.details?.watchMatch && e.title.includes('WATCHLIST'))),
    [events, matchedEventIds],
  )

  function handleAdd() {
    if (!add(input, note)) {
      setError('Enter a plate with at least 4 letters/digits that is not already listed')
      return
    }
    setError(null)
    setInput('')
    setNote('')
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="Alert list — flag these plates on sight">
        <div className="flex gap-2">
          <input
            className="input mono flex-1 uppercase"
            placeholder="e.g. UP16AB1234"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <input
            className="input w-40"
            placeholder="note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <button className="btn btn-primary" onClick={handleAdd}>Add</button>
        </div>
        {error && <p className="mt-2 text-[0.7rem] text-red-300">{error}</p>}
        <p className="mt-2 text-[0.68rem] leading-relaxed text-slate-500">
          Matching is tolerant of OCR mistakes (O↔0, I/L↔1, S↔5, B↔8, Z↔2, G↔6) and also fires on partial
          fragments of 4+ characters. When the on-board OCR reads a listed plate, the incident is flagged
          <span className="font-bold text-red-300"> critical</span> and appears below.
        </p>

        <ul className="mt-3 flex flex-col gap-1.5">
          {plates.length === 0 && (
            <li className="rounded-lg border border-dashed border-slate-800 px-3 py-6 text-center text-[0.72rem] text-slate-500">
              No plates on the alert list yet.
            </li>
          )}
          {plates.map((p) => (
            <li key={p.plate} className="flex items-center gap-3 rounded-lg border border-slate-800/70 bg-[#0b1220] px-3 py-2">
              <IconAlert width={14} height={14} className="text-red-400" />
              <span className="mono text-[0.85rem] font-bold tracking-widest text-slate-100">{p.plate}</span>
              <span className="min-w-0 flex-1 truncate text-[0.7rem] text-slate-500">{p.note}</span>
              <span className="mono text-[0.66rem] text-slate-600">{timeAgo(p.addedAt)}</span>
              <button className="btn btn-sm" onClick={() => remove(p.plate)} title="Remove">
                <IconX width={12} height={12} />
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={`Flagged sightings — ${matchedEvents.length}`}>
        {matchedEvents.length === 0 ? (
          <p className="py-6 text-center text-[0.72rem] text-slate-500">
            No flagged vehicles yet. When the bus unit reads a listed plate, the sighting lands here as a critical alert.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {matchedEvents.map((e) => (
              <li
                key={e.id}
                className="cursor-pointer rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 transition hover:bg-red-500/15"
                onClick={() => { select(e.id); onShowOnMap(e) }}
              >
                <div className="flex items-center gap-2">
                  <span className="mono text-[0.78rem] font-bold text-red-200">{e.plate}</span>
                  <SeverityBadge severity={e.severity} />
                  <StatusBadge status={e.status} />
                  <span className="mono ml-auto text-[0.66rem] text-slate-400">{timeAgo(e.timestamp)}</span>
                </div>
                <div className="mt-0.5 text-[0.72rem] text-slate-300">{e.title}</div>
                <div className="mono text-[0.66rem] text-slate-500">{coordLabel(e.lat, e.lng)} · Bus {e.busId}</div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
