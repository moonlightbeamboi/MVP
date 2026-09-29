import { useMemo } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useEventsStore } from '../state/eventsStore'
import { EVENT_META, type EventType } from '../types'
import { StatCard } from '../components/ui'
import { pct } from '../lib/format'

const tooltipStyle = {
  background: '#101a2c',
  border: '1px solid rgba(34,211,238,0.35)',
  borderRadius: 10,
  fontSize: 12,
  color: '#e2e8f0',
}

export default function Analytics() {
  const events = useEventsStore((s) => s.events)

  const operational = useMemo(() => events.filter((e) => e.type !== 'snapshot'), [events])
  const snapshots = useMemo(() => events.filter((e) => e.type === 'snapshot'), [events])

  const stats = useMemo(() => {
    const active = operational.filter((e) => e.status !== 'resolved').length
    const highCritical = operational.filter((e) => e.severity === 'high' || e.severity === 'critical').length
    const avgConf = operational.length > 0 ? operational.reduce((a, e) => a + e.confidence, 0) / operational.length : 0
    return { total: operational.length, active, highCritical, avgConf }
  }, [operational])

  const overTime = useMemo(() => {
    const cutoff = Date.now() - 2 * 3600_000
    const recent = operational.filter((e) => e.timestamp >= cutoff)
    const buckets = new Map<number, number>()
    const BUCKET = 5 * 60_000
    for (let t = Math.floor((Date.now() - 2 * 3600_000) / BUCKET) * BUCKET; t <= Date.now(); t += BUCKET) buckets.set(t, 0)
    for (const e of recent) {
      const key = Math.floor(e.timestamp / BUCKET) * BUCKET
      buckets.set(key, (buckets.get(key) ?? 0) + 1)
    }
    return [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([t, n]) => ({ time: new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }), events: n }))
  }, [operational])

  const byType = useMemo(() => {
    const counts = new Map<EventType, number>()
    for (const e of operational) counts.set(e.type, (counts.get(e.type) ?? 0) + 1)
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => ({ name: EVENT_META[t].short, value: n, color: EVENT_META[t].color }))
  }, [operational])

  const vehicleMix = useMemo(() => {
    const keys = ['cars', 'buses', 'trucks', 'bikes', 'pedestrians'] as const
    const sums: Record<string, number> = {}
    for (const s of snapshots) {
      for (const k of keys) sums[k] = (sums[k] ?? 0) + Number(s.details?.[k] ?? 0)
    }
    return keys.map((k) => ({ class: k === 'pedestrians' ? 'Pedestrians' : k, total: sums[k] ?? 0 }))
  }, [snapshots])

  const congestion = useMemo(
    () =>
      snapshots
        .slice(0, 40)
        .reverse()
        .map((s) => ({
          time: new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
          density: Number(s.details?.densityIndex ?? 0),
          vehicles: Number(s.details?.vehicles ?? 0),
        })),
    [snapshots],
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total incidents" value={stats.total} sub="excluding traffic snapshots" />
        <StatCard label="Active (unresolved)" value={stats.active} accent="#fbbf24" sub="open in incident queue" />
        <StatCard label="High / critical" value={stats.highCritical} accent="#ef4444" sub="need priority response" />
        <StatCard label="Avg AI confidence" value={pct(stats.avgConf)} accent="#34d399" sub="across all detections" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel panel-pad">
          <h3 className="microlabel mb-3">Incidents over time (last 2 h)</h3>
          <ResponsiveContainer width="100%" height={230}>
            <AreaChart data={overTime}>
              <defs>
                <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#22d3ee" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 5" />
              <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#1e293b' }} minTickGap={28} />
              <YAxis allowDecimals={false} tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} width={26} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: '#334155' }} />
              <Area type="monotone" dataKey="events" stroke="#22d3ee" strokeWidth={2} fill="url(#grad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="panel panel-pad">
          <h3 className="microlabel mb-3">Incidents by category</h3>
          {byType.length === 0 ? (
            <Empty />
          ) : (
            <ResponsiveContainer width="100%" height={230}>
              <PieChart>
                <Pie data={byType} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3} strokeWidth={0}>
                  {byType.map((d) => <Cell key={d.name} fill={d.color} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="panel panel-pad">
          <h3 className="microlabel mb-3">Road users observed (sum of traffic snapshots)</h3>
          {snapshots.length === 0 ? (
            <Empty hint="Snapshots are captured every 25 s while the bus unit is sensing." />
          ) : (
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={vehicleMix}>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 5" />
                <XAxis dataKey="class" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#1e293b' }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} width={30} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#1e293b55' }} />
                <Bar dataKey="total" radius={[5, 5, 0, 0]} fill="#818cf8" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="panel panel-pad">
          <h3 className="microlabel mb-3">Traffic density index along route</h3>
          {congestion.length < 2 ? (
            <Empty hint="Needs at least two traffic snapshots — keep the bus unit sensing." />
          ) : (
            <ResponsiveContainer width="100%" height={230}>
              <LineChart data={congestion}>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 5" />
                <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#1e293b' }} minTickGap={30} />
                <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} width={30} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: '#334155' }} />
                <Line type="monotone" dataKey="density" stroke="#f59e0b" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  )
}

function Empty({ hint }: { hint?: string }) {
  return (
    <div className="flex h-[230px] flex-col items-center justify-center gap-1 text-center">
      <p className="text-xs text-slate-500">No data yet</p>
      {hint && <p className="max-w-[240px] text-[0.68rem] text-slate-600">{hint}</p>}
    </div>
  )
}
