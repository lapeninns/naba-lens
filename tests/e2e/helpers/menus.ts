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

/**
 * Activates a draft as the Menus admin. AC28 (S1-MENUS): an activation that
 * would retire items is refused (menu_retirements_unconfirmed) until the admin
 * confirms how many; this fixture confirms the count the refusal reports, as
 * an admin approving the diff would.
 */
export async function activateMenu(admin: Db, versionId: string) {
  const revision = () =>
    Number(
      psql(
        `select revision from public.menu_versions where id = '${versionId}'::uuid`
      )
    )
  const first = await admin.rpc("activate_menu_version", {
    p_version_id: versionId,
    p_expected_revision: revision(),
  })
  if (!first.error) return first.data
  if (first.error.message !== "menu_retirements_unconfirmed")
    return ok(Promise.resolve(first))
  const { retirements } = JSON.parse(first.error.details ?? "{}") as {
    retirements?: number
  }
  return ok(
    (
      admin.rpc as unknown as (
        name: string,
        args: Record<string, unknown>
      ) => PromiseLike<RpcResult<unknown>>
    )("activate_menu_version_confirmed", {
      p_version_id: versionId,
      p_expected_revision: revision(),
      p_retirements: retirements ?? 0,
    })
  )
}
