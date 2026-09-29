import {
  collection, doc, limit, onSnapshot, orderBy, query, setDoc, updateDoc,
} from 'firebase/firestore'
import type { BusState, DataBackend, EventStatus, UrbanEvent } from '../../types'
import { getDb } from '../firebaseConfig'

const EVENTS_COL = 'events'
const FLEET_COL = 'fleet'
const MAX_EVENTS = 300

/** Firestore backend — the "cloud" that links the bus unit and the control room. */
export class FirebaseStore implements DataBackend {
  readonly mode = 'firebase' as const

  async init() {
    getDb() // throws if not configured
  }

  subscribeEvents(cb: (events: UrbanEvent[]) => void): () => void {
    const db = getDb()
    const q = query(collection(db, EVENTS_COL), orderBy('timestamp', 'desc'), limit(MAX_EVENTS))
    return onSnapshot(
      q,
      (snap) => cb(snap.docs.map((d) => ({ ...(d.data() as UrbanEvent), id: d.id }))),
      (err) => console.error('[firebase] events listener:', err),
    )
  }

  async addEvent(e: UrbanEvent) {
    const db = getDb()
    const { id, ...rest } = e
    await setDoc(doc(db, EVENTS_COL, id), rest)
  }

  async updateEvent(id: string, patch: Partial<UrbanEvent>) {
    const db = getDb()
    await updateDoc(doc(db, EVENTS_COL, id), patch)
  }

  async setStatus(id: string, status: EventStatus) {
    return this.updateEvent(id, { status })
  }

  subscribeFleet(busId: string, cb: (s: BusState | null) => void): () => void {
    const db = getDb()
    return onSnapshot(
      doc(db, FLEET_COL, busId),
      (snap) => cb(snap.exists() ? (snap.data() as BusState) : null),
      (err) => console.error('[firebase] fleet listener:', err),
    )
  }

  async publishFleet(s: BusState) {
    const db = getDb()
    await setDoc(doc(db, FLEET_COL, s.busId), s, { merge: true })
  }
}
