import { createWorker, type Worker } from 'tesseract.js'

/**
 * Number-plate OCR tuned for Indian plates:
 *  1. locate the high-edge text band inside the vehicle crop (the plate),
 *  2. preprocess (grayscale + contrast), upscale,
 *  3. OCR with a restricted alphabet in several segmentation modes,
 *  4. fix character confusion using the Indian plate layout
 *     (2 letters, 1-2 digits, 1-3 letters, 3-4 digits) — e.g. a misread
 *     "UPI6AB1234" becomes "UP16AB1234" because position 3 must be a digit.
 * Runs fully locally — worker + model are vendored into /public when the
 * vendor script has been run, with CDN fallback otherwise.
 */

let vendorStatus: { tesseract?: boolean } = {}
try {
  vendorStatus = await fetch('/vendor-status.json').then((r) => r.json())
} catch {
  /* dev fallback below */
}

let workerPromise: Promise<Worker> | null = null

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const opts: Record<string, unknown> = { logger: () => {} }
      if (vendorStatus.tesseract) {
        opts.workerPath = '/tesseract/worker.min.js'
        opts.corePath = '/tesseract/core'
        opts.langPath = '/tesseract/lang'
        opts.gzip = false
      }
      const worker = await createWorker('eng', 1, opts)
      await worker.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
        tessedit_pageseg_mode: '6' as never, // PSM.SINGLE_BLOCK
      })
      return worker
    })()
  }
  return workerPromise
}

export interface PlateResult {
  plate: string | null
  confidence: number
  simulated: boolean
  raw: string
}

const PLATE_RES = [
  /[A-Z]{2}\s?-?[0-9]{1,2}\s?-?[A-Z]{0,3}\s?-?[0-9]{3,4}/,
  /[A-Z]{2}[0-9]{6,8}/,
]

// ── Indian-format position-aware correction ─────────────────────────────────

const DIGIT_AS_LETTER: Record<string, string> = { '0': 'O', '1': 'I', '5': 'S', '8': 'B', '2': 'Z', '6': 'G' }
const LETTER_AS_DIGIT: Record<string, string> = { O: '0', I: '1', S: '5', B: '8', Z: '2', G: '6', D: '0', Q: '0' }

/** slot layouts of real Indian registration formats: [letters, digits, letters, digits] */
const TEMPLATES: [number, number, number, number][] = [
  [2, 2, 2, 4], // current private: UP 16 AB 1234
  [2, 1, 2, 4], // older private
  [2, 2, 3, 4], // 3-letter series
  [2, 1, 3, 4],
]

function fitTemplate(s: string, t: [number, number, number, number]): { out: string; score: number } | null {
  const total = t[0] + t[1] + t[2] + t[3]
  if (s.length !== total) return null
  let score = 0
  let out = ''
  let idx = 0
  const slots: [number, 'L' | 'D'][] = [
    [t[0], 'L'],
    [t[1], 'D'],
    [t[2], 'L'],
    [t[3], 'D'],
  ]
  for (const [count, kind] of slots) {
    for (let k = 0; k < count; k++, idx++) {
      const c = s[idx]
      const isDigit = c >= '0' && c <= '9'
      if (kind === 'L') {
        if (!isDigit) {
          out += c
          score += 1
        } else {
          const m = DIGIT_AS_LETTER[c]
          if (!m) return null
          out += m
          score += 0.5
        }
      } else {
        if (isDigit) {
          out += c
          score += 1
        } else {
          const m = LETTER_AS_DIGIT[c]
          if (!m) return null
          out += m
          score += 0.5
        }
      }
    }
  }
  return { out, score }
}

/** Coerce a raw OCR read into the Indian plate layout. Returns null when implausible. */
export function fixIndianPlate(raw: string): string | null {
  const s = raw.replace(/[^A-Z0-9]/g, '')
  if (s.length < 8 || s.length > 11) return null
  let best: { out: string; score: number } | null = null
  for (const t of TEMPLATES) {
    const f = fitTemplate(s, t)
    if (f && (!best || f.score > best.score)) best = f
  }
  // accept when at least half the characters sit naturally in their slots
  return best && best.score >= s.length * 0.5 ? best.out : null
}

