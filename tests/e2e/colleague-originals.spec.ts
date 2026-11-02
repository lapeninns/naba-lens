import { writeFileSync } from "node:fs"

import { expect, test } from "@playwright/test"

import { anonClient, signIn, type Db } from "../support/identities"
import { getLocalSupabaseEnv } from "../support/local-supabase"
import { supportedMp4, syntheticJpeg } from "./helpers/media"
import { provisioner } from "./helpers/stack"
import { openPortfolio, uploadThroughDialog } from "./helpers/ui"
import { provisionWorld, signedInPage } from "./helpers/world"

/**
 * Colleague media rows through Supabase directly (not the app), as a signed-in
 * staff member with a real JWT. The community rule lets staff read active
 * colleagues' ready media rows; it must never give a path to stored bytes:
 * end users have no storage read, list or signing rights, and only the app's
 * authorised routes sign derivatives. Hidden rows (deactivated uploader,
 * deleted asset) must not be readable at all.
 */

type AssetRow = Record<string, unknown> & {
  id: string
  original_path: string
  thumbnail_path: string | null
  preview_path: string | null
}

const env = getLocalSupabaseEnv()

async function storageAttempts(db: Db, token: string, path: string) {
  const bucket = db.storage.from("media")
  const download = await bucket.download(path)
  const signed = await bucket.createSignedUrl(path, 60)
  const signedMany = await bucket.createSignedUrls([path], 60)
  const publicUrl = bucket.getPublicUrl(path).data.publicUrl
  const publicRes = await fetch(publicUrl)
  const authRes = await fetch(
    `${env.url}/storage/v1/object/authenticated/media/${path}`,
    {
      headers: { authorization: `Bearer ${token}`, apikey: env.publishableKey },
    }
  )
  const folder = path.split("/").slice(0, 2).join("/")
  const listed = await bucket.list(folder)
  return {
    download: download.data ? `bytes:${download.data.size}` : "refused",
    createSignedUrl: signed.data?.signedUrl ? "signed" : "refused",
    createSignedUrls:
      signedMany.data?.some((s) => s.signedUrl) === true ? "signed" : "refused",
    publicUrl: publicRes.status,
    authenticatedGet: authRes.status,
    list: listed.data?.length ? `listed:${listed.data.length}` : "nothing",
  }
}

const REFUSED = {
  download: "refused",
  createSignedUrl: "refused",
  createSignedUrls: "refused",
  list: "nothing",
}

