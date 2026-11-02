import { randomUUID } from "node:crypto"

import { expect, test } from "@playwright/test"

import { signIn, type Db } from "../support/identities"
import { getLocalSupabaseEnv } from "../support/local-supabase"
import {
  londonInstant,
  provisionCoverageWorld,
  seedImages,
} from "./helpers/coverage-world"
import { supportedMp4, syntheticJpeg } from "./helpers/media"
import { provisioner, psql } from "./helpers/stack"
import { openPortfolio, uploadThroughDialog } from "./helpers/ui"
import { provisionWorld, seedReadyAssets, signedInPage } from "./helpers/world"

/**
 * Independent probes for the review findings fixed in schema v6 / services
 * v1.3 (R-01, R-02, R-03, R-04, R-05, R-09, R-10). Every access check runs as
 * a real signed-in user, through the built app or PostgREST directly.
 */

type RpcError = { code: string; message: string; details?: string | null }
type RpcResult<T> = { data: T | null; error: RpcError | null }

async function ok<T>(call: PromiseLike<RpcResult<T>>): Promise<T> {
  const { data, error } = await call
  if (error) {
    throw new Error(`${error.message} (${error.code}) ${error.details ?? ""}`)
  }
  return data as T
}

const key = () => `ws5-${randomUUID()}`
const env = getLocalSupabaseEnv()

/** PostgREST RPC over raw HTTP, so the probe does not depend on generated types. */
async function rawRpc(db: Db, fn: string, body: object) {
  const { data } = await db.auth.getSession()
  const res = await fetch(`${env.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: env.publishableKey,
      authorization: `Bearer ${data.session!.access_token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })
  return { status: res.status, text: await res.text() }
}

/** A UTC instant five days before the current London month began. */
function inLastMonth() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "numeric",
  }).formatToParts(new Date())
  const year = Number(parts.find((p) => p.type === "year")!.value)
  const month = Number(parts.find((p) => p.type === "month")!.value)
  return new Date(
    Date.parse(londonInstant(year, month, 1)) - 5 * 24 * 3600 * 1000
  )
    .toISOString()
    .replace(".000Z", "Z")
}

type SubmitRow = { item_id: string; asset_id: string; replayed: boolean }

/** Grants the manager and returns a new task at venue 1 assigned to staff A. */
async function assignedTask(
  w: Awaited<ReturnType<typeof provisionCoverageWorld>>
) {
  const service = provisioner()
  const admin = await signIn(service, w.admin.email)
  const manager = await signIn(service, w.manager.email)
  await ok(
    admin.rpc("grant_venue_manager", {
      p_staff_id: w.manager.id,
      p_venue_id: w.venue1.id,
    })
  )
  const [row] = await ok(
    manager.rpc("save_coverage_requirement", {
      p_venue_id: w.venue1.id,
      p_requirement_id: null as never,
      p_expected_revision: null as never,
      p_kind: "venue_specific",
      p_title: `WS5 review task ${randomUUID().slice(0, 6)}`,
      p_guidance: null as never,
      p_photo_target: 2,
      p_due_on: null as never,
      p_client_request_key: key(),
    })
  )
  await ok(
    manager.rpc("set_coverage_requirement_assignees", {
      p_requirement_id: row!.requirement_id,
      p_staff_ids: [w.staffA.id],
    })
  )
  return { manager, requirementId: row!.requirement_id }
}

const ownAssets = async (uploaderId: string) => {
  const { data, error } = await provisioner()
    .from("media_assets")
    .select("id, original_filename, media_type")
    .eq("uploader_id", uploaderId)
  if (error) throw error
  return data
}

