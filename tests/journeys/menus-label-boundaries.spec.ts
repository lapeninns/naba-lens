import { randomUUID } from "node:crypto"

import { expect, test } from "@playwright/test"

import { signIn, type Db } from "../support/identities"
import { sql } from "../fixtures/menus/journey-helpers"
import { provisioner, psql, requireIsolatedStack } from "../e2e/helpers/stack"
import { provisionWorld, seedReadyAssets } from "../e2e/helpers/world"

/**
 * Journey menus.label-boundaries (MENUS-QA-10): label rights follow the account
 * and the asset state. Runs at the API level, as the real users' own sessions
 * (the QA report had no browser journey for this row; the browser-side
 * deactivation checks live in tests/e2e/auth.spec.ts and gaps.spec.ts).
 */

test.beforeAll(() => requireIsolatedStack())

const save = (client: Db, assetId: string, revision = 0) =>
  client.rpc("save_media_labels", {
    p_asset_id: assetId,
    p_expected_revision: revision,
    p_content_types: ["dish"],
    p_note: null as unknown as string,
    p_items: [],
    p_missing_item: null as unknown as string,
  })

function expectDenied(
  result: { error: { message: string; code?: string } | null },
  message: string,
  code: string
) {
  expect(result.error).not.toBeNull()
  expect(result.error?.message).toContain(message)
  expect(result.error?.code).toBe(code)
}

const labelRows = (assetId: string) =>
  psql(
    `select count(*) from public.media_labels where asset_id = ${sql(assetId)}`
  )

async function reserve(
  uploaderId: string,
  venueId: string,
  state: "uploading" | "failed"
) {
  const id = randomUUID()
  const admin = provisioner()
  const insert = await admin.from("media_assets").insert({
    id,
    uploader_id: uploaderId,
    venue_id: venueId,
    original_path: `${uploaderId}/${id}/original.jpg`,
    original_filename: `jr-boundary-${state}-${id.slice(0, 6)}.jpg`,
    media_type: "image",
  })
  if (insert.error) throw insert.error
  if (state === "failed") {
    const failed = await admin
      .from("media_assets")
      .update({ upload_state: "failed" })
      .eq("id", id)
    if (failed.error) throw failed.error
  }
  return id
}

test("menus.label-boundaries: inactive accounts are denied and read nothing", async () => {
  test.setTimeout(120_000)
  const world = await provisionWorld()
  const [staffAsset] = await seedReadyAssets(
    world.staffC.id,
    world.venue2.id,
    1,
    "image",
    `jr-inactive-staff-${world.tag}`
  )
  const [otherAsset] = await seedReadyAssets(
    world.staffA.id,
    world.venue1.id,
    1,
    "image",
    `jr-inactive-admin-${world.tag}`
  )
  const staff = await signIn(provisioner(), world.staffC.email)
  const adminB = await signIn(provisioner(), world.adminB.email)
  expect((await save(staff, staffAsset)).error).toBeNull()

  psql(
    `update public.profiles set active = false where id in (${[world.staffC.id, world.adminB.id].map(sql).join(", ")})`
  )

  expectDenied(await save(staff, staffAsset, 1), "not_active_user", "42501")
  expectDenied(await save(adminB, otherAsset), "not_active_user", "42501")
  expect(labelRows(otherAsset)).toBe("0")
  const details = await adminB.rpc("media_label_details", {
    p_asset_ids: [staffAsset],
  })
  expect(details.data).toEqual([])
  expect((await staff.from("menu_items").select("id")).data).toEqual([])
})

test("menus.label-boundaries: uploading, failed and deleted assets cannot be labelled", async () => {
  test.setTimeout(120_000)
  const world = await provisionWorld()
  const staff = await signIn(provisioner(), world.staffA.email)
  const admin = await signIn(provisioner(), world.adminA.email)

  await test.step("uploading and failed reservations are not found", async () => {
    for (const state of ["uploading", "failed"] as const) {
      const id = await reserve(world.staffA.id, world.venue1.id, state)
      for (const client of [staff, admin]) {
        expectDenied(await save(client, id), "media_asset_not_found", "P0002")
      }
      expect(labelRows(id)).toBe("0")
    }
  })

  await test.step("a deleted asset loses its labels and cannot be labelled again", async () => {
    const [id] = await seedReadyAssets(
      world.staffA.id,
      world.venue1.id,
      1,
      "image",
      `jr-deleted-${world.tag}`
    )
    expect((await save(staff, id)).error).toBeNull()
    expect(labelRows(id)).toBe("1")
    const deleted = await staff.rpc("delete_media_asset", { p_asset_id: id })
    expect(deleted.error).toBeNull()
    const details = await admin.rpc("media_label_details", {
      p_asset_ids: [id],
    })
    expect(details.data).toEqual([])
    for (const client of [staff, admin]) {
      expectDenied(await save(client, id, 1), "media_asset_not_found", "P0002")
    }
  })
})
