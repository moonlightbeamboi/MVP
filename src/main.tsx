import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import 'leaflet/dist/leaflet.css'
import './styles.css'
import App from './App'
import { startEventsSync } from './state/eventsStore'
import { getBackend } from './lib/store'
import { busSim } from './lib/gps/busSim'

// dev/demo debugging hook (also handy during the presentation Q&A)
void (async () => {
  const [{ engine }, { useLiveStore }, { useWatchlistStore }] = await Promise.all([
    import('./lib/engine/engine'),
    import('./state/liveStore'),
    import('./state/watchlistStore'),
  ])
  ;(window as unknown as Record<string, unknown>).__urbaneye = { engine, useLiveStore, useWatchlistStore, busSim }
})()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

// ── app boot: connect the data layer and keep the fleet position live ──────
void (async () => {
  await startEventsSync()
  const backend = await getBackend()
  let lastPublish = 0
  busSim.subscribe((state) => {
    const now = Date.now()
    if (now - lastPublish >= 2000) {
      lastPublish = now
      void backend.publishFleet(state).catch(() => {})
    }
  })
})()
