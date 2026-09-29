import type { ObjectDetection } from '@tensorflow-models/coco-ssd'
import type { BusState, EventType, Severity, UrbanEvent } from '../../types'
import { EVENT_META, PERSON_CLASS, SIGN_CLASSES, VEHICLE_CLASSES } from '../../types'
import { busSim } from '../gps/busSim'
import { getBackend } from '../store'
import { useLiveStore, useSettingsStore, type DetectionBox } from '../../state/liveStore'
import { Tracker, iou } from './tracker'
import { analyseRoadRoi, detectPothole, detectWaterlogging, type RoiStats } from './heuristics'
import { readPlate } from './plate'
import { useWatchlistStore } from '../../state/watchlistStore'

const LOOP_MS = 140
const HEURISTIC_EVERY = 3
const SNAPSHOT_EVERY_MS = 25_000

let vendorStatus: { cocoSsd?: boolean } = {}
try {
  vendorStatus = await fetch('/vendor-status.json').then((r) => r.json())
} catch {
  /* fall back to CDN */
}

/**
 * Road-relevant COCO classes only. Everything else (keyboard, bird, dining
 * table …) is COCO hallucinating on road texture and is dropped before it can
 * pollute the overlay or the stats.
 */
const ALLOWED_CLASSES = new Set([
  'car', 'bus', 'truck', 'motorcycle', 'bicycle', 'train',
  'person', 'cow', 'dog', 'horse', 'sheep',
  'traffic light', 'stop sign', 'fire hydrant',
])
/** per-class confidence floors (above the global 0.4 gate) */
const CLASS_SCORE_GATES: Record<string, number> = {
  person: 0.55,
  cow: 0.5,
  dog: 0.6,
  horse: 0.6,
  sheep: 0.6,
  train: 0.65,
  'traffic light': 0.5,
  'stop sign': 0.5,
  'fire hydrant': 0.6,
}

const BOX_COLORS: Record<string, string> = {
  car: '#22d3ee',
  bus: '#f59e0b',
  truck: '#f97316',
  motorcycle: '#a78bfa',
  bicycle: '#34d399',
  person: '#f472b6',
  'traffic light': '#4ade80',
  'stop sign': '#4ade80',
}

export interface EngineEventFeedItem {
  event: UrbanEvent
}

type EventListener = (e: UrbanEvent) => void

class SensingEngine {
  private video: HTMLVideoElement | null = null
  private overlay: HTMLCanvasElement | null = null
  private model: ObjectDetection | null = null
  private loopTimer: number | null = null
  private tickCount = 0
  private tickTimes: number[] = []
  private tracker = new Tracker()
  private lastFire: Record<string, number> = {}
  private lastSnapshot = 0
  private signStreak: Record<string, number> = {}
  private prevSpeedProxy = 0
  private listeners = new Set<EventListener>()
  private plateQueue: { eventId: string; box: [number, number, number, number] } | null = null
  private lastVehicleBoxes: [number, number, number, number][] = []
  private busy = false
  private lastRoi: RoiStats | null = null
  /** localized hazard boxes (pothole / waterlogging), drawn like detection boxes */
  private hazardBoxes: { box: { x: number; y: number; w: number; h: number }; label: string; color: string; conf: number; until: number }[] = []
  /** plate text attached to the vehicle box it was read from */
  private plateTag: { text: string; box: [number, number, number, number]; until: number } | null = null
  /** consecutive positive pothole analyses (persistence gate) */
  private potholeStreak = 0
  /** continuous plate reader */
  private lastPlateWatch = 0
  private lastWatchPlate = ''
  private plateWatchBusy = false
  /** processing canvas (video frame snapshot for the HF detector) */
  private workCanvas: HTMLCanvasElement | null = null
  private workCtx: CanvasRenderingContext2D | null = null
  /** true when the advanced HF DETR detector is active (else COCO-SSD fallback) */
  private usingHf = false
  private hfDetectFn: ((c: HTMLCanvasElement) => Promise<{ label: string; score: number; xmin: number; ymin: number; xmax: number; ymax: number }[] | null>) | null = null

  /** latest road-ROI pixel statistics (for tuning/diagnostics) */
  get roiStats(): RoiStats | null {
    return this.lastRoi
  }

