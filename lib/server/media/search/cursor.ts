import { decodeCursor, encodeCursor } from "@/lib/server/media/library"

// The library's opaque (created_at desc, id desc) cursor, with the length and
// charset check of lib/server/menu-photos/cursor.ts first: a tampered cursor
// is refused, never passed to the database.

const SHAPE = /^[A-Za-z0-9_-]{1,512}$/

export function encodeSearchCursor(createdAt: string, id: string): string {
  return encodeCursor(createdAt, id)
}

export function decodeSearchCursor(
  cursor: string
): { createdAt: string; id: string } | null {
  if (!SHAPE.test(cursor)) return null
  return decodeCursor(cursor)
}
