/**
 * B10-07 destination checklist (b10-design §9). Website destinations are
 * fixed here by repository; NabaPresence locations are one per active venue,
 * built from the roster at freeze. Every check is outstanding with what it
 * waits for, or passed or failed with an evidence path.
 */

import {
  isIsoInstant,
  isObject,
  type LintProblem,
  type RosterVenue,
} from "./roster"

export const DESTINATIONS_SCHEMA = "b10-destinations/1"

export type Destination = {
  id: string
  kind: "website" | "undecided" | "nabapresence_location"
  label: string
  generation?: "A" | "B" | "C" | "D"
  statusAtFreeze: "candidate" | "unknown"
  waitingFor: readonly string[]
}

export const FIXED_DESTINATIONS: readonly Destination[] = [
  {
    id: "D-01",
    kind: "website",
    label: "TheOldCrownLP",
    generation: "A",
    statusAtFreeze: "candidate",
    waitingFor: ["X8", "X7", "B06"],
  },
  {
    id: "D-02",
    kind: "website",
    label: "TheCornerHouseLP",
    generation: "A",
    statusAtFreeze: "candidate",
    waitingFor: ["X8", "X7", "B06"],
  },
  {
    id: "D-03",
    kind: "website",
    label: "TheWhiteHorseLP",
    generation: "A",
    statusAtFreeze: "candidate",
    waitingFor: ["X8", "X7", "B06", "OD-B4 price source"],
  },
  {
    id: "D-04",
    kind: "website",
    label: "TheBarleyMowLP",
    generation: "B",
    statusAtFreeze: "candidate",
    waitingFor: ["X8", "X7", "B06"],
  },
  {
    id: "D-05",
    kind: "website",
    label: "TheRailwayLP",
    generation: "B",
    statusAtFreeze: "candidate",
    waitingFor: ["X8", "X7 live domain", "B06"],
  },
  {
    id: "D-06",
    kind: "website",
    label: "ThePrinceOfWalesLP",
    generation: "B",
    statusAtFreeze: "candidate",
    waitingFor: ["X8", "X7", "B06", "OD-B10-9", "OD-B10-12"],
  },
  {
    id: "D-07",
    kind: "website",
    label: "TheQueenElizabethLP",
    generation: "B",
    statusAtFreeze: "candidate",
    waitingFor: ["X8", "X7 live domain", "B06"],
  },
  {
    id: "D-08",
    kind: "website",
    label: "TheWhiteHorseInnLP",
    generation: "C",
    statusAtFreeze: "candidate",
    waitingFor: ["X8", "X7", "B06", "OD-B10-10"],
  },
  {
    id: "D-09",
    kind: "website",
    label: "TheBellLP",
    generation: "D",
    statusAtFreeze: "candidate",
    waitingFor: ["X8", "X7", "B06"],
  },
  {
    id: "D-10",
    kind: "website",
    label: "TheOldSchoolHouseLP",
    generation: "D",
    statusAtFreeze: "candidate",
    waitingFor: ["X8", "X7 live domain", "B06"],
  },
  {
    id: "D-11",
    kind: "undecided",
    label: "LapenInnsLP group directory",
    statusAtFreeze: "unknown",
    waitingFor: ["OD-B10-11"],
  },
  {
    id: "D-12",
    kind: "undecided",
    label: "platform/lapen-sites workspace",
    statusAtFreeze: "unknown",
    waitingFor: ["OD-B10-12"],
  },
  {
    id: "D-13",
    kind: "undecided",
    label: "platform/gastro-chatbot",
    statusAtFreeze: "unknown",
    waitingFor: ["OD-B10-12"],
  },
]

/** The repository behind each website destination, for crosswalk lookups. */
export function websiteDestinationFor(
  repository: string
): Destination | undefined {
  return FIXED_DESTINATIONS.find(
    (d) => d.kind === "website" && d.label === repository
  )
}

export type DestinationCheck = {
  id: string
  title: string
  waitingFor: readonly string[]
}

export const WEBSITE_CHECKS: readonly DestinationCheck[] = [
  {
    id: "DC-1",
    title:
      "Remote head and the repository's AGENTS.md and release process re-read",
    waitingFor: ["B10-07a freeze"],
  },
  {
    id: "DC-2",
    title: "Crosswalk row signed off and the guest domain confirmed live",
    waitingFor: ["X8", "X7"],
  },
  {
    id: "DC-3",
    title: "Field manifest signed off; only manifest fields delivered",
    waitingFor: ["B06-01"],
  },
  {
    id: "DC-4",
    title: "The repository's own release gate passed on the final head",
    waitingFor: ["B06"],
  },
  {
    id: "DC-5",
    title:
      "Deploy authorised and the production deployment matches the merged head",
    waitingFor: ["X7", "X1"],
  },
  {
    id: "DC-6",
    title: "Page, JSON and MCP agree on each delivered field",
    waitingFor: ["B06"],
  },
  {
    id: "DC-7",
    title: "A changed answer appears at its next revision",
    waitingFor: ["B06"],
  },
  {
    id: "DC-8",
    title: "Withdrawal removed within the objective, measured",
    waitingFor: ["B06"],
  },
  {
    id: "DC-9",
    title: "An older replay after a withdrawal is refused",
    waitingFor: ["B06"],
  },
  {
    id: "DC-10",
    title:
      "Outage: last good state or explicit unavailable, never a stale value past expiry",
    waitingFor: ["B06"],
  },
  {
    id: "DC-11",
    title:
      "No Wi-Fi secret, staff data, private note or original media URL on page, JSON or MCP",
    waitingFor: ["B06"],
  },
  {
    id: "DC-12",
    title: "Supported MCP protocol versions still negotiate",
    waitingFor: ["B06"],
  },
]

