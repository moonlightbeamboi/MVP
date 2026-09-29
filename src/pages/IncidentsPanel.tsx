import { useMemo, useState } from 'react'
import { useEventsStore } from '../state/eventsStore'
import { getBackend } from '../lib/store'
import {
  EVENT_META, STATUS_LABEL, SEVERITY_COLOR,
  type EventType, type EventStatus, type UrbanEvent,
} from '../types'
import { SeverityBadge, StatusBadge } from '../components/ui'
import { coordLabel, fullDateTime, pct, timeAgo } from '../lib/format'
import { IconCheck, IconMap, IconDownload, IconAlert } from '../components/icons'

const OPERATIONAL_TYPES = (Object.keys(EVENT_META) as EventType[]).filter((t) => t !== 'snapshot')

const STATUS_FLOW: EventStatus[] = ['new', 'acknowledged', 'in_progress', 'resolved']

export default function IncidentsPanel({ onShowOnMap }: { onShowOnMap: (e: UrbanEvent) => void }) {
  const events = useEventsStore((s) => s.events)
  const selectedId = useEventsStore((s) => s.selectedId)
  const select = useEventsStore((s) => s.select)

  const [typeFilter, setTypeFilter] = useState<EventType | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<EventStatus | 'all'>('all')
  const [windowFilter, setWindowFilter] = useState<'1h' | '6h' | '24h' | 'all'>('24h')

  const filtered = useMemo(() => {
    const cutoff = windowFilter === 'all' ? 0 : Date.now() - { '1h': 3.6e6, '6h': 21.6e6, '24h': 86.4e6 }[windowFilter]
    return events.filter(
      (e) =>
        e.type !== 'snapshot' &&
        (typeFilter === 'all' || e.type === typeFilter) &&
        (statusFilter === 'all' || e.status === statusFilter) &&
        e.timestamp >= cutoff,
    )
  }, [events, typeFilter, statusFilter, windowFilter])

  const selected = filtered.find((e) => e.id === selectedId) ?? null

  async function setStatus(id: string, status: EventStatus) {
    const backend = await getBackend()
    await backend.setStatus(id, status)
  }

  function exportCsv() {
    const rows = [
      ['id', 'timestamp', 'type', 'severity', 'status', 'lat', 'lng', 'confidence', 'speed_kph', 'plate', 'title'],
      ...filtered.map((e) => [
        e.id, new Date(e.timestamp).toISOString(), e.type, e.severity, e.status,
        e.lat, e.lng, e.confidence, e.speedKph, e.plate ?? '', `"${e.title.replace(/"/g, '""')}"`,
      ]),
    ]
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `urbaneye-events-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="panel min-w-0">
        <header className="flex flex-wrap items-center gap-2 border-b border-slate-800/70 px-4 py-3">
          <h3 className="microlabel mr-2">Incident Queue — {filtered.length}</h3>
          <select className="select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as EventType | 'all')}>
            <option value="all">All types</option>
            {OPERATIONAL_TYPES.map((t) => <option key={t} value={t}>{EVENT_META[t].short}</option>)}
          </select>
          <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as EventStatus | 'all')}>
            <option value="all">All statuses</option>
            {STATUS_FLOW.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <select className="select" value={windowFilter} onChange={(e) => setWindowFilter(e.target.value as '1h' | '6h' | '24h' | 'all')}>
            <option value="1h">Last hour</option>
            <option value="6h">Last 6 hours</option>
            <option value="24h">Last 24 hours</option>
            <option value="all">All time</option>
          </select>
          <button className="btn btn-sm ml-auto" onClick={exportCsv}>
            <IconDownload width={13} height={13} /> CSV
          </button>
        </header>

        <div className="max-h-[calc(100vh-330px)] overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-4 py-10 text-center text-xs text-slate-500">
              No incidents match the current filters. Events appear here the moment the bus unit detects them.
            </p>
          ) : (
            <ul className="divide-y divide-slate-800/60">
              {filtered.map((e) => (
                <li
                  key={e.id}
                  className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 transition hover:bg-slate-800/30 ${selectedId === e.id ? 'bg-cyan-500/5' : ''}`}
                  onClick={() => select(e.id)}
                >
                  <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: EVENT_META[e.type].color, boxShadow: `0 0 6px ${EVENT_META[e.type].color}` }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[0.82rem] font-medium text-slate-100">
                      {e.details?.watchMatch && (
                        <span className="mr-1.5 inline-flex items-center rounded border border-red-500/60 bg-red-500/20 px-1 py-px align-middle text-[0.6rem] font-black tracking-wider text-red-300">
                          <IconAlert width={9} height={9} className="mr-0.5 inline" />ALERT
                        </span>
                      )}
                      {e.title}
                    </div>
                    <div className="mono text-[0.66rem] text-slate-500">{coordLabel(e.lat, e.lng)} · Bus {e.busId}{e.plate ? ` · ${e.plate}` : ''}</div>
                  </div>
                  <SeverityBadge severity={e.severity} />
                  <StatusBadge status={e.status} />
                  <span className="mono w-16 text-right text-[0.68rem] text-slate-500">{timeAgo(e.timestamp)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── detail drawer ── */}
      <div>
        {selected ? (
          <IncidentDetail event={selected} onStatus={setStatus} onShowOnMap={onShowOnMap} />
        ) : (
          <div className="panel flex h-full items-center justify-center p-8 text-center text-xs text-slate-500">
            Select an incident to inspect evidence, confidence, plate OCR and workflow actions.
          </div>
        )}
      </div>
    </div>
  )
}

