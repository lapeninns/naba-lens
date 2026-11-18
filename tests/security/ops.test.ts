// S1-OPS (20261118106000-106300): activity log, settings, notification
// preferences, notifications inbox and triggers, monitoring and the
// notification job. Real signed-in identities through PostgREST for every
// public function: own venue, other venue, staff, manager, admin, inactive and
// anon. The service role and psql only build fixtures and read back.
import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  anonClient,
  createIdentity,
  type TestIdentity,
} from "../support/identities"
import {
  fails,
  insertAsset,
  insertSubmittedItem,
  itemRevision,
  ok,
  psql,
  review,
} from "./coverage-fixtures"
import { call, service, world, type World } from "./knowledge-fixtures"

type Rpc<T> = PromiseLike<{
  data: T | null
  error: { message: string; code: string; details?: string } | null
}>

type ActivityItem = {
  source: string
  id: number
  at: string
  actorId: string | null
  actorRole: string
  venueId: string | null
  action: string
  objectType: string
  objectId: string | null
  oldRevision: number | null
  newRevision: number | null
  reason: string | null
}
type ActivityPage = {
  items: ActivityItem[]
  nextCursor: { at: string; source: string; id: number } | null
}
type Settings = Record<string, unknown> & { revision: number }
type Inbox = {
  items: {
    id: number
    kind: string
    subjectType: string
    subjectId: string | null
    venueId: string | null
    payload: Record<string, unknown>
    state: string
  }[]
  unread: number
  nextBefore: number | null
}

const rpc = <T>(who: TestIdentity, fn: string, args: object = {}) =>
  call(who, fn, args) as unknown as Rpc<T>

const activity = (who: TestIdentity, args: object = {}) =>
  rpc<ActivityPage>(who, "admin_activity", args)
const settings = (who: TestIdentity) => rpc<Settings>(who, "ops_settings")
const setSettings = (
  who: TestIdentity,
  revision: number,
  patch: object,
  reason: string | null = "TEST change"
) =>
  rpc<Settings & { changed: boolean }>(who, "ops_settings_set", {
    p_expected_revision: revision,
    p_patch: patch,
    p_reason: reason,
  })
const inbox = (who: TestIdentity, args: object = {}) =>
  rpc<Inbox>(who, "my_notifications", args)
const unread = (who: TestIdentity) => rpc<number>(who, "my_notification_count")

async function anonRefused(fn: string, args: object = {}) {
  const { error } = await anonClient().rpc(fn as never, args as never)
  expect(error, `anon ${fn}`).not.toBeNull()
}

async function leaver(w: World, label: string, role: "staff" | "admin") {
  const who = await createIdentity(service, {
    label,
    role,
    venueId: role === "admin" ? null : w.venue,
  })
  await ok(service.from("profiles").update({ active: false }).eq("id", who.id))
  return who
}

function failAsset(id: string) {
  // A real failure: the uploader's finalise could not validate the file.
  psql(
    `update public.media_assets set upload_state = 'failed', updated_at = clock_timestamp() where id = '${id}'`
  )
}

async function uploadingAsset(w: World, who: TestIdentity) {
  return insertAsset(service, {
    uploader: who.id,
    venue: w.venue,
    ready: false,
  })
}

let v: World
let other: World
let startRevision: number

beforeAll(async () => {
  ;[v, other] = await Promise.all([world("ops-a"), world("ops-b")])
  startRevision = (await ok(settings(v.admin))).revision
})

afterAll(async () => {
  // Leave the organisation settings at their defaults for other suites.
  const now = await ok(settings(v.admin))
  await ok(
    setSettings(
      v.admin,
      now.revision,
      {
        quietStart: "21:00",
        quietEnd: "08:00",
        reviewReminderDays: 1,
        backlogAlertDays: 7,
        orphanCleanupDays: 7,
        exportProfiles: ["original", "website", "social", "custom"],
        storageQuotaBytes: 107374182400,
        storageAlertPercent: 80,
      },
      "TEST restore defaults"
    )
  )
})

