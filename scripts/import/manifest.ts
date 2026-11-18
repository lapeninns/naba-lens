/**
 * Legacy import manifest (FA-54): a CSV with one row per file.
 *
 *   file              path of the file, relative to the import folder
 *   venue             venue id (uuid) or slug
 *   contributor_email optional: who took it, if they have an account
 *   capture_date      optional: YYYY-MM-DD, or YYYY-MM-DDTHH:MM[:SS] with an
 *                     optional Z or ±HH:MM offset (no offset: Europe/London)
 *   legacy_label      optional: the old label or caption
 *   legacy_folder     optional: the old folder (kept as a note only; never
 *                     makes a photo accepted)
 *
 * Header names are matched case-insensitively; `file_path`, `venue_id`,
 * `venue_slug`, `contributor` and `captured_at` are accepted as aliases.
 * Pure: no file system or database access.
 */

export type ManifestRow = {
  /** 1-based line of the CSV (the header is line 1). */
  line: number
  file: string
  venue: string
  contributorEmail: string | null
  capturedAt: Date | null
  legacyLabel: string | null
  legacyFolder: string | null
}

export type ManifestProblem = { line: number; message: string }

export type ParsedManifest = {
  rows: ManifestRow[]
  problems: ManifestProblem[]
}

const COLUMNS = {
  file: ["file", "file_path", "path"],
  venue: ["venue", "venue_id", "venue_slug"],
  contributorEmail: ["contributor_email", "contributor", "email"],
  capturedAt: ["capture_date", "captured_at", "capture_time"],
  legacyLabel: ["legacy_label", "label"],
  legacyFolder: ["legacy_folder", "folder"],
} as const

type Column = keyof typeof COLUMNS

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF, a BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  const src = text.startsWith("﻿") ? text.slice(1) : text
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"' && field === "") {
      quoted = true
    } else if (ch === ",") {
      row.push(field)
      field = ""
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++
      row.push(field)
      rows.push(row)
      row = []
      field = ""
    } else {
      field += ch
    }
  }
  if (quoted) throw new Error("The manifest has an unclosed quote.")
  if (field !== "" || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?$/
/** Earliest capture time accepted (the database's set_media_captured_at). */
const EARLIEST = Date.UTC(1990, 0, 1)

/** Europe/London's offset from UTC, in ms, at a UTC instant. */
function londonOffsetMs(utc: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(utc))
  const p: Record<string, number> = {}
  for (const part of parts)
    if (part.type !== "literal") p[part.type] = Number(part.value)
  return (
    Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) -
    Math.floor(utc / 1000) * 1000
  )
}

/** A London wall-clock time as a UTC instant. */
function fromLondon(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number
): number {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s)
  const first = wall - londonOffsetMs(wall)
  return wall - londonOffsetMs(first)
}

function realDate(y: number, mo: number, d: number): boolean {
  const date = new Date(Date.UTC(y, mo - 1, d))
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d
  )
}

/**
 * A manifest capture date -> instant, or an error message. A date with no
 * time is read as midday, Europe/London (the day is what the manifest
 * knows; midday keeps it on that day in every UK display). Not before 1990
 * and not after `now` plus one day.
 */
export function parseCaptureDate(
  value: string,
  now: Date = new Date()
): { ok: true; value: Date } | { ok: false; message: string } {
  const text = value.trim()
  let instant: number | null = null
  const dateOnly = DATE_ONLY.exec(text)
  const dateTime = DATE_TIME.exec(text)
  if (dateOnly) {
    const [y, mo, d] = dateOnly.slice(1).map(Number) as [number, number, number]
    if (!realDate(y, mo, d)) return { ok: false, message: "not a real date" }
    instant = fromLondon(y, mo, d, 12, 0, 0)
  } else if (dateTime) {
    const [y, mo, d, h, mi] = dateTime.slice(1, 6).map(Number) as number[]
    const s = Number(dateTime[6] ?? 0)
    if (!realDate(y!, mo!, d!) || h! > 23 || mi! > 59 || s > 59)
      return { ok: false, message: "not a real date and time" }
    const zone = dateTime[7]
    if (!zone) {
      instant = fromLondon(y!, mo!, d!, h!, mi!, s)
    } else {
      const offset =
        zone === "Z"
          ? 0
          : (zone.startsWith("-") ? -1 : 1) *
            (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6))) *
            60_000
      instant = Date.UTC(y!, mo! - 1, d!, h!, mi!, s) - offset
    }
  } else {
    return {
      ok: false,
      message:
        "use YYYY-MM-DD or YYYY-MM-DDTHH:MM (optionally with Z or ±HH:MM)",
    }
  }
  if (instant < EARLIEST) return { ok: false, message: "before 1990" }
  if (instant > now.getTime() + 86_400_000)
    return { ok: false, message: "in the future" }
  return { ok: true, value: new Date(instant) }
}

