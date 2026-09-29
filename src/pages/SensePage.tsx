import { useCallback, useEffect, useRef, useState } from 'react'
import { engine } from '../lib/engine/engine'
import { SAMPLES, VideoSourceManager, type SourceKind } from '../lib/engine/videoSource'
import { densityLabel } from '../lib/engine/heuristics'
import { busSim } from '../lib/gps/busSim'
import { coordLabel, clockTime, timeAgo } from '../lib/format'
import { useLiveStore, useSettingsStore } from '../state/liveStore'
import { EVENT_META, VEHICLE_CLASSES, type BusState, type UrbanEvent } from '../types'
import { Panel, Toggle } from '../components/ui'
import MiniMap from '../components/MiniMap'
import {
  IconCamera, IconFilm, IconMonitor, IconPlay, IconPause, IconStop, IconUpload,
} from '../components/icons'

function useBusState(): BusState | null {
  const [state, setState] = useState<BusState | null>(null)
  useEffect(() => busSim.subscribe(setState), [])
  return state
}

export default function SensePage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const sourceMgr = useRef<VideoSourceManager | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const live = useLiveStore()
  const bus = useBusState()
  const [feed, setFeed] = useState<UrbanEvent[]>([])
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [source, setSource] = useState<SourceKind>('none')
  const [sampleAvailable, setSampleAvailable] = useState(false)
  const [running, setRunning] = useState(false)
  const [simPaused, setSimPaused] = useState(!busSim.running)
  const [deviceGps, setDeviceGps] = useState(false)
  const [gpsMsg, setGpsMsg] = useState<string | null>(null)
  const [scanResult, setScanResult] = useState<string | null>(null)
  const [speedKph, setSpeedKph] = useState(busSim.speedKph)
  const [timeScale, setTimeScale] = useState(busSim.timeScale)

  useEffect(() => {
    if (videoRef.current && !sourceMgr.current) {
      sourceMgr.current = new VideoSourceManager(videoRef.current)
    }
    // re-bind unconditionally — StrictMode remounts run cleanup first
    if (videoRef.current) engine.setVideo(videoRef.current)
    if (overlayRef.current) engine.setOverlay(overlayRef.current)
    const off = engine.onEvent((e) => {
      if (e.type === 'snapshot') return
      setFeed((f) => [e, ...f].slice(0, 30))
    })
    if (sourceMgr.current) {
      sourceMgr.current.onEnded = () => {
        engine.stop()
        setRunning(false)
        setSource('none')
        setSourceError('Screen share ended — pick a source and start the AI again.')
      }
    }
    // prefer the laptop's real GPS; fall back to the simulated route if denied
    setDeviceGps(true)
    setGpsMsg('Requesting real GPS fix… (allow the browser location prompt)')
    void busSim.useDeviceGps(true, (reason) => {
      setDeviceGps(false)
      setGpsMsg(`⚠ ${reason}`)
    })
    // probe bundled sample clips, then auto-load the default one as the "bus camera"
    void Promise.all(
      SAMPLES.map((s) =>
        fetch(s.path, { method: 'HEAD' }).then((r) => r.ok).catch(() => false),
      ),
    ).then((results) => setSampleAvailable(results.some(Boolean)))
    if (sourceMgr.current) {
      sourceMgr.current.useSample(SAMPLES[0].path).then(() => setSource('sample')).catch(() => {})
    }
    void engine.loadModel()
    return () => {
      off()
      engine.stop()
      engine.setVideo(null)
      engine.setOverlay(null)
    }
  }, [])

  const pickSource = useCallback(async (kind: SourceKind, samplePath?: string) => {
    setSourceError(null)
    const mgr = sourceMgr.current
    if (!mgr) return
    try {
      if (kind === 'webcam') await mgr.useWebcam()
      else if (kind === 'sample') await mgr.useSample(samplePath)
      else if (kind === 'screen') await mgr.useScreen()
      else if (kind === 'file') return // handled by input
      setSource(kind)
    } catch (e) {
      setSource(kind === 'webcam' ? 'none' : kind)
      setSourceError(
        kind === 'webcam'
          ? 'Camera permission denied or unavailable. Use the sample video, a file, or screen share instead.'
          : e instanceof Error ? e.message : 'Source failed',
      )
    }
  }, [])

  const onFile = useCallback(async (f: File | undefined) => {
    if (!f || !sourceMgr.current) return
    await sourceMgr.current.useFile(f)
    setSource('file')
    setSourceError(null)
  }, [])

  const toggleAi = useCallback(async () => {
    if (running) {
      engine.stop()
      setRunning(false)
    } else {
      await engine.start()
      setRunning(engine.isRunning)
    }
  }, [running])

  const density = densityLabel(live.densityIndex)
  const vehicleTotal = Object.entries(live.activeCounts)
    .filter(([k]) => VEHICLE_CLASSES[k])
    .reduce((a, [, v]) => a + v, 0)

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_350px]">
      {/* ── left column: camera + feed ── */}
      <div className="flex min-w-0 flex-col gap-4">
        <Panel
          title="Bus Camera — Live Unit UP16-ETB-042"
          right={
            <div className="flex items-center gap-2">
              {running ? (
                <span className="hud-chip flex items-center gap-1.5" style={{ color: '#34d399' }}>
                  <span className="rec-dot" /> AI SENSING · {live.fps} fps
                </span>
              ) : (
                <span className="hud-chip" style={{ color: '#94a3b8' }}>AI OFF</span>
              )}
            </div>
          }
        >
          <div className="relative overflow-hidden rounded-xl border border-slate-800/80 bg-black" style={{ aspectRatio: '16/9' }}>
            <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" />
            <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />

            {/* HUD */}
            <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <span className={`hud-chip flex items-center gap-1.5 ${running ? '' : 'opacity-60'}`}>
                    <span className="rec-dot" /> REC
                  </span>
                  <span className="hud-chip">{busSim.busId}</span>
                </div>
                <span
                  className="hud-chip"
                  style={{ color: live.modelStatus === 'ready' ? '#34d399' : live.modelStatus === 'loading' ? '#fbbf24' : '#f87171' }}
                >
                  {live.modelStatus === 'ready' ? '● AI MODEL ACTIVE' : live.modelStatus === 'loading' ? '● MODEL LOADING…' : live.modelStatus === 'error' ? '● MODEL ERROR' : '● MODEL IDLE'}
                </span>
              </div>
              <div className="flex items-end justify-between">
                <span className="hud-chip mono">
                  GPS {bus ? coordLabel(bus.lat, bus.lng) : '——'} · {bus?.speedKph ?? 0} km/h · HDG {bus?.heading ?? 0}°
                </span>
                <span className="hud-chip mono">{clockTime(Date.now())}</span>
              </div>
            </div>

            {source === 'none' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#04070d]/85 text-center">
                <IconCamera width={34} height={34} className="text-slate-600" />
                <p className="text-sm font-semibold text-slate-300">No camera source selected</p>
                <p className="max-w-xs text-xs text-slate-500">
                  Pick a source below — webcam acts as the bus camera, or use the bundled road video / screen share.
                </p>
              </div>
            )}
          </div>

          {sourceError && (
            <p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{sourceError}</p>
          )}
          {live.modelStatus === 'error' && (
            <p className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              Model error: {live.modelMessage}
            </p>
          )}

          {/* source bar */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button className={`btn ${source === 'webcam' ? 'btn-primary' : ''}`} onClick={() => void pickSource('webcam')}>
              <IconCamera width={14} height={14} /> Webcam
            </button>
            {SAMPLES.map((s) => (
              <button
                key={s.id}
                className={`btn ${source === 'sample' ? 'btn-primary' : ''}`}
                onClick={() => void pickSource('sample', s.path)}
                disabled={!sampleAvailable}
                title={sampleAvailable ? `Bundled demo clip: ${s.label}` : 'Run `npm run vendor` to download the sample clips'}
              >
                <IconFilm width={14} height={14} /> {s.label}
              </button>
            ))}
            <button className={`btn ${source === 'screen' ? 'btn-primary' : ''}`} onClick={() => void pickSource('screen')}>
              <IconMonitor width={14} height={14} /> Screen share
            </button>
            <button className={`btn ${source === 'file' ? 'btn-primary' : ''}`} onClick={() => fileInputRef.current?.click()}>
              <IconUpload width={14} height={14} /> Video file
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <div className="ml-auto flex items-center gap-2">
              <button className={`btn ${running ? 'btn-danger' : 'btn-primary'}`} onClick={() => void toggleAi()} disabled={live.modelStatus === 'loading'}>
                {running ? <><IconStop width={14} height={14} /> Stop AI</> : <><IconPlay width={14} height={14} /> Start AI Sensing</>}
              </button>
            </div>
          </div>
        </Panel>

        <Panel title="Session Event Feed" right={<span className="microlabel">{feed.length} events</span>}>
          {feed.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-500">
              No events yet. Start the AI with a source selected — detected incidents appear here and on the Control Room map.
            </p>
          ) : (
            <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-1">
              {feed.map((e) => (
                <li key={e.id} className="fade-in flex items-center gap-2.5 rounded-lg border border-slate-800/70 bg-[#0b1220] px-3 py-2">
                  <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: EVENT_META[e.type].color }} />
                  <span className="min-w-0 flex-1 truncate text-[0.8rem] text-slate-200">{e.title}</span>
                  <span className="mono text-[0.68rem] text-slate-500">{coordLabel(e.lat, e.lng)}</span>
                  <span className="mono w-14 text-right text-[0.68rem] text-slate-500">{timeAgo(e.timestamp)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* ── right column: telemetry ── */}
      <div className="flex flex-col gap-4">
        <Panel title="Live Perception">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-slate-800/70 bg-[#0b1220] px-2 py-2.5">
              <div className="mono text-2xl font-bold text-cyan-300">{vehicleTotal}</div>
              <div className="microlabel mt-0.5">Vehicles in frame</div>
            </div>
            <div className="rounded-lg border border-slate-800/70 bg-[#0b1220] px-2 py-2.5">
              <div className="mono text-2xl font-bold text-violet-300">{live.pedestrians}</div>
              <div className="microlabel mt-0.5">Pedestrians</div>
            </div>
            <div className="rounded-lg border border-slate-800/70 bg-[#0b1220] px-2 py-2.5">
              <div className="mono text-2xl font-bold text-amber-300">{live.densityIndex}</div>
              <div className="microlabel mt-0.5">Density index</div>
            </div>
          </div>

          <div className="mt-3">
            <div className="flex items-center justify-between">
              <span className="microlabel">Traffic density</span>
              <span className="text-[0.72rem] font-bold" style={{ color: density.level === 'heavy' ? '#f87171' : density.level === 'moderate' ? '#fbbf24' : '#34d399' }}>
                {density.label}
              </span>
            </div>
            <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${live.densityIndex}%`,
                  background: density.level === 'heavy' ? '#ef4444' : density.level === 'moderate' ? '#f59e0b' : '#10b981',
                }}
              />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[0.72rem] text-slate-400">
            {Object.entries(VEHICLE_CLASSES).map(([cls, label]) => (
              <div key={cls} className="flex items-center justify-between">
                <span>{label}</span>
                <span className="mono text-slate-200">
                  {live.activeCounts[cls] ?? 0} <span className="text-slate-600">({live.uniqueCounts[cls] ?? 0})</span>
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[0.64rem] text-slate-600">current (unique this session)</p>
        </Panel>

        <Panel title="Simulated GPS — Route 62/63 Loop">
          <MiniMap height={210} />
          <div className="mt-3 space-y-2.5">
            <label className="block">
              <div className="flex justify-between text-[0.72rem] text-slate-400"><span>Bus speed</span><span className="mono">{speedKph} km/h</span></div>
              <input type="range" min={5} max={80} value={speedKph} className="w-full"
                onChange={(e) => { const v = +e.target.value; setSpeedKph(v); busSim.speedKph = v }} />
            </label>
            <label className="block">
              <div className="flex justify-between text-[0.72rem] text-slate-400"><span>Demo time-scale</span><span className="mono">{timeScale}×</span></div>
              <input type="range" min={1} max={60} value={timeScale} className="w-full"
                onChange={(e) => { const v = +e.target.value; setTimeScale(v); busSim.timeScale = v }} />
            </label>
            <div className="flex gap-2">
              <button className="btn btn-sm flex-1" onClick={() => {
                busSim.running = !busSim.running
                setSimPaused(!busSim.running)
              }}>
                {simPaused ? <><IconPlay width={12} height={12} /> Resume route</> : <><IconPause width={12} height={12} /> Pause route</>}
              </button>
            </div>
            <Toggle
              on={deviceGps}
              label="Use device GPS"
              hint="Use this laptop/phone's real GPS instead of the simulated route — perfect for a walk-around demo"
              onChange={(v) => {
                setDeviceGps(v)
                if (v) {
                  void busSim.useDeviceGps(true, (reason) => {
                    setDeviceGps(false)
                    setGpsMsg(`⚠ ${reason}`)
                  })
                  setGpsMsg('Requesting location fix… (allow the browser prompt)')
                } else {
                  void busSim.useDeviceGps(false)
                  setGpsMsg(null)
                }
              }}
            />
            {gpsMsg && <p className="rounded-lg border border-slate-700/70 bg-[#0b1220] px-2.5 py-1.5 text-[0.68rem] text-amber-200">{gpsMsg}</p>}
          </div>
        </Panel>

        <Panel title="AI Features">
          <FeatureToggles />
        </Panel>

        <Panel title="Demo Aids">
          <p className="mb-2 text-[0.68rem] text-slate-500">
            Fire representative events manually when live conditions can't produce them during the presentation.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn btn-sm" onClick={() => void engine.injectDemo('pothole')}>Inject pothole</button>
            <button className="btn btn-sm" onClick={() => void engine.injectDemo('waterlogging')}>Inject waterlogging</button>
            <button className="btn btn-sm" onClick={() => void engine.injectDemo('animal')}>Inject stray cattle</button>
            <button className="btn btn-sm" onClick={() => void engine.injectDemo('congestion')}>Inject congestion</button>
            <button className="btn btn-sm btn-danger col-span-2" onClick={() => void engine.injectDemo('manual')}>Report road accident</button>
          </div>
          <div className="mt-3 border-t border-slate-800/70 pt-3">
            <div className="flex items-center gap-2">
            <button
              className="btn btn-sm"
              title="OCR the biggest vehicle in frame, or the centre of the frame (webcam mode), and check the watchlist"
              onClick={() => {
                setScanResult('Scanning…')
                void engine.scanPlateNow().then((r) => {
                  setScanResult(
                    r.plate
                      ? `Read: ${r.plate}${r.flagged ? ' — 🚨 ON WATCHLIST' : ''}`
                      : `Not readable (raw: "${r.raw.slice(0, 24) || '—'}"). Hold the plate closer / brighter.`,
                  )
                })
              }}
            >
              Scan number plate
            </button>
              <span className="text-[0.66rem] text-slate-500">OCR biggest vehicle → watchlist check</span>
            </div>
            {scanResult && <p className="mono mt-2 rounded-lg border border-slate-700/70 bg-[#0b1220] px-2.5 py-1.5 text-[0.7rem] text-slate-200">{scanResult}</p>}
          </div>
        </Panel>
      </div>
    </div>
  )
}

function FeatureToggles() {
  const { settings, set } = useSettingsStore()
  return (
    <div>
      <label className="mb-2 block">
        <div className="flex justify-between text-[0.72rem] text-slate-400">
          <span>Trigger sensitivity</span>
          <span className="mono">{Math.round(settings.sensitivity * 100)}%</span>
        </div>
        <input type="range" min={10} max={100} value={settings.sensitivity * 100} className="w-full"
          onChange={(e) => set('sensitivity', +e.target.value / 100)} />
      </label>
      <Toggle on={settings.enableVehicles} label="Vehicle detection & counting" onChange={(v) => set('enableVehicles', v)} />
      <Toggle on={settings.enableCongestion} label="Congestion monitoring" onChange={(v) => set('enableCongestion', v)} />
      <Toggle on={settings.enablePothole} label="Pothole / road damage" onChange={(v) => set('enablePothole', v)} />
      <Toggle on={settings.enableWater} label="Waterlogging detection" onChange={(v) => set('enableWater', v)} />
      <Toggle on={settings.enablePedestrian} label="Pedestrian proximity" onChange={(v) => set('enablePedestrian', v)} />
      <Toggle on={settings.enableAnimals} label="Stray cattle / animal on road" onChange={(v) => set('enableAnimals', v)} />
      <Toggle on={settings.enableSigns} label="Traffic sign awareness" onChange={(v) => set('enableSigns', v)} />
      <Toggle on={settings.enableBraking} label="Harsh-braking incidents" onChange={(v) => set('enableBraking', v)} />
      <Toggle on={settings.enableRash} label="Rash driving / overspeeding" onChange={(v) => set('enableRash', v)} />
      <Toggle on={settings.enablePlates} label="Number-plate OCR (on incidents)" onChange={(v) => set('enablePlates', v)} />
      <Toggle on={settings.enablePlateWatch} label="Continuous plate reader (webcam)" hint="Reads plates ~every 2.5s — hold a plate up to the webcam; watchlist hits get flagged automatically" onChange={(v) => set('enablePlateWatch', v)} />
    </div>
  )
}
