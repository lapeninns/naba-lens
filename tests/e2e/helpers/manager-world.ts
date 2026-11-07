import { randomUUID } from "node:crypto"

import { signIn, type Db } from "../../support/identities"
import { seedImages } from "./coverage-world"
import { activateMenu, ok } from "./menus"
import { provisioner, psql } from "./stack"
import { createPeople, createVenues, type Person, type Venue } from "./world"

/**
 * DEV FIXTURE world for the venue manager workspace (/manager), on the
 * isolated stack only. Venue A and venue B each have an active four-item
 * menu: Soup and Salad (Starters), Pie (Mains) and Lager (Drinks). mgrA and
 * mgrB are real venue manager ACCOUNTS, converted from staff by the admin's
 * own session through convert_account_to_manager (audited, with a reason),
 * so each holds an effective grant for its venue. staffA1 and staffA2 are
 * staff at venue A. Nothing here decides a photo: decisions go through the
 * pages, and labels are saved by each uploader's own session.
 */
export type ManagerWorld = {
  tag: string
  venueA: Venue
  venueB: Venue
  admin: Person
  mgrA: Person
  mgrB: Person
  staffA1: Person
  staffA2: Person
  /** Active menu at venue A: item ids by name. */
  itemsA: MenuItems
  /** Active menu at venue B: item ids by name. */
  itemsB: MenuItems
  /** The admin's own session (database), for fixture writes an admin makes. */
  adminDb: Db
}

export type MenuItems = Record<"soup" | "salad" | "pie" | "lager", string>

/** Eligible items on the fixture menu (food and drinks sections). */
export const MENU_SIZE = 4

const sql = (v: string) => `'${v.replace(/'/g, "''")}'`

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

async function activeMenu(admin: Db, venueId: string, title: string) {
  const versionId = (await ok(
    admin.rpc("create_menu_draft", {
      p_venue_id: venueId,
      p_title: title,
      p_source: {
        kind: "json",
        label: "DEV FIXTURE menu.json",
        sha256: "b".repeat(64),
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
          {
            slug: "drinks",
            name: "Drinks",
            kind: "drinks",
            items: [menuItem("drinks--lager", "Lager")],
          },
        ],
      } as never,
    })
  )) as string
  await activateMenu(admin, versionId)
  const keys: [keyof MenuItems, string][] = [
    ["soup", "starters--soup"],
    ["salad", "starters--salad"],
    ["pie", "mains--pie"],
    ["lager", "drinks--lager"],
  ]
  const items = {} as MenuItems
  for (const [name, key] of keys) items[name] = activeItemId(venueId, key)
  return items
}

/** The stable item id behind a source key in the venue's active version. */
export function activeItemId(venueId: string, sourceKey: string): string {
  const id = psql(`select e.item_id from public.menu_entries e
    join public.menu_versions v on v.id = e.version_id
    where v.venue_id = ${sql(venueId)}::uuid and v.status = 'active' and e.source_key = ${sql(sourceKey)}`)
  if (!id) throw new Error(`No active item ${sourceKey}`)
  return id
}

export function activeVersionId(venueId: string): string {
  return psql(
    `select id from public.menu_versions where venue_id = ${sql(venueId)}::uuid and status = 'active'`
  )
}

/** Converts a staff account into a venue manager account, as the admin. */
export async function convertToManager(
  adminDb: Db,
  who: Pick<Person, "id">,
  venue: Pick<Venue, "id">
): Promise<string> {
  const [row] = await ok(
    adminDb.rpc("convert_account_to_manager", {
      p_profile_id: who.id,
      p_venue_id: venue.id,
      p_reason: "DEV FIXTURE: runs the venue's photo review",
      p_client_request_key: `e2e-mgr-${randomUUID()}`,
    })
  )
  return row!.grant_id
}

export async function provisionManagerWorld(): Promise<ManagerWorld> {
  const tag = randomUUID().slice(0, 6)
  const [venueA, venueB] = await createVenues(tag, ["Mgr One", "Mgr Two"])
  const [admin, mgrA, mgrB, staffA1, staffA2] = createPeople(tag, [
    { label: "Mgr Admin", role: "admin", venueId: null },
    {
      label: "Mgr Manager A",
      role: "staff",
      venueId: venueA.id,
      jobTitle: "General Manager",
    },
    {
      label: "Mgr Manager B",
      role: "staff",
      venueId: venueB.id,
      jobTitle: "General Manager",
    },
    {
      label: "Mgr Staff One",
      role: "staff",
      venueId: venueA.id,
      jobTitle: "Chef",
    },
    {
      label: "Mgr Staff Two",
      role: "staff",
      venueId: venueA.id,
      jobTitle: "Bartender",
    },
  ])
  // Complete profiles, so staff land on Home rather than setup.
  psql(`update public.profiles set department = 'boh'
    where id in (${[mgrA, mgrB, staffA1, staffA2].map((p) => `${sql(p.id)}::uuid`).join(", ")})`)

  const adminDb = await signIn(provisioner(), admin.email)
  const itemsA = await activeMenu(adminDb, venueA.id, `Manager menu A ${tag}`)
  const itemsB = await activeMenu(adminDb, venueB.id, `Manager menu B ${tag}`)
  await convertToManager(adminDb, mgrA, venueA)
  await convertToManager(adminDb, mgrB, venueB)
  return {
    tag,
    venueA,
    venueB,
    admin,
    mgrA,
    mgrB,
    staffA1,
    staffA2,
    itemsA,
    itemsB,
    adminDb,
  }
}

/**
 * Saves labels on one photo as its uploader (their own session): menu items
 * and content types, like the label editor does.
 */
export async function labelAsUploader(
  who: Pick<Person, "email">,
  venueId: string,
  assetId: string,
  itemIds: string[],
  contentTypes: string[] = []
) {
  const client = await signIn(provisioner(), who.email)
  const { error } = await client.rpc("save_media_labels", {
    p_asset_id: assetId,
    p_expected_revision: 0,
    p_content_types: contentTypes,
    p_note: null as unknown as string,
    p_items: itemIds.map((itemId) => ({ itemId, variantId: null })),
    p_missing_item: null as unknown as string,
    p_catalogue_version_id: activeVersionId(venueId),
  })
  if (error) throw new Error(`fixture label save failed: ${error.message}`)
}

/** One ready photo by `who` at `venue` with real derivatives, labelled as `itemIds`. */
export async function labelledPhoto(
  who: Person,
  venue: Venue,
  itemIds: string[],
  options: { contentTypes?: string[]; colour?: string; prefix?: string } = {}
): Promise<string> {
  const [asset] = await seedImages(who, venue, 1, {
    prefix: options.prefix ?? "DEV-FIXTURE-manager",
    colour: options.colour,
  })
  await labelAsUploader(who, venue.id, asset!, itemIds, options.contentTypes)
  return asset!
}

/** The live item-photo row of a photo: "item:state:basis[:corrects]" or "". */
export function photoRow(assetId: string): string {
  return psql(`select string_agg(item_id || ':' || state || ':' || basis
      || coalesce(':' || corrects_item_id, ''), ',' order by item_id)
    from public.menu_item_photos
    where asset_id = ${sql(assetId)}::uuid`)
}

/** The preferred (menu) photo asset of an item at a venue, or "". */
export function preferredAsset(itemId: string): string {
  return psql(`select coalesce(string_agg(asset_id::text, ','), '')
    from public.menu_item_photos
    where item_id = ${sql(itemId)}::uuid and is_primary and state = 'accepted'`)
}
