import { create } from 'zustand'

export interface AlertPlate {
  plate: string
  note: string
  addedAt: number
}

const LS_KEY = 'urbaneye.alertPlates'

function load(): AlertPlate[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    /* ignore */
  }
  return []
}

function normalize(p: string): string {
  return p.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Normalize an OCR read for comparison. OCR often confuses O↔0 and I↔1 on
 * Indian plates, so build a small equivalence expansion: each watchlist entry
 * is compared in "canonical" form where O/I/Q→0/1 groups are collapsed.
 */
function canonical(p: string): string {
  return normalize(p)
    .replace(/O/g, '0')
    .replace(/I|L/g, '1')
    .replace(/Q|D/g, '0')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/Z/g, '2')
    .replace(/G/g, '6')
}

/** longest common substring length between the two canonical strings */
function commonSubstringLen(a: string, b: string): number {
  if (!a || !b) return 0
  let best = 0
  let prev = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0)
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1
        if (cur[j] > best) best = cur[j]
      }
    }
    prev = cur
  }
  return best
}

interface WatchlistStore {
  plates: AlertPlate[]
  add: (plate: string, note?: string) => boolean
  remove: (plate: string) => void
  /** returns the matching watchlist entry, if any */
  match: (readPlate: string | undefined) => AlertPlate | null
  /** events that matched the watchlist */
  matchedEventIds: string[]
  recordMatch: (eventId: string) => void
}

export const useWatchlistStore = create<WatchlistStore>((set, get) => ({
  plates: load(),
  add: (plate, note = '') => {
    const norm = normalize(plate)
    if (norm.length < 4 || get().plates.some((p) => normalize(p.plate) === norm)) return false
    const plates = [{ plate: norm, note: note.trim(), addedAt: Date.now() }, ...get().plates]
    localStorage.setItem(LS_KEY, JSON.stringify(plates))
    set({ plates })
    return true
  },
  remove: (plate) => {
    const plates = get().plates.filter((p) => p.plate !== plate)
    localStorage.setItem(LS_KEY, JSON.stringify(plates))
    set({ plates })
  },
  match: (readPlate) => {
    if (!readPlate) return null
    const list = get().plates
    if (list.length === 0) return null
    const norm = normalize(readPlate)
    if (!norm) return null
    const canon = canonical(readPlate)
    for (const entry of list) {
      const eNorm = normalize(entry.plate)
      const eCanon = canonical(entry.plate)
      if (norm === eNorm || canon === eCanon) return entry
      // partial: watched plate appears inside the read (or vice versa)
      if (eCanon.length >= 4 && (canon.includes(eCanon) || eCanon.includes(canon))) return entry
      // tolerant: most of the watched plate (allowing a few OCR drops) is present
      const need = Math.max(4, eCanon.length - 3)
      if (eCanon.length >= 5 && commonSubstringLen(canon, eCanon) >= need) return entry
    }
    return null
  },
  matchedEventIds: [],
  recordMatch: (eventId) => {
    if (!get().matchedEventIds.includes(eventId)) {
      set({ matchedEventIds: [...get().matchedEventIds, eventId] })
    }
  },
}))
