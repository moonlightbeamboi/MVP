import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet.heat'
import { ROUTE } from '../lib/gps/busSim'
import { getBackend } from '../lib/store'
import { BUS_ID } from '../lib/gps/busSim'
import { useEventsStore } from '../state/eventsStore'
import { EVENT_META, SEVERITY_COLOR, type BusState, type UrbanEvent } from '../types'
import { busIcon, eventIcon } from '../components/MiniMap'
import { coordLabel, fullDateTime, pct } from '../lib/format'
import { IconLayers } from '../components/icons'

const SEVERITY_WEIGHT: Record<string, number> = { low: 0.35, medium: 0.6, high: 0.85, critical: 1 }

function FocusMarker({ event }: { event: UrbanEvent | null }) {
  const map = useMap()
  useEffect(() => {
    if (event) map.flyTo([event.lat, event.lng], Math.max(map.getZoom(), 16), { duration: 0.8 })
  }, [event, map])
  return null
}

function HeatLayer({ points, on }: { points: [number, number, number][]; on: boolean }) {
  const map = useMap()
  const layerRef = useRef<L.Layer | null>(null)
  useEffect(() => {
    if (!on || points.length === 0) {
      if (layerRef.current) {
        map.removeLayer(layerRef.current)
        layerRef.current = null
      }
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const heat = (L as any).heatLayer(points, {
      radius: 28,
      blur: 18,
      maxZoom: 17,
      max: 1,
      gradient: { 0.2: '#0ea5e9', 0.45: '#22d3ee', 0.65: '#f59e0b', 0.85: '#ef4444' },
    })
    heat.addTo(map)
    layerRef.current = heat
    return () => {
      map.removeLayer(heat)
    }
  }, [map, points, on])
  return null
}

export default function MapView() {
  const events = useEventsStore((s) => s.events)
  const selectedId = useEventsStore((s) => s.selectedId)
  const [fleet, setFleet] = useState<BusState | null>(null)
  const [heat, setHeat] = useState(true)

  useEffect(() => {
    let off: (() => void) | null = null
    void getBackend().then((b) => {
      off = b.subscribeFleet(BUS_ID, setFleet)
    })
    return () => off?.()
  }, [])

  const routeLine = useMemo(() => [...ROUTE, ROUTE[0]], [])
  const operational = useMemo(() => events.filter((e) => e.type !== 'snapshot'), [events])
  const selected = useMemo(() => operational.find((e) => e.id === selectedId) ?? null, [operational, selectedId])
  const heatPoints = useMemo<[number, number, number][]>(
    () => operational.map((e) => [e.lat, e.lng, SEVERITY_WEIGHT[e.severity] ?? 0.5]),
    [operational],
  )

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-800/80" style={{ height: 'calc(100vh - 260px)', minHeight: 420 }}>
      <MapContainer center={ROUTE[0]} zoom={14} className="h-full w-full" preferCanvas>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Polyline positions={routeLine} pathOptions={{ color: '#22d3ee', weight: 2.5, opacity: 0.55, dashArray: '6 8' }} />
        <HeatLayer points={heatPoints} on={heat} />
        {fleet && <Marker position={[fleet.lat, fleet.lng]} icon={busIcon(fleet.heading)} zIndexOffset={800} />}
        {operational.map((e) => (
          <Marker key={e.id} position={[e.lat, e.lng]} icon={eventIcon(SEVERITY_COLOR[e.severity])} opacity={e.status === 'resolved' ? 0.45 : 1}>
            <Popup>
              <div style={{ minWidth: 220 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span className="event-dot" style={{ background: SEVERITY_COLOR[e.severity], color: SEVERITY_COLOR[e.severity], width: 10, height: 10 }} />
                  <strong style={{ fontSize: '0.82rem' }}>{EVENT_META[e.type].short}</strong>
                  <span style={{ marginLeft: 'auto', fontSize: '0.66rem', color: '#8298b4' }}>{pct(e.confidence)}</span>
                </div>
                <div style={{ fontSize: '0.78rem', marginBottom: 4 }}>{e.title}</div>
                {e.thumbnail && (
                  <img src={e.thumbnail} alt="event snapshot" style={{ width: '100%', borderRadius: 6, marginBottom: 6 }} />
                )}
                <div style={{ fontSize: '0.68rem', color: '#8298b4', lineHeight: 1.5 }}>
                  {coordLabel(e.lat, e.lng)}<br />
                  {fullDateTime(e.timestamp)} · Bus {e.busId}<br />
                  {e.plate && <span>Plate: <strong style={{ color: '#fbbf24' }}>{e.plate}</strong></span>}
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
        <FocusMarker event={selected} />
      </MapContainer>

      {/* map controls */}
      <div className="absolute right-3 top-3 z-[1000] flex gap-2">
        <button className={`btn btn-sm ${heat ? 'btn-primary' : ''}`} onClick={() => setHeat(!heat)}>
          <IconLayers width={13} height={13} /> Incident heatmap
        </button>
      </div>

      {/* legend */}
      <div className="panel absolute bottom-4 left-3 z-[1000] px-3 py-2.5 text-[0.68rem]" style={{ background: 'rgba(10,16,28,0.92)' }}>
        <div className="microlabel mb-1.5">Legend</div>
        <div className="flex flex-col gap-1">
          {(['critical', 'high', 'medium', 'low'] as const).map((s) => (
            <span key={s} className="flex items-center gap-2 text-slate-300">
              <span className="event-dot" style={{ background: SEVERITY_COLOR[s], color: SEVERITY_COLOR[s], width: 10, height: 10 }} />
              {s}
            </span>
          ))}
          <span className="mt-1 flex items-center gap-2 text-cyan-300">
            <svg width="11" height="11" viewBox="0 0 24 24"><path d="M12 3 19 20l-7-4-7 4L12 3z" fill="#67e8f9" /></svg>
            Bus UP16-ETB-042 {fleet ? `· ${fleet.speedKph} km/h` : ''}
          </span>
        </div>
      </div>
    </div>
  )
}
