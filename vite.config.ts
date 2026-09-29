import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))

/**
 * onnxruntime-web dynamically imports its `.mjs` runtime files with a
 * `?import` query (e.g. `/ort/ort-wasm-simd-threaded.asyncify.mjs?import`).
 * Vite chokes on `?import` for files served from `public/` (500), so we serve
 * the `/ort/` directory ourselves with correct content types.
 */
function ortStatic() {
  const ortDir = path.join(root, 'public', 'ort')
  return {
    name: 'ort-static-dev',
    configureServer(server: { middlewares: { use: (fn: (req: any, res: any, next: () => void) => void) => void } }) {
      server.middlewares.use((req: any, res: any, next: () => void) => {
        const url = (req.url || '').split('?')[0]
        if (!url.startsWith('/ort/')) return next()
        const file = path.join(ortDir, url.slice('/ort/'.length))
        if (!file.startsWith(ortDir) || !fs.existsSync(file)) return next()
        res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
        fs.createReadStream(file).pipe(res)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), ortStatic()],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    chunkSizeWarningLimit: 2500,
  },
})
