import { Link } from 'react-router-dom'
import { useEventsStore } from '../state/eventsStore'
import { busSim } from '../lib/gps/busSim'
import { IconBus, IconCamera, IconEye, IconMap, IconPlay, IconAlert, IconActivity, IconSettings } from '../components/icons'

const PIPELINE = [
  { icon: <IconCamera width={20} height={20} />, title: 'Camera on the bus', desc: 'Laptop webcam / road video acts as the on-board camera feed.' },
  { icon: <IconEye width={20} height={20} />, title: 'On-board AI', desc: 'TensorFlow.js models detect vehicles, pedestrians, potholes, waterlogging — live in the browser.' },
  { icon: <IconAlert width={20} height={20} />, title: 'Geo-tagged events', desc: 'Each detection is stamped with GPS position, speed and timestamp.' },
  { icon: <IconMap width={20} height={20} />, title: 'Control room', desc: 'Incidents stream to a live map dashboard with heatmaps, queue management and analytics.' },
]

export default function Home() {
  const events = useEventsStore((s) => s.events)
  const incidents = events.filter((e) => e.type !== 'snapshot')

  return (
    <div className="flex flex-col gap-6">
      {/* hero */}
      <section className="relative overflow-hidden rounded-2xl border border-slate-800/80 bg-gradient-to-br from-[#0c1424] via-[#0a101d] to-[#081019] px-6 py-10 sm:px-10">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{ background: 'radial-gradient(600px 300px at 85% 10%, rgba(34,211,238,0.14), transparent), radial-gradient(500px 260px at 10% 100%, rgba(139,92,246,0.1), transparent)' }}
        />
        <div className="relative max-w-2xl">
          <span className="chip chip-active">SIH 2026 · Working Prototype</span>
          <h1 className="mt-4 text-3xl font-extrabold leading-tight tracking-tight text-slate-50 sm:text-4xl">
            Every city bus is a <span className="text-cyan-300">moving sensor</span>.
          </h1>
          <p className="mt-3 text-[0.95rem] leading-relaxed text-slate-400">
            UrbanEye turns a public-transport fleet into a distributed urban intelligence network, built for
            <strong className="text-slate-200"> Indian road conditions</strong> — potholes, monsoon waterlogging, stray
            cattle, dense mixed traffic. Cameras watch the road, on-board AI spots what matters, and every detection
            streams geo-tagged to a single control room. This MVP simulates the entire architecture on one laptop, on a
            real Noida Sector 62–63 route.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/bus-unit" className="btn btn-primary" style={{ fontSize: '0.9rem', padding: '0.6rem 1.1rem' }}>
              <IconBus width={16} height={16} /> Open Bus Unit (sensing)
            </Link>
            <Link to="/control-room" className="btn" style={{ fontSize: '0.9rem', padding: '0.6rem 1.1rem' }}>
              <IconMap width={16} height={16} /> Enter Control Room
            </Link>
          </div>
        </div>
      </section>

      {/* pipeline */}
      <section>
        <h2 className="microlabel mb-3">End-to-end flow</h2>
        <div className="grid gap-3 md:grid-cols-4">
          {PIPELINE.map((p, i) => (
            <div key={p.title} className="panel relative px-4 py-5">
              <span className="absolute right-3 top-3 text-[1.6rem] font-extrabold text-slate-800">{i + 1}</span>
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/12 text-cyan-300">{p.icon}</span>
              <h3 className="mt-3 text-[0.9rem] font-bold text-slate-100">{p.title}</h3>
              <p className="mt-1 text-[0.74rem] leading-relaxed text-slate-500">{p.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* status cards */}
      <section className="grid gap-3 md:grid-cols-3">
        <div className="panel flex items-center gap-4 px-5 py-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/12 text-emerald-300"><IconActivity width={18} height={18} /></span>
          <div>
            <div className="mono text-xl font-bold text-slate-100">{incidents.length}</div>
            <div className="microlabel">Incidents detected so far</div>
          </div>
        </div>
        <div className="panel flex items-center gap-4 px-5 py-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/12 text-cyan-300"><IconBus width={18} height={18} /></span>
          <div>
            <div className="mono text-xl font-bold text-slate-100">{busSim.busId}</div>
            <div className="microlabel">Bus unit in service · Sector 62–63 loop</div>
          </div>
        </div>
        <div className="panel flex items-center gap-4 px-5 py-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/12 text-violet-300"><IconSettings width={18} height={18} /></span>
          <div>
            <div className="text-[0.9rem] font-bold text-slate-100">Runs fully offline</div>
            <div className="microlabel">Firebase optional · AI models vendored locally</div>
          </div>
        </div>
      </section>

      {/* how to demo */}
      <section className="panel panel-pad">
        <h2 className="microlabel mb-2">Two-minute demo recipe</h2>
        <ol className="list-inside list-decimal space-y-1.5 text-[0.82rem] leading-relaxed text-slate-400">
          <li>Open <Link to="/bus-unit" className="text-cyan-300 underline decoration-cyan-800">Bus Unit</Link> — a bundled Indian street clip (Bengaluru HSR Layout) starts playing through the “bus camera”.</li>
          <li>Press <strong className="text-slate-200">Start AI Sensing</strong>. Watch vehicles, people and road surface get detected in real time.</li>
          <li>Let it run — potholes, congestion and waterlogging events appear on the feed with GPS stamps (use <em>Demo Aids</em> to force any event instantly).</li>
          <li>Switch to the <Link to="/control-room" className="text-cyan-300 underline decoration-cyan-800">Control Room</Link>: the bus moves on the live map, incident markers pop in, and the heatmap builds up.</li>
          <li>Open an incident: evidence snapshot, confidence, OCR plate read, and status workflow (acknowledge → resolve).</li>
          <li>Show <strong className="text-slate-200">Analytics</strong> — incident trends, road-user counts and the density index along the route.</li>
        </ol>
      </section>
    </div>
  )
}
