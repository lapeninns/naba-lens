import "server-only"

import type { Database, Json } from "@/lib/db/types"
import type { Db } from "@/lib/server/media/types"
import { isUuid } from "@/lib/server/menus/validate"
import type { MyUploadsPage } from "@/lib/staff/my-uploads"

export type AlbumPostLabel = { kind: "dish" | "area"; id: string; name: string }
export type AlbumFeedback = {
  id: number
  action: "feedback" | "retake" | "remove" | "label"
  note: string | null
  label_name: string | null
  created_at: string
}
export type AlbumPost = {
  id: string
  uploaderId: string
  uploaderName: string
  postedAt: string
  removed: boolean
  labels: AlbumPostLabel[]
  feedback: AlbumFeedback[]
}

type RPC = Database["public"]["Functions"]["staff_album_posts"]

function objects(raw: Json) {
  return Array.isArray(raw)
    ? raw.flatMap((row) =>
        row && typeof row === "object" && !Array.isArray(row) ? [row] : []
      )
    : []
}

function toPost(row: RPC["Returns"][number]): AlbumPost {
  return {
    id: row.id,
    uploaderId: row.uploader_id,
    uploaderName: row.uploader_name,
    postedAt: row.created_at,
    removed: row.removed,
    labels: objects(row.labels).flatMap(({ kind, id, name }) =>
      (kind === "dish" || kind === "area") &&
      typeof id === "string" &&
      typeof name === "string"
        ? [{ kind, id, name }]
        : []
    ),
    feedback: objects(row.feedback).flatMap(
      ({ id, action, note, label_name, created_at }) =>
        typeof id === "number" &&
        typeof created_at === "string" &&
        (action === "feedback" ||
          action === "retake" ||
          action === "remove" ||
          action === "label")
          ? [
              {
                id,
                action,
                created_at,
                note: typeof note === "string" ? note : null,
                label_name: typeof label_name === "string" ? label_name : null,
              },
            ]
          : []
    ),
  }
}

export async function getAlbumPost(db: Db, id: string) {
  const { data, error } = await db.rpc("staff_album_posts", {
    p_asset_id: id,
    p_limit: 1,
  })
  if (error) throw new Error("Could not load the Album photo.")
  return data?.[0] ? toPost(data[0]) : null
}

type AlbumCursor = { before: string; beforeId: string }

export function albumPostCursor({ before, beforeId }: Partial<AlbumCursor>) {
  return typeof before === "string" &&
    Number.isFinite(Date.parse(before)) &&
    isUuid(beforeId)
    ? { before, beforeId }
    : undefined
}

type AlbumPostPage = {
  posts: AlbumPost[]
  next: AlbumCursor | null
}

export async function listAlbumPosts(
  db: Db,
  input: {
    slot?: { kind: "dish" | "area"; id: string }
    cursor?: AlbumCursor
  } = {}
): Promise<AlbumPostPage | null> {
  const limit = 24
  const { slot, cursor } = input
  const { data, error } = await db.rpc("staff_album_posts", {
    ...(slot && { p_slot_kind: slot.kind, p_slot_id: slot.id }),
    ...(cursor && { p_before: cursor.before, p_before_id: cursor.beforeId }),
    p_limit: limit + 1,
  })
  if (error) return null
  const posts = (data ?? []).slice(0, limit).map(toPost)
  const last = posts.at(-1)
  const next =
    (data?.length ?? 0) > limit && last
      ? { before: last.postedAt, beforeId: last.id }
      : null
  return { posts, next }
}

export async function withStaffAlbumStates(
  db: Db,
  page: MyUploadsPage
): Promise<MyUploadsPage> {
  if (page.items.length === 0) return page
  const { data, error } = await db.rpc("staff_album_own_states", {
    p_asset_ids: page.items.map(({ assetId }) => assetId),
  })
  if (error) throw new Error("Could not load your Album states.")
  const byId = new Map(data?.map((state) => [state.id, state]))
  return {
    ...page,
    items: page.items.map((photo) => ({
      ...photo,
      albumPost: byId.get(photo.assetId),
    })),
  }
}
