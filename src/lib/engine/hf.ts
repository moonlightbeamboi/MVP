import { env, pipeline } from '@huggingface/transformers'
import * as ort from 'onnxruntime-web'

// serve the ORT runtime from /ort/ (vendored; the vite dev middleware handles
// the ?import dynamic-import quirk). One setting covers both ORT instances.
ort.env.wasm.wasmPaths = '/ort/'
ort.env.wasm.numThreads = 1

/**
 * Hugging Face Transformers.js pipelines — the "advanced" tier of the
 * detection stack, all running locally in the browser:
 *  - object detection : DETR-ResNet-50 (COCO, Apache-2.0)
 *  - plate detection  : YOLOv11-n fine-tuned on license plates (AGPL-3.0)
 *  - plate reading    : TrOCR-small-printed (MIT)
 * All model weights are vendored under /models/hf/ for offline demos.
 */

env.allowLocalModels = true
env.localModelPath = '/models/hf/'
// vendored ORT runtime; remote downloads stay disabled so demos never stall
env.allowRemoteModels = false
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.wasmPaths = '/ort/'
  env.backends.onnx.wasm.numThreads = 1 // no cross-origin isolation on localhost demos
  env.backends.onnx.wasm.proxy = false // run on the main thread — the proxy worker can't resolve vendored wasm
}

export interface HfBox {
  /** normalized 0..1, xyxy */
  xmin: number
  ymin: number
  xmax: number
  ymax: number
  label: string
  score: number
}

let device: 'webgpu' | 'wasm' = 'wasm'
let detrPipe: ((input: HTMLCanvasElement, opts?: object) => Promise<Array<{ label: string; score: number; box: { xmin: number; ymin: number; xmax: number; ymax: number } }>>) | null = null
let detrLoading: Promise<boolean> | null = null
let plateSession: import('onnxruntime-web').InferenceSession | null = null
let plateLoading: Promise<boolean> | null = null
let trocrPipe: ((input: HTMLCanvasElement, opts?: object) => Promise<Array<{ generated_text: string }>>) | null = null
let trocrLoading: Promise<boolean> | null = null

async function tryPipeline(
  task: 'object-detection' | 'image-to-text',
  model: string,
  device: 'webgpu' | 'wasm',
  dtype: string,
): Promise<unknown | null> {
  try {
    return await pipeline(task, model, { device, dtype } as never)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    ;(window as unknown as Record<string, unknown>).__hfError = `${model}/${device}/${dtype}: ${msg}`
    console.warn(`[hf] ${task} ${model} on ${device}/${dtype} failed:`, msg)
    return null
  }
}

/** Load the DETR detector. WebGPU(fp16) first, WASM(q8) as fallback. */
export async function loadDetr(): Promise<boolean> {
  if (detrPipe) return true
  if (detrLoading) return detrLoading
  detrLoading = (async () => {
    let p = await tryPipeline('object-detection', 'Xenova/detr-resnet-50', 'webgpu', 'fp16')
    if (p) device = 'webgpu'
    if (!p) p = await tryPipeline('object-detection', 'Xenova/detr-resnet-50', 'wasm', 'q8')
    if (!p) return false
    detrPipe = p as unknown as typeof detrPipe
    console.info('[hf] DETR ready on', device)
    return true
  })()
  return detrLoading
}

/** Load the license-plate detector: YOLOv11-n fine-tuned on plates (ONNX). */
export async function loadPlateDetector(): Promise<boolean> {
  if (plateSession) return true
  if (plateLoading) return plateLoading
  plateLoading = (async () => {
    try {
      plateSession = await ort.InferenceSession.create(
        '/models/hf/morsetechlab/yolov11-license-plate-detection/license-plate-finetune-v1n.onnx',
        { executionProviders: ['wasm'] },
      )
      return true
    } catch (e) {
      ;(window as unknown as Record<string, unknown>).__plateError = e instanceof Error ? e.message : String(e)
      console.warn('[hf] plate detector load failed:', e instanceof Error ? e.message : e)
      return false
    }
  })()
  return plateLoading
}

/** Load TrOCR-small-printed for plate text. */
export async function loadTrocr(): Promise<boolean> {
  if (trocrPipe) return true
  if (trocrLoading) return trocrLoading
  trocrLoading = (async () => {
    const p = await tryPipeline('image-to-text', 'Xenova/trocr-small-printed', 'wasm', 'q8')
    if (p) trocrPipe = p as unknown as typeof trocrPipe
    return !!trocrPipe
  })()
  return trocrLoading
}

export function hfDevice() {
  return device
}