function IncidentDetail({ event, onStatus, onShowOnMap }: {
  event: UrbanEvent
  onStatus: (id: string, s: EventStatus) => Promise<void>
  onShowOnMap: (e: UrbanEvent) => void
}) {
  const nextActions = STATUS_FLOW.filter((s) => s !== event.status)
  return (
    <div className="panel panel-pad flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: EVENT_META[event.type].color }} />
        <h3 className="text-sm font-bold text-slate-100">{EVENT_META[event.type].label}</h3>
        <span className="ml-auto"><StatusBadge status={event.status} /></span>
      </div>

      {event.thumbnail ? (
        <img src={event.thumbnail} alt="detection snapshot" className="w-full rounded-lg border border-slate-800" />
      ) : (
        <div className="flex h-36 items-center justify-center rounded-lg border border-dashed border-slate-800 text-[0.7rem] text-slate-600">
          No snapshot captured
        </div>
      )}

      <p className="text-[0.86rem] text-slate-200">{event.title}</p>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[0.72rem]">
        <Field label="Confidence" value={pct(event.confidence)} />
        <Field label="Severity" value={event.severity} color={SEVERITY_COLOR[event.severity]} />
        <Field label="Location" value={coordLabel(event.lat, event.lng)} />
        <Field label="Time" value={fullDateTime(event.timestamp)} />
        <Field label="Bus speed" value={`${event.speedKph} km/h`} />
        <Field label="Heading" value={`${event.heading}°`} />
        <Field label="Source" value={event.source === 'ai' ? 'On-board AI' : 'Operator / simulated'} />
        <Field label="Bus" value={event.busId} />
      </dl>

      {event.plate && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          <div className="microlabel" style={{ color: '#fbbf24' }}>Number plate (OCR)</div>
          <div className="mono mt-0.5 text-lg font-bold tracking-widest text-amber-200">{event.plate}</div>
          {event.details?.plateSimulated ? (
            <div className="text-[0.64rem] text-amber-400/80">Plate not readable at this resolution — simulated value shown</div>
          ) : event.details?.plateConfidence !== undefined ? (
            <div className="text-[0.64rem] text-amber-400/80">OCR confidence {pct(Number(event.details.plateConfidence))}</div>
          ) : null}
        </div>
      )}

      {event.details && Object.keys(event.details).length > 0 && (
        <div>
          <div className="microlabel mb-1">Sensor evidence</div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(event.details)
              .filter(([k]) => !k.startsWith('plate'))
              .map(([k, v]) => (
                <span key={k} className="rounded border border-slate-700/70 bg-[#0b1220] px-1.5 py-0.5 text-[0.66rem] text-slate-300">
                  {k}: <span className="mono">{String(v)}</span>
                </span>
              ))}
          </div>
        </div>
      )}

      <div className="mt-1 flex flex-wrap gap-2 border-t border-slate-800/70 pt-3">
        <button className="btn btn-sm" onClick={() => onShowOnMap(event)}>
          <IconMap width={13} height={13} /> Show on map
        </button>
        {nextActions.map((s) => (
          <button
            key={s}
            className={`btn btn-sm ${s === 'resolved' ? 'btn-primary' : ''}`}
            onClick={() => void onStatus(event.id, s)}
          >
            {s === 'resolved' ? <IconCheck width={13} height={13} /> : null}
            Mark {STATUS_LABEL[s].toLowerCase()}
          </button>
        ))}
      </div>
    </div>
  )
}

function Field({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <dt className="microlabel">{label}</dt>
      <dd className="mono mt-0.5 capitalize" style={{ color: color ?? '#cbd5e1' }}>{value}</dd>
    </div>
  )
}
