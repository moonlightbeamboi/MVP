import { create } from 'zustand'
import type { UrbanEvent } from '../types'
import { getBackend } from '../lib/store'

interface EventsState {
  events: UrbanEvent[]
  selectedId: string | null
  loaded: boolean
  select: (id: string | null) => void
}

/**
 * Mirrors the data backend into React. `startEventsSync()` is called once at
 * app boot; after that the store is always current (live in both Firebase and
 * local/BroadcastChannel modes).
 */
export const useEventsStore = create<EventsState>((set) => ({
  events: [],
  selectedId: null,
  loaded: false,
  select: (id) => set({ selectedId: id }),
}))

let started = false
export async function startEventsSync() {
  if (started) return
  started = true
  const backend = await getBackend()
  backend.subscribeEvents((events) => useEventsStore.setState({ events, loaded: true }))
}