describe("ops_settings", () => {
  it("is readable by every active person with the venue timezone", async () => {
    for (const who of [v.staffA, v.manager, v.admin, other.staffA]) {
      const s = await ok(settings(who))
      expect(s).toMatchObject({
        quietStart: expect.stringMatching(/^\d\d:\d\d$/),
        timezone: "Europe/London",
        exportProfiles: expect.any(Array),
      })
    }
    await fails(
      settings(await leaver(v, "ops-s-gone", "staff")),
      "not_active_user"
    )
    await anonRefused("ops_settings")
  })

  it("lets an admin change settings with the current revision and a reason", async () => {
    const before = await ok(settings(v.admin))
    const changed = await ok(
      setSettings(v.admin, before.revision, {
        quietStart: "22:00",
        exportProfiles: ["website", "original", "website"],
        orphanCleanupDays: 10,
      })
    )
    expect(changed).toMatchObject({
      changed: true,
      quietStart: "22:00",
      orphanCleanupDays: 10,
      exportProfiles: ["original", "website"],
      revision: before.revision + 1,
    })
    // The same values again change nothing.
    expect(
      await ok(setSettings(v.admin, changed.revision, { quietStart: "22:00" }))
    ).toMatchObject({ changed: false, revision: changed.revision })
    // A stale revision is refused.
    await fails(
      setSettings(v.admin, before.revision, { quietStart: "23:00" }),
      "stale_revision",
      "40001"
    )
    // The change is in the activity log with old and new revisions.
    const log = await ok(activity(v.admin, { p_source: "activity" }))
    expect(log.items[0]).toMatchObject({
      action: "settings_changed",
      objectType: "settings",
      actorId: v.admin.id,
      actorRole: "admin",
      oldRevision: before.revision,
      newRevision: before.revision + 1,
      reason: "TEST change",
    })
  })

  it("validates every field and requires a reason", async () => {
    const { revision } = await ok(settings(v.admin))
    const cases: [object, string][] = [
      [{ quietStart: "24:00" }, "invalid_quiet_hours"],
      [{ quietEnd: 8 }, "invalid_quiet_hours"],
      [{ reviewReminderDays: 0 }, "invalid_reminder_days"],
      [{ reviewReminderDays: 1.5 }, "invalid_reminder_days"],
      [{ backlogAlertDays: 61 }, "invalid_backlog_days"],
      [{ orphanCleanupDays: 31 }, "invalid_cleanup_days"],
      [{ exportProfiles: [] }, "invalid_export_profiles"],
      [{ exportProfiles: ["tiff"] }, "invalid_export_profiles"],
      [{ storageQuotaBytes: 10 }, "invalid_storage_quota"],
      [{ storageAlertPercent: 100 }, "invalid_alert_percent"],
      [{ secret: "x" }, "invalid_patch"],
    ]
    for (const [patch, message] of cases)
      await fails(setSettings(v.admin, revision, patch), message)
    await fails(
      setSettings(v.admin, revision, { quietStart: "20:00" }, "  "),
      "reason_required"
    )
  })

  it("refuses staff, managers, an inactive admin and anon", async () => {
    const { revision } = await ok(settings(v.admin))
    for (const who of [v.staffA, v.manager, v.staffManager, other.manager])
      await fails(
        setSettings(who, revision, { quietStart: "20:00" }),
        "not_admin",
        "42501"
      )
    await fails(
      setSettings(await leaver(v, "ops-s-admin-gone", "admin"), revision, {
        quietStart: "20:00",
      }),
      "not_admin"
    )
    await anonRefused("ops_settings_set", {
      p_expected_revision: revision,
      p_patch: {},
      p_reason: "x",
    })
    expect((await ok(settings(v.admin))).revision).toBe(revision)
  })

  it("started from the documented defaults", () => {
    expect(startRevision).toBeGreaterThanOrEqual(1)
    expect(
      psql(
        `select column_default from information_schema.columns where table_schema = 'public' and table_name = 'ops_settings' and column_name = 'orphan_cleanup_days'`
      )
    ).toBe("7")
  })
})

