/**
 * Downloads/copies third-party AI assets into `public/` so the demo runs
 * fully offline. Safe to re-run — existing files are skipped unless --force.
 *
 *  1. COCO-SSD (lite_mobilenet_v2) TFJS model  → public/models/ssdlite_mobilenet_v2/
 *  2. Tesseract.js worker + wasm cores         → public/tesseract/core/
 *  3. English traineddata (tessdata_fast)      → public/tesseract/lang/eng.traineddata
 *  4. Sample road video (optional)             → public/samples/road.mp4
 */
import { mkdirSync, copyFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const pub = path.join(root, 'public')
const force = process.argv.includes('--force')
const log = (m) => console.log(`[vendor] ${m}`)

async function downloadTo(url, dest) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await writeFile(dest, buf)
  return buf.length
}

async function existsRemote(url) {
  try {
    const r = await fetch(url, { method: 'HEAD' })
    return r.ok
  } catch {
    return false
  }
}

// ── 1. COCO-SSD models (accurate v2 + lite fallback) ────────────────────────
const MODEL_BASES = [
  ['https://storage.googleapis.com/tfjs-models/savedmodel/ssd_mobilenet_v2', 'ssd_mobilenet_v2'],
  ['https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2', 'ssdlite_mobilenet_v2'],
]
async function vendorCocoSsd() {
  for (const [base, name] of MODEL_BASES) {
    const dir = path.join(pub, 'models', name)
    mkdirSync(dir, { recursive: true })
    const modelJsonPath = path.join(dir, 'model.json')
    if (!force && existsSync(modelJsonPath)) {
      log(`coco-ssd ${name}: already vendored`)
      continue
    }
    const n = await downloadTo(`${base}/model.json`, modelJsonPath)
    log(`coco-ssd ${name}: model.json (${(n / 1024).toFixed(0)} KB)`)
    const modelJson = JSON.parse(await readFile(modelJsonPath, 'utf8'))
    const shards = new Set()
    for (const m of modelJson.weightsManifest ?? [])
      for (const p of m.paths ?? []) shards.add(p)
    for (const s of shards) {
      const bytes = await downloadTo(`${base}/${s}`, path.join(dir, s))
      log(`coco-ssd ${name}: ${s} (${(bytes / 1024 / 1024).toFixed(1)} MB)`)
    }
  }
}

// ── 2+3. Tesseract worker / cores / traineddata ─────────────────────────────
const HF_BASE = 'https://huggingface.co'
const HF_MODELS = {
  'Xenova/detr-resnet-50': [
    'config.json',
    'preprocessor_config.json',
    'onnx/model_fp16.onnx',
    'onnx/model_quantized.onnx',
  ],
  'Xenova/trocr-small-printed': [
    'config.json',
    'generation_config.json',
    'preprocessor_config.json',
    'tokenizer_config.json',
    'tokenizer.json',
    'special_tokens_map.json',
    'sentencepiece.bpe.model',
    'onnx/encoder_model_quantized.onnx',
    'onnx/decoder_model_merged_quantized.onnx',
  ],
  'morsetechlab/yolov11-license-plate-detection': [
    'license-plate-finetune-v1n.onnx',
  ],
}
const HF_OPTIONAL = ['generation_config.json', 'sentencepiece.bpe.model', 'merges.txt', 'vocab.json', 'special_tokens_map.json']

async function vendorHfModels() {
  for (const [repo, files] of Object.entries(HF_MODELS)) {
    for (const f of files) {
      const rel = path.join('hf', repo, f)
      const dst = path.join(pub, 'models', rel)
      if (!force && existsSync(dst)) continue
      mkdirSync(path.dirname(dst), { recursive: true })
      try {
        const n = await downloadTo(`${HF_BASE}/${repo}/resolve/main/${f}`, dst)
        log(`hf: ${repo}/${f} (${(n / 1048576).toFixed(1)} MB)`)
      } catch (e) {
        if (HF_OPTIONAL.some((o) => f.endsWith(o))) log(`hf: ${repo}/${f} unavailable — skipped`)
        else log(`hf: ${repo}/${f} FAILED (${e.message})`)
      }
    }
  }
  // onnxruntime-web wasm files for fully-local inference
  const ortDist = path.join(root, 'node_modules', 'onnxruntime-web', 'dist')
  if (existsSync(ortDist)) {
    const ortDst = path.join(pub, 'ort')
    mkdirSync(ortDst, { recursive: true })
    for (const f of readdirSync(ortDist)) {
      if (f.endsWith('.wasm') || f.endsWith('.mjs')) {
        copyFileSync(path.join(ortDist, f), path.join(ortDst, f))
      }
    }
    log('hf: onnxruntime-web wasm copied to public/ort/')
  }
}

