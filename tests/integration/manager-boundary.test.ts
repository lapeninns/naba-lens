// Venue manager boundary through the app's real Server Functions and Route
// Handlers (docs/plans/venue-manager-workspace.md, spec §3): a converted
// manager account gets none of the staff or admin media surfaces beyond its
// own manager-era uploads (B02-c: it uploads and labels its own at its
// managed venue). Its staff-era media, colleagues' media, the portfolio,
// community, legacy coverage, deletion and every media, avatar and evidence
// route for those assets refuse it, and nothing else changes in the database.
import { createHash, randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () =>
  import("./auth-support").then((m) => m.nextHeadersMock())
)
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))

import {
  loadSubmittablePhotosAction,
  reviewSubmissionAction,
  submitPhotosAction,
} from "@/app/_coverage/actions"
import {
  loadLabelCatalogue,
  loadLabelEditorContext,
  saveLabelBatch,
} from "@/app/_labels/actions"
import { deleteMedia } from "@/app/_media/actions"
import { GET as avatarRoute } from "@/app/api/avatars/[id]/route"
import { GET as evidencePreviewRoute } from "@/app/api/coverage/evidence/[assetId]/preview/route"
import { GET as evidenceThumbRoute } from "@/app/api/coverage/evidence/[assetId]/thumb/route"
import { GET as libraryRoute } from "@/app/api/library/route"
import { GET as downloadRoute } from "@/app/api/media/[id]/download/route"
import { GET as previewRoute } from "@/app/api/media/[id]/preview/route"
import { GET as streamRoute } from "@/app/api/media/[id]/stream/route"
import { GET as thumbRoute } from "@/app/api/media/[id]/thumb/route"
import { GET as portfolioRoute } from "@/app/api/portfolio/route"
import { POST as profileRoute } from "@/app/api/profile/route"
import { finaliseUpload, loadMyMedia, reserveUpload } from "@/app/staff/actions"
import { loadCommunityPage } from "@/app/staff/community/actions"
import { getCoverageActor } from "@/lib/server/coverage/context"
import { getMediaActor } from "@/lib/server/media/context"

import { makeManager } from "../security/coverage-fixtures"
import { syntheticJpeg } from "../slice/media-actor"
import {
  anonClient,
  createIdentity,
  createVenue,
  serviceClient,
  type Db,
  type TestIdentity,
} from "../support/identities"
import {
  appRequest,
  Browser,
  issueSignInLink,
  readSessionCookie,
} from "./auth-support"
import { followEmailLink } from "./auth-confirm"

const service = serviceClient()
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex")

type Person = TestIdentity & { browser: Browser; rest: Db }

/** Signs in through /auth/confirm; `rest` is a Supabase client on the same session. */
async function person(
  label: string,
  opts: { role: "staff" | "admin"; venueId?: string }
): Promise<Person> {
  const identity = await createIdentity(service, {
    label,
    role: opts.role,
    venueId: opts.venueId ?? null,
    session: false,
  })
  const browser = new Browser(label)
  const res = await followEmailLink(
    browser,
    await issueSignInLink(service, identity.email)
  )
  expect(res.location).toBe("/")
  const { session } = readSessionCookie(browser)
  const rest = anonClient()
  const { error } = await rest.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  })
  if (error) throw error
  return { ...identity, browser, rest }
}