describe("admin_activity", () => {
  it("records deactivation and reactivation with the admin as actor", async () => {
    const person = await createIdentity(service, {
      label: "ops-act-person",
      role: "staff",
      venueId: v.venue,
    })
    await ok(
      v.admin.client
        .from("profiles")
        .update({ active: false })
        .eq("id", person.id)
    )
    await ok(
      v.admin.client
        .from("profiles")
        .update({ active: true })
        .eq("id", person.id)
    )
    const page = await ok(
      activity(v.admin, { p_venue_id: v.venue, p_source: "activity" })
    )
    // Membership rows for the same account are logged too (S2-FIX R26).
    const mine = page.items.filter(
      (i) => i.objectId === person.id && i.action.startsWith("account_")
    )
    expect(mine.map((i) => i.action)).toEqual([
      "account_reactivated",
      "account_deactivated",
    ])
    expect(mine[1]).toMatchObject({
      actorId: v.admin.id,
      actorRole: "admin",
      venueId: v.venue,
      objectType: "account",
    })
  })

  it("records removal of a finished upload, not of an abandoned reservation", async () => {
    const ready = await insertAsset(service, {
      uploader: v.staffA.id,
      venue: v.venue,
    })
    const reservation = await uploadingAsset(v, v.staffA)
    await ok(
      v.staffA.client.rpc(
        "delete_media_asset" as never,
        {
          p_asset_id: ready.id,
        } as never
      )
    )
    psql(
      `update public.media_assets set deleted_at = now() where id = '${reservation.id}'`
    )
    const page = await ok(
      activity(v.admin, { p_venue_id: v.venue, p_action: "media_removed" })
    )
    expect(page.items.map((i) => i.objectId)).toEqual([ready.id])
    expect(page.items[0]).toMatchObject({ actorId: v.staffA.id })
  })

  it("reads existing history tables and pages with a cursor", async () => {
    // Every source maps onto the common columns.
    const all = await ok(activity(v.admin, { p_venue_id: v.venue }))
    expect(all.items.length).toBeGreaterThan(0)
    for (const item of all.items) {
      expect(item.venueId).toBe(v.venue)
      expect(item.action).toMatch(/^[a-z_]+$/)
    }
    // Working-list changes from the fixture are knowledge history.
    const knowledge = await ok(
      activity(v.admin, { p_venue_id: v.venue, p_source: "knowledge" })
    )
    expect(knowledge.items.length).toBeGreaterThan(0)

    const first = await ok(
      activity(v.admin, { p_venue_id: v.venue, p_limit: 2 })
    )
    expect(first.items).toHaveLength(2)
    expect(first.nextCursor).not.toBeNull()
    const second = await ok(
      activity(v.admin, {
        p_venue_id: v.venue,
        p_limit: 2,
        p_before: first.nextCursor,
      })
    )
    const seen = new Set(first.items.map((i) => `${i.source}:${i.id}`))
    for (const i of second.items)
      expect(seen.has(`${i.source}:${i.id}`)).toBe(false)

    // Filters by actor; another venue's rows stay out.
    const byAdmin = await ok(activity(v.admin, { p_actor_id: v.admin.id }))
    for (const i of byAdmin.items) expect(i.actorId).toBe(v.admin.id)
    const otherVenue = await ok(activity(v.admin, { p_venue_id: other.venue }))
    for (const i of otherVenue.items) expect(i.venueId).toBe(other.venue)

    await fails(
      activity(v.admin, { p_before: { at: "nope", source: "x", id: 1 } }),
      "invalid_cursor"
    )
  })

  it("refuses staff, managers (own or other venue), an inactive admin and anon", async () => {
    for (const who of [v.staffA, v.manager, v.staffManager, other.manager])
      await fails(activity(who, { p_venue_id: v.venue }), "not_admin", "42501")
    await fails(activity(await leaver(v, "ops-act-gone", "admin")), "not_admin")
    await anonRefused("admin_activity")
  })
})

