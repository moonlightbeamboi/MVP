/**
 * Lightweight classical-CV heuristics that run on a downscaled frame.
 * These complement the neural detector for road-surface conditions, which
 * COCO-SSD does not cover. They are deliberately simple (pixel statistics)
 * — honest, tunable, and fast enough to run on a laptop CPU.
 */

export interface RoiBox {
  /** bounding box normalized to the full video frame (0..1) */
  x: number
  y: number
  w: number
  h: number
}

export interface RoiStats {
  darkRatio: number
  /** fraction of pixels much darker than the scene mean — a localized hole */
  darkRelRatio: number
  lumaMean: number
  edgeMean: number
  blueRatio: number
  glareRatio: number
  /** smooth warm-toned pool: signature of a water-filled pothole */
  warmSmoothRatio: number
  /** where the dark patch / water pool is, so the UI can box it */
  darkBox: RoiBox | null
  poolBox: RoiBox | null
}

function makeCtx(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D canvas unavailable')
  return [c, ctx]
}

const [roiCanvas, roiCtx] = makeCtx(96, 96)

/**
 * Analyse the lower-centre part of the frame (the road immediately ahead).
 * `video` is the live <video> element.
 */
export function analyseRoadRoi(video: HTMLVideoElement): RoiStats | null {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) return null
  // source rect: bottom 45%, centre 70%
  const sx = vw * 0.15
  const sw = vw * 0.7
  const sy = vh * 0.55
  const sh = vh * 0.45
  roiCtx.drawImage(video, sx, sy, sw, sh, 0, 0, 96, 96)
  const { data } = roiCtx.getImageData(0, 0, 96, 96)

  let dark = 0
  let blue = 0
  let glare = 0
  let warmSmooth = 0
  let lumaSum = 0
  const lumas = new Float32Array(96 * 96)
  const total = 96 * 96

  for (let i = 0; i < total; i++) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    const luma = 0.299 * r + 0.587 * g + 0.114 * b
    lumas[i] = luma
    lumaSum += luma
    if (luma < 55) dark++
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const sat = max === 0 ? 0 : (max - min) / max
    // blue sheen: blue-dominant, moderately saturated, not too dark
    if (b > r + 18 && b > g + 8 && sat > 0.28 && max > 60 && luma > 45) blue++
    // specular glare: very bright, low saturation
    if (luma > 225 && sat < 0.16) glare++
  }

  // water-filled pothole signature: large smooth (low local gradient),
  // mid-bright, warm/murky-toned region — muddy water pooled in a hole
  for (let y = 1; y < 95; y++) {
    for (let x = 1; x < 95; x++) {
      const i = y * 96 + x
      const g = Math.abs(lumas[i + 1] - lumas[i - 1]) + Math.abs(lumas[i + 96] - lumas[i - 96])
      if (g < 8) {
        const i4 = i * 4
        const r = data[i4]
        const gg = data[i4 + 1]
        const b = data[i4 + 2]
        if (r > b + 6 && r >= gg && lumas[i] > 60 && lumas[i] < 185) warmSmooth++
      }
    }
  }

  // edge energy via simple horizontal+vertical gradient on luma
  let edgeSum = 0
  let edgeN = 0
  for (let y = 1; y < 95; y++) {
    for (let x = 1; x < 95; x++) {
      const i = y * 96 + x
      const gx = Math.abs(lumas[i + 1] - lumas[i - 1])
      const gy = Math.abs(lumas[i + 96] - lumas[i - 96])
      edgeSum += gx + gy
      edgeN++
    }
  }

  const lumaMean = lumaSum / total
  // localized-darkness check on the road *immediately* ahead (bottom half of
  // the ROI): a pothole is a patch clearly darker than its surroundings;
  // shadows spread over a uniformly dark road don't count
  let darkArea = 0
  let darkRel = 0
  let dMinX = 96, dMinY = 96, dMaxX = -1, dMaxY = -1
  let pMinX = 96, pMinY = 96, pMaxX = -1, pMaxY = -1
  for (let y = 48; y < 96; y++) {
    for (let x = 0; x < 96; x++) {
      const i = y * 96 + x
      darkArea++
      if (lumas[i] < lumaMean * 0.55) {
        darkRel++
        if (x < dMinX) dMinX = x
        if (x > dMaxX) dMaxX = x
        if (y < dMinY) dMinY = y
        if (y > dMaxY) dMaxY = y
      }
    }
  }
  // warm-pool bbox (same pixel condition as warmSmooth counting above)
  for (let y = 1; y < 95; y++) {
    for (let x = 1; x < 95; x++) {
      const i = y * 96 + x
      const g = Math.abs(lumas[i + 1] - lumas[i - 1]) + Math.abs(lumas[i + 96] - lumas[i - 96])
      if (g < 8) {
        const i4 = i * 4
        const r = data[i4]
        const gg = data[i4 + 1]
        const b = data[i4 + 2]
        if (r > b + 6 && r >= gg && lumas[i] > 60 && lumas[i] < 185) {
          if (x < pMinX) pMinX = x
          if (x > pMaxX) pMaxX = x
          if (y < pMinY) pMinY = y
          if (y > pMaxY) pMaxY = y
        }
      }
    }
  }

  // map ROI pixel coords (96x96) back to full-frame normalized coords.
  // ROI source: x 15%..85%, y 55%..100% of the frame
  const toFrame = (minX: number, minY: number, maxX: number, maxY: number): RoiBox | null => {
    if (maxX < 0 || maxY < 0) return null
    const FX = 0.15, FW = 0.7, FY = 0.55, FH = 0.45
    const x = FX + (minX / 96) * FW
    const y = FY + (minY / 96) * FH
    return {
      x: +x.toFixed(3),
      y: +y.toFixed(3),
      w: +(((maxX - minX) / 96) * FW).toFixed(3),
      h: +(((maxY - minY) / 96) * FH).toFixed(3),
    }
  }

  return {
    darkRatio: dark / total,
    darkRelRatio: darkArea > 0 ? darkRel / darkArea : 0,
    lumaMean: +lumaMean.toFixed(1),
    blueRatio: blue / total,
    glareRatio: glare / total,
    warmSmoothRatio: warmSmooth / (94 * 94),
    edgeMean: edgeN > 0 ? edgeSum / edgeN : 0,
    darkBox: toFrame(dMinX, dMinY, dMaxX, dMaxY),
    poolBox: toFrame(pMinX, pMinY, pMaxX, pMaxY),
  }
}

