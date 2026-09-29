import type { BusState, DataBackend, EventStatus, UrbanEvent } from '../../types'

/**
 * Offline backend used when Firebase is not configured. Persists events to
 * localStorage and syncs across browser tabs via BroadcastChannel, so the
 * "sensing laptop" and the "control room" can be two tabs on the same machine.
 */
export class LocalStore implements DataBackend {
  readonly mode = 'local' as const
  private events = new Map<string, UrbanEvent>()
  private fleet = new Map<string, BusState>()
  private eventSubs = new Set<(e: UrbanEvent[]) => void>()
  private fleetSubs = new Map<string, Set<(s: BusState | null) => void>>()
  private channel: BroadcastChannel | null = null

  private static LS_EVENTS = 'urbaneye.events'
  private static LS_FLEET = 'urbaneye.fleet'

  async init() {
    try {
      const raw = localStorage.getItem(LocalStore.LS_EVENTS)
      if (raw) {
        const arr = JSON.parse(raw) as UrbanEvent[]
        for (const e of arr) this.events.set(e.id, e)
      }
      const rawFleet = localStorage.getItem(LocalStore.LS_FLEET)
      if (rawFleet) {
        const arr = JSON.parse(rawFleet) as [string, BusState][]
        for (const [k, v] of arr) this.fleet.set(k, v)
      }
    } catch {
      /* corrupted storage — start clean */
    }
    if ('BroadcastChannel' in window) {
      this.channel = new BroadcastChannel('urbaneye.sync')
      this.channel.onmessage = (msg) => this.onRemote(msg.data)
    }
  }

  private onRemote(data: { kind: string; payload: unknown }) {
    if (data.kind === 'events') {
      const arr = data.payload as UrbanEvent[]
      let changed = false
      for (const e of arr) {
        const existing = this.events.get(e.id)
        if (!existing || existing.status !== e.status || existing.plate !== e.plate) {
          this.events.set(e.id, e)
          changed = true
        }
      }
      if (changed) this.emitEvents()
    } else if (data.kind === 'fleet') {
      const [id, s] = data.payload as [string, BusState]
      this.fleet.set(id, s)
      this.fleetSubs.get(id)?.forEach((cb) => cb(s))
    } else if (data.kind === 'delete') {
      this.events.delete(data.payload as string)
      this.emitEvents()
    }
  }

  private persist() {
    try {
      const arr = [...this.events.values()].sort((a, b) => b.timestamp - a.timestamp).slice(0, 250)
      localStorage.setItem(LocalStore.LS_EVENTS, JSON.stringify(arr))
    } catch {
      /* quota — ignore */
    }
  }

  private persistFleet() {
    try {
      localStorage.setItem(LocalStore.LS_FLEET, JSON.stringify([...this.fleet.entries()].slice(-3)))
    } catch {
      /* ignore */
    }
  }

  private emitEvents() {
    const arr = [...this.events.values()].sort((a, b) => b.timestamp - a.timestamp)
    this.eventSubs.forEach((cb) => cb(arr))
  }

  subscribeEvents(cb: (events: UrbanEvent[]) => void): () => void {
    this.eventSubs.add(cb)
    cb([...this.events.values()].sort((a, b) => b.timestamp - a.timestamp))
    return () => this.eventSubs.delete(cb)
  }

  async addEvent(e: UrbanEvent) {
    this.events.set(e.id, e)
    this.emitEvents()
    this.persist()
    this.channel?.postMessage({ kind: 'events', payload: [e] })
  }

  async updateEvent(id: string, patch: Partial<UrbanEvent>) {
    const e = this.events.get(id)
    if (!e) return
    const next = { ...e, ...patch }
    this.events.set(id, next)
    this.emitEvents()
    this.persist()
    this.channel?.postMessage({ kind: 'events', payload: [next] })
  }

  async setStatus(id: string, status: EventStatus) {
    return this.updateEvent(id, { status })
  }

  subscribeFleet(busId: string, cb: (s: BusState | null) => void): () => void {
    if (!this.fleetSubs.has(busId)) this.fleetSubs.set(busId, new Set())
    this.fleetSubs.get(busId)!.add(cb)
    cb(this.fleet.get(busId) ?? null)
    return () => {
      this.fleetSubs.get(busId)?.delete(cb)
    }
  }

  async publishFleet(s: BusState) {
    this.fleet.set(s.busId, s)
    this.persistFleet()
    this.fleetSubs.get(s.busId)?.forEach((cb) => cb(s))
    this.channel?.postMessage({ kind: 'fleet', payload: [s.busId, s] })
  }
}
