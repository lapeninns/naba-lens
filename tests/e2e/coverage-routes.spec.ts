import { randomUUID } from "node:crypto"

import { expect, test, type APIResponse, type Page } from "@playwright/test"

import sharp from "sharp"

import { signIn, type Db } from "../support/identities"
import {
  legacyStaffGrant,
  provisionCoverageWorld,
  seedImages,
  type CoverageWorld,
} from "./helpers/coverage-world"
import { provisioner, psql } from "./helpers/stack"
import { seedReadyAssets, signedInPage } from "./helpers/world"

/**
 * Coverage route handlers in the built app (owner handoff §4; AC-26, AC-27),
 * called over HTTP with real sessions. The services' own tests call these
 * in-process; these go through `next start`, the proxy and the cookies.
 */

type RpcResult<T> = {
  data: T | null
  error: { code: string; message: string; details?: string | null } | null
}

async function ok<T>(call: PromiseLike<RpcResult<T>>): Promise<T> {
  const { data, error } = await call
  if (error) {
    throw new Error(`${error.message} (${error.code}) ${error.details ?? ""}`)
  }
  return data as T
}

const key = () => `ws5-${randomUUID()}`
const UUID_TEXT =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

const evidence = (page: Page, assetId: string, kind: "thumb" | "preview") =>
  page.request.get(`/api/coverage/evidence/${assetId}/${kind}`, {
    maxRedirects: 0,
  })

/** Lifetime in seconds of the storage token in a signed URL. */
function signedLifetime(location: string): number {
  const token = new URL(location).searchParams.get("token")!
  const claims = JSON.parse(
    Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")
  ) as { exp: number; iat: number }
  return claims.exp - claims.iat
}

async function expectPrivateRedirect(
  page: Page,
  res: APIResponse,
  kind: "thumb" | "preview",
  label: string
) {
  expect(res.status(), label).toBe(302)
  const headers = res.headers()
  expect(
    {
      cache: headers["cache-control"],
      nosniff: headers["x-content-type-options"],
    },
    label
  ).toEqual({ cache: "private, no-store", nosniff: "nosniff" })
  expect(headers["referrer-policy"], `${label} referrer`).toBe("no-referrer")
  const location = headers["location"]!
  expect(location, label).toMatch(
    new RegExp(`/storage/v1/object/sign/media/.+/${kind}\\.webp\\?`)
  )
  expect(signedLifetime(location), label).toBeLessThanOrEqual(60)
  const image = await page.request.get(location)
  expect(image.status(), label).toBe(200)
  expect(image.headers()["content-type"], label).toBe("image/webp")
}

async function expectNotFound(res: APIResponse, label: string) {
  expect(res.status(), label).toBe(404)
  expect(res.headers()["location"], label).toBeUndefined()
  expect(res.headers()["cache-control"], label).toBe("private, no-store")
}

