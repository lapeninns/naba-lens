/**
 * How the dashboard classifies the B03 status view's rows (b10-design §3.4a).
 * The unavailable (reason, detail) pairs are the internal reader's own closed
 * table, imported rather than copied so the two can never disagree. A row
 * outside that table is a contract breach: it is reported with its pair and
 * never added to another count.
 */

import { UNAVAILABLE_DETAILS } from "@/app/api/knowledge/_reader/contract"

export const FRESHNESS_STATES = [
  "current",
  "due_soon",
  "expired",
  "basis_missing",
  "unrated",
] as const
export type FreshnessState = (typeof FRESHNESS_STATES)[number]

export type SlotStatusRow = {
  status: string
  reason: string | null
  detail: string | null
}

export type SlotStatusClass =
  | { kind: "available" }
  | { kind: "unavailable"; pair: string }
  | { kind: "contract_breach"; pair: string }

const pairOf = (reason: string | null, detail: string | null) =>
  `${reason ?? "-"} / ${detail ?? "-"}`

/** Every unavailable pair the reader accepts, as "reason / detail". */
export function unavailablePairs(): string[] {
  return Object.entries(UNAVAILABLE_DETAILS).flatMap(([reason, details]) =>
    (details as readonly string[]).map((detail) => pairOf(reason, detail))
  )
}

export function classifySlotStatus(row: SlotStatusRow): SlotStatusClass {
  const pair = pairOf(row.reason, row.detail)
  if (row.status === "available")
    return row.reason === null && row.detail === null
      ? { kind: "available" }
      : { kind: "contract_breach", pair }
  if (row.status !== "unavailable" || row.reason === null)
    return { kind: "contract_breach", pair }
  const details: readonly string[] | undefined =
    UNAVAILABLE_DETAILS[row.reason as keyof typeof UNAVAILABLE_DETAILS]
  return details !== undefined &&
    row.detail !== null &&
    details.includes(row.detail)
    ? { kind: "unavailable", pair }
    : { kind: "contract_breach", pair }
}

export type SlotStatusCounts = {
  available: number
  unavailable: Record<string, number>
  contractBreaches: Record<string, number>
}

export function countSlotStatuses(
  rows: readonly SlotStatusRow[]
): SlotStatusCounts {
  const counts: SlotStatusCounts = {
    available: 0,
    unavailable: {},
    contractBreaches: {},
  }
  for (const row of rows) {
    const c = classifySlotStatus(row)
    if (c.kind === "available") counts.available++
    else {
      const bucket =
        c.kind === "unavailable" ? counts.unavailable : counts.contractBreaches
      bucket[c.pair] = (bucket[c.pair] ?? 0) + 1
    }
  }
  return counts
}

/** The uses a B03 freshness entry can name. */
export const FRESHNESS_USES = ["internal", "public"] as const
export type FreshnessUse = (typeof FRESHNESS_USES)[number]

export type FreshnessEntry = { use: string; state: string }

export type FreshnessCounts = {
  byUse: Partial<Record<FreshnessUse, Partial<Record<FreshnessState, number>>>>
  contractBreaches: Record<string, number>
}

export function countFreshness(
  entries: readonly FreshnessEntry[]
): FreshnessCounts {
  const counts: FreshnessCounts = { byUse: {}, contractBreaches: {} }
  for (const { use, state } of entries) {
    if (
      (FRESHNESS_USES as readonly string[]).includes(use) &&
      (FRESHNESS_STATES as readonly string[]).includes(state)
    ) {
      const byState = (counts.byUse[use as FreshnessUse] ??= {})
      const key = state as FreshnessState
      byState[key] = (byState[key] ?? 0) + 1
    } else {
      const key = `${use} / ${state}`
      counts.contractBreaches[key] = (counts.contractBreaches[key] ?? 0) + 1
    }
  }
  return counts
}