describe("notification preferences", () => {
  it("are the person's own, with organisation quiet hours by default", async () => {
    const start = await ok(
      rpc<Record<string, unknown>>(v.staffB, "my_notification_preferences")
    )
    expect(start).toMatchObject({
      retakes: true,
      assignments: true,
      uploadProblems: true,
      digests: true,
      quietStart: null,
      quietEnd: null,
      timezone: "Europe/London",
    })
    const set = await ok(
      rpc<Record<string, unknown>>(
        v.staffB,
        "set_my_notification_preferences",
        {
          p_patch: { digests: false, quietStart: "22:30", quietEnd: "07:00" },
        }
      )
    )
    expect(set).toMatchObject({
      digests: false,
      quietStart: "22:30",
      quietEnd: "07:00",
    })
    // Another person's preferences are untouched.
    expect(
      await ok(
        rpc<Record<string, unknown>>(v.staffA, "my_notification_preferences")
      )
    ).toMatchObject({ digests: true, quietStart: null })
    // Both null returns to the organisation's quiet hours.
    expect(
      await ok(
        rpc<Record<string, unknown>>(
          v.staffB,
          "set_my_notification_preferences",
          {
            p_patch: { quietStart: null, quietEnd: null, digests: true },
          }
        )
      )
    ).toMatchObject({ digests: true, quietStart: null })
  })

  it("validates the patch", async () => {
    for (const [patch, message] of [
      [{ retakes: "no" }, "invalid_patch"],
      [{ push: true }, "invalid_patch"],
      [{ quietStart: "22:00" }, "invalid_quiet_hours"],
      [{ quietStart: "22:00", quietEnd: "7am" }, "invalid_quiet_hours"],
    ] as const)
      await fails(
        rpc(v.staffA, "set_my_notification_preferences", { p_patch: patch }),
        message
      )
  })

  it("refuses an inactive account and anon", async () => {
    const gone = await leaver(v, "ops-pref-gone", "staff")
    await fails(rpc(gone, "my_notification_preferences"), "not_active_user")
    await fails(
      rpc(gone, "set_my_notification_preferences", {
        p_patch: { digests: false },
      }),
      "not_active_user"
    )
    await anonRefused("my_notification_preferences")
    await anonRefused("set_my_notification_preferences", { p_patch: {} })
  })
})