test.describe("coverage evidence previews (AC-27)", () => {
  test.setTimeout(180_000)

  test("only the author, the venue's manager and admins get a short private redirect; everything else is 404", async ({
    browser,
  }) => {
    const w: CoverageWorld = await provisionCoverageWorld()
    const service = provisioner()
    const admin: Db = await signIn(service, w.admin.email)
    const staffA: Db = await signIn(service, w.staffA.email)
    const grant = await legacyStaffGrant(w.admin, w.manager, w.venue1)
    const [photo, unsubmitted, deletedLater] = await seedImages(
      w.staffA,
      w.venue1,
      3,
      { prefix: `ws5-evidence-${w.tag}` }
    )
    const [video] = await seedReadyAssets(
      w.staffA.id,
      w.venue1.id,
      1,
      "video",
      `ws5-evidence-video-${w.tag}`
    )
    await ok(
      staffA.rpc("submit_coverage_photos", {
        p_asset_ids: [photo!, deletedLater!],
        p_client_request_key: key(),
      })
    )

    const author = await signedInPage(browser, w.staffA)
    const manager = await signedInPage(browser, w.manager)
    const adminPage = await signedInPage(browser, w.admin)
    const colleague = await signedInPage(browser, w.staffB)
    const otherVenue = await signedInPage(browser, w.staffC)
    const anonymous = await (await browser.newContext()).newPage()

    for (const [who, page] of [
      ["author", author],
      ["manager", manager],
      ["admin", adminPage],
    ] as const) {
      for (const kind of ["thumb", "preview"] as const) {
        await expectPrivateRedirect(
          page,
          await evidence(page, photo!, kind),
          kind,
          `${who} ${kind}`
        )
      }
    }
    // Colleagues (same venue, not the manager) and other venues: task evidence
    // is not community media.
    for (const [who, page] of [
      ["same-venue colleague", colleague],
      ["other-venue staff", otherVenue],
    ] as const) {
      for (const kind of ["thumb", "preview"] as const) {
        await expectNotFound(
          await evidence(page, photo!, kind),
          `${who} ${kind}`
        )
      }
    }
    for (const kind of ["thumb", "preview"] as const) {
      const res = await evidence(anonymous, photo!, kind)
      expect(res.status(), `anonymous ${kind}`).toBe(401)
      expect(res.headers()["location"]).toBeUndefined()
    }
    // Unknown, malformed, never submitted, and video ids look the same.
    for (const [label, id] of [
      ["unknown id", randomUUID()],
      ["malformed id", "not-a-uuid"],
      ["unsubmitted photo", unsubmitted!],
      ["video", video!],
    ] as const) {
      for (const [who, page] of [
        ["manager", manager],
        ["admin", adminPage],
      ] as const) {
        await expectNotFound(
          await evidence(page, id, "thumb"),
          `${who} ${label}`
        )
      }
    }

    // Deleted evidence is gone for everyone.
    await ok(staffA.rpc("delete_media_asset", { p_asset_id: deletedLater! }))
    for (const [who, page] of [
      ["author", author],
      ["manager", manager],
      ["admin", adminPage],
    ] as const) {
      await expectNotFound(
        await evidence(page, deletedLater!, "preview"),
        `${who} deleted`
      )
    }

    // The author leaves: their retained evidence stays reviewable by the
    // manager and admins; their own session is refused.
    const left = await service
      .from("profiles")
      .update({ active: false })
      .eq("id", w.staffA.id)
    if (left.error) throw left.error
    for (const [who, page] of [
      ["manager", manager],
      ["admin", adminPage],
    ] as const) {
      await expectPrivateRedirect(
        page,
        await evidence(page, photo!, "preview"),
        "preview",
        `${who} after the author left`
      )
    }
    expect((await evidence(author, photo!, "thumb")).status()).toBe(403)
    await expectNotFound(
      await evidence(colleague, photo!, "thumb"),
      "colleague after the author left"
    )

    // Revoking the grant ends the manager's access on their next request.
    await ok(
      admin.rpc("revoke_venue_manager", {
        p_grant_id: grant,
        p_reason: "WS5: evidence route check",
      })
    )
    await expectNotFound(
      await evidence(manager, photo!, "thumb"),
      "manager after revoke"
    )
    await expectPrivateRedirect(
      adminPage,
      await evidence(adminPage, photo!, "thumb"),
      "thumb",
      "admin after revoke"
    )

    for (const page of [author, manager, adminPage, colleague, otherVenue]) {
      await page.context().close()
    }
    await anonymous.context().close()
  })
})

