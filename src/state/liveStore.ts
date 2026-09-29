import { create } from 'zustand'

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error'
export type SourceKind = 'none' | 'webcam' | 'sample' | 'file' | 'screen'

export interface LiveStats {
  running: boolean
  modelStatus: ModelStatus
  modelMessage: string
  source: SourceKind
  sourceLabel: string
  /** detection ticks per second */
  fps: number
  /** current-frame count per class */
  activeCounts: Record<string, number>
  /** session-unique vehicles per class */
  uniqueCounts: Record<string, number>
  pedestrians: number
  densityIndex: number
  avgSpeedProxy: number
  detections: DetectionBox[]
  lastError: string | null
}

export interface DetectionBox {
  id: number
  label: string
  score: number
  x: number
  y: number
  w: number
  h: number
  color: string
  /** plate text read for this vehicle, shown under the label */
  plate?: string
}

interface LiveStore extends LiveStats {
  patch: (p: Partial<LiveStats>) => void
}

export const useLiveStore = create<LiveStore>((set) => ({
  running: false,
  modelStatus: 'idle',
  modelMessage: '',
  source: 'none',
  sourceLabel: '',
  fps: 0,
  activeCounts: {},
  uniqueCounts: {},
  pedestrians: 0,
  densityIndex: 0,
  avgSpeedProxy: 0,
  detections: [],
  lastError: null,
  patch: (p) => set(p),
}))

// ── AI feature settings (persisted) ─────────────────────────────────────────

export interface AiSettings {
  sensitivity: number // 0..1, higher = fire more events
  enableVehicles: boolean
  enableCongestion: boolean
  enablePothole: boolean
  enableWater: boolean
  enablePedestrian: boolean
  enableAnimals: boolean
  enableSigns: boolean
  enableBraking: boolean
  enableRash: boolean
  enablePlates: boolean
  enablePlateWatch: boolean
  routeSpeedKph: number
  routeTimeScale: number
}

const DEFAULTS: AiSettings = {
  sensitivity: 0.5,
  enableVehicles: true,
  enableCongestion: true,
  enablePothole: true,
  enableWater: true,
  enablePedestrian: true,
  enableAnimals: true,
  enableSigns: true,
  enableBraking: true,
  enableRash: true,
  enablePlates: true,
  enablePlateWatch: true,
  routeSpeedKph: 28,
  routeTimeScale: 10,
}

const LS_KEY = 'urbaneye.aiSettings'

function load(): AiSettings {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS }
}

interface SettingsStore {
  settings: AiSettings
  set: <K extends keyof AiSettings>(key: K, value: AiSettings[K]) => void
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: load(),
  set: (key, value) => {
    const settings = { ...get().settings, [key]: value }
    localStorage.setItem(LS_KEY, JSON.stringify(settings))
    set({ settings })
  },
}))