describe("notifications", () => {
  it("tells the uploader once about a failed upload and resolves it when fixed", async () => {
    const before = await ok(unread(v.staffA))
    const asset = await uploadingAsset(v, v.staffA)
    failAsset(asset.id)
    let box = await ok(inbox(v.staffA))
    const notice = box.items.find((i) => i.subjectId === asset.id)
    expect(notice).toMatchObject({
      kind: "upload_problem",
      subjectType: "media_asset",
      venueId: v.venue,
      state: "unread",
      payload: { problem: "upload_failed", mediaType: "image" },
    })
    expect(await ok(unread(v.staffA))).toBe(before + 1)

    // Failing again while the notice is unread: no repeat.
    psql(
      `update public.media_assets set upload_state = 'uploading' where id = '${asset.id}'`
    )
    failAsset(asset.id)
    box = await ok(inbox(v.staffA))
    expect(box.items.filter((i) => i.subjectId === asset.id)).toHaveLength(1)

    // Ready after a retry: resolved, off the badge, still listed.
    psql(
      `update public.media_assets set upload_state = 'processing' where id = '${asset.id}';
       update public.media_assets set upload_state = 'ready', validated_mime_type = 'image/jpeg' where id = '${asset.id}'`
    )
    box = await ok(inbox(v.staffA))
    expect(box.items.find((i) => i.subjectId === asset.id)?.state).toBe(
      "resolved"
    )
    expect(await ok(unread(v.staffA))).toBe(before)
  })

  it("tells the author about a retake with the reviewer's reason", async () => {
    const asset = await insertAsset(service, {
      uploader: v.staffA.id,
      venue: v.venue,
    })
    const itemId = await insertSubmittedItem(service, {
      asset,
      venue: v.venue,
      author: v.staffA.id,
      submittedAt: new Date().toISOString(),
    })
    const { revision } = await itemRevision(service, itemId)
    await ok(
      review(
        v.staffManager,
        itemId,
        revision,
        "needs_another_photo",
        "TEST too dark"
      )
    )
    const box = await ok(inbox(v.staffA))
    expect(box.items.find((i) => i.subjectId === itemId)).toMatchObject({
      kind: "retake_requested",
      subjectType: "checklist_item",
      payload: { source: "checklist", reason: "TEST too dark" },
    })
    // Nobody else hears about it.
    const otherBox = await ok(inbox(v.staffB))
    expect(otherBox.items.some((i) => i.subjectId === itemId)).toBe(false)
  })

  it("tells the assignee about a direct assignment, not the assigner", async () => {
    const checkId = v.checks.guest_wifi
    const { data } = await service
      .from("venue_amenity_checks")
      .select("revision")
      .eq("id", checkId)
      .single()
    await ok(
      v.manager.client.rpc("amenity_assign_check", {
        p_check_id: checkId,
        p_assignee_id: v.staffB.id,
        p_revision: data!.revision,
      })
    )
    const box = await ok(inbox(v.staffB))
    expect(box.items.find((i) => i.subjectId === checkId)).toMatchObject({
      kind: "assigned",
      subjectType: "amenity_check",
      payload: { checkId, question: "guest_wifi" },
    })
  })

  it("respects a turned-off kind", async () => {
    await ok(
      rpc(v.staffB, "set_my_notification_preferences", {
        p_patch: { uploadProblems: false },
      })
    )
    const asset = await uploadingAsset(v, v.staffB)
    failAsset(asset.id)
    expect(
      (await ok(inbox(v.staffB))).items.some((i) => i.subjectId === asset.id)
    ).toBe(false)
    await ok(
      rpc(v.staffB, "set_my_notification_preferences", {
        p_patch: { uploadProblems: true },
      })
    )
  })

  it("marks only the caller's own notices read", async () => {
    const asset = await uploadingAsset(v, v.staffA)
    failAsset(asset.id)
    const mine = (await ok(inbox(v.staffA))).items.find(
      (i) => i.subjectId === asset.id
    )!
    // Someone else (another venue, a manager) cannot mark it.
    for (const who of [other.staffA, v.manager])
      expect(
        await ok(
          rpc<number>(who, "mark_notifications_read", { p_ids: [mine.id] })
        )
      ).toBe(0)
    expect(
      await ok(
        rpc<number>(v.staffA, "mark_notifications_read", { p_ids: [mine.id] })
      )
    ).toBe(1)
    expect(
      (await ok(inbox(v.staffA))).items.find((i) => i.id === mine.id)?.state
    ).toBe("read")
    // After reading, a new failure is a new notice.
    psql(
      `update public.media_assets set upload_state = 'uploading' where id = '${asset.id}'`
    )
    failAsset(asset.id)
    expect(
      (await ok(inbox(v.staffA))).items.filter((i) => i.subjectId === asset.id)
    ).toHaveLength(2)
    // Mark all.
    await ok(rpc(v.staffA, "mark_notifications_read", {}))
    expect(await ok(unread(v.staffA))).toBe(0)
  })

  it("pages the inbox", async () => {
    for (let i = 0; i < 3; i++)
      failAsset((await uploadingAsset(v, v.staffA)).id)
    const first = await ok(inbox(v.staffA, { p_limit: 2 }))
    expect(first.items).toHaveLength(2)
    expect(first.nextBefore).toBe(first.items[1].id)
    const second = await ok(
      inbox(v.staffA, { p_limit: 2, p_before: first.nextBefore })
    )
    expect(second.items[0].id).toBeLessThan(first.items[1].id)
  })

  it("holds out-of-app delivery until quiet hours end in venue time", () => {
    // 22:30 London in winter is inside 21:00-08:00: delivery at 08:00 next day.
    expect(
      psql(
        `select private.notification_deliver_after('${v.staffA.id}', '${v.venue}', '2026-11-20 22:30:00+00')`
      )
    ).toBe("2026-11-21 08:00:00+00")
    // 03:00 is too: delivery at 08:00 the same day.
    expect(
      psql(
        `select private.notification_deliver_after('${v.staffA.id}', '${v.venue}', '2026-11-20 03:00:00+00')`
      )
    ).toBe("2026-11-20 08:00:00+00")
    // Summer time: 23:00 BST (22:00 UTC) is quiet; 08:00 BST is 07:00 UTC.
    expect(
      psql(
        `select private.notification_deliver_after('${v.staffA.id}', '${v.venue}', '2026-07-01 22:00:00+00')`
      )
    ).toBe("2026-07-02 07:00:00+00")
    // Midday is not quiet.
    expect(
      psql(
        `select private.notification_deliver_after('${v.staffA.id}', '${v.venue}', '2026-11-20 12:00:00+00')`
      )
    ).toBe("2026-11-20 12:00:00+00")
  })

  it("never blocks the caller when a notice cannot be written", () => {
    // A payload over the 4 KB limit fails the insert: notify returns null and
    // the statement (a decision, in real use) still succeeds.
    expect(
      psql(
        `select coalesce(private.notify('${v.staffA.id}', '${v.venue}', 'assigned', 'amenity_check', 'x', 'test:${randomUUID()}', jsonb_build_object('pad', repeat('x', 5000)))::text, 'none')`
      )
    ).toBe("none")
  })

  it("keeps the writers private", () => {
    for (const fn of [
      "private.notify(uuid, uuid, text, text, text, text, jsonb, timestamptz)",
      "private.record_activity(uuid, text, text, text, integer, integer, text, jsonb, jsonb)",
      "private.notification_resolve(text, text, text, uuid)",
      "public.ops_run_notification_jobs(timestamptz)",
      "public.ops_record_job_run(text, text, timestamptz, text, jsonb, integer, uuid, text, uuid)",
    ])
      for (const role of ["anon", "authenticated"])
        expect(
          psql(`select has_function_privilege('${role}', '${fn}', 'execute')`),
          `${role} ${fn}`
        ).toBe("f")
  })

  it("refuses an inactive account and anon", async () => {
    const gone = await leaver(v, "ops-n-gone", "staff")
    await fails(inbox(gone), "not_active_user")
    await fails(unread(gone), "not_active_user")
    await fails(rpc(gone, "mark_notifications_read", {}), "not_active_user")
    await anonRefused("my_notifications")
    await anonRefused("my_notification_count")
    await anonRefused("mark_notifications_read")
  })
})