test("staff reading colleagues' media rows directly get no path to stored bytes; hidden rows stay hidden", async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "direct API probe; once")
  test.setTimeout(180_000)
  const world = await provisionWorld()
  const service = provisioner()

  // Staff B (same venue as A) and staff C (other venue) upload through the
  // real dialog, so the stored objects are exactly what production writes.
  const photo = await syntheticJpeg(`colleague-original-${world.tag}.jpg`)
  const clip = supportedMp4(`colleague-original-${world.tag}.mp4`)
  const doomed = await syntheticJpeg(`colleague-deleted-${world.tag}.jpg`)
  const pageB = await signedInPage(browser, world.staffB)
  await openPortfolio(pageB)
  await uploadThroughDialog(pageB, [photo, clip])
  const pageC = await signedInPage(browser, world.staffC)
  await openPortfolio(pageC)
  await uploadThroughDialog(pageC, [doomed])
  await pageB.context().close()
  await pageC.context().close()

  const rowsOf = async (uploader: string) => {
    const { data, error } = await service
      .from("media_assets")
      .select("*")
      .eq("uploader_id", uploader)
    if (error) throw error
    return data as unknown as AssetRow[]
  }
  const bAssets = await rowsOf(world.staffB.id)
  const [cAsset] = await rowsOf(world.staffC.id)
  expect(bAssets).toHaveLength(2)

  const staffA = await signIn(service, world.staffA.email)
  const token = (await staffA.auth.getSession()).data.session!.access_token
  const findings: Record<string, unknown> = {}

  // (a) What a colleague's row exposes.
  const read = await staffA
    .from("media_assets")
    .select("*")
    .in(
      "id",
      bAssets.map((a) => a.id)
    )
  expect(read.error).toBeNull()
  const visible = (read.data ?? []) as unknown as AssetRow[]
  findings.colleagueRowsVisible = visible.length
  findings.colleagueRowColumns = Object.keys(visible[0] ?? {}).sort()
  findings.exposesOriginalPath = visible.every((r) => !!r.original_path)
  findings.exposesOriginalFilename = visible.every(
    (r) => typeof r.original_filename === "string"
  )

  // Control: the objects exist (the service role can read them), so each
  // refusal below is about access, not a missing object.
  for (const asset of bAssets) {
    for (const path of [
      asset.original_path,
      asset.thumbnail_path,
      asset.preview_path,
    ]) {
      if (!path) continue
      const control = await service.storage.from("media").download(path)
      expect(control.error, `control ${path}`).toBeNull()
    }
  }

  // (b) Every direct storage route to those keys, as staff A.
  const attempts: Record<string, unknown> = {}
  for (const asset of bAssets) {
    for (const [kind, path] of [
      ["original", asset.original_path],
      ["thumb", asset.thumbnail_path],
      ["preview", asset.preview_path],
    ] as const) {
      if (!path) continue
      const label = `${asset.original_filename} ${kind}`
      const result = await storageAttempts(staffA, token, path)
      attempts[label] = result
      expect(result, label).toMatchObject(REFUSED)
      expect(result.publicUrl, `${label} public URL`).not.toBe(200)
      expect(result.authenticatedGet, `${label} authenticated GET`).not.toBe(
        200
      )
    }
  }
  findings.storageAttempts = attempts

  // (c) Hidden rows: a deleted asset and a deactivated colleague.
  // A colleague cannot delete it (whatever the call answers, it stays).
  await staffA.rpc("delete_media_asset", { p_asset_id: cAsset!.id })
  const untouched = await service
    .from("media_assets")
    .select("deleted_at")
    .eq("id", cAsset!.id)
    .single()
  expect(untouched.data?.deleted_at ?? null).toBeNull()
  const staffC = await signIn(service, world.staffC.email)
  const removed = await staffC.rpc("delete_media_asset", {
    p_asset_id: cAsset!.id,
  })
  expect(removed.error).toBeNull()
  const afterDelete = await staffA
    .from("media_assets")
    .select("id")
    .eq("id", cAsset!.id)
  findings.deletedRowVisible = afterDelete.data?.length ?? 0
  expect(afterDelete.data ?? []).toEqual([])
  findings.deletedStorage = await storageAttempts(
    staffA,
    token,
    cAsset!.original_path
  )

  const left = await service
    .from("profiles")
    .update({ active: false })
    .eq("id", world.staffB.id)
  if (left.error) throw left.error
  const afterLeave = await staffA
    .from("media_assets")
    .select("id")
    .in(
      "id",
      bAssets.map((a) => a.id)
    )
  findings.deactivatedColleagueRowsVisible = afterLeave.data?.length ?? 0
  expect(afterLeave.data ?? []).toEqual([])
  findings.deactivatedStorage = await storageAttempts(
    staffA,
    token,
    bAssets[0]!.original_path
  )
  expect(findings.deactivatedStorage).toMatchObject(REFUSED)

  // Signed out: nothing at all.
  const anon = await anonClient()
    .from("media_assets")
    .select("id")
    .in(
      "id",
      bAssets.map((a) => a.id)
    )
  findings.anonymousRowsVisible = anon.data?.length ?? 0
  expect(anon.data ?? []).toEqual([])

  const out = testInfo.outputPath("colleague-originals.json")
  writeFileSync(out, JSON.stringify(findings, null, 2) + "\n")
  await testInfo.attach("findings", { path: out })
})
