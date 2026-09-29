// ── Domain types shared across the whole app ────────────────────────────────

export type EventType =
  | 'pothole'
  | 'waterlogging'
  | 'congestion'
  | 'harsh_braking'
  | 'rash_driving'
  | 'pedestrian'
  | 'animal'
  | 'sign'
  | 'snapshot'
  | 'manual'

export type Severity = 'low' | 'medium' | 'high' | 'critical'

export type EventStatus = 'new' | 'acknowledged' | 'in_progress' | 'resolved'

export interface UrbanEvent {
  id: string
  busId: string
  type: EventType
  title: string
  severity: Severity
  /** 0..1 AI confidence */
  confidence: number
  lat: number
  lng: number
  /** bus speed at capture time (simulated, km/h) */
  speedKph: number
  /** bus heading in degrees (0 = north) */
  heading: number
  /** epoch milliseconds */
  timestamp: number
  status: EventStatus
  /** small jpeg data-url snapshot of the frame that triggered the event */
  thumbnail?: string
  /** number plate read by OCR, when available */
  plate?: string
  /** free-form extra metrics (vehicle counts, density index, sign type …) */
  details?: Record<string, string | number | boolean>
  source: 'ai' | 'manual'
}

export interface BusState {
  busId: string
  lat: number
  lng: number
  speedKph: number
  heading: number
  /** epoch ms of this position fix */
  updatedAt: number
  gpsMode: 'sim' | 'device'
  /** meters travelled along the simulated route (sim mode) */
  routeMeters?: number
}

export type BackendMode = 'firebase' | 'local'

export interface DataBackend {
  readonly mode: BackendMode
  init(): Promise<void>
  /** newest first, live-updating */
  subscribeEvents(cb: (events: UrbanEvent[]) => void): () => void
  addEvent(e: UrbanEvent): Promise<void>
  updateEvent(id: string, patch: Partial<UrbanEvent>): Promise<void>
  setStatus(id: string, status: EventStatus): Promise<void>
  subscribeFleet(busId: string, cb: (s: BusState | null) => void): () => void
  publishFleet(s: BusState): Promise<void>
}

// ── Presentation metadata ───────────────────────────────────────────────────

export const EVENT_META: Record<
  EventType,
  { label: string; short: string; color: string; severity: Severity }
> = {
  pothole: { label: 'Pothole / Road Damage', short: 'Pothole', color: '#f97316', severity: 'medium' },
  waterlogging: { label: 'Waterlogging / Road Hazard', short: 'Waterlogging', color: '#38bdf8', severity: 'high' },
  congestion: { label: 'Traffic Congestion', short: 'Congestion', color: '#fbbf24', severity: 'medium' },
  harsh_braking: { label: 'Harsh Braking / Incident', short: 'Incident', color: '#ef4444', severity: 'high' },
  rash_driving: { label: 'Rash Driving / Overspeeding', short: 'Rash Driving', color: '#fb7185', severity: 'high' },
  pedestrian: { label: 'Pedestrian Near Carriageway', short: 'Pedestrian', color: '#a78bfa', severity: 'medium' },
  animal: { label: 'Stray Cattle / Animal on Road', short: 'Stray Animal', color: '#fcd34d', severity: 'high' },
  sign: { label: 'Traffic Sign / Infrastructure', short: 'Sign', color: '#34d399', severity: 'low' },
  snapshot: { label: 'Traffic Snapshot', short: 'Snapshot', color: '#64748b', severity: 'low' },
  manual: { label: 'Manual Report', short: 'Manual', color: '#fb7185', severity: 'critical' },
}

export const SEVERITY_COLOR: Record<Severity, string> = {
  low: '#22d3ee',
  medium: '#fbbf24',
  high: '#fb923c',
  critical: '#ef4444',
}

export const STATUS_LABEL: Record<EventStatus, string> = {
  new: 'New',
  acknowledged: 'Acknowledged',
  in_progress: 'In Progress',
  resolved: 'Resolved',
}

/** COCO-SSD classes we care about, mapped to display names. */
export const VEHICLE_CLASSES: Record<string, string> = {
  car: 'Car',
  bus: 'Bus',
  truck: 'Truck',
  motorcycle: 'Bike',
  bicycle: 'Cycle',
}
export const PERSON_CLASS = 'person'
export const SIGN_CLASSES: Record<string, string> = {
  'traffic light': 'Traffic Light',
  'stop sign': 'Stop Sign',
}
