// Calendar dates as the database reads them (private.knowledge_safe_date,
// private.london_today). Shared by the value and schedule validators.

/** private.knowledge_safe_date: a real calendar date written YYYY-MM-DD. */
export function safeDate(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const [y, m, d] = v.split("-").map(Number) as [number, number, number]
  if (y < 1 || m < 1 || m > 12 || d < 1) return null
  const days = new Date(Date.UTC(2000, m, 0)).getUTCDate()
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
  if (d > (m === 2 ? (leap ? 29 : 28) : days)) return null
  return v
}

/** Today's date in London, YYYY-MM-DD (private.london_today). */
export function londonToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}