/** Staff upload through the real Server Functions and a signed storage PUT. */
async function upload(staff: Person) {
  const bytes = await syntheticJpeg(320, 240)
  const idempotencyKey = randomUUID()
  const reserved = await staff.browser.run(() =>
    reserveUpload({
      idempotencyKey,
      filename: "dish.jpg",
      sizeBytes: bytes.byteLength,
      contentType: "image/jpeg",
      mediaType: "image",
      preferResumable: false,
    })
  )
  if (!reserved.ok) throw new Error(reserved.message)
  const { assetId, objectKey, token } = reserved.reservation
  const stored = await anonClient()
    .storage.from("media")
    .uploadToSignedUrl(objectKey, token!, bytes, { contentType: "image/jpeg" })
  if (stored.error) throw stored.error
  const done = await staff.browser.run(() =>
    finaliseUpload({ assetId, idempotencyKey })
  )
  if (!done.ok || done.result.state !== "ready")
    throw new Error("finalise failed")
  return { assetId, bytes }
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const assetParams = (assetId: string) => ({
  params: Promise.resolve({ assetId }),
})

async function assetRow(id: string) {
  const { data } = await service
    .from("media_assets")
    .select("deleted_at, uploader_id, venue_id")
    .eq("id", id)
    .single()
  return data!
}

let venue: { id: string; name: string }
let admin: Person
let staff: Person
let manager: Person
/** A colleague's photo at the manager's venue. */
let colleagueAsset: Awaited<ReturnType<typeof upload>>
/** The manager's own photo from before the conversion. */
let ownStaffEraAsset: Awaited<ReturnType<typeof upload>>

beforeAll(async () => {
  venue = await createVenue(service, "mgr-boundary")
  admin = await person("mb-admin", { role: "admin" })
  staff = await person("mb-staff", { role: "staff", venueId: venue.id })
  manager = await person("mb-manager", { role: "staff", venueId: venue.id })
  colleagueAsset = await upload(staff)
  ownStaffEraAsset = await upload(manager)
  await makeManager({ ...admin, client: admin.rest }, manager, venue.id)
})

describe("venue manager boundary", () => {
  const run = <T>(fn: () => Promise<T>) => manager.browser.run(fn)

  it("the default media and coverage actors refuse a manager", async () => {
    expect(await run(() => getMediaActor())).toEqual({
      ok: false,
      status: 403,
      message: "Not allowed.",
    })
    expect(await run(() => getCoverageActor())).toMatchObject({
      ok: false,
      code: "not_permitted",
    })
    // Control: the same session is a working manager actor when named.
    expect((await run(() => getMediaActor("manager"))).ok).toBe(true)
  })

  it("uploads only as a manager upload; staff-era media and the portfolio stay closed (B02-c)", async () => {
    const reserve = await run(() =>
      reserveUpload({
        idempotencyKey: randomUUID(),
        filename: "x.jpg",
        sizeBytes: 10,
        contentType: "image/jpeg",
        mediaType: "image",
        preferResumable: false,
      })
    )
    expect(reserve).toMatchObject({ ok: true })
    const reserved = reserve.ok ? reserve.reservation.assetId : ""
    expect((await assetRow(reserved)).venue_id).toBe(venue.id)
    // Its staff-era upload is not its manager-era one: finalise can't read it.
    expect(
      await run(() =>
        finaliseUpload({
          assetId: ownStaffEraAsset.assetId,
          idempotencyKey: randomUUID(),
        })
      )
    ).toMatchObject({ ok: false, status: 404 })
    expect(await run(() => loadMyMedia(null))).toMatchObject({ ok: false })
    const { count } = await service
      .from("media_assets")
      .select("id", { count: "exact", head: true })
      .eq("uploader_id", manager.id)
    expect(count).toBe(2)
  })

  it("labels: a colleague's or its staff-era photo is never its to label (B02-c)", async () => {
    for (const asset of [colleagueAsset, ownStaffEraAsset])
      expect(
        await run(() => loadLabelEditorContext([asset.assetId]))
      ).toMatchObject({ ok: true, assets: [], missing: [asset.assetId] })
    // Its managed venue's catalogue is readable for its own uploads.
    expect(await run(() => loadLabelCatalogue(venue.id))).toMatchObject({
      ok: true,
    })
    const saved = await run(() =>
      saveLabelBatch([
        {
          assetId: ownStaffEraAsset.assetId,
          expectedRevision: 0,
          catalogueVersionId: null,
          contentTypes: ["dish"],
          note: null,
          items: [],
          missingItem: null,
        } as never,
      ])
    )
    expect(saved).toEqual([
      expect.objectContaining({ ok: false, code: "not_found" }),
    ])
    const { data: labels } = await service
      .from("media_labels")
      .select("asset_id")
      .eq("asset_id", ownStaffEraAsset.assetId)
    expect(labels).toEqual([])
  })

  it("community, legacy coverage and deletion are refused", async () => {
    expect(await run(() => loadCommunityPage({}, null))).toMatchObject({
      ok: false,
    })
    for (const result of [
      await run(() => submitPhotosAction({})),
      await run(() => loadSubmittablePhotosAction({})),
      await run(() => reviewSubmissionAction({})),
    ]) {
      expect(result).toMatchObject({ ok: false, code: "not_permitted" })
    }
    for (const asset of [colleagueAsset, ownStaffEraAsset]) {
      expect((await run(() => deleteMedia(asset.assetId))).ok).toBe(false)
      expect((await assetRow(asset.assetId)).deleted_at).toBeNull()
    }
  })

  it("media, avatar and evidence routes refuse and send no bytes", async () => {
    for (const asset of [colleagueAsset, ownStaffEraAsset]) {
      // The own-media routes admit a manager account for its manager-era
      // uploads only (B02-c), so these answer as unknown assets. Download
      // answers non-admins with the unknown-asset 404 by design.
      for (const [route, status] of [
        [thumbRoute, 404],
        [previewRoute, 404],
        [streamRoute, 404],
        [downloadRoute, 404],
      ] as const) {
        const res = await run(() =>
          route(appRequest(manager.browser, "/x"), params(asset.assetId))
        )
        expect(res.status).toBe(status)
        expect(res.headers.get("location")).toBeNull()
        const body = new Uint8Array(await res.arrayBuffer())
        expect(sha256(body)).not.toBe(sha256(asset.bytes))
      }
      for (const route of [evidencePreviewRoute, evidenceThumbRoute]) {
        const res = await run(() =>
          route(appRequest(manager.browser, "/x"), assetParams(asset.assetId))
        )
        expect(res.status).toBe(403)
        expect(res.headers.get("location")).toBeNull()
      }
    }
    for (const id of [staff.id, manager.id]) {
      const res = await run(() =>
        avatarRoute(appRequest(manager.browser, "/x"), params(id))
      )
      expect(res.status).toBe(403)
    }
    for (const [route, path] of [
      [portfolioRoute, "/api/portfolio"],
      [libraryRoute, "/api/library"],
    ] as const) {
      const res = await run(() => route(appRequest(manager.browser, path)))
      expect(res.status, path).toBe(403)
    }
  })

  it("the staff profile route refuses and changes nothing", async () => {
    const before = (
      await service
        .from("profiles")
        .select("display_name, avatar_path")
        .eq("id", manager.id)
        .single()
    ).data
    const form = new FormData()
    form.set("displayName", "TEST renamed by route")
    const res = await run(() =>
      profileRoute(
        appRequest(manager.browser, "/api/profile", {
          method: "POST",
          body: form,
        })
      )
    )
    expect(res.status).toBe(403)
    const after = (
      await service
        .from("profiles")
        .select("display_name, avatar_path")
        .eq("id", manager.id)
        .single()
    ).data
    expect(after).toEqual(before)
  })

  it("staff and admins keep their access (the denial is per role)", async () => {
    const own = await staff.browser.run(() =>
      thumbRoute(
        appRequest(staff.browser, "/x"),
        params(colleagueAsset.assetId)
      )
    )
    expect(own.status).toBe(302)
    const dl = await admin.browser.run(() =>
      downloadRoute(
        appRequest(admin.browser, "/x"),
        params(ownStaffEraAsset.assetId)
      )
    )
    expect(dl.status).toBe(200)
    expect(sha256(new Uint8Array(await dl.arrayBuffer()))).toBe(
      sha256(ownStaffEraAsset.bytes)
    )
  })
})