test.describe("private media responses send no-referrer (D-004)", () => {
  test("media, avatar and evidence redirects and 404s say no-referrer; ordinary pages keep the global policy", async ({
    browser,
  }) => {
    const w = await provisionCoverageWorld()
    const [photo] = await seedImages(w.staffA, w.venue1, 1)
    const owner = await signedInPage(browser, w.staffA)
    const colleague = await signedInPage(browser, w.staffB)
    const avatar = await sharp({
      create: { width: 256, height: 256, channels: 3, background: "#5a8f6b" },
    })
      .jpeg()
      .toBuffer()
    const set = await owner.request.post("/api/profile", {
      multipart: {
        displayName: w.staffA.name,
        avatar: { name: "me.jpg", mimeType: "image/jpeg", buffer: avatar },
      },
    })
    expect(set.status()).toBe(200)

    const cases: [Page, string, number[]][] = [
      [owner, `/api/media/${photo}/thumb`, [302]],
      [owner, `/api/media/${photo}/preview`, [302]],
      [colleague, `/api/media/${photo}/thumb`, [302]],
      [colleague, `/api/media/${photo}/download`, [403, 404]],
      [owner, `/api/media/${randomUUID()}/thumb`, [404]],
      [colleague, `/api/avatars/${w.staffA.id}`, [302]],
      [colleague, `/api/avatars/${randomUUID()}`, [404]],
      [owner, `/api/coverage/evidence/${randomUUID()}/thumb`, [404]],
    ]
    for (const [page, path, statuses] of cases) {
      const res = await page.request.get(path, { maxRedirects: 0 })
      const label = path.replace(UUID_TEXT, "<id>")
      expect(statuses, label).toContain(res.status())
      expect(res.headers()["referrer-policy"], label).toBe("no-referrer")
    }
    const ordinary = await owner.request.get("/staff/tasks")
    expect(ordinary.status()).toBe(200)
    expect(ordinary.headers()["referrer-policy"]).toBe(
      "strict-origin-when-cross-origin"
    )
  })
})

const PREPARE = "/api/internal/coverage/monthly-preparation"

const secret = process.env.CLEANUP_SECRET

function runCount(): number {
  return Number(
    psql(
      `select count(*) from public.coverage_preparation_runs where run_trigger = 'scheduled'`
    )
  )
}

test.describe("signed out (R-X1)", () => {
  test("every coverage page goes to /login; evidence and the scheduler give nothing away", async ({
    browser,
  }) => {
    const w = await provisionCoverageWorld()
    const [photo] = await seedImages(w.staffA, w.venue1, 1)
    const context = await browser.newContext()
    const page = await context.newPage()
    for (const path of [
      "/staff/tasks",
      "/staff/tasks/month",
      `/staff/tasks/${randomUUID()}`,
      "/staff/manage",
      "/staff/manage/review",
      "/staff/manage/team",
      "/staff/manage/checklist",
      `/staff/manage/checklist/${randomUUID()}`,
      "/staff/manage/menu",
      "/admin/coverage",
      "/admin/coverage/managers",
      `/admin/coverage/${w.venue1.id}`,
      `/admin/coverage/${w.venue1.id}/review`,
    ]) {
      await page.goto(path)
      await expect(page, path.replace(UUID_TEXT, "<id>")).toHaveURL(
        /\/login(\?|$)/
      )
    }
    for (const kind of ["thumb", "preview"] as const) {
      const res = await page.request.get(
        `/api/coverage/evidence/${photo}/${kind}`,
        { maxRedirects: 0 }
      )
      expect([401, 404], kind).toContain(res.status())
      expect(res.headers()["location"], kind).toBeUndefined()
    }
    const before = runCount()
    const prepare = await page.request.get(PREPARE, { maxRedirects: 0 })
    expect([401, 503]).toContain(prepare.status())
    expect(runCount()).toBe(before)
    await context.close()
  })
})

