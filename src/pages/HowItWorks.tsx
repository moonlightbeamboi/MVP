import { Panel } from '../components/ui'
import { IconCamera, IconDatabase, IconEye, IconMap, IconSettings } from '../components/icons'

const LAYERS = [
  {
    icon: <IconCamera width={18} height={18} />,
    name: 'Sensing layer — “the bus”',
    items: [
      'Laptop webcam / road video / screen-share as the on-board camera',
      'Simulated GPS: bus follows a real Sector 62–63 (Noida) route loop; device GPS optional',
      'TensorFlow.js COCO-SSD (lite_mobilenet_v2) for vehicles, pedestrians, traffic signs and stray cattle/dogs',
      'Classical-CV heuristics tuned for Indian roads: potholes & monsoon waterlogging; IoU tracker for counting + speed proxy',
      'Tesseract.js OCR crops vehicle regions for number-plate reads on incidents',
    ],
  },
  {
    icon: <IconDatabase width={18} height={18} />,
    name: 'Data layer',
    items: [
      'Events + live fleet position written as documents (Firestore collection "events" / "fleet")',
      'Firebase optional — an offline local store with cross-tab BroadcastChannel sync replaces it 1:1',
      'Events carry: type, severity, confidence, lat/lng, speed, heading, JPEG snapshot, OCR plate',
    ],
  },
  {
    icon: <IconMap width={18} height={18} />,
    name: 'Presentation layer — control room',
    items: [
      'Live Leaflet map: moving bus, incident markers, severity heatmap (Carto dark tiles)',
      'Incident queue: filters, evidence viewer, status workflow, CSV export',
      'Analytics: incident trends, category split, road-user mix, route density index',
    ],
  },
]

const STACK = [
  ['Frontend', 'React 19 + Vite 7 + TypeScript (strict)'],
  ['AI / vision', 'TensorFlow.js, COCO-SSD, Tesseract.js (WASM, on-device)'],
  ['Maps', 'Leaflet + Carto dark basemap + leaflet.heat'],
  ['Charts', 'Recharts'],
  ['Cloud store (optional)', 'Firebase Firestore (free Spark tier)'],
  ['State', 'Zustand + BroadcastChannel'],
  ['Styling', 'Tailwind CSS v4'],
]

export default function HowItWorks() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold tracking-tight text-slate-100">Architecture — how the simulation maps to the real system</h1>
        <p className="mt-1 text-[0.8rem] leading-relaxed text-slate-500">
          The proposal mounts cameras + edge AI on buses and streams intelligence to city authorities. This prototype keeps
          the exact same data flow, but the “bus” is this laptop: webcam instead of fleet camera, simulated GPS instead of a
          vehicle telematics unit, and in-browser inference instead of an embedded edge box. Swapping the simulated pieces
          for real ones only replaces the two input adapters — nothing downstream changes.
        </p>
      </div>

      <div className="panel px-5 py-4">
        <div className="flex flex-wrap items-center gap-2 text-[0.75rem] font-semibold">
          <span className="chip chip-active">Camera</span><span className="text-slate-600">→</span>
          <span className="chip" style={{ color: '#67e8f9', borderColor: '#155e75' }}>On-board AI (browser)</span><span className="text-slate-600">→</span>
          <span className="chip" style={{ color: '#fbbf24', borderColor: '#92400e' }}>Geo-tagged event + snapshot</span><span className="text-slate-600">→</span>
          <span className="chip" style={{ color: '#a5b4fc', borderColor: '#4338ca' }}>Firestore / local store</span><span className="text-slate-600">→</span>
          <span className="chip" style={{ color: '#34d399', borderColor: '#065f46' }}>Control room map & analytics</span>
        </div>
      </div>

      {LAYERS.map((l) => (
        <Panel key={l.name} title={l.name}>
          <div className="flex gap-3">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-cyan-500/12 text-cyan-300">{l.icon}</span>
            <ul className="list-inside list-disc space-y-1 text-[0.8rem] leading-relaxed text-slate-400">
              {l.items.map((i) => <li key={i}>{i}</li>)}
            </ul>
          </div>
        </Panel>
      ))}

      <Panel title="Technology stack">
        <dl className="grid gap-x-6 gap-y-2 text-[0.8rem] sm:grid-cols-2">
          {STACK.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 border-b border-slate-800/60 pb-1.5">
              <dt className="text-slate-500">{k}</dt>
              <dd className="text-right font-medium text-slate-200">{v}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      <Panel title="Honest limitations (says this on purpose)">
        <ul className="list-inside list-disc space-y-1 text-[0.8rem] leading-relaxed text-slate-400">
          <li>Pothole / waterlogging detection is classical-CV heuristics (dark-patch & blue-sheen analysis), not a model trained on road-damage datasets — sensitivity is exposed as a slider.</li>
          <li>Number-plate OCR needs close, well-lit plates; when unreadable the event shows a clearly-labelled simulated plate.</li>
          <li>Vehicle speed is a proxy estimated from tracker motion across frames, not radar.</li>
          <li>“Demo Aids” buttons inject representative events so every dashboard feature can be shown regardless of live conditions.</li>
        </ul>
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-slate-800 bg-[#0b1220] px-3 py-2 text-[0.72rem] text-slate-500">
          <IconEye width={14} height={14} className="mt-0.5 flex-shrink-0 text-cyan-400" />
          Production path: replace webcam with sealed fleet camera + edge device (Jetson / phone), simulated GPS with vehicle telematics,
          and scale Firestore with rules + auth. The event schema and dashboard carry over unchanged.
        </p>
      </Panel>

      <Panel title="Team & roadmap (fill in for submission)">
        <div className="grid gap-3 text-[0.8rem] text-slate-400 sm:grid-cols-2">
          <div>
            <div className="microlabel mb-1.5">If we build the real system next</div>
            <ol className="list-inside list-decimal space-y-1">
              <li>Pilot on 3 college shuttle buses with phone-based capture</li>
              <li>Train road-damage model on an India-specific dataset (RDD2022)</li>
              <li>Auth + role-based control room, SMS/e-mail escalations</li>
              <li>Open the incident feed to municipal APIs</li>
            </ol>
          </div>
          <div>
            <div className="microlabel mb-1.5">Why buses?</div>
            <p className="leading-relaxed">
              Fixed daily routes give repeated, systematic coverage of the same corridors at different times —
              a free, moving sensor network with zero additional vehicles on the road.
            </p>
          </div>
        </div>
      </Panel>
    </div>
  )
}
