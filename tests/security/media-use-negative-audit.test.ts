// B05-02f negative audit (contracts/b05-design.md §2.2 item 3, §2.9): nothing
// but media_use_grant_create creates a use grant. After a photo is accepted
// for menu use, read for an admin download, archived, grouped and reviewed,
// it still has zero grants and reads not_granted. Real identities through
// PostgREST; the service role only builds fixtures and reads state back.
import { createHash, randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import { getReadableAsset } from "@/lib/server/media/access"
import type { Json } from "@/lib/db/types"

import { actorFor } from "../slice/media-actor"
import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import { makeManager, ok, psql } from "./coverage-fixtures"
import { json } from "./knowledge-fixtures"
import {
  item,
  menu,
  publishMenu,
  readDocument,
  reserveReady,
  saveOk,
  section,
} from "./menus-fixtures"

const service = serviceClient()

const grantsOn = (asset: string) =>
  psql(
    `select count(*) from public.media_use_grants where asset_id = '${asset}'`
  )

async function useState(who: TestIdentity, asset: string) {
  return (
    await json<{ state: string }>(who, "asset_use_status", {
      p_asset_id: asset,
    })
  ).state
}

describe("no use grant from anything but a grant command (B05-02f)", () => {
  let admin: TestIdentity
  let staff: TestIdentity
  let mgr: TestIdentity
  let venue: { id: string; name: string }
  let asset: string

  beforeAll(async () => {
    admin = await createIdentity(service, {
      label: "b05-neg-admin",
      role: "admin",
    })
    venue = await createVenue(service, "b05-neg")
    ;[staff, mgr] = await Promise.all([
      createIdentity(service, {
        label: "b05-neg-s",
        role: "staff",
        venueId: venue.id,
      }),
      createIdentity(service, {
        label: "b05-neg-m",
        role: "staff",
        venueId: venue.id,
      }),
    ])
    await makeManager(admin, mgr, venue.id)
    const version = await publishMenu(
      admin,
      venue.id,
      menu("TEST b05 negative", [
        section("mains", "Mains", [item("mains--tikka", "Tikka")]),
      ])
    )
    const tikka = (await readDocument(service, version)).byKey["mains--tikka"]!
    asset = (await reserveReady(service, staff)).id
    await saveOk(staff, {
      asset,
      revision: 0,
      types: ["dish"],
      items: [{ itemId: tikka.itemId, variantId: null }],
      catalogue: version,
    })

    // 1. Accepted for menu use (a review decision).
    await ok(
      mgr.client.rpc("review_menu_item_photo", {
        p_asset_id: asset,
        p_item_id: tikka.itemId,
        p_variant_id: null as unknown as string,
        p_decision: "accepted",
        p_expected_revision: 1,
        p_make_primary: true,
      })
    )
    // 2. The admin download read path.
    const readable = await getReadableAsset(await actorFor(admin), asset)
    expect(readable.ok).toBe(true)
    // 3. An archive receipt.
    const row = (await ok(
      service
        .from("media_assets")
        .select("original_path")
        .eq("id", asset)
        .single()
    )) as { original_path: string }
    const project = "abcdefghijklmnopqrst"
    const hash = "b".repeat(64)
    const blobKey = `${project}/blobs/sha256/bb/${hash}`
    const manifest = {
      format: "nabalens-original-archive@1",
      sourceProjectRef: project,
      sourceBucket: "media",
      assetId: asset,
      uploaderId: staff.id,
      venueId: venue.id,
      uploaderName: "TEST",
      venueName: venue.name,
      originalFilename: "TEST labels.jpg",
      originalPath: row.original_path,
      mediaType: "image",
      mimeType: "image/jpeg",
      sizeBytes: 4,
      uploadedAt: new Date().toISOString(),
      sha256: hash,
      blobKey,
    }
    const manifestHash = createHash("sha256")
      .update(JSON.stringify(manifest))
      .digest("hex")
    await ok(
      service.from("media_archive_receipts").insert({
        asset_id: asset,
        sha256: hash,
        size_bytes: 4,
        mime_type: "image/jpeg",
        source_project_ref: project,
        source_key: row.original_path,
        blob_key: blobKey,
        manifest_key: `${project}/manifests/${asset}/${hash}/${manifestHash}.json`,
        manifest_sha256: manifestHash,
        manifest: manifest as unknown as Json,
      })
    )
    // 4. Group membership.
    const group = await json<string>(staff, "contribution_group_start", {
      p_key: `TEST-${randomUUID()}`,
      p_subject_kind: "menu_item",
      p_subject_id: tikka.itemId,
    })
    await json(staff, "contribution_group_add", {
      p_group_id: group,
      p_asset_ids: [asset],
    })
  })

  it("leaves zero grants and not_granted after every one of those events", async () => {
    expect(
      psql(
        `select state from public.menu_item_photos where asset_id = '${asset}'`
      )
    ).toBe("accepted")
    expect(
      psql(
        `select count(*) from public.media_archive_receipts where asset_id = '${asset}'`
      )
    ).toBe("1")
    expect(
      psql(
        `select count(*) from public.media_contribution_group_members where asset_id = '${asset}'`
      )
    ).toBe("1")
    expect(grantsOn(asset)).toBe("0")
    expect(await useState(staff, asset)).toBe("not_granted")
    expect(await useState(admin, asset)).toBe("not_granted")
  })

  it("has no trigger or other function that writes grants or withdrawals", () => {
    expect(
      psql(`select string_agg(p.proname, ',' order by p.proname) from pg_proc p
        where p.prosrc ~* 'insert\\s+into\\s+public\\.media_use_grants\\s*\\('`)
    ).toBe("media_use_grant_create")
    expect(
      psql(`select count(*) from pg_trigger tg join pg_proc p on p.oid = tg.tgfoid
        where p.prosrc ~* 'media_use_grants|media_use_grant_create|media_use_withdraw'`)
    ).toBe("0")
  })
})
