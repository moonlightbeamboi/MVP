import type { BusState } from '../../types'

export const BUS_ID = 'UP16-ETB-042'

/**
 * Simulated service route: a loop around JIIT Noida (Sector 62) → Sector 63 →
 * back, hugging the real road grid — Sector 62 main road (B-Block road) past
 * the JIIT gate, the Sector 62/63 link near the NH-9 service lanes, up through
 * Sector 63, and back down the Sector 62 side. Waypoints are approximate but
 * land on real streets when plotted on OSM tiles — right for a demo.
 */
export const ROUTE: [number, number][] = [
  [28.6292, 77.3704], // JIIT Sector 62 (start / depot)
  [28.6283, 77.3718],
  [28.6275, 77.3736],
  [28.6269, 77.3758],
  [28.6262, 77.3781],
  [28.6259, 77.3802], // Sector 62/63 boundary
  [28.6272, 77.3817],
  [28.6291, 77.3824], // Sector 63 main road
  [28.6310, 77.3818],
  [28.6326, 77.3801],
  [28.6335, 77.3778],
  [28.6330, 77.3752],
  [28.6318, 77.3726],
  [28.6305, 77.3708],
]

function toRad(d: number) {
  return (d * Math.PI) / 180
}

/** haversine distance in meters */
export function distanceM(a: [number, number], b: [number, number]): number {
  const R = 6371000
  const dLat = toRad(b[0] - a[0])
  const dLng = toRad(b[1] - a[1])
  const lat1 = toRad(a[0])
  const lat2 = toRad(b[0])
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** initial bearing in degrees (0 = north, clockwise) */
export function bearingDeg(a: [number, number], b: [number, number]): number {
  const lat1 = toRad(a[0])
  const lat2 = toRad(b[0])
  const dLng = toRad(b[1] - a[1])
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360
}

// Precompute cumulative segment distances so interpolation is O(log n).
const SEGS: { from: [number, number]; to: [number, number]; len: number; cum: number; heading: number }[] = []
let total = 0
for (let i = 0; i < ROUTE.length; i++) {
  const from = ROUTE[i]
  const to = ROUTE[(i + 1) % ROUTE.length]
  const len = distanceM(from, to)
  SEGS.push({ from, to, len, cum: total, heading: bearingDeg(from, to) })
  total += len
}
export const ROUTE_LENGTH_M = total

function posAt(meters: number): { latlng: [number, number]; heading: number } {
  const m = ((meters % total) + total) % total
  for (let i = 0; i < SEGS.length; i++) {
    const s = SEGS[i]
    if (m < s.cum + s.len) {
      const t = (m - s.cum) / s.len
      return {
        latlng: [
          s.from[0] + (s.to[0] - s.from[0]) * t,
          s.from[1] + (s.to[1] - s.from[1]) * t,
        ],
        heading: s.heading,
      }
    }
  }
  return { latlng: ROUTE[0], heading: 0 }
}

/**
 * Drives the simulated bus along the route. Emits a position every 500 ms.
 * `speedKph` is the *displayed* bus speed; `timeScale` fast-forwards the
 * simulation so the marker visibly moves during a demo.
 */
export class BusSim {
  private timer: number | null = null
  private meters = 0
  private listeners = new Set<(s: BusState) => void>()

  speedKph = 28
  timeScale = 10
  running = true
  gpsMode: 'sim' | 'device' = 'sim'
  private deviceWatch: number | null = null
  readonly busId = BUS_ID

  constructor() {
    this.start()
  }

  start() {
    if (this.timer !== null) return
    this.timer = window.setInterval(() => this.tick(), 500)
  }

  stop() {
    if (this.timer !== null) {
      window.clearInterval(this.timer)
      this.timer = null
    }
  }

  private tick() {
    if (!this.running || this.gpsMode !== 'sim') return
    const metersPerTick = (this.speedKph * this.timeScale * 1000) / 3600 / 2 // per 0.5s
    this.meters += metersPerTick
    this.emit(this.meters)
  }

  private emit(meters: number) {
    const { latlng, heading } = posAt(meters)
    const state: BusState = {
      busId: this.busId,
      lat: latlng[0],
      lng: latlng[1],
      speedKph: this.running ? Math.round(this.speedKph) : 0,
      heading: Math.round(heading),
      updatedAt: Date.now(),
      gpsMode: 'sim',
      routeMeters: meters,
    }
    this.listeners.forEach((l) => l(state))
  }

  /** Use the laptop's real GPS (if it exposes one) instead of the simulated route. */
  async useDeviceGps(enable: boolean, onDenied?: (reason: string) => void) {
    this.gpsMode = enable ? 'device' : 'sim'
    if (enable) {
      if (this.deviceWatch !== null) return // already watching
      if (!('geolocation' in navigator)) {
        this.gpsMode = 'sim'
        onDenied?.('Geolocation is not available in this browser')
        return
      }
      this.deviceWatch = navigator.geolocation.watchPosition(
        (p) => {
          const state: BusState = {
            busId: this.busId,
            lat: p.coords.latitude,
            lng: p.coords.longitude,
            speedKph: p.coords.speed ? Math.round(p.coords.speed * 3.6) : 0,
            heading: p.coords.heading ?? 0,
            updatedAt: Date.now(),
            gpsMode: 'device',
          }
          this.listeners.forEach((l) => l(state))
        },
        (err) => {
          this.gpsMode = 'sim'
          onDenied?.(
            err.code === err.PERMISSION_DENIED
              ? 'Location permission denied — staying on the simulated route'
              : 'Device GPS fix unavailable — staying on the simulated route',
          )
        },
        { enableHighAccuracy: true, timeout: 10_000 },
      )
    } else if (this.deviceWatch !== null) {
      navigator.geolocation.clearWatch(this.deviceWatch)
      this.deviceWatch = null
    }
  }

  subscribe(cb: (s: BusState) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  getState(): BusState {
    const { latlng, heading } = posAt(this.meters)
    return {
      busId: this.busId,
      lat: latlng[0],
      lng: latlng[1],
      speedKph: Math.round(this.speedKph),
      heading: Math.round(heading),
      updatedAt: Date.now(),
      gpsMode: this.gpsMode,
      routeMeters: this.meters,
    }
  }
}

/** App-wide singleton — the bus is "in service" from the moment the app loads. */
export const busSim = new BusSim()