export interface PotholeSignal {
  fired: boolean
  confidence: number
  score: number
}

/**
 * Pothole heuristic with two signatures:
 *  1. a *localized* dark patch (relative to scene brightness) with strong
 *     edges — a dry, shadowed hole; a uniformly dark road does NOT fire;
 *  2. a warm smooth pool — murky water filling a pothole (monsoon condition).
 */
export function detectPothole(s: RoiStats, gain: number): PotholeSignal {
  const poolTh = 0.2 * gain
  const poolHit = s.warmSmoothRatio > poolTh

  // localized darkness: a patch covering 6–45% of the ROI and clearly darker
  // than the mean — whole-scene darkness (shadowed smooth roads) is excluded
  const darkRelTh = 0.06 * gain
  const darkHit =
    s.darkRelRatio > darkRelTh &&
    s.darkRelRatio < 0.45 &&
    s.edgeMean > 14 * gain

  if (darkHit || poolHit) {
    const confidence = poolHit
      ? Math.min(0.95, 0.55 + (s.warmSmoothRatio - poolTh) * 1.8)
      : Math.min(0.93, 0.45 + s.darkRelRatio * 1.6)
    return { fired: true, confidence, score: poolHit ? s.warmSmoothRatio / poolTh : s.darkRelRatio / darkRelTh }
  }
  return {
    fired: false,
    score: Math.max(s.darkRelRatio / darkRelTh, s.warmSmoothRatio / Math.max(0.05, poolTh)),
    confidence: 0.3,
  }
}

export interface WaterSignal {
  fired: boolean
  confidence: number
}

/**
 * Waterlogging heuristic: standing water shows as blue-dominant sheen (clean
 * water) or a large murky smooth pool (monsoon mud water) in the road ROI.
 */
export function detectWaterlogging(s: RoiStats, gain: number): WaterSignal {
  const blueTh = 0.05 * gain
  const blueHit = s.blueRatio > blueTh && s.blueRatio + s.glareRatio * 0.5 > blueTh * 1.4
  const poolHit = s.warmSmoothRatio > 0.25 * gain
  return {
    fired: blueHit || poolHit,
    confidence: blueHit
      ? Math.min(0.94, 0.5 + (s.blueRatio - blueTh) * 3)
      : poolHit
        ? Math.min(0.9, 0.5 + (s.warmSmoothRatio - 0.25 * gain) * 1.6)
        : 0.3,
  }
}

/** Map a density index (0..100) to a human label. */
export function densityLabel(index: number): { label: string; level: 'low' | 'moderate' | 'heavy' } {
  if (index < 30) return { label: 'Free Flow', level: 'low' }
  if (index < 60) return { label: 'Moderate', level: 'moderate' }
  return { label: 'Heavy / Congested', level: 'heavy' }
}