// ── 2+3b. Tesseract worker / cores / traineddata ────────────────────────────
async function vendorTesseract() {
  const coreDir = path.join(pub, 'tesseract', 'core')
  const langDir = path.join(pub, 'tesseract', 'lang')
  mkdirSync(coreDir, { recursive: true })
  mkdirSync(langDir, { recursive: true })

  const workerSrc = path.join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js')
  const workerDst = path.join(pub, 'tesseract', 'worker.min.js')
  if (force || !existsSync(workerDst)) {
    copyFileSync(workerSrc, workerDst)
    log('tesseract: worker.min.js copied')
  } else log('tesseract: worker already vendored')

  const coreSrc = path.join(root, 'node_modules', 'tesseract.js-core')
  const cores = [
    'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm',
    'tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm',
  ]
  for (const f of cores) {
    const dst = path.join(coreDir, f)
    if (force || !existsSync(dst)) {
      copyFileSync(path.join(coreSrc, f), dst)
      log(`tesseract: ${f} copied`)
    }
  }

  const langDst = path.join(langDir, 'eng.traineddata')
  if (force || !existsSync(langDst)) {
    const urls = [
      'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/eng.traineddata',
      'https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata',
    ]
    let done = false
    for (const u of urls) {
      try {
        const n = await downloadTo(u, langDst)
        log(`tesseract: eng.traineddata (${(n / 1024 / 1024).toFixed(1)} MB)`)
        done = true
        break
      } catch (e) {
        log(`tesseract: ${u} failed (${e.message})`)
      }
    }
    if (!done) log('tesseract: WARNING — traineddata not downloaded, OCR will use CDN')
  } else log('tesseract: traineddata already vendored')
}

// ── 4. Sample road video (best effort) ──────────────────────────────────────
const SAMPLE_CANDIDATES = [
  ['https://videos.pexels.com/video-files/16177622/16177622-hd_1920_1080_25fps.mp4', 'bengaluru.mp4', 'https://www.pexels.com/'],
  ['https://videos.pexels.com/video-files/30350783/13009508_1920_1080_30fps.mp4', 'mumbai.mp4', 'https://www.pexels.com/'],
  ['https://videos.pexels.com/video-files/34218230/14505598_1280_720_25fps.mp4', 'potholes.mp4', 'https://www.pexels.com/'],
  ['https://videos.pexels.com/video-files/37051860/15696046_1920_1080_30fps.mp4', 'bull.mp4', 'https://www.pexels.com/'],
]
async function vendorSampleVideo() {
  const dir = path.join(pub, 'samples')
  mkdirSync(dir, { recursive: true })
  for (const [u, name, referer] of SAMPLE_CANDIDATES) {
    const dst = path.join(dir, name)
    if (!force && existsSync(dst)) {
      log(`sample video: ${name} already vendored`)
      continue
    }
    try {
      const res = await fetch(u, { headers: referer ? { referer } : {} })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const buf = Buffer.from(await res.arrayBuffer())
      await writeFile(dst, buf)
      log(`sample video: ${name} (${(buf.length / 1024 / 1024).toFixed(1)} MB) from ${u}`)
    } catch (e) {
      log(`sample video: ${u} failed (${e.message})`)
    }
  }
}

// ── offline marker used by the app to decide local vs CDN loading ───────────
async function writeMarker() {
  const marker = {
    cocoSsd: existsSync(path.join(pub, 'models', 'ssd_mobilenet_v2', 'model.json')),
    detr: existsSync(path.join(pub, 'models', 'hf', 'Xenova', 'detr-resnet-50', 'config.json')),
    trocr: existsSync(path.join(pub, 'models', 'hf', 'Xenova', 'trocr-small-printed', 'config.json')),
    tesseract: existsSync(path.join(pub, 'tesseract', 'worker.min.js')),
    plateOnnx: existsSync(path.join(pub, 'models', 'hf', 'morsetechlab', 'yolov11-license-plate-detection', 'license-plate-finetune-v1n.onnx')),
  }
  writeFileSync(path.join(pub, 'vendor-status.json'), JSON.stringify(marker))
  log(`status: ${JSON.stringify(marker)}`)
}

const steps = [vendorCocoSsd, vendorTesseract, vendorHfModels, vendorSampleVideo, writeMarker]
for (const s of steps) {
  try {
    await s()
  } catch (e) {
    log(`step failed: ${e.message}`)
  }
}
log('done')
