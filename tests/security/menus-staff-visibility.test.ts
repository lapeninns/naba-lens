// Staff read access to a menu version's sections, entries and entry variants
// (20261101110000 rewrote those policies as "version_id in (versions the caller
// may read)", evaluated once per query). The rule is unchanged: an active
// version of a venue the staff member may label, i.e. an active staff account
// whose current venue it is, or who owns a non-deleted asset there. Each case
// compares what the staff member's own session reads with that rule applied
// to the service-role view of the data, so any change in who sees what fails.
import { beforeAll, describe, expect, it } from "vitest"

import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import {
  createDraft,
  item,
  menu,
  publishMenu,
  reserveReady,
  section,
} from "./menus-fixtures"

const service = serviceClient()
let venueA: string
let venueB: string
let venueC: string
let admin: TestIdentity
let activeA: string
let retiredA: string
let draftA: string
let activeB: string
let activeC: string
const staff: Record<string, TestIdentity> = {}

const doc = (title: string, tag: string) =>
  menu(title, [
    section("mains", "Mains", [
      item(`mains--stew-${tag}`, `Stew ${tag}`, { variants: ["Small", "Large"] }),
      item(`mains--pie-${tag}`, `Pie ${tag}`),
    ]),
    section("sides", "Sides", [item(`sides--chips-${tag}`, `Chips ${tag}`)]),
  ])

type Seen = { sections: string[]; entries: string[]; variants: string[] }

/** What the identity's own session reads (RLS applies). */
async function seen(who: TestIdentity): Promise<Seen> {
  const ids = async (table: string, column: string) => {
    const { data, error } = await who.client.from(table as "menu_entries").select(column)
    if (error) throw error
    return (data as unknown as Record<string, string>[])
      .map((r) => r[column])
      .sort()
  }
  return {
    sections: await ids("menu_sections", "id"),
    entries: await ids("menu_entries", "id"),
    variants: await ids("menu_entry_variants", "id"),
  }
}

/** The documented rule, from the service role's view of the data. */
async function expected(profileId: string): Promise<Seen> {
  const { data: profile } = await service
    .from("profiles")
    .select("role, active, venue_id")
    .eq("id", profileId)
    .single()
  if (!profile || !profile.active || profile.role !== "staff")
    return { sections: [], entries: [], variants: [] }
  const { data: owned } = await service
    .from("media_assets")
    .select("venue_id")
    .eq("uploader_id", profileId)
    .is("deleted_at", null)
  const venues = new Set<string>([
    ...(profile.venue_id ? [profile.venue_id] : []),
    ...(owned ?? []).map((a) => a.venue_id),
  ])
  const { data: versions } = await service
    .from("menu_versions")
    .select("id")
    .eq("status", "active")
    .in("venue_id", [...venues])
  const versionIds = (versions ?? []).map((v) => v.id)
  const sections = await service
    .from("menu_sections")
    .select("id")
    .in("version_id", versionIds)
  const entries = await service
    .from("menu_entries")
    .select("id, menu_entry_variants(id)")
    .in("version_id", versionIds)
  const sort = (rows: { id: string }[] | null) =>
    (rows ?? []).map((r) => r.id).sort()
  return {
    sections: sort(sections.data),
    entries: sort(entries.data),
    variants: (entries.data ?? [])
      .flatMap((e) => e.menu_entry_variants)
      .map((v) => v.id)
      .sort(),
  }
}

async function expectRuleHolds(who: TestIdentity) {
  const actual = await seen(who)
  expect(actual).toEqual(await expected(who.id))
  return actual
}