test.describe("review fixes (schema v6, services v1.3)", () => {
  test.setTimeout(180_000)

  test("R-01: a colleague's video plays inline with no filename; owner and admin keep the download headers", async ({
    browser,
  }) => {
    const world = await provisionWorld()
    const clip = supportedMp4(`r01-clip-${world.tag}.mp4`)
    const owner = await signedInPage(browser, world.staffB)
    await openPortfolio(owner)
    await uploadThroughDialog(owner, [clip])
    const [video] = await ownAssets(world.staffB.id)
    const colleague = await signedInPage(browser, world.staffA)
    const admin = await signedInPage(browser, world.adminA)
    const stream = (page: typeof owner, range?: string) =>
      page.request.get(`/api/media/${video!.id}/stream`, {
        headers: range ? { range } : {},
      })
    const stem = clip.name.replace(/\.mp4$/, "")

    for (const range of [undefined, "bytes=0-99"]) {
      const res = await stream(colleague, range)
      const label = `colleague ${range ?? "full"}`
      expect(res.status(), label).toBe(range ? 206 : 200)
      const headers = res.headers()
      expect(headers["content-disposition"] ?? "", label).toMatch(/^inline/)
      expect(headers["content-disposition"] ?? "", label).not.toMatch(
        /filename/i
      )
      expect(JSON.stringify(headers), label).not.toContain(stem)
      expect(headers["content-type"], label).toBe("video/mp4")
      expect(headers["cache-control"], label).toBe("private, no-store")
      expect(headers["x-content-type-options"], label).toBe("nosniff")
    }
    for (const [who, page] of [
      ["owner", owner],
      ["admin", admin],
    ] as const) {
      const res = await stream(page)
      expect(res.status(), who).toBe(200)
      expect(res.headers()["content-disposition"], who).toMatch(
        new RegExp(`^attachment; filename="${stem}\\.mp4"`)
      )
    }
    expect(
      (await colleague.request.get(`/api/media/${video!.id}/download`)).status()
    ).toBe(404)
  })

  test("R-02: direct reads return only own media rows; no colleague filename reaches community pages or the viewer", async ({
    browser,
  }) => {
    const world = await provisionWorld()
    const photo = await syntheticJpeg(`r02-private-name-${world.tag}.jpg`)
    const owner = await signedInPage(browser, world.staffB)
    await openPortfolio(owner)
    await uploadThroughDialog(owner, [photo])
    const [asset] = await ownAssets(world.staffB.id)
    const stem = photo.name.replace(/\.jpg$/, "")

    const staffA = await signIn(provisioner(), world.staffA.email)
    const rows = await staffA.from("media_assets").select("*")
    expect(rows.error).toBeNull()
    const foreign = (rows.data ?? []).filter(
      (r) => r.uploader_id !== world.staffA.id
    )
    expect(
      foreign.length,
      `colleague rows through select=* (columns: ${Object.keys(foreign[0] ?? {}).join(", ")})`
    ).toBe(0)
    const community = await rawRpc(staffA, "community_media_page", {
      p_uploader: world.staffB.id,
    })
    expect(community.status).toBe(200)
    expect(community.text).toContain(asset!.id)
    expect(community.text).not.toContain(stem)

    const colleague = await signedInPage(browser, world.staffA)
    for (const path of [
      "/staff/community",
      `/staff/people/${world.staffB.id}`,
    ]) {
      const res = await colleague.goto(path)
      expect(res?.status(), path).toBe(200)
      await expect(
        colleague.getByRole("button", { name: /^Photo, / }).first()
      ).toBeVisible()
      expect(await colleague.content(), path).not.toContain(stem)
      await colleague
        .getByRole("button", { name: /^Photo, / })
        .first()
        .click()
      const viewer = colleague.getByRole("dialog")
      await expect(viewer).toBeVisible()
      await expect(viewer).not.toContainText(stem)
      await viewer.press("Escape")
    }
    // The owner still sees their own filename.
    await owner.reload()
    expect(await owner.content()).toContain(stem)

    // The projection colleagues read through: no paths, filename or key.
    const projected = await rawRpc(staffA, "community_readable_assets", {
      p_asset_ids: [asset!.id],
    })
    expect(projected.status).toBe(200)
    const rowsOut = JSON.parse(projected.text) as Record<string, unknown>[]
    expect(rowsOut.map((r) => r.id)).toEqual([asset!.id])
    expect(Object.keys(rowsOut[0]!).sort()).toEqual(
      [
        "id",
        "uploader_id",
        "venue_id",
        "media_type",
        "validated_mime_type",
        "size_bytes",
        "width",
        "height",
        "duration_seconds",
        "has_preview",
        "has_thumbnail",
        "created_at",
      ].sort()
    )
    expect(projected.text).not.toContain(stem)
    const tooMany = await rawRpc(staffA, "community_readable_assets", {
      p_asset_ids: Array.from({ length: 101 }, () => randomUUID()),
    })
    expect(tooMany.status).toBe(400)
    expect(tooMany.text).toContain("invalid_asset_ids")
    const anonymous = await fetch(
      `${env.url}/rest/v1/rpc/community_readable_assets`,
      {
        method: "POST",
        headers: {
          apikey: env.publishableKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({ p_asset_ids: [asset!.id] }),
      }
    )
    expect([401, 403, 404]).toContain(anonymous.status)
    // Once the uploader has left, colleagues get nothing back.
    const left = await provisioner()
      .from("profiles")
      .update({ active: false })
      .eq("id", world.staffB.id)
    if (left.error) throw left.error
    const afterLeave = await rawRpc(staffA, "community_readable_assets", {
      p_asset_ids: [asset!.id],
    })
    expect(afterLeave.status).toBe(200)
    expect(JSON.parse(afterLeave.text)).toEqual([])
  })

  test("R-03: a manager cannot add a departed colleague's photo or a video as amenity evidence, nor preview it", async ({
    browser,
  }) => {
    const w = await provisionCoverageWorld()
    const service = provisioner()
    const admin = await signIn(service, w.admin.email)
    const manager = await signIn(service, w.manager.email)
    await ok(
      admin.rpc("grant_venue_manager", {
        p_staff_id: w.manager.id,
        p_venue_id: w.venue1.id,
      })
    )
    await ok(manager.rpc("prepare_coverage_month", { p_venue_id: w.venue1.id }))
    const [activePhoto] = await seedImages(w.staffA, w.venue1, 1)
    const [departedPhoto] = await seedImages(w.staffB, w.venue1, 1)
    const [video] = await seedReadyAssets(
      w.staffA.id,
      w.venue1.id,
      1,
      "video",
      `r03-video-${w.tag}`
    )
    const left = await service
      .from("profiles")
      .update({ active: false })
      .eq("id", w.staffB.id)
    if (left.error) throw left.error

    // No fact row yet means NULL: any other number is a revision conflict.
    const revision = () => {
      const r = psql(
        `select revision from public.venue_amenity_facts where venue_id = '${w.venue1.id}'::uuid and amenity_key = 'toilets'`
      )
      return r === "" ? (null as never) : Number(r)
    }
    const setFact = (assetIds: string[]) =>
      manager.rpc("set_amenity_fact", {
        p_venue_id: w.venue1.id,
        p_amenity_key: "toilets",
        p_expected_revision: revision(),
        p_presence: "present",
        p_facts: null as never,
        p_policy: null as never,
        p_confirm: false,
        p_asset_ids: assetIds,
      })
    for (const [label, id, detail] of [
      ["departed colleague's photo", departedPhoto!, "inactive_uploader"],
      ["video", video!, "not_image"],
    ] as const) {
      const { error } = await setFact([id])
      expect(
        { code: error?.code, message: error?.message, details: error?.details },
        label
      ).toEqual({
        code: "P0001",
        message: "evidence_not_eligible",
        details: detail,
      })
    }
    expect(
      psql(
        `select count(*) from public.venue_amenity_fact_media where asset_id in ('${departedPhoto}'::uuid, '${video}'::uuid)`
      )
    ).toBe("0")
    // Control: an active colleague's photo is accepted with the same call.
    expect((await setFact([activePhoto!])).error).toBeNull()

    const page = await signedInPage(browser, w.manager)
    for (const id of [departedPhoto!, video!]) {
      const res = await page.request.get(
        `/api/coverage/evidence/${id}/preview`,
        { maxRedirects: 0 }
      )
      expect(res.status(), id).toBe(404)
    }
  })

  test("R-03 follow-up: photos already linked to an amenity are not re-checked; only new ones are", async () => {
    const w = await provisionCoverageWorld()
    const service = provisioner()
    const admin = await signIn(service, w.admin.email)
    const manager = await signIn(service, w.manager.email)
    const staffA = await signIn(service, w.staffA.email)
    await ok(
      admin.rpc("grant_venue_manager", {
        p_staff_id: w.manager.id,
        p_venue_id: w.venue1.id,
      })
    )
    const [deletedLater, extra, deletedNew] = await seedImages(
      w.staffA,
      w.venue1,
      3
    )
    const [leaverPhoto] = await seedImages(w.staffB, w.venue1, 1)
    const revision = () => {
      const r = psql(
        `select revision from public.venue_amenity_facts where venue_id = '${w.venue1.id}'::uuid and amenity_key = 'parking'`
      )
      return r === "" ? (null as never) : Number(r)
    }
    const setFact = (assetIds: string[]) =>
      manager.rpc("set_amenity_fact", {
        p_venue_id: w.venue1.id,
        p_amenity_key: "parking",
        p_expected_revision: revision(),
        p_presence: "present",
        p_facts: null as never,
        p_policy: null as never,
        p_confirm: false,
        p_asset_ids: assetIds,
      })
    const linked = () =>
      psql(
        `select coalesce(string_agg(asset_id::text, ',' order by asset_id), '') from public.venue_amenity_fact_media where venue_id = '${w.venue1.id}'::uuid`
      )

    expect((await setFact([deletedLater!, leaverPhoto!])).error).toBeNull()
    // Then the owner deletes one linked photo and the other's uploader leaves.
    await ok(staffA.rpc("delete_media_asset", { p_asset_id: deletedLater! }))
    await ok(staffA.rpc("delete_media_asset", { p_asset_id: deletedNew! }))
    const left = await service
      .from("profiles")
      .update({ active: false })
      .eq("id", w.staffB.id)
    if (left.error) throw left.error

    const kept = await setFact([deletedLater!, leaverPhoto!, extra!])
    expect(
      kept.error,
      `${kept.error?.code} ${kept.error?.message} ${kept.error?.details ?? ""}`
    ).toBeNull()
    expect(linked()).toBe(
      [deletedLater!, leaverPhoto!, extra!].sort().join(",")
    )

    // Control: a deleted photo that was not linked yet is still refused.
    const added = await setFact([
      deletedLater!,
      leaverPhoto!,
      extra!,
      deletedNew!,
    ])
    expect({ code: added.error?.code, message: added.error?.message }).toEqual({
      code: "P0002",
      message: "media_asset_not_found",
    })
    expect(linked()).toBe(
      [deletedLater!, leaverPhoto!, extra!].sort().join(",")
    )
  })

  test("R-04: a review replay after the grant is revoked is refused; the same key with a different decision is idempotency_key_reused", async () => {
    const w = await provisionCoverageWorld()
    const service = provisioner()
    const admin = await signIn(service, w.admin.email)
    const manager = await signIn(service, w.manager.email)
    const staffA = await signIn(service, w.staffA.email)
    const grant = await ok(
      admin.rpc("grant_venue_manager", {
        p_staff_id: w.manager.id,
        p_venue_id: w.venue1.id,
      })
    )
    const [asset] = await seedImages(w.staffA, w.venue1, 1)
    const [item] = await ok(
      staffA.rpc("submit_coverage_photos", {
        p_asset_ids: [asset!],
        p_client_request_key: key(),
      })
    )
    const k = key()
    await ok(
      manager.rpc("review_coverage_item", {
        p_item_id: item!.item_id,
        p_expected_revision: item!.revision,
        p_decision: "accepted",
        p_client_request_key: k,
      })
    )
    const other = await manager.rpc("review_coverage_item", {
      p_item_id: item!.item_id,
      p_expected_revision: item!.revision + 1,
      p_decision: "needs_another_photo",
      p_reason: "WS5: same key, other decision",
      p_client_request_key: k,
    })
    expect({ message: other.error?.message, code: other.error?.code }).toEqual({
      message: "idempotency_key_reused",
      code: "22023",
    })

    await ok(
      admin.rpc("revoke_venue_manager", {
        p_grant_id: grant,
        p_reason: "WS5: R-04 replay check",
      })
    )
    const replay = await manager.rpc("review_coverage_item", {
      p_item_id: item!.item_id,
      p_expected_revision: item!.revision,
      p_decision: "accepted",
      p_client_request_key: k,
    })
    expect(replay.data ?? []).toEqual([])
    expect({
      code: replay.error?.code,
      message: replay.error?.message,
    }).toEqual({ code: "P0002", message: "coverage_item_not_found" })
  })

  test("R-05: a direct monthly-only submit of a photo from an earlier month is refused", async () => {
    const w = await provisionCoverageWorld()
    const staffA = await signIn(provisioner(), w.staffA.email)
    const [old] = await seedImages(w.staffA, w.venue1, 1, {
      uploadedAt: inLastMonth(),
    })
    const [current] = await seedImages(w.staffA, w.venue1, 1)
    const refused = await staffA.rpc("submit_coverage_photos", {
      p_asset_ids: [old!],
      p_client_request_key: key(),
    })
    expect({
      message: refused.error?.message,
      code: refused.error?.code,
      details: refused.error?.details,
    }).toEqual({
      message: "evidence_not_eligible",
      code: "P0001",
      details: "outside_period",
    })
    expect(
      (
        await staffA.rpc("submit_coverage_photos", {
          p_asset_ids: [current!],
          p_client_request_key: key(),
        })
      ).error
    ).toBeNull()
  })

  test("R-05: an earlier month's pending photo cannot move from a task to monthly-only; a current one can", async () => {
    const w = await provisionCoverageWorld()
    const staffA = await signIn(provisioner(), w.staffA.email)
    const { requirementId } = await assignedTask(w)
    const [old] = await seedImages(w.staffA, w.venue1, 1, {
      uploadedAt: inLastMonth(),
    })
    const [current] = await seedImages(w.staffA, w.venue1, 1)
    await ok(
      staffA.rpc("submit_coverage_photos", {
        p_asset_ids: [old!, current!],
        p_requirement_id: requirementId,
        p_client_request_key: key(),
      })
    )
    const liveOn = (assetId: string) =>
      psql(
        `select coalesce(requirement_id::text, 'monthly-only') from public.coverage_submission_items where asset_id = '${assetId}'::uuid and state = 'submitted' and archived_at is null`
      )

    const moveOld = await staffA.rpc("submit_coverage_photos", {
      p_asset_ids: [old!],
      p_client_request_key: key(),
    })
    expect({
      code: moveOld.error?.code,
      message: moveOld.error?.message,
      details: moveOld.error?.details,
    }).toEqual({
      code: "P0001",
      message: "evidence_not_eligible",
      details: "outside_period",
    })
    expect(liveOn(old!)).toBe(requirementId)

    await ok(
      staffA.rpc("submit_coverage_photos", {
        p_asset_ids: [current!],
        p_client_request_key: key(),
      })
    )
    expect(liveOn(current!)).toBe("monthly-only")
  })

  test("R-07: every row of a submit or attach says whether the call replayed; one of three racing calls is new", async () => {
    const w = await provisionCoverageWorld()
    const staffA = await signIn(provisioner(), w.staffA.email)
    const { manager, requirementId } = await assignedTask(w)
    const mine = await seedImages(w.staffA, w.venue1, 2)
    const colleagues = await seedImages(w.staffB, w.venue1, 2)
    const submitKey = key()
    const attachKey = key()
    const calls = {
      submit: () =>
        staffA.rpc("submit_coverage_photos", {
          p_asset_ids: mine,
          p_client_request_key: submitKey,
        }),
      attach: () =>
        manager.rpc("attach_coverage_evidence", {
          p_requirement_id: requirementId,
          p_asset_ids: colleagues,
          p_client_request_key: attachKey,
        }),
    }
    for (const [label, call] of Object.entries(calls)) {
      const race = await Promise.all([call(), call(), call()])
      const answers = race.map((r) => {
        expect(r.error, label).toBeNull()
        const rows = r.data as unknown as SubmitRow[]
        expect(rows, label).toHaveLength(2)
        const flags = [...new Set(rows.map((row) => row.replayed))]
        expect(flags, `${label}: one flag per call`).toHaveLength(1)
        return { flag: flags[0], items: rows.map((row) => row.item_id).sort() }
      })
      expect(
        answers.filter((a) => a.flag === false),
        `${label}: calls reporting new items`
      ).toHaveLength(1)
      expect(new Set(answers.map((a) => a.items.join(","))).size, label).toBe(1)
      const again = (await ok(call())) as unknown as SubmitRow[]
      expect(
        again.map((row) => row.replayed),
        `${label} retry`
      ).toEqual([true, true])
    }
  })

  test("R-09: a blank reason on an assignee change is not a database check failure", async () => {
    const w = await provisionCoverageWorld()
    const service = provisioner()
    const admin = await signIn(service, w.admin.email)
    const manager = await signIn(service, w.manager.email)
    await ok(
      admin.rpc("grant_venue_manager", {
        p_staff_id: w.manager.id,
        p_venue_id: w.venue1.id,
      })
    )
    const [row] = await ok(
      manager.rpc("save_coverage_requirement", {
        p_venue_id: w.venue1.id,
        p_requirement_id: null as never,
        p_expected_revision: null as never,
        p_kind: "venue_specific",
        p_title: `WS5 R-09 ${w.tag}`,
        p_guidance: null as never,
        p_photo_target: 1,
        p_due_on: null as never,
        p_client_request_key: key(),
      })
    )
    for (const blank of ["", "   "]) {
      const res = await manager.rpc("set_coverage_requirement_assignees", {
        p_requirement_id: row!.requirement_id,
        p_staff_ids: [w.staffA.id],
        p_reason: blank,
      })
      // A blank reason is no reason: the change saves.
      expect(res.error, JSON.stringify(blank)).toBeNull()
    }
  })

  test("R-10: service_role has neither TRUNCATE nor DELETE on any coverage table", () => {
    const tables = [
      "venue_manager_grants",
      "coverage_audit_events",
      "coverage_amenity_templates",
      "venue_amenity_facts",
      "venue_amenity_fact_media",
      "menu_coverage_plans",
      "coverage_requirements",
      "coverage_requirement_assignees",
      "monthly_targets",
      "coverage_submissions",
      "coverage_submission_items",
      "coverage_review_events",
      "coverage_preparation_runs",
    ]
    const rows = psql(`
      select string_agg(t || ':' || has_table_privilege('service_role', 'public.' || t, 'TRUNCATE')::text
        || ':' || has_table_privilege('service_role', 'public.' || t, 'DELETE')::text, ',' order by t)
      from unnest(array[${tables.map((t) => `'${t}'`).join(", ")}]) as t
    `).split(",")
    expect(rows).toEqual([...tables].sort().map((t) => `${t}:false:false`))
  })
})