test.describe("scheduled monthly preparation route (AC-26)", () => {
  test("without a configured secret it answers 503 and runs nothing", async ({
    request,
  }) => {
    test.skip(!!secret, "runs against an app started without CLEANUP_SECRET")
    const before = runCount()
    for (const method of ["GET", "POST"]) {
      const res = await request.fetch(PREPARE, {
        method,
        headers: { authorization: `Bearer ${"x".repeat(48)}` },
      })
      expect(res.status(), method).toBe(503)
      expect(await res.json()).toEqual({ error: "not_configured" })
      expect(res.headers()["cache-control"]).toBe("private, no-store")
    }
    expect(runCount()).toBe(before)
  })

  test("a wrong or missing bearer is 401; the right one runs once with counts only; a repeat changes nothing", async ({
    request,
  }) => {
    test.skip(!secret, "needs CLEANUP_SECRET in the app and test environment")
    const w = await provisionCoverageWorld()
    const before = runCount()
    for (const authorization of [
      undefined,
      "Bearer wrong-secret-that-is-long-enough-to-count-000",
      `Bearer ${secret}x`,
      `Basic ${secret}`,
    ]) {
      const res = await request.fetch(PREPARE, {
        method: "GET",
        headers: authorization ? { authorization } : {},
      })
      expect(res.status(), authorization?.slice(0, 6) ?? "none").toBe(401)
      expect(await res.json()).toEqual({ error: "unauthorized" })
      expect(res.headers()["cache-control"]).toBe("private, no-store")
    }
    expect(runCount()).toBe(before)

    const first = await request.fetch(PREPARE, {
      method: "GET",
      headers: { authorization: `Bearer ${secret}` },
    })
    expect(first.status()).toBe(200)
    expect(first.headers()["cache-control"]).toBe("private, no-store")
    const text = await first.text()
    expect(text).not.toMatch(UUID_TEXT)
    expect(text).not.toContain("@")
    const body = JSON.parse(text) as {
      status: string
      runs: Record<string, unknown>[]
    }
    expect(body.status).toBe("succeeded")
    expect(body.runs).toHaveLength(1)
    expect(Object.keys(body.runs[0]!).sort()).toEqual(
      [
        "alreadyPresent",
        "candidatesAdded",
        "errorCode",
        "period",
        "placeholdersCreated",
        "staffConsidered",
        "status",
        "targetsCopied",
      ].sort()
    )
    expect(body.runs[0]).toMatchObject({ status: "succeeded", errorCode: null })
    expect(Number(body.runs[0]!.candidatesAdded)).toBeGreaterThanOrEqual(24)
    expect(runCount()).toBe(before + 1)
    // Every active staff member of the new venues now has a row this month.
    const staff = [w.manager, w.staffA, w.staffB, w.joiner, w.staffC]
      .map((p) => `'${p.id}'::uuid`)
      .join(", ")
    expect(
      psql(
        `select count(distinct staff_id) from public.monthly_targets where staff_id in (${staff}) and period_month = (select max(period_month) from public.coverage_preparation_runs)`
      )
    ).toBe("5")

    const again = await request.fetch(PREPARE, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    })
    expect(again.status()).toBe(200)
    expect((await again.json()).runs[0]).toMatchObject({
      status: "succeeded",
      targetsCopied: 0,
      placeholdersCreated: 0,
      candidatesAdded: 0,
    })
  })

  test("a failed run answers 500 with an error code and no database text", async ({
    request,
  }) => {
    test.skip(!secret, "needs CLEANUP_SECRET in the app and test environment")
    // A new venue whose staff need targets, then a fault injected on the
    // owned stack for this test only.
    await provisionCoverageWorld()
    // Drop first too, so a killed earlier run cannot leave the fault behind.
    psql(`
      drop trigger if exists ws5_injected_fault on public.monthly_targets;
      drop function if exists public.ws5_injected_fault();
      create function public.ws5_injected_fault() returns trigger
      language plpgsql as $$ begin raise exception 'WS5 injected fault text'; end $$;
      create trigger ws5_injected_fault before insert on public.monthly_targets
      for each row execute function public.ws5_injected_fault();
    `)
    try {
      const res = await request.fetch(PREPARE, {
        method: "GET",
        headers: { authorization: `Bearer ${secret}` },
      })
      expect(res.status()).toBe(500)
      expect(res.headers()["cache-control"]).toBe("private, no-store")
      const text = await res.text()
      expect(text).not.toContain("WS5 injected")
      expect(text).not.toMatch(UUID_TEXT)
      const body = JSON.parse(text) as {
        status?: string
        error?: string
        runs?: { status: string; errorCode: string | null }[]
      }
      if (body.runs) {
        expect(body.status).toBe("failed")
        expect(body.runs[0]).toMatchObject({ status: "failed" })
        expect(body.runs[0]!.errorCode).toMatch(/^[0-9A-Z]{5}$/)
      } else {
        expect(body).toEqual({ error: "preparation_failed" })
      }
    } finally {
      psql(`
        drop trigger if exists ws5_injected_fault on public.monthly_targets;
        drop function if exists public.ws5_injected_fault();
      `)
    }
  })
})