function plateFromRaw(raw: string): string | null {
  let m: RegExpMatchArray | null = null
  for (const re of PLATE_RES) {
    m = raw.match(re)
    if (m) break
  }
  if (!m) return null
  const matched = m[0].replace(/\s+/g, '')
  return fixIndianPlate(matched) ?? matched
}

async function ocrCanvas(worker: Worker, c: HTMLCanvasElement, psm: string): Promise<{ raw: string; conf: number }> {
  await worker.setParameters({ tessedit_pageseg_mode: psm as never })
  const { data } = await worker.recognize(c)
  const raw = (data.text ?? '').toUpperCase().replace(/[^A-Z0-9\s-]/g, ' ').trim()
  return { raw, conf: data.confidence ?? 0 }
}

/**
 * Attempt to read a plate from the current video frame. With `box` (a
 * detected vehicle, normalized coords) it localizes the high-contrast text
 * band inside the vehicle crop. Without a box (webcam mode: a held-up plate,
 * no car) it works on the centre of the frame.
 */
export async function readPlate(
  video: HTMLVideoElement,
  box?: [number, number, number, number] | null,
): Promise<PlateResult> {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) return { plate: null, confidence: 0, simulated: false, raw: '' }

  let sx: number, sy: number, sw: number, sh: number
  if (box) {
    const [bx, by, bw, bh] = box
    sx = Math.max(0, (bx + bw * 0.05) * vw)
    sy = Math.min(vh - 8, (by + bh * 0.45) * vh)
    sw = Math.min(vw - sx, bw * 0.9 * vw)
    sh = Math.max(8, Math.min(vh - sy, bh * 0.55 * vh))
  } else {
    // webcam mode: centre region, slightly below middle
    sx = vw * 0.18
    sy = vh * 0.28
    sw = vw * 0.64
    sh = vh * 0.5
  }

  const scale = Math.min(5, Math.max(2.5, 520 / sw))
  const W = Math.round(sw * scale)
  const H = Math.round(sh * scale)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return { plate: null, confidence: 0, simulated: false, raw: '' }

  const worker = await getWorker()

  // draw the preprocessed crop once to locate the text band by edge energy
  ctx.filter = 'grayscale(1) contrast(1.7) brightness(1.1)'
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, W, H)
  ctx.filter = 'none'
  const img = ctx.getImageData(0, 0, W, H).data
  const rowEdge = new Float32Array(H)
  for (let y = 1; y < H - 1; y++) {
    let sum = 0
    for (let x = 1; x < W - 1; x++) {
      const i = (y * W + x) * 4
      const l1 = 0.299 * img[i + 4] + 0.587 * img[i + 5] + 0.114 * img[i + 6]
      const l0 = 0.299 * img[i - 4] + 0.587 * img[i - 3] + 0.114 * img[i - 2]
      const lu = 0.299 * img[i + W * 4] + 0.587 * img[i + W * 4 + 1] + 0.114 * img[i + W * 4 + 2]
      const ld = 0.299 * img[i - W * 4] + 0.587 * img[i - W * 4 + 1] + 0.114 * img[i - W * 4 + 2]
      sum += Math.abs(l1 - l0) + Math.abs(lu - ld)
    }
    rowEdge[y] = sum
  }
  // best band of ~40% crop height — that's where plate text lives
  const bandH = Math.max(8, Math.round(H * 0.4))
  let bestY = 0
  let bestSum = -1
  let running = 0
  for (let y = 0; y < bandH; y++) running += rowEdge[y]
  for (let y0 = 0; y0 + bandH < H; y0++) {
    if (running > bestSum) {
      bestSum = running
      bestY = y0
    }
    running += (rowEdge[y0 + bandH] ?? 0) - rowEdge[y0]
  }
  const pad = Math.round(H * 0.06)
  const bandY = Math.max(0, bestY - pad)
  const bandH2 = Math.min(H - bandY, bandH + pad * 2)

  // prepare the localized band, upscaled 2x
  const bandCanvas = document.createElement('canvas')
  bandCanvas.width = W
  bandCanvas.height = bandH2 * 2
  const bandCtx = bandCanvas.getContext('2d', { willReadFrequently: true })
  if (!bandCtx) return { plate: null, confidence: 0, simulated: false, raw: '' }
  bandCtx.filter = 'grayscale(1) contrast(1.8) brightness(1.12)'
  bandCtx.drawImage(canvas, 0, bandY, W, bandH2, 0, 0, W, bandH2 * 2)
  bandCtx.filter = 'none'

  let best: PlateResult = { plate: null, confidence: 0, simulated: false, raw: '' }

  async function consider(raw: string, conf: number): Promise<boolean> {
    const fixed = plateFromRaw(raw) ?? (raw ? fixIndianPlate(raw) : null)
    if (fixed) {
      if (!best.plate || conf / 100 > best.confidence) {
        best = { plate: fixed, confidence: conf / 100, simulated: false, raw }
      }
      if (best.confidence > 0.55) return true
    } else if (raw.length > best.raw.length) {
      best = { plate: null, confidence: conf / 100, simulated: false, raw }
    }
    return false
  }

  // ── advanced tier: YOLO11 plate localization + TrOCR reading ──────────────
  try {
    const hf = await import('./hf')
    const [plateDet, trocr] = await Promise.all([hf.loadPlateDetector(), hf.loadTrocr()])
    if (plateDet) {
      const pb = await hf.hfDetectPlateCrop(canvas)
      if (pb) {
        // tight plate crop (upscaled, slight padding) — much better OCR input
        const px0 = Math.max(0, pb.xmin * W - W * 0.02)
        const py0 = Math.max(0, pb.ymin * H - H * 0.08)
        const pw = Math.min(W - px0, (pb.xmax - pb.xmin) * W + W * 0.04)
        const ph = Math.min(H - py0, (pb.ymax - pb.ymin) * H + H * 0.16)
        bandCtx.filter = 'grayscale(1) contrast(1.8) brightness(1.12)'
        bandCtx.drawImage(canvas, px0, py0, pw, ph, 0, 0, W, bandH2 * 2)
        bandCtx.filter = 'none'
      }
    }
    if (trocr) {
      const txt = await hf.hfReadText(bandCanvas)
      if (txt && (await consider(txt, 0.92))) {
        return { plate: best.plate, confidence: best.confidence, simulated: false, raw: best.raw }
      }
    }
  } catch (e) {
    console.warn('[plate] HF tier skipped:', e instanceof Error ? e.message : e)
  }

  // ── Tesseract tier: passes on the band, then the full crop ────────────────
  let p = await ocrCanvas(worker, bandCanvas, '7')
  if (await consider(p.raw, p.conf)) return { plate: best.plate, confidence: best.confidence, simulated: false, raw: best.raw }
  p = await ocrCanvas(worker, bandCanvas, '6')
  if (await consider(p.raw, p.conf)) return { plate: best.plate, confidence: best.confidence, simulated: false, raw: best.raw }

  // pass 2: full crop, preprocessed
  ctx.filter = 'grayscale(1) contrast(1.7) brightness(1.1)'
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, W, H)
  ctx.filter = 'none'
  p = await ocrCanvas(worker, canvas, '6')
  if (await consider(p.raw, p.conf)) return { plate: best.plate, confidence: best.confidence, simulated: false, raw: best.raw }

  // pass 3: full crop, plain
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, W, H)
  p = await ocrCanvas(worker, canvas, '6')
  await consider(p.raw, p.conf)

  return { plate: best.plate, confidence: best.confidence, simulated: false, raw: best.raw }
}
