/*
 * The place the person last matched a photo in, on this phone only (§6.1
 * step 4): Match suggests its empty slots after the current place's. A
 * convenience, so a browser that keeps nothing simply suggests less.
 */
const KEY = "nabalens.match.last-place"

export function readLastPlace(): string | null {
  try {
    return window.localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function writeLastPlace(place: string) {
  try {
    window.localStorage.setItem(KEY, place)
  } catch {
    // Private mode or storage blocked: nothing to remember.
  }
}

/*
 * The slots the person matched most recently on this phone (spec §5.3
 * "recent subjects"), newest first. Match offers them as choices; nothing
 * is ever applied from them. Per phone and per venue, since slot ids are the
 * venue's own; a browser that keeps nothing simply offers none.
 */
const RECENT_KEY = "nabalens.match.recent-slots"
const RECENT_KEEP = 8

type RecentStore = { venue: string | null; slots: string[] }

function readStore(): RecentStore | null {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<RecentStore>
    return Array.isArray(parsed.slots)
      ? {
          venue: typeof parsed.venue === "string" ? parsed.venue : null,
          slots: parsed.slots.filter(
            (id): id is string => typeof id === "string"
          ),
        }
      : null
  } catch {
    return null
  }
}

export function readRecentSlots(venue: string | null): string[] {
  const store = readStore()
  if (!store || (venue && store.venue && store.venue !== venue)) return []
  return store.slots
}

export function writeRecentSlot(venue: string | null, slot: string) {
  const before = readRecentSlots(venue)
  const slots = [slot, ...before.filter((id) => id !== slot)].slice(
    0,
    RECENT_KEEP
  )
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify({ venue, slots }))
  } catch {
    // Private mode or storage blocked: nothing to remember.
  }
}
