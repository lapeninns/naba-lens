/** "18 Nov 2026, 14:05" in the venue's timezone (spec §11). */
export function formatWhen(iso: string | null, timeZone = "Europe/London") {
  if (!iso) return "unknown"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "unknown"
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date)
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ")
  }
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * What one photo is called (handoff "One photo"): its first menu label,
 * else its first place, else the first slot it fills, else "Photo". The
 * page is titled with this, not "Photo details".
 */
export function assetTitle(detail: {
  labels: {
    items: { itemName: string }[]
    places: { label: string; removedAt: string | null }[]
  }
  slots: { name: string }[]
}): string {
  const item = detail.labels.items.find((i) => i.itemName)
  if (item) return item.itemName
  const place = detail.labels.places.find((p) => p.label && !p.removedAt)
  if (place) return place.label
  return detail.slots.find((s) => s.name)?.name ?? "Photo"
}