export const PRESENCE_CHECKS: readonly DestinationCheck[] = [
  {
    id: "NP-1",
    title: "Location metadata read under NabaPresence's rules",
    waitingFor: ["X6"],
  },
  {
    id: "NP-2",
    title: "Crosswalk row signed off, never matched by name",
    waitingFor: ["X8", "B07-01"],
  },
  {
    id: "NP-3",
    title: "Field mapping supported for the location's category",
    waitingFor: ["B07-01"],
  },
  {
    id: "NP-4",
    title: "Suggestion intake is idempotent",
    waitingFor: ["B07-02"],
  },
  {
    id: "NP-5",
    title: "Sign-off bound to the source revision; a changed source refuses it",
    waitingFor: ["B07-04"],
  },
  {
    id: "NP-6",
    title:
      "Published only through NabaPresence's review; confirmed_applied with the matching receipt",
    waitingFor: ["B07-05", "X6"],
  },
  {
    id: "NP-7",
    title: "guest_wifi never sends credentials",
    waitingFor: ["B07"],
  },
]

export const UNDECIDED_CHECKS: readonly DestinationCheck[] = [
  {
    id: "DEC-1",
    title: "Owner decision on whether this is a destination, recorded",
    waitingFor: [],
  },
]

export function nabaPresenceDestinations(
  roster: readonly RosterVenue[]
): Destination[] {
  return roster
    .filter((v) => v.active)
    .map((venue, i) => ({
      id: `D-${String(14 + i).padStart(2, "0")}`,
      kind: "nabapresence_location" as const,
      label: `NabaPresence location for venue ${venue.id}`,
      statusAtFreeze: "unknown" as const,
      waitingFor: ["X6", "X8"],
    }))
}

export function allDestinations(roster: readonly RosterVenue[]): Destination[] {
  return [...FIXED_DESTINATIONS, ...nabaPresenceDestinations(roster)]
}

export function checksFor(
  destination: Destination
): readonly DestinationCheck[] {
  if (destination.kind === "website") return WEBSITE_CHECKS
  if (destination.kind === "nabapresence_location") return PRESENCE_CHECKS
  return UNDECIDED_CHECKS
}

export type ChecklistItem =
  | {
      destination: string
      check: string
      state: "outstanding"
      waitingFor: string[]
    }
  | {
      destination: string
      check: string
      state: "passed" | "failed"
      evidencePath: string
      observedAt: string
      sourceRevision: string
    }

export type DestinationChecklist = {
  schema: typeof DESTINATIONS_SCHEMA
  items: ChecklistItem[]
}

export function initialChecklist(
  roster: readonly RosterVenue[]
): DestinationChecklist {
  const items: ChecklistItem[] = allDestinations(roster).flatMap((d) =>
    checksFor(d).map((c) => ({
      destination: d.id,
      check: c.id,
      state: "outstanding" as const,
      waitingFor: [...new Set([...d.waitingFor, ...c.waitingFor])],
    }))
  )
  return { schema: DESTINATIONS_SCHEMA, items }
}

const nonEmpty = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0

export function lintDestinationChecklist(
  checklist: unknown,
  roster: readonly RosterVenue[]
): LintProblem[] {
  if (!isObject(checklist)) return [{ path: "$", message: "is not an object" }]
  const problems: LintProblem[] = []
  if (checklist.schema !== DESTINATIONS_SCHEMA)
    problems.push({
      path: "$.schema",
      message: `must be ${DESTINATIONS_SCHEMA}`,
    })
  if (!Array.isArray(checklist.items))
    return [...problems, { path: "$.items", message: "is not a list" }]
  const expected = new Set(
    allDestinations(roster).flatMap((d) =>
      checksFor(d).map((c) => `${d.id} ${c.id}`)
    )
  )
  const seen = new Set<string>()
  checklist.items.forEach((item: unknown, i: number) => {
    const path = `$.items[${i}]`
    if (!isObject(item)) {
      problems.push({ path, message: "is not an object" })
      return
    }
    const key = `${item.destination} ${item.check}`
    if (!expected.has(key))
      problems.push({ path, message: `${key} is not a destination check` })
    if (seen.has(key))
      problems.push({ path, message: `${key} is listed twice` })
    seen.add(key)
    if (item.state === "outstanding") {
      if (
        !Array.isArray(item.waitingFor) ||
        (item.waitingFor.length === 0 && !String(item.check).startsWith("DEC-"))
      )
        problems.push({
          path,
          message: "an outstanding check names what it waits for",
        })
    } else if (item.state === "passed" || item.state === "failed") {
      if (
        !nonEmpty(item.evidencePath) ||
        !isIsoInstant(item.observedAt) ||
        !nonEmpty(item.sourceRevision)
      )
        problems.push({
          path,
          message:
            "a result needs an evidence path, a UTC time and a source revision",
        })
    } else
      problems.push({
        path,
        message: "state must be outstanding, passed or failed",
      })
  })
  for (const key of expected)
    if (!seen.has(key))
      problems.push({ path: "$.items", message: `${key} is missing` })
  return problems
}
