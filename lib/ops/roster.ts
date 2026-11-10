/**
 * The production venue roster as the coordinator read it (id, slug, name,
 * active), in the box table `supabase` prints. Records are checked against it
 * so an identity value is always copied, never typed.
 */

export type RosterVenue = {
  id: string
  slug: string
  name: string
  active: boolean
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function parseRoster(text: string): RosterVenue[] {
  const venues: RosterVenue[] = []
  for (const line of text.split("\n")) {
    if (!line.startsWith("│")) continue
    const cells = line
      .split("│")
      .slice(1, -1)
      .map((cell) => cell.trim())
    if (cells.length !== 4 || !UUID.test(cells[0])) continue
    venues.push({
      id: cells[0],
      slug: cells[1],
      name: cells[2],
      active: cells[3] === "true",
    })
  }
  return venues
}

export type LintProblem = { path: string; message: string }

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/

/** Records hold roles and counts only; an email address means personal data slipped in. */
export function personalDataProblems(
  value: unknown,
  path: string
): LintProblem[] {
  if (typeof value === "string")
    return EMAIL.test(value)
      ? [{ path, message: "contains an email address" }]
      : []
  if (Array.isArray(value))
    return value.flatMap((item, i) =>
      personalDataProblems(item, `${path}[${i}]`)
    )
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([key, item]) =>
      personalDataProblems(item, `${path}.${key}`)
    )
  return []
}

export const isIsoDate = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`))

export const isIsoInstant = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/.test(value) &&
  !Number.isNaN(Date.parse(value))

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