describe("monitoring and the notification job", () => {
  it("shows ops status to admins only", async () => {
    const status = await ok(rpc<Record<string, unknown>>(v.admin, "ops_status"))
    expect(status).toMatchObject({
      storage: {
        usedBytes: expect.any(Number),
        quotaBytes: expect.any(Number),
        state: expect.stringMatching(/^(ok|warning|full)$/),
      },
      processing: {
        stuck: expect.any(Number),
        failedLastDay: expect.any(Number),
      },
      jobs: expect.any(Array),
      exceptions: expect.any(Array),
    })
    for (const who of [v.staffA, v.manager, v.staffManager, other.manager])
      await fails(rpc(who, "ops_status"), "not_admin", "42501")
    await fails(
      rpc(await leaver(v, "ops-st-gone", "admin"), "ops_status"),
      "not_admin"
    )
    await anonRefused("ops_status")
  })

  it("keeps the job functions to the service role", async () => {
    for (const who of [v.staffA, v.manager, v.admin]) {
      const run = await rpc(who, "ops_run_notification_jobs")
      expect(run.error?.code).toBe("42501")
      const rec = await rpc(who, "ops_record_job_run", {
        p_job: "export",
        p_state: "failed",
        p_error_code: "x",
      })
      expect(rec.error?.code).toBe("42501")
    }
    await anonRefused("ops_run_notification_jobs")
  })

  it("sends the venue's managers one digest when work waits, outside quiet hours", async () => {
    const asset = await insertAsset(service, {
      uploader: v.staffB.id,
      venue: v.venue,
    })
    await insertSubmittedItem(service, {
      asset,
      venue: v.venue,
      author: v.staffB.id,
      submittedAt: new Date().toISOString(),
    })
    const digests = (who: TestIdentity) =>
      ok(inbox(who)).then((b) =>
        b.items.filter(
          (i) => i.kind === "review_digest" && i.subjectId === v.venue
        )
      )
    // 22:00 London: quiet, nothing sent.
    await ok(
      service.rpc(
        "ops_run_notification_jobs" as never,
        {
          p_now: "2026-11-20T22:00:00Z",
        } as never
      )
    )
    expect(await digests(v.staffManager)).toHaveLength(0)
    // 10:00: one digest to the grant holder; staff and the other venue get none.
    await ok(
      service.rpc(
        "ops_run_notification_jobs" as never,
        {
          p_now: "2026-11-20T10:00:00Z",
        } as never
      )
    )
    const [d] = await digests(v.staffManager)
    expect(d.payload).toMatchObject({
      checklistPhotos: 1,
      waiting: expect.any(Number),
    })
    expect(await digests(v.staffA)).toHaveLength(0)
    expect(await digests(other.staffManager)).toHaveLength(0)
    // Again in the same period: no repeat.
    await ok(
      service.rpc(
        "ops_run_notification_jobs" as never,
        {
          p_now: "2026-11-20T11:00:00Z",
        } as never
      )
    )
    expect(await digests(v.staffManager)).toHaveLength(1)
  })

  it("tells every admin once about a failed job and resolves it when the job recovers", async () => {
    const job = `test_${randomUUID().slice(0, 8)}`
    await ok(
      service.rpc(
        "ops_record_job_run" as never,
        {
          p_job: job,
          p_state: "failed",
          p_error_code: "export_failed",
          p_detail: { packages: 1 },
        } as never
      )
    )
    const status = await ok(
      rpc<{ jobs: { job: string; lastState: string }[] }>(v.admin, "ops_status")
    )
    expect(status.jobs.find((j) => j.job === job)).toMatchObject({
      lastState: "failed",
    })

    const notices = () =>
      ok(inbox(v.admin)).then((b) =>
        b.items.filter((i) => i.kind === "exception" && i.subjectId === job)
      )
    await ok(service.rpc("ops_run_notification_jobs" as never, {} as never))
    await ok(service.rpc("ops_run_notification_jobs" as never, {} as never))
    const open = await notices()
    expect(open).toHaveLength(1)
    expect(open[0]).toMatchObject({
      subjectType: "exception_job",
      state: "unread",
      payload: { topic: "job", job, errorCode: "export_failed" },
    })
    // Staff and managers get no exceptions.
    expect(
      (await ok(inbox(v.manager))).items.some((i) => i.kind === "exception")
    ).toBe(false)

    await ok(
      service.rpc(
        "ops_record_job_run" as never,
        {
          p_job: job,
          p_state: "succeeded",
        } as never
      )
    )
    await ok(service.rpc("ops_run_notification_jobs" as never, {} as never))
    expect((await notices())[0].state).toBe("resolved")
  })

  it("flags storage near the quota without deleting anything", async () => {
    const before = Number(
      psql(`select count(*) from public.media_assets where deleted_at is null`)
    )
    const { revision } = await ok(settings(v.admin))
    await ok(
      setSettings(v.admin, revision, {
        storageQuotaBytes: 1073741824,
        storageAlertPercent: 50,
      })
    )
    // Make usage cross 50% of 1 GiB with one large recorded original.
    const big = await uploadingAsset(v, v.staffA)
    psql(
      `update public.media_assets set size_bytes = 600000000 where id = '${big.id}'`
    )
    const status = await ok(
      rpc<{ storage: { state: string }; exceptions: { topic: string }[] }>(
        v.admin,
        "ops_status"
      )
    )
    expect(status.storage.state).toBe("warning")
    expect(status.exceptions.map((e) => e.topic)).toContain("storage")
    await ok(service.rpc("ops_run_notification_jobs" as never, {} as never))
    expect(
      Number(
        psql(
          `select count(*) from public.media_assets where deleted_at is null`
        )
      )
    ).toBe(before + 1)
    psql(`update public.media_assets set size_bytes = 4 where id = '${big.id}'`)
  })
})