/** Run the DETR detector on a canvas; boxes normalized 0..1 (xyxy). */
export async function hfDetect(canvas: HTMLCanvasElement): Promise<HfBox[] | null> {
  if (!detrPipe) return null
  try {
    const out = await detrPipe(canvas, { threshold: 0.4 })
    return out.map((o) => ({
      label: o.label.toLowerCase(),
      score: o.score,
      xmin: o.box.xmin / canvas.width,
      ymin: o.box.ymin / canvas.height,
      xmax: o.box.xmax / canvas.width,
      ymax: o.box.ymax / canvas.height,
    }))
  } catch (e) {
    console.warn('[hf] detect failed:', e)
    return null
  }
}

/**
 * Detect a license plate inside a vehicle crop canvas (coords in the crop's
 * own pixels). Runs YOLOv11-n with letterbox preprocessing + NMS and returns
 * the tightest plate box in the crop's normalized coords, or null.
 */
export async function hfDetectPlateCrop(crop: HTMLCanvasElement): Promise<HfBox | null> {
  if (!plateSession) return null
  const SIZE = 640
  const cw = crop.width
  const ch = crop.height
  if (!cw || !ch) return null
  const scale = Math.min(SIZE / cw, SIZE / ch)
  const rw = Math.max(1, Math.round(cw * scale))
  const rh = Math.max(1, Math.round(ch * scale))
  const dx = (SIZE - rw) / 2
  const dy = (SIZE - rh) / 2

  const letter = document.createElement('canvas')
  letter.width = SIZE
  letter.height = SIZE
  const lctx = letter.getContext('2d', { willReadFrequently: true })
  if (!lctx) return null
  lctx.fillStyle = '#737373'
  lctx.fillRect(0, 0, SIZE, SIZE)
  lctx.drawImage(crop, 0, 0, cw, ch, dx, dy, rw, rh)

  const img = lctx.getImageData(0, 0, SIZE, SIZE).data
  const input = new Float32Array(3 * SIZE * SIZE)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4
      input[y * SIZE + x] = img[i] / 255
      input[SIZE * SIZE + y * SIZE + x] = img[i + 1] / 255
      input[2 * SIZE * SIZE + y * SIZE + x] = img[i + 2] / 255
    }
  }

  try {
    const feeds: Record<string, import('onnxruntime-web').Tensor> = {
      [plateSession.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]),
    }
    const out = await plateSession.run(feeds)
    const t = out[plateSession.outputNames[0]]
    // YOLOv8/11 layout: [1, 5, N] = cx, cy, w, h, score
    const d = t.data as Float32Array
    const n = t.dims[2]
    const cands: { x0: number; y0: number; x1: number; y1: number; s: number }[] = []
    for (let i = 0; i < n; i++) {
      const s = d[4 * n + i]
      if (s < 0.35) continue
      const cx = d[i]
      const cy = d[n + i]
      const w = d[2 * n + i]
      const h = d[3 * n + i]
      cands.push({ x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2, s })
    }
    cands.sort((a, b) => b.s - a.s)
    const keep: typeof cands = []
    for (const c of cands) {
      let ok = true
      for (const k of keep) {
        const ix = Math.max(0, Math.min(c.x1, k.x1) - Math.max(c.x0, k.x0))
        const iy = Math.max(0, Math.min(c.y1, k.y1) - Math.max(c.y0, k.y0))
        if (ix * iy / Math.max(1, (c.x1 - c.x0) * (c.y1 - c.y0), (k.x1 - k.x0) * (k.y1 - k.y0)) > 0.5) {
          ok = false
          break
        }
      }
      if (ok) keep.push(c)
      if (keep.length >= 3) break
    }
    if (keep.length === 0) return null
    const b = keep[0]
    // letterbox coords → crop pixel coords → normalized
    const px = (v: number) => Math.max(0, Math.min(1, (v - dx) / scale / cw))
    const py = (v: number) => Math.max(0, Math.min(1, (v - dy) / scale / ch))
    return {
      label: 'plate',
      score: b.s,
      xmin: px(b.x0),
      ymin: py(b.y0),
      xmax: px(b.x1),
      ymax: py(b.y1),
    }
  } catch {
    return null
  }
}

/** Read text (plate characters) from a tight plate crop with TrOCR. */
export async function hfReadText(crop: HTMLCanvasElement): Promise<string> {
  if (!trocrPipe) return ''
  try {
    const out = await trocrPipe(crop, { max_new_tokens: 16 })
    return (out[0]?.generated_text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  } catch {
    return ''
  }
}
