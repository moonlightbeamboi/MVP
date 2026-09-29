export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function clockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour12: false })
}

export function fullDateTime(ts: number): string {
  return new Date(ts).toLocaleString([], { hour12: false })
}

export function coordLabel(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}

export function pct(c: number): string {
  return `${Math.round(c * 100)}%`
}
