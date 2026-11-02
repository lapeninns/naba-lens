// Community read access to colleagues' media (20261102160000): raw media rows
// stay own/admin only, and colleagues read a narrow projection through
// community_readable_assets (no storage paths, filename or upload key). Hidden
// (departed uploader), deleted and unfinished assets give nothing. Real
// identities; the service role only builds fixtures.
import { beforeAll, describe, expect, it } from "vitest"

import {
  anonClient,
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import { reserve, reserveReady } from "./menus-fixtures"

const service = serviceClient()
let admin: TestIdentity
let owner: TestIdentity
let colleague: TestIdentity
let departed: TestIdentity
let ownerReady: string
let ownerUnfinished: string
let ownerDeleted: string
let departedReady: string
let colleagueReady: string

const COLUMNS = [
  "created_at",
  "duration_seconds",
  "has_preview",
  "has_thumbnail",
  "height",
  "id",
  "media_type",
  "size_bytes",
  "uploader_id",
  "validated_mime_type",
  "venue_id",
  "width",
]

const readable = (who: TestIdentity, ids: string[]) =>
  who.client.rpc("community_readable_assets", { p_asset_ids: ids })

beforeAll(async () => {
  const venue = (await createVenue(service, "community-assets")).id
  const otherVenue = (await createVenue(service, "community-assets-2")).id
  admin = await createIdentity(service, {
    label: "community-assets-admin",
    role: "admin",
  })
  const staff = (label: string, venueId: string) =>
    createIdentity(service, { label, role: "staff", venueId })
  owner = await staff("community-assets-owner", venue)
  colleague = await staff("community-assets-colleague", otherVenue)
  departed = await staff("community-assets-departed", venue)

  ownerReady = (await reserveReady(service, owner)).id
  ownerUnfinished = (await reserve(owner)).id
  ownerDeleted = (await reserveReady(service, owner)).id
  const deleted = await owner.client.rpc("delete_media_asset", {
    p_asset_id: ownerDeleted,
  })
  if (deleted.error) throw deleted.error
  colleagueReady = (await reserveReady(service, colleague)).id
  departedReady = (await reserveReady(service, departed)).id
  const left = await service
    .from("profiles")
    .update({ active: false })
    .eq("id", departed.id)
  if (left.error) throw left.error
})

describe("colleague media rows", () => {
  it("returns only the caller's own rows to select=*, while admins keep theirs", async () => {
    const { data, error } = await colleague.client
      .from("media_assets")
      .select("*")
    expect(error).toBeNull()
    expect(data!.length).toBeGreaterThan(0)
    expect(data!.every((r) => r.uploader_id === colleague.id)).toBe(true)
    expect(data!.map((r) => r.id)).toContain(colleagueReady)
    for (const id of [ownerReady, departedReady]) {
      const one = await colleague.client
        .from("media_assets")
        .select("id")
        .eq("id", id)
      expect(one.data, id).toEqual([])
    }
    const own = await owner.client
      .from("media_assets")
      .select("id")
      .eq("id", ownerReady)
    expect(own.data).toEqual([{ id: ownerReady }])
    const all = await admin.client
      .from("media_assets")
      .select("id")
      .in("id", [ownerReady, departedReady])
    expect(all.data!.map((r) => r.id).sort()).toEqual(
      [ownerReady, departedReady].sort()
    )
  })

  it("gives colleagues a narrow projection: no paths, filename or upload key", async () => {
    const { data, error } = await readable(colleague, [ownerReady])
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    const row = data![0]!
    expect(Object.keys(row).sort()).toEqual(COLUMNS)
    expect(row).toMatchObject({
      id: ownerReady,
      uploader_id: owner.id,
      media_type: "image",
      validated_mime_type: "image/jpeg",
    })
    const text = JSON.stringify(row)
    expect(text).not.toMatch(/original|path|filename|upload_key|TEST labels/)
  })

  it("gives nothing for hidden, deleted or unfinished assets", async () => {
    expect(
      (
        await readable(colleague, [
          ownerUnfinished,
          ownerDeleted,
          departedReady,
        ])
      ).data
    ).toEqual([])
    // The owner too: only ready, undeleted assets.
    expect(
      (await readable(owner, [ownerUnfinished, ownerDeleted])).data
    ).toEqual([])
    expect((await readable(owner, [ownerReady])).data).toHaveLength(1)
    // Admins read retained media of people who have left.
    expect(
      (await readable(admin, [departedReady, ownerReady]))
        .data!.map((r) => r.id)
        .sort()
    ).toEqual([departedReady, ownerReady].sort())
    expect((await readable(departed, [departedReady])).data).toEqual([])
  })

  it("refuses anonymous callers and more than 100 ids", async () => {
    const anon = await anonClient().rpc("community_readable_assets", {
      p_asset_ids: [ownerReady],
    })
    expect(anon.error).not.toBeNull()
    const many = Array.from({ length: 101 }, () => ownerReady)
    const { error } = await readable(colleague, many)
    expect(error?.message).toBe("invalid_asset_ids")
    expect(error?.code).toBe("22023")
    expect((await readable(colleague, [])).data).toEqual([])
  })

  it("shows the original filename in community listings to its uploader only", async () => {
    const page = (who: TestIdentity) =>
      who.client.rpc("community_media_page", { p_uploader: owner.id })
    const seen = await page(colleague)
    expect(seen.error).toBeNull()
    const row = seen.data!.find((r) => r.id === ownerReady)
    expect(row).toBeDefined()
    expect(row!.original_filename).toBeNull()
    const mine = (await page(owner)).data!.find((r) => r.id === ownerReady)
    expect(mine!.original_filename).toBe("TEST labels.jpg")
  })
})
