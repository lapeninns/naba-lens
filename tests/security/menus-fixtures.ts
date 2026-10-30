// Shared fixtures for the v0.3 catalogue/label DB tests (menus-db, labels-db).
// Every assertion in those suites runs as a real signed-in identity through
// PostgREST; the service role here only creates venues/accounts/assets and
// reads back persisted state.
import { randomUUID } from "node:crypto"

import { expect } from "vitest"

import type { Json } from "../../lib/db/types"
import type {
  MenuDocItem,
  MenuDocSection,
  MenuDocument,
  MenuDocVariant,
} from "../../lib/menus/types"
import { markReady, type Db, type TestIdentity } from "../support/identities"

export function item(
  sourceKey: string,
  name: string,
  opts: Partial<Omit<MenuDocItem, "variants">> & {
    variants?: (string | MenuDocVariant)[]
  } = {}
): MenuDocItem {
  return {
    itemId: opts.itemId ?? null,
    sourceKey,
    name,
    description: opts.description ?? null,
    aliases: opts.aliases ?? [],
    sourceMeta: opts.sourceMeta ?? {},
    variants: (opts.variants ?? []).map((v) =>
      typeof v === "string" ? { variantId: null, name: v } : v
    ),
    review: opts.review ?? null,
  }
}

export function section(
  slug: string,
  name: string,
  items: MenuDocItem[],
  kind: MenuDocSection["kind"] = "food"
): MenuDocSection {
  return { slug, name, kind, items }
}

export function menu(title: string, sections: MenuDocSection[]): MenuDocument {
  return { title, sections }
}

export const asJson = (value: unknown) => value as unknown as Json

export async function createDraft(
  admin: TestIdentity,
  venueId: string,
  doc: MenuDocument,
  basedOn: string | null = null
): Promise<string> {
  const { data, error } = await admin.client.rpc("create_menu_draft", {
    p_venue_id: venueId,
    p_title: doc.title,
    p_source: asJson({
      kind: "json",
      label: "TEST fixture.json",
      sha256: "a".repeat(64),
      revision: null,
      capturedAt: "2026-10-30T10:00:00Z",
      notes: null,
    }),
    p_document: asJson(doc),
    ...(basedOn ? { p_based_on: basedOn } : {}),
  })
  if (error) throw error
  return data as string
}

export async function activate(admin: TestIdentity, versionId: string) {
  const service = admin.client
  const { data: v, error: readError } = await service
    .from("menu_versions")
    .select("revision")
    .eq("id", versionId)
    .single()
  if (readError) throw readError
  const { error } = await admin.client.rpc("activate_menu_version", {
    p_version_id: versionId,
    p_expected_revision: v.revision,
  })
  if (error) throw error
}

/** Creates and activates a version; returns its id. */
export async function publishMenu(
  admin: TestIdentity,
  venueId: string,
  doc: MenuDocument,
  basedOn: string | null = null
) {
  const id = await createDraft(admin, venueId, doc, basedOn)
  await activate(admin, id)
  return id
}

export type CatalogueRow = {
  itemId: string
  sourceKey: string
  name: string
  sectionSlug: string
  variants: { variantId: string; name: string }[]
}

/** The version's content as a MenuDocument with ids filled (service readback). */
export async function readDocument(
  service: Db,
  versionId: string
): Promise<MenuDocument & { byKey: Record<string, CatalogueRow> }> {
  const { data: version, error: vError } = await service
    .from("menu_versions")
    .select("title")
    .eq("id", versionId)
    .single()
  if (vError) throw vError
  const { data: sections, error } = await service
    .from("menu_sections")
    .select(
      "slug, name, kind, position, menu_entries(item_id, source_key, name, description, aliases, source_meta, position, menu_entry_variants(variant_id, name, position))"
    )
    .eq("version_id", versionId)
    .order("position")
  if (error) throw error
  const byKey: Record<string, CatalogueRow> = {}
  const doc: MenuDocument = {
    title: version.title,
    sections: sections.map((s) => ({
      slug: s.slug,
      name: s.name,
      kind: s.kind as MenuDocSection["kind"],
      items: [...s.menu_entries]
        .sort((a, b) => a.position - b.position)
        .map((e) => {
          const variants = [...e.menu_entry_variants]
            .sort((a, b) => a.position - b.position)
            .map((v) => ({ variantId: v.variant_id, name: v.name }))
          byKey[e.source_key] = {
            itemId: e.item_id,
            sourceKey: e.source_key,
            name: e.name,
            sectionSlug: s.slug,
            variants,
          }
          return {
            itemId: e.item_id,
            sourceKey: e.source_key,
            name: e.name,
            description: e.description,
            aliases: e.aliases,
            sourceMeta: e.source_meta as MenuDocItem["sourceMeta"],
            variants,
            review: null,
          }
        }),
    })),
  }
  return Object.assign(doc, { byKey })
}

export async function reserveReady(
  service: Db,
  staff: TestIdentity,
  mediaType: "image" | "video" = "image"
): Promise<{ id: string; venue_id: string }> {
  const asset = await reserve(staff, mediaType)
  await markReady(
    service,
    asset.id,
    mediaType === "image" ? "image/jpeg" : "video/mp4"
  )
  return asset
}

export async function reserve(
  staff: TestIdentity,
  mediaType: "image" | "video" = "image"
): Promise<{ id: string; venue_id: string }> {
  const { data, error } = await staff.client.rpc("reserve_media_asset", {
    p_client_upload_key: randomUUID(),
    p_size_bytes: 4,
    p_media_type: mediaType,
    p_extension: mediaType === "image" ? "jpg" : "mp4",
    p_original_filename: `TEST labels.${mediaType === "image" ? "jpg" : "mp4"}`,
  })
  if (error) throw error
  return data[0]
}

export type SaveArgs = {
  asset: string
  revision: number
  types?: string[]
  note?: string | null
  items?: { itemId: string; variantId: string | null }[]
  missing?: string | null
  catalogue?: string | null
}

export function saveLabels(user: TestIdentity, args: SaveArgs) {
  return user.client.rpc("save_media_labels", {
    p_asset_id: args.asset,
    p_expected_revision: args.revision,
    p_content_types: args.types ?? [],
    // supabase-js serialises null; the generated type says string.
    p_note: (args.note ?? null) as string,
    p_items: asJson(args.items ?? []),
    ...(args.missing !== undefined
      ? { p_missing_item: args.missing as string }
      : {}),
    ...(args.catalogue ? { p_catalogue_version_id: args.catalogue } : {}),
  })
}

export async function saveOk(user: TestIdentity, args: SaveArgs) {
  const { data, error } = await saveLabels(user, args)
  if (error) throw new Error(`${error.code} ${error.message} ${error.details}`)
  return data[0]
}

/** Asserts a PostgREST error with exactly this code (message) and SQLSTATE. */
export function expectDbError(
  result: { error: { code: string; message: string; details?: string } | null },
  message: string,
  code?: string
) {
  expect(result.error, `expected ${message}`).not.toBeNull()
  expect(result.error!.message).toBe(message)
  if (code) expect(result.error!.code).toBe(code)
}