  async loadModel(): Promise<boolean> {
    const live = useLiveStore.getState()
    if (this.model) return true
    if (live.modelStatus === 'loading') return false
    live.patch({ modelStatus: 'loading', modelMessage: 'Loading AI model…' })
    // preferred: the more accurate DETR-ResNet-50 via Transformers.js
    // (WebGPU fp16 → WASM q8), fully vendored. Falls back to COCO-SSD.
    try {
      const { loadDetr, hfDevice, hfDetect } = await import('./hf')
      const hfOk = await loadDetr()
      if (hfOk) {
        this.usingHf = true
        this.model = null
        this.hfDetectFn = hfDetect
        console.info('[engine] using HF DETR on', hfDevice())
        useLiveStore.getState().patch({ modelStatus: 'ready', modelMessage: '' })
        return true
      }
    } catch (e) {
      console.warn('[engine] HF DETR unavailable, falling back to COCO-SSD:', e)
    }
    try {
      const [tfMod, cocoMod] = await Promise.all([
        import('@tensorflow/tfjs'),
        import('@tensorflow-models/coco-ssd'),
      ])
      // both packages are named-export ESM (no default) in some builds — handle both shapes
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      const tfModAny = tfMod as any
      const tf = tfModAny.ready ? tfModAny : tfModAny.default
      await tf.ready()
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      const cocoAny = cocoMod as any
      const cocoSsd = cocoAny.load ? cocoAny : cocoAny.default
      // SSD graph, vendored for offline use; fall back to the lite graph, then CDN
      let modelUrl: string | undefined
      for (const url of ['/models/ssd_mobilenet_v2/model.json', '/models/ssdlite_mobilenet_v2/model.json']) {
        if (await fetch(url, { method: 'HEAD' }).then((r) => r.ok).catch(() => false)) {
          modelUrl = url
          break
        }
      }
      const loadOpts: { base: 'mobilenet_v2' | 'lite_mobilenet_v2'; modelUrl?: string } = {
        base: modelUrl?.includes('lite') ? 'lite_mobilenet_v2' : 'mobilenet_v2',
      }
      if (modelUrl) loadOpts.modelUrl = modelUrl
      const detector = await cocoSsd.load(loadOpts)
      // warm-up so the first real detection isn't slow
      const warm = document.createElement('canvas')
      warm.width = 300
      warm.height = 300
      await detector.detect(warm)
      this.model = detector
      useLiveStore.getState().patch({ modelStatus: 'ready', modelMessage: '' })
      return true
    } catch (e) {
      useLiveStore.getState().patch({
        modelStatus: 'error',
        modelMessage: e instanceof Error ? e.message : 'Model failed to load',
      })
      return false
    }
  }

  setVideo(el: HTMLVideoElement | null) {
    this.video = el
  }

  setOverlay(el: HTMLCanvasElement | null) {
    this.overlay = el
  }