/**
 * A manifest file path, checked to stay inside the import folder: relative,
 * forward or back slashes, no `..` segment, no drive letter. Returns the
 * normalised path (forward slashes) or null.
 */
export function safeRelativePath(value: string): string | null {
  const text = value.trim().replace(/\\/g, "/")
  if (!text || text.startsWith("/") || /^[A-Za-z]:/.test(text)) return null
  if (/[\u0000-\u001f\u007f]/.test(text)) return null
  const parts = text.split("/").filter((p) => p !== "" && p !== ".")
  if (parts.length === 0 || parts.some((p) => p === "..")) return null
  return parts.join("/")
}

const optional = (value: string | undefined, max: number) => {
  const text = (value ?? "").trim()
  return text ? text.slice(0, max) : null
}

/**
 * Parses the manifest. Rows with a problem are left out of `rows` and listed
 * in `problems` (the importer reports them and imports the rest). Throws only
 * when the file cannot be read as a manifest at all (no header, no file or
 * venue column, an unclosed quote).
 */
export function parseManifest(
  text: string,
  now: Date = new Date()
): ParsedManifest {
  const table = parseCsv(text)
  const header = table[0]
  if (!header) throw new Error("The manifest is empty.")
  const names = header.map((h) => h.trim().toLowerCase())
  const index = {} as Record<Column, number>
  for (const column of Object.keys(COLUMNS) as Column[]) {
    index[column] = names.findIndex((n) =>
      (COLUMNS[column] as readonly string[]).includes(n)
    )
  }
  if (index.file < 0 || index.venue < 0) {
    throw new Error(
      'The manifest needs a "file" and a "venue" column in its first row.'
    )
  }

  const rows: ManifestRow[] = []
  const problems: ManifestProblem[] = []
  const seen = new Map<string, number>()
  table.slice(1).forEach((cells, i) => {
    const line = i + 2
    if (cells.every((c) => c.trim() === "")) return
    const cell = (column: Column) =>
      index[column] >= 0 ? cells[index[column]] : undefined
    const problem = (message: string) => problems.push({ line, message })

    const file = safeRelativePath(cell("file") ?? "")
    if (!file) return problem("file: give a path inside the import folder")
    const venue = (cell("venue") ?? "").trim()
    if (!venue) return problem("venue: give the venue id or slug")
    const key = `${venue}\u0000${file}`
    const earlier = seen.get(key)
    if (earlier !== undefined)
      return problem(`same file and venue as line ${earlier}`)

    const email = optional(cell("contributorEmail"), 320)
    if (email && !EMAIL.test(email))
      return problem("contributor_email: not an email address")

    let capturedAt: Date | null = null
    const date = optional(cell("capturedAt"), 40)
    if (date) {
      const parsed = parseCaptureDate(date, now)
      if (!parsed.ok) return problem(`capture_date: ${parsed.message}`)
      capturedAt = parsed.value
    }

    seen.set(key, line)
    rows.push({
      line,
      file,
      venue,
      contributorEmail: email ? email.toLowerCase() : null,
      capturedAt,
      legacyLabel: optional(cell("legacyLabel"), 200),
      legacyFolder: optional(cell("legacyFolder"), 500),
    })
  })
  return { rows, problems }
}
