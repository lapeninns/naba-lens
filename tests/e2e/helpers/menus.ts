import type { Db } from "../../support/identities"
import { psql } from "./stack"

type RpcResult<T> = {
  data: T | null
  error: { code: string; message: string; details?: string | null } | null
}

export async function ok<T>(call: PromiseLike<RpcResult<T>>): Promise<T> {
  const { data, error } = await call
  if (error) {
    throw new Error(`${error.message} (${error.code}) ${error.details ?? ""}`)
  }
  return data as T
}

const menuItem = (sourceKey: string, name: string) => ({
  itemId: null,
  sourceKey,
  name,
  description: null,
  aliases: [],
  sourceMeta: {},
  variants: [],
  review: null,
})

/** DEV FIXTURE: a three-item draft made as the Menus admin; returns its id. */
export function createMenuDraft(admin: Db, venueId: string, title: string) {
  return ok(
    admin.rpc("create_menu_draft", {
      p_venue_id: venueId,
      p_title: title,
      p_source: {
        kind: "json",
        label: "DEV FIXTURE menu.json",
        sha256: "a".repeat(64),
        revision: null,
        capturedAt: "2026-11-01T10:00:00Z",
        notes: null,
      } as never,
      p_document: {
        title,
        sections: [
          {
            slug: "starters",
            name: "Starters",
            kind: "food",
            items: [
              menuItem("starters--soup", "Soup"),
              menuItem("starters--salad", "Salad"),
            ],
          },
          {
            slug: "mains",
            name: "Mains",
            kind: "food",
            items: [menuItem("mains--pie", "Pie")],
          },
        ],
      } as never,
    })
  ) as Promise<string>
}

export function activateMenu(admin: Db, versionId: string) {
  return ok(
    admin.rpc("activate_menu_version", {
      p_version_id: versionId,
      p_expected_revision: Number(
        psql(
          `select revision from public.menu_versions where id = '${versionId}'::uuid`
        )
      ),
    })
  )
}
