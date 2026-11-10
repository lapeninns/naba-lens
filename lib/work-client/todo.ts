// Home's next actions (UI design §2, §3.1): one card per piece of work, in a
// fixed order, so the same work is never offered twice on a screen.

export const TODO_KINDS = [
  "upload",
  "replacement",
  "retake",
  "finding",
  "recheck",
  "overdue",
  "labels",
  "check",
  "due_soon",
  "setup",
  "review_photos",
  "confirm_findings",
] as const
export type TodoKind = (typeof TODO_KINDS)[number]

// D1: failed uploads on this phone (data loss) lead; then work someone is
// waiting on; rechecks; overdue; labels; assigned checks; due soon; setup;
// and the manager queues, each its own card.
const RANK: Record<TodoKind, number> = {
  upload: 1,
  replacement: 2,
  retake: 2,
  finding: 2,
  recheck: 3,
  overdue: 4,
  labels: 5,
  check: 6,
  due_soon: 7,
  setup: 8,
  review_photos: 9,
  confirm_findings: 9,
}

/** Assigned checks shown one by one before "Show all N" (§3.1 item 6). */
export const CHECKS_SHOWN = 3

export type TodoEntry = {
  /** The underlying record's stable key, e.g. `check:<checkId>`. */
  key: string
  kind: TodoKind
  /** How many pieces of work the card stands for (a grouped card > 1). */
  members: number
  /** Setup only: sending is blocked (no venue, or an inactive one). */
  blocking?: boolean
}

function rank(entry: TodoEntry): number {
  return entry.kind === "setup" && entry.blocking ? 0 : RANK[entry.kind]
}

/** Stable: entries of the same rank keep the order they came in. */
export function orderTodo<T extends TodoEntry>(entries: readonly T[]): T[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => rank(a.entry) - rank(b.entry) || a.index - b.index)
    .map(({ entry }) => entry)
}

/**
 * The To do badge: every card's members. Null ("couldn't check") when any
 * read behind the list failed, never a number that leaves work out.
 */
export function todoBadge(
  entries: readonly TodoEntry[],
  readFailed: boolean
): number | null {
  if (readFailed) return null
  return entries.reduce((sum, entry) => sum + Math.max(0, entry.members), 0)
}

/**
 * A list section below To do keeps only rows that aren't already a card, and
 * says how many moved ("N more are in To do").
 */
export function withoutTodo<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  todo: readonly TodoEntry[]
): { rows: T[]; inTodo: number } {
  const keys = new Set(todo.map((entry) => entry.key))
  const kept = rows.filter((row) => !keys.has(keyOf(row)))
  return { rows: kept, inTodo: rows.length - kept.length }
}
