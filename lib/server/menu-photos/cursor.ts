import "server-only"

import { intInRange, isUuid } from "@/lib/server/coverage/validate"

// Opaque page cursors (base64url JSON), validated on the way back in: a
// tampered cursor is refused, never passed to the database.

const MAX_INT = 2 ** 31 - 1
const MAX_EVENT_ID = Number.MAX_SAFE_INTEGER
const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/

const encode = (value: unknown[]) =>
  Buffer.from(JSON.stringify(value)).toString("base64url")

function decode(cursor: string): unknown[] | null {
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(cursor)) return null
  try {
    const value: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8")
    )
    return Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

export type ItemsCursor = { section: number; entry: number; itemId: string }
export type QueueCursor = { createdAt: string; key: string }
export type EventsCursor = { before: number }

export const itemsCursor = {
  encode: (c: ItemsCursor) => encode([c.section, c.entry, c.itemId]),
  decode(cursor: string): ItemsCursor | null {
    const v = decode(cursor)
    return v?.length === 3 &&
      intInRange(v[0], 0, MAX_INT) &&
      intInRange(v[1], 0, MAX_INT) &&
      isUuid(v[2])
      ? { section: v[0], entry: v[1], itemId: v[2] }
      : null
  },
}

export const queueCursor = {
  encode: (c: QueueCursor) => encode([c.createdAt, c.key]),
  decode(cursor: string): QueueCursor | null {
    const v = decode(cursor)
    return v?.length === 2 &&
      typeof v[0] === "string" &&
      ISO_TIMESTAMP.test(v[0]) &&
      !Number.isNaN(Date.parse(v[0])) &&
      isUuid(v[1])
      ? { createdAt: v[0], key: v[1] }
      : null
  },
}

export const eventsCursor = {
  encode: (c: EventsCursor) => encode([c.before]),
  decode(cursor: string): EventsCursor | null {
    const v = decode(cursor)
    return v?.length === 1 && intInRange(v[0], 1, MAX_EVENT_ID)
      ? { before: v[0] }
      : null
  },
}