beforeAll(async () => {
  venueA = (await createVenue(service, "vis-a")).id
  venueB = (await createVenue(service, "vis-b")).id
  venueC = (await createVenue(service, "vis-c")).id
  admin = await createIdentity(service, { label: "vis-admin", role: "admin" })
  retiredA = await publishMenu(admin, venueA, doc("TEST vis A old", "old"))
  activeA = await publishMenu(admin, venueA, doc("TEST vis A", "a"), retiredA)
  draftA = await createDraft(admin, venueA, doc("TEST vis A draft", "draft"), activeA)
  activeB = await publishMenu(admin, venueB, doc("TEST vis B", "b"))
  activeC = await publishMenu(admin, venueC, doc("TEST vis C", "c"))

  const make = async (
    label: string,
    venueId: string | null,
    active = true
  ) => {
    staff[label] = await createIdentity(service, {
      label: `vis-${label}`,
      role: "staff",
      venueId,
      active,
    })
  }
  await make("a", venueA)
  await make("b", venueB)
  await make("inactive", venueA, false)
  await make("mover", venueA)
  await make("midsession", venueA)
})

describe("staff reads of the catalogue, one check per version", () => {
  it("sees the active version of its own venue only", async () => {
    const a = await expectRuleHolds(staff.a)
    expect(a.entries).toHaveLength(3)
    expect(a.sections).toHaveLength(2)
    expect(a.variants).toHaveLength(2)
    const b = await expectRuleHolds(staff.b)
    expect(b.entries).toHaveLength(3)
    expect(b.entries).not.toEqual(a.entries)
  })

  it("never sees drafts, retired versions or another venue", async () => {
    const { data } = await staff.a.client
      .from("menu_entries")
      .select("version_id")
    const versions = new Set((data ?? []).map((r) => r.version_id))
    expect([...versions]).toEqual([activeA])
    expect(versions.has(retiredA)).toBe(false)
    expect(versions.has(draftA)).toBe(false)
    expect(versions.has(activeB)).toBe(false)
    expect(versions.has(activeC)).toBe(false)
  })

  it("sees nothing as inactive staff", async () => {
    expect(await expectRuleHolds(staff.inactive)).toEqual({
      sections: [],
      entries: [],
      variants: [],
    })
  })

  it("keeps the old venue after a transfer while an own asset remains there", async () => {
    const asset = await reserveReady(service, staff.mover)
    expect(asset.venue_id).toBe(venueA)
    const { error } = await service
      .from("profiles")
      .update({ venue_id: venueB })
      .eq("id", staff.mover.id)
    expect(error).toBeNull()
    const both = await expectRuleHolds(staff.mover)
    expect(both.entries).toHaveLength(6)
    const { error: deleted } = await service
      .from("media_assets")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", asset.id)
    expect(deleted).toBeNull()
    const onlyB = await expectRuleHolds(staff.mover)
    expect(onlyB.entries).toHaveLength(3)
  })

  it("follows a move between venues made while its session is open", async () => {
    const before = await expectRuleHolds(staff.midsession)
    expect(before.entries).toHaveLength(3)
    const { error } = await service
      .from("profiles")
      .update({ venue_id: venueC })
      .eq("id", staff.midsession.id)
    expect(error).toBeNull()
    const after = await expectRuleHolds(staff.midsession)
    expect(after.entries).toHaveLength(3)
    expect(after.entries).not.toEqual(before.entries)
    const { error: off } = await service
      .from("profiles")
      .update({ active: false })
      .eq("id", staff.midsession.id)
    expect(off).toBeNull()
    expect(await expectRuleHolds(staff.midsession)).toEqual({
      sections: [],
      entries: [],
      variants: [],
    })
  })

  it("leaves admin reads of every version unchanged", async () => {
    for (const id of [retiredA, activeA, draftA, activeB, activeC]) {
      const { data, error } = await admin.client
        .from("menu_entries")
        .select("id")
        .eq("version_id", id)
      expect(error).toBeNull()
      expect(data).toHaveLength(3)
    }
  })

  it("answers when a version is activated or retired while a session is open", async () => {
    const before = await expectRuleHolds(staff.b)
    const next = await publishMenu(admin, venueB, doc("TEST vis B next", "b2"), activeB)
    const after = await expectRuleHolds(staff.b)
    expect(after.entries).not.toEqual(before.entries)
    const { data } = await staff.b.client.from("menu_entries").select("version_id")
    expect(new Set((data ?? []).map((r) => r.version_id))).toEqual(new Set([next]))
  })
})