  onEvent(cb: EventListener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  get isRunning() {
    return this.loopTimer !== null
  }

  async start() {
    if (this.loopTimer !== null) return
    if (!this.video) {
      useLiveStore.getState().patch({ lastError: 'No camera source selected' })
      return
    }
    const ok = await this.loadModel()
    if (!ok || !this.model) return
    useLiveStore.getState().patch({ running: true, lastError: null })
    this.loopTimer = window.setInterval(() => void this.tick(), LOOP_MS)
  }

  stop() {
    if (this.loopTimer !== null) {
      window.clearInterval(this.loopTimer)
      this.loopTimer = null
    }
    this.tracker.reset()
    useLiveStore.getState().patch({ running: false, detections: [], densityIndex: 0, avgSpeedProxy: 0 })
  }

  resetStats() {
    this.tracker.reset()
    this.lastFire = {}
  }

  /** Manually inject a demo incident (used by the "simulate" buttons). */
  async injectDemo(kind: Exclude<EventType, 'snapshot'>, titleOverride?: string) {
    const titles: Partial<Record<EventType, string>> = {
      pothole: 'Pothole cluster detected (simulated)',
      waterlogging: 'Waterlogged stretch detected (simulated)',
      congestion: 'Heavy congestion detected (simulated)',
      harsh_braking: 'Harsh braking / possible collision (simulated)',
      pedestrian: 'Pedestrian on carriageway (simulated)',
      animal: 'Stray cattle on carriageway (simulated)',
      sign: 'Damaged traffic sign observed (simulated)',
      manual: 'Road accident reported (simulated)',
    }
    await this.createEvent(kind, {
      title: titleOverride ?? titles[kind] ?? EVENT_META[kind].label,
      confidence: 0.88,
      severity: kind === 'manual' ? 'critical' : EVENT_META[kind].severity,
      source: 'manual',
      details: { injected: true },
      thumbnail: this.captureThumbnail(),
      needsPlate: kind === 'manual' || kind === 'harsh_braking',
    })
  }

  private async tick() {
    const video = this.video
    if (!video || this.busy) return
    if (video.readyState < 2 || !video.videoWidth) return
    this.busy = true
    try {
      const now = Date.now()
      const settings = useSettingsStore.getState().settings
      let preds: { class: string; score: number; bbox: number[] }[] = []
      if (this.usingHf && this.hfDetectFn) {
        // advanced path: snapshot the frame, run DETR on the processing canvas
        if (!this.workCanvas || this.workCanvas.width !== video.videoWidth) {
          this.workCanvas = this.workCanvas ?? document.createElement('canvas')
          this.workCanvas.width = video.videoWidth
          this.workCanvas.height = video.videoHeight
          this.workCtx = this.workCanvas.getContext('2d', { willReadFrequently: true })
        }
        if (!this.workCtx) return
        this.workCtx.drawImage(video, 0, 0)
        const hfBoxes = await this.hfDetectFn(this.workCanvas)
        preds = (hfBoxes ?? [])
          .filter((b) => ALLOWED_CLASSES.has(b.label) && b.score >= (CLASS_SCORE_GATES[b.label] ?? 0.45))
          .map((b) => ({
            class: b.label,
            score: b.score,
            bbox: [
              b.xmin * video.videoWidth,
              b.ymin * video.videoHeight,
              (b.xmax - b.xmin) * video.videoWidth,
              (b.ymax - b.ymin) * video.videoHeight,
            ],
          }))
      } else {
        const model = this.model
        if (!model) return
        // keep only road-relevant classes (COCO hallucinates keyboards/birds on
        // road texture) and enforce per-class confidence floors
        const raw = (await model.detect(video, 18, 0.4)).filter(
          (p) => ALLOWED_CLASSES.has(p.class) && p.score >= (CLASS_SCORE_GATES[p.class] ?? 0.45),
        )
        preds = raw.map((p) => ({ class: p.class, score: p.score, bbox: p.bbox }))
      }
      this.tickTimes.push(now)
      while (this.tickTimes.length > 0 && now - this.tickTimes[0] > 1000) this.tickTimes.shift()

      const vehicles: { cls: string; box: [number, number, number, number]; score: number }[] = []
      const activeCounts: Record<string, number> = {}
      const boxes: DetectionBox[] = []
      this.lastVehicleBoxes = []

      for (const p of preds) {
        const box: [number, number, number, number] = [p.bbox[0] / video.videoWidth, p.bbox[1] / video.videoHeight, p.bbox[2] / video.videoWidth, p.bbox[3] / video.videoHeight]
        boxes.push({ id: boxes.length, label: p.class, score: p.score, x: box[0], y: box[1], w: box[2], h: box[3], color: BOX_COLORS[p.class] ?? '#94a3b8' })
        activeCounts[p.class] = (activeCounts[p.class] ?? 0) + 1
        if (VEHICLE_CLASSES[p.class]) {
          vehicles.push({ cls: p.class, box, score: p.score })
          this.lastVehicleBoxes.push(box)
        }
      }

      this.tracker.update(vehicles, now)
      const speedProxy = this.tracker.avgSpeedProxy(now)
      const vehicleTotal = vehicles.length
      const densityIndex = Math.min(
        100,
        Math.round(vehicleTotal * 9 + Math.max(0, 0.45 - speedProxy) * 160 + (speedProxy < 0.12 && vehicleTotal >= 3 ? 18 : 0)),
      )

      // ── overlay ──
      this.drawOverlay(boxes, now)

      // ── events ──
      if (this.tickCount % HEURISTIC_EVERY === 0) {
        if (settings.enableSigns) this.checkSigns(preds, now, settings.sensitivity)
        if (settings.enablePedestrian) this.checkPedestrians(preds, video, now)
        if (settings.enableAnimals) this.checkAnimals(preds, video, now)
        if (settings.enableBraking) this.checkBraking(speedProxy, now)
        if (settings.enableRash) this.checkRashDriving(now)
        if (settings.enablePlateWatch && this.lastVehicleBoxes.length > 0 && now - this.lastPlateWatch > 2500 && !this.plateWatchBusy) {
          this.lastPlateWatch = now
          void this.plateWatchTick()
        }
        if (settings.enablePothole || settings.enableWater) {
          const stats = analyseRoadRoi(video)
          this.lastRoi = stats
          if (stats) {
            const gain = 1.5 - settings.sensitivity
            if (settings.enablePothole) {
              const sig = detectPothole(stats, gain)
              // persistence gate: require two consecutive positives (~0.8s apart)
              // so a single dark car or shadow can't fake a pothole
              this.potholeStreak = sig.fired ? this.potholeStreak + 1 : 0
              if (sig.fired && this.potholeStreak >= 2 && this.cool('pothole', now, 18_000)) {
                this.potholeStreak = 0
                const box = stats.warmSmoothRatio > 0.2 * gain ? stats.poolBox : stats.darkBox
                if (box) {
                  this.hazardBoxes = this.hazardBoxes.filter((h) => h.label.startsWith('Water'))
                  this.hazardBoxes.push({ box, label: 'Pothole', color: '#f97316', conf: sig.confidence, until: now + 3500 })
                }
                void this.createEvent('pothole', {
                  title: 'Pothole / road damage detected',
                  confidence: sig.confidence,
                  details: {
                    darkRatio: +stats.darkRatio.toFixed(3),
                    poolRatio: +stats.warmSmoothRatio.toFixed(3),
                    edgeEnergy: +stats.edgeMean.toFixed(1),
                    sustained: true,
                  },
                  thumbnail: this.captureThumbnail(),
                })
              }
            }
            if (settings.enableWater) {
              const sig = detectWaterlogging(stats, gain)
              if (sig.fired && this.cool('waterlogging', now, 25_000)) {
                if (stats.poolBox) {
                  this.hazardBoxes = this.hazardBoxes.filter((h) => !h.label.startsWith('Water'))
                  this.hazardBoxes.push({ box: stats.poolBox, label: 'Waterlogging', color: '#38bdf8', conf: sig.confidence, until: now + 3500 })
                }
                void this.createEvent('waterlogging', {
                  title: 'Waterlogging / wet hazardous stretch',
                  confidence: sig.confidence,
                  details: { blueSheen: +stats.blueRatio.toFixed(3), poolRatio: +stats.warmSmoothRatio.toFixed(3), glare: +stats.glareRatio.toFixed(3) },
                  thumbnail: this.captureThumbnail(),
                })
              }
            }
          }
        }
        if (settings.enableCongestion && this.cool('congestion', now, 40_000)) {
          this.checkCongestion(densityIndex, vehicleTotal, speedProxy, now)
        }
      }

      // periodic aggregate snapshot for analytics
      if (now - this.lastSnapshot > SNAPSHOT_EVERY_MS && now > this.lastSnapshot) {
        this.lastSnapshot = now
        void this.createEvent('snapshot', {
          title: 'Traffic snapshot',
          confidence: 1,
          details: {
            vehicles: vehicleTotal,
            densityIndex,
            avgSpeedProxy: +speedProxy.toFixed(3),
            cars: activeCounts['car'] ?? 0,
            buses: activeCounts['bus'] ?? 0,
            trucks: activeCounts['truck'] ?? 0,
            bikes: (activeCounts['motorcycle'] ?? 0) + (activeCounts['bicycle'] ?? 0),
            pedestrians: activeCounts['person'] ?? 0,
          },
          thumbnail: undefined,
        })
      }

      const live = useLiveStore.getState()
      live.patch({
        fps: this.tickTimes.length,
        activeCounts,
        uniqueCounts: this.tracker.uniqueCounts(),
        pedestrians: activeCounts['person'] ?? 0,
        densityIndex,
        avgSpeedProxy: +speedProxy.toFixed(3),
        detections: boxes,
      })

      this.prevSpeedProxy = speedProxy
      this.tickCount++
    } finally {
      this.busy = false
    }
  }

  // ── individual checks ─────────────────────────────────────────────────────

  private checkSigns(preds: { class: string; score: number }[], now: number, sensitivity: number) {
    for (const p of preds) {
      if (!SIGN_CLASSES[p.class] || p.score < 0.5) continue
      const key = p.class
      this.signStreak[key] = (this.signStreak[key] ?? 0) + 1
      if (this.signStreak[key] >= 2 && this.cool(`sign:${key}`, now, 30_000 - sensitivity * 10_000)) {
        void this.createEvent('sign', {
          title: `${SIGN_CLASSES[key]} observed`,
          confidence: p.score,
          details: { signType: SIGN_CLASSES[key] },
          thumbnail: this.captureThumbnail(),
        })
      }
    }
  }

  private checkPedestrians(preds: { class: string; bbox: number[]; score: number }[], video: HTMLVideoElement, now: number) {
    for (const p of preds) {
      if (p.class !== PERSON_CLASS || p.score < 0.6) continue
      const area = (p.bbox[2] * p.bbox[3]) / (video.videoWidth * video.videoHeight)
      const cx = (p.bbox[0] + p.bbox[2] / 2) / video.videoWidth
      if (area > 0.06 && cx > 0.2 && cx < 0.8 && this.cool('pedestrian', now, 45_000)) {
        void this.createEvent('pedestrian', {
          title: 'Pedestrian close to carriageway',
          confidence: p.score,
          details: { frameArea: +area.toFixed(3) },
          thumbnail: this.captureThumbnail(),
        })
        break
      }
    }
  }

  /** Indian-road speciality: stray cattle & dogs on the carriageway. */
  private checkAnimals(preds: { class: string; bbox: number[]; score: number }[], video: HTMLVideoElement, now: number) {
    for (const p of preds) {
      const area = (p.bbox[2] * p.bbox[3]) / (video.videoWidth * video.videoHeight)
      if (p.class === 'cow' && p.score > 0.55 && area > 0.015 && this.cool('animal:cow', now, 40_000)) {
        void this.createEvent('animal', {
          title: 'Stray cattle on carriageway',
          confidence: p.score,
          severity: 'high',
          details: { animal: 'cattle', frameArea: +area.toFixed(3) },
          thumbnail: this.captureThumbnail(),
        })
      } else if (p.class === 'dog' && p.score > 0.65 && area > 0.01 && this.cool('animal:dog', now, 60_000)) {
        void this.createEvent('animal', {
          title: 'Stray dog on road',
          confidence: p.score,
          severity: 'low',
          details: { animal: 'dog', frameArea: +area.toFixed(3) },
          thumbnail: this.captureThumbnail(),
        })
      }
    }
  }

  private checkBraking(speedProxy: number, now: number) {
    if (
      this.prevSpeedProxy > 0.28 &&
      speedProxy < this.prevSpeedProxy * 0.4 &&
      this.cool('harsh_braking', now, 20_000)
    ) {
      void this.createEvent('harsh_braking', {
        title: 'Harsh braking / sudden speed drop',
        confidence: 0.72,
        severity: 'high',
        details: { speedBefore: +this.prevSpeedProxy.toFixed(3), speedAfter: +speedProxy.toFixed(3) },
        thumbnail: this.captureThumbnail(),
        needsPlate: true,
      })
    }
  }

  /**
   * Rash driving: a tracked vehicle moving much faster than the median of the
   * other tracked vehicles around it (overtaking wildly, weaving through
   * traffic). Relative speed makes it work on both static and moving cameras.
   */
  private lastRashDebug: { tracks: number; median: number; max: number } = { tracks: 0, median: 0, max: 0 }
  get rashDebug() {
    return this.lastRashDebug
  }

  private checkRashDriving(now: number) {
    const speeds: { track: import('./tracker').Track; speed: number }[] = []
    for (const t of this.tracker.tracks) {
      if (!VEHICLE_CLASSES[t.cls] || t.history.length < 3) continue
      const old = t.history.find((h) => now - h.t >= 800) ?? t.history[0]
      const dt = (now - old.t) / 1000
      if (dt < 0.6) continue
      speeds.push({ track: t, speed: Math.hypot(t.cx - old.cx, t.cy - old.cy) / dt })
    }
    if (speeds.length < 3) {
      this.lastRashDebug = { tracks: speeds.length, median: 0, max: 0 }
      return
    }
    const sorted = speeds.map((s) => s.speed).sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const max = sorted[sorted.length - 1]
    this.lastRashDebug = { tracks: speeds.length, median: +median.toFixed(3), max: +max.toFixed(3) }
    if (median < 0.03) return
    for (const s of speeds) {
      if (s.speed > median * 2.8 && s.speed > 0.12 && this.cool('rash_driving', now, 30_000)) {
        void this.createEvent('rash_driving', {
          title: `Rash driving: ${VEHICLE_CLASSES[s.track.cls]} at ~${Math.round((s.speed / Math.max(0.05, median)) * 100)}% of traffic speed`,
          confidence: Math.min(0.9, 0.5 + (s.speed / median - 2.8) * 0.15),
          severity: 'high',
          details: {
            vehicle: s.track.cls,
            relSpeed: +(s.speed / median).toFixed(2),
          },
          thumbnail: this.captureThumbnail(),
          needsPlate: true,
        })
        break
      }
    }
  }

  private checkCongestion(densityIndex: number, vehicles: number, speedProxy: number, now: number) {
    if (densityIndex >= 62 && vehicles >= 4) {
      void this.createEvent('congestion', {
        title: 'Heavy traffic congestion ahead',
        confidence: Math.min(0.95, densityIndex / 100),
        severity: densityIndex > 80 ? 'high' : 'medium',
        details: { densityIndex, vehicles, avgSpeedProxy: +speedProxy.toFixed(3) },
        thumbnail: this.captureThumbnail(),
      })
    }
  }

  private cool(key: string, now: number, ms: number): boolean {
    const last = this.lastFire[key] ?? 0
    if (now - last < ms) return false
    this.lastFire[key] = now
    return true
  }

  // ── event creation ────────────────────────────────────────────────────────

  private captureThumbnail(): string | undefined {
    const video = this.video
    if (!video || !video.videoWidth) return undefined
    const w = 320
    const h = Math.round((video.videoHeight / video.videoWidth) * 320)
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    if (!ctx) return undefined
    ctx.drawImage(video, 0, 0, w, h)
    try {
      return c.toDataURL('image/jpeg', 0.55)
    } catch {
      return undefined
    }
  }

  private async createEvent(
    type: EventType,
    opts: {
      title: string
      confidence: number
      severity?: Severity
      details?: Record<string, string | number | boolean>
      thumbnail?: string
      source?: 'ai' | 'manual'
      needsPlate?: boolean
    },
  ): Promise<UrbanEvent> {
    const bus: BusState = busSim.getState()
    const meta = EVENT_META[type]
    const event: UrbanEvent = {
      id: crypto.randomUUID(),
      busId: bus.busId,
      type,
      title: opts.title,
      severity: opts.severity ?? meta.severity,
      confidence: +Math.min(0.99, opts.confidence).toFixed(2),
      lat: +bus.lat.toFixed(6),
      lng: +bus.lng.toFixed(6),
      speedKph: bus.speedKph,
      heading: bus.heading,
      timestamp: Date.now(),
      status: type === 'snapshot' ? 'resolved' : 'new',
      thumbnail: opts.thumbnail,
      details: opts.details,
      source: opts.source ?? 'ai',
    }
    const backend = await getBackend()
    await backend.addEvent(event)
    this.listeners.forEach((l) => l(event))

    if (opts.needsPlate && this.lastVehicleBoxes.length > 0 && useSettingsStore.getState().settings.enablePlates) {
      this.plateQueue = { eventId: event.id, box: this.biggestVehicleBox() }
      void this.processPlateQueue()
    }
    return event
  }

  private biggestVehicleBox(): [number, number, number, number] {
    let best: [number, number, number, number] = [0, 0, 0, 0]
    let area = 0
    for (const b of this.lastVehicleBoxes) {
      const a = b[2] * b[3]
      if (a > area) {
        area = a
        best = b
      }
    }
    return best
  }

  private plateBusy = false
  private async processPlateQueue(retryBox?: [number, number, number, number]) {
    if (this.plateBusy) return
    const job = this.plateQueue
    if (!job) return
    const video = this.video
    if (!video) return
    this.plateBusy = true
    this.plateQueue = null
    try {
      const result = await readPlate(video, retryBox ?? job.box)
      const backend = await getBackend()
      const readBox = retryBox ?? job.box
      if (result.plate && readBox) {
        this.plateTag = { text: result.plate, box: readBox, until: Date.now() + 6000 }
      }
      if (job.eventId !== 'pending') {
        if (result.plate) {
          const hit = useWatchlistStore.getState().match(result.plate)
          await backend.updateEvent(job.eventId, {
            plate: result.plate,
            ...(hit
              ? {
                  severity: 'critical' as const,
                  title: `🚨 WATCHLIST HIT — plate ${result.plate} matched alert "${hit.plate}"`,
                  details: { plateConfidence: +result.confidence.toFixed(2), watchMatch: hit.plate, watchNote: hit.note || 'on alert list' },
                }
              : { details: { plateConfidence: +result.confidence.toFixed(2), plateRaw: result.raw.slice(0, 40) } }),
          })
          if (hit) useWatchlistStore.getState().recordMatch(job.eventId)
        } else {
          await backend.updateEvent(job.eventId, {
            plate: 'NOT READABLE',
            details: { plateSimulated: true, plateRaw: result.raw.slice(0, 40) },
          })
        }
      }
    } catch (e) {
      console.warn('[plate OCR]', e)
    } finally {
      this.plateBusy = false
    }
  }

  /** Continuous plate reading for webcam mode — OCRs periodically, reports new plates. */
  private async plateWatchTick() {
    const video = this.video
    if (!video || video.readyState < 2) return
    this.plateWatchBusy = true
    try {
      const box = this.lastVehicleBoxes.length > 0 ? this.biggestVehicleBox() : null
      const result = await readPlate(video, box)
      // watchlist matches on the regexed plate OR any raw OCR fragment
      const hit = useWatchlistStore.getState().match(result.plate ?? undefined)
        ?? useWatchlistStore.getState().match(result.raw)
      const readLabel = result.plate ?? (hit ? hit.plate : null)
      if (box && readLabel) {
        this.plateTag = { text: readLabel, box, until: Date.now() + 6000 }
      }
      if (readLabel && readLabel !== this.lastWatchPlate) {
        this.lastWatchPlate = readLabel
        const event = await this.createEvent('manual', {
          title: hit
            ? `🚨 WATCHLIST HIT — plate fragment "${result.raw.split(/\s+/)[0]}" matched alert "${hit.plate}"`
            : `Plate read: ${readLabel}`,
          confidence: Math.max(0.5, result.confidence),
          severity: hit ? 'critical' : 'low',
          details: {
            plateRaw: result.raw.slice(0, 40),
            plateConfidence: +result.confidence.toFixed(2),
            ...(hit ? { watchMatch: hit.plate, watchNote: hit.note || 'on alert list' } : {}),
          },
          thumbnail: this.captureThumbnail(),
        })
        if (hit) useWatchlistStore.getState().recordMatch(event.id)
      } else if (!readLabel) {
        this.lastWatchPlate = ''
      }
    } catch (e) {
      console.warn('[plate watch]', e)
    } finally {
      this.plateWatchBusy = false
    }
  }

  /**
   * Manually OCR the frame and check the watchlist. Prefers the biggest
   * detected vehicle; with none in frame (webcam + held-up plate) it reads
   * the centre region. Emits a "Plate scan" event with the result so the
   * full read → match → flag flow can be shown on demand.
   */
  async scanPlateNow(): Promise<{ plate: string | null; flagged: boolean; raw: string }> {
    const video = this.video
    if (!video) return { plate: null, flagged: false, raw: '' }
    const box = this.lastVehicleBoxes.length > 0 ? this.biggestVehicleBox() : null
    const result = await readPlate(video, box).catch(() => ({ plate: null as string | null, confidence: 0, simulated: false, raw: '' }))
    // watchlist matches on the regexed plate OR any raw OCR fragment
    const wl = useWatchlistStore.getState()
    const hit = wl.match(result.plate ?? undefined) ?? wl.match(result.raw)
    const readLabel = result.plate ?? (hit ? hit.plate : null)
    if (box && readLabel) {
      this.plateTag = { text: readLabel, box, until: Date.now() + 6000 }
    }
    const event = await this.createEvent('manual', {
      title: hit
        ? `🚨 WATCHLIST HIT — fragment "${result.raw.split(/\s+/)[0] || result.raw}" matched alert "${hit.plate}"`
        : readLabel
          ? `Plate scan: ${readLabel}`
          : 'Plate scan: not readable at current resolution',
      confidence: readLabel ? Math.max(0.5, result.confidence) : 0.4,
      severity: hit ? 'critical' : 'low',
      details: {
        plateRaw: result.raw.slice(0, 40),
        ...(hit ? { watchMatch: hit.plate, watchNote: hit.note || 'on alert list' } : {}),
      },
      thumbnail: this.captureThumbnail(),
    })
    if (hit) useWatchlistStore.getState().recordMatch(event.id)
    return { plate: readLabel, flagged: !!hit, raw: result.raw }
  }

  // ── overlay rendering ─────────────────────────────────────────────────────

  private drawOverlay(boxes: DetectionBox[], now: number) {
    const canvas = this.overlay
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0) return
    if (canvas.width !== Math.round(rect.width * dpr)) {
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const W = canvas.width
    const H = canvas.height
    ctx.font = `${Math.max(11, Math.round(12 * dpr))}px system-ui, sans-serif`

    // attach the last-read plate to the vehicle box it belongs to
    if (this.plateTag && now < this.plateTag.until) {
      let best: DetectionBox | null = null
      let bestIou = 0.15
      for (const b of boxes) {
        const v = iou([b.x, b.y, b.w, b.h], this.plateTag.box)
        if (v > bestIou) {
          bestIou = v
          best = b
        }
      }
      if (best) best.plate = this.plateTag.text
    } else if (this.plateTag) {
      this.plateTag = null
    }

    for (const b of boxes) {
      const x = b.x * W
      const y = b.y * H
      const w = b.w * W
      const h = b.h * H
      ctx.strokeStyle = b.color
      ctx.lineWidth = 2 * dpr
      ctx.strokeRect(x, y, w, h)
      const lines: string[] = [`${b.label} ${Math.round(b.score * 100)}%`]
      if (b.plate) lines.push(`Plate: ${b.plate}`)
      ctx.font = `${Math.max(11, Math.round(12 * dpr))}px system-ui, sans-serif`
      const lineHeight = 16 * dpr
      let maxW = 0
      for (const line of lines) maxW = Math.max(maxW, ctx.measureText(line).width)
      const blockH = lineHeight * lines.length
      const ly = y > blockH ? y - blockH : y + h
      ctx.fillStyle = b.color
      ctx.globalAlpha = 0.85
      ctx.fillRect(x, ly, maxW + 8 * dpr, blockH)
      ctx.globalAlpha = 1
      ctx.fillStyle = '#0b0f17'
      lines.forEach((line, idx) => {
        ctx.fillText(line, x + 4 * dpr, ly + (idx + 0.8) * lineHeight)
      })
    }

    // hazard boxes (pothole / waterlogging) — same rectangle style
    this.hazardBoxes = this.hazardBoxes.filter((h) => h.until > now)
    for (const hz of this.hazardBoxes) {
      const x = hz.box.x * W
      const y = hz.box.y * H
      const w = hz.box.w * W
      const h = hz.box.h * H
      ctx.strokeStyle = hz.color
      ctx.lineWidth = 2.5 * dpr
      ctx.setLineDash([6 * dpr, 4 * dpr])
      ctx.strokeRect(x, y, w, h)
      ctx.setLineDash([])
      const label = `${hz.label} ${Math.round(hz.conf * 100)}%`
      ctx.font = `700 ${Math.max(11, Math.round(12 * dpr))}px system-ui, sans-serif`
      const tw = ctx.measureText(label).width + 8 * dpr
      const th = 16 * dpr
      const ly = y > th ? y - th : y + h
      ctx.fillStyle = hz.color
      ctx.globalAlpha = 0.9
      ctx.fillRect(x, ly, tw, th)
      ctx.globalAlpha = 1
      ctx.fillStyle = '#0b0f17'
      ctx.fillText(label, x + 4 * dpr, ly + 12 * dpr)
    }
  }
}

export const engine = new SensingEngine()
