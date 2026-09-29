import { useEffect, useMemo, useState } from 'react'
import { MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet.heat'
import { busSim, ROUTE } from '../lib/gps/busSim'
import type { BusState } from '../types'

export function busIcon(heading: number): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div class="bus-marker" style="transform: rotate(${heading}deg)">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#67e8f9" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(0deg)">
        <path d="M12 3 19 20l-7-4-7 4L12 3z" fill="#67e8f9" stroke="none"/>
      </svg>
    </div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  })
}

export function eventIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div class="event-dot" style="background:${color}; color:${color}"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  })
}

function FollowBus({ state }: { state: BusState | null }) {
  const map = useMap()
  useEffect(() => {
    if (state) map.panTo([state.lat, state.lng], { animate: true, duration: 0.5 })
  }, [state, map])
  return null
}

/** Compact route-following map used on the Bus Unit page. */
export default function MiniMap({ height = 260 }: { height?: number }) {
  const [state, setState] = useState<BusState | null>(null)
  useEffect(() => busSim.subscribe(setState), [])

  const routeLine = useMemo(() => [...ROUTE, ROUTE[0]], [])
  const center = useMemo<[number, number]>(() => [ROUTE[0][0], ROUTE[0][1]], [])

  return (
    <div className="overflow-hidden rounded-lg border border-slate-800/80" style={{ height }}>
      <MapContainer center={center} zoom={15} scrollWheelZoom={false} attributionControl className="h-full w-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Polyline positions={routeLine} pathOptions={{ color: '#22d3ee', weight: 2, opacity: 0.5, dashArray: '5 7' }} />
        {state && (
          <>
            <Marker position={[state.lat, state.lng]} icon={busIcon(state.heading)} />
            <FollowBus state={state} />
          </>
        )}
      </MapContainer>
    </div>
  )
}
