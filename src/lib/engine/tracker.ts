/**
 * Minimal IoU-based tracker. Matches detections between consecutive frames to
 * (a) count *unique* vehicles and (b) estimate relative speed from how far
 * tracked boxes travel per second. This is a demo-grade tracker — it does not
 * need to survive occlusion well.
 */
export interface Track {
  id: number
  cls: string
  box: [number, number, number, number] // x, y, w, h (normalized 0..1)
  cx: number
  cy: number
  hits: number
  lastSeen: number
  history: { t: number; cx: number; cy: number }[]
}

export function iou(a: [number, number, number, number], b: [number, number, number, number]): number {
  const [ax, ay, aw, ah] = a
  const [bx, by, bw, bh] = b
  const x1 = Math.max(ax, bx)
  const y1 = Math.max(ay, by)
  const x2 = Math.min(ax + aw, bx + bw)
  const y2 = Math.min(ay + ah, by + bh)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = aw * ah + bw * bh - inter
  return union > 0 ? inter / union : 0
}

export class Tracker {
  tracks: Track[] = []
  private nextId = 1
  private unique = new Map<string, Set<number>>()

  /** Match new detections to existing tracks; spawn tracks for new ones. */
  update(dets: { cls: string; box: [number, number, number, number]; score: number }[], now: number) {
    const usedTracks = new Set<number>()
    for (const d of dets) {
      let best: Track | null = null
      let bestIou = 0.25
      for (const t of this.tracks) {
        if (usedTracks.has(t.id) || t.cls !== d.cls) continue
        const v = iou(t.box, d.box)
        if (v > bestIou) {
          bestIou = v
          best = t
        }
      }
      if (best) {
        usedTracks.add(best.id)
        best.box = d.box
        best.cx = d.box[0] + d.box[2] / 2
        best.cy = d.box[1] + d.box[3] / 2
        best.hits++
        best.lastSeen = now
        best.history.push({ t: now, cx: best.cx, cy: best.cy })
        if (best.history.length > 20) best.history.shift()
        const set = this.unique.get(d.cls) ?? new Set<number>()
        set.add(best.id)
        this.unique.set(d.cls, set)
      } else {
        const id = this.nextId++
        const cx = d.box[0] + d.box[2] / 2
        const cy = d.box[1] + d.box[3] / 2
        this.tracks.push({
          id, cls: d.cls, box: d.box, cx, cy, hits: 1, lastSeen: now,
          history: [{ t: now, cx, cy }],
        })
      }
    }
    // prune stale tracks (not seen for 1.5s)
    this.tracks = this.tracks.filter((t) => now - t.lastSeen < 1500)
  }

  uniqueCounts(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const [cls, set] of this.unique) out[cls] = set.size
    return out
  }

  /**
   * Mean tracked speed as a fraction of frame height per second — a proxy for
   * how fast the scene moves relative to the camera. High value = traffic
   * flowing past the bus; near zero with many vehicles = congestion.
   */
  avgSpeedProxy(now: number): number {
    let sum = 0
    let n = 0
    for (const t of this.tracks) {
      if (t.history.length < 2) continue
      const oldest = t.history.find((h) => now - h.t <= 1000) ?? t.history[0]
      const dt = (now - oldest.t) / 1000
      if (dt <= 0.05) continue
      const d = Math.hypot(t.cx - oldest.cx, t.cy - oldest.cy)
      sum += d / dt
      n++
    }
    return n > 0 ? sum / n : 0
  }

  reset() {
    this.tracks = []
    this.unique.clear()
  }
}
