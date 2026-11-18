// S1-OPS pure models (lib/ops): settings form rules and patch, activity
// cursor and words, notification words, ops status parsing and exception words.
import { describe, expect, it } from "vitest"

import {
  actionWords,
  decodeCursor,
  encodeCursor,
  parseActivityPage,
  revisionText,
} from "@/lib/ops/activity"
import {
  notificationWords,
  parseInbox,
  parsePreferences,
  type AppNotification,
} from "@/lib/ops/notifications"
import {
  DEFAULT_SETTINGS,
  formatBytes,
  parseOpsSettings,
  quietHoursText,
  settingsForm,
  settingsPatch,
} from "@/lib/ops/settings"
import { exceptionText, parseOpsStatus } from "@/lib/ops/status"

const current = { ...DEFAULT_SETTINGS, revision: 3 }

describe("settingsPatch", () => {
  it("sends only changed fields, with the reason", () => {
    const form = {
      ...settingsForm(current),
      quietStart: "22:00",
      orphanCleanupDays: "10",
      storageQuotaGb: "200",
      exportProfiles: ["website", "original"],
      reason: "  Longer window  ",
    }
    expect(settingsPatch(form, current)).toEqual({
      ok: true,
      patch: {
        quietStart: "22:00",
        orphanCleanupDays: 10,
        storageQuotaBytes: 200 * 1024 ** 3,
        exportProfiles: ["original", "website"],
      },
      reason: "Longer window",
    })
  })

  it("is empty for an unchanged form and needs no reason then", () => {
    expect(settingsPatch(settingsForm(current), current)).toEqual({
      ok: true,
      patch: {},
      reason: "",
    })
  })

  it("names each invalid field", () => {
    const result = settingsPatch(
      {
        ...settingsForm(current),
        quietStart: "9pm",
        quietEnd: "24:00",
        reviewReminderDays: "0",
        backlogAlertDays: "1.5",
        orphanCleanupDays: "31",
        storageQuotaGb: "0",
        storageAlertPercent: "100",
        exportProfiles: [],
      },
      current
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(Object.keys(result.fieldErrors).sort()).toEqual(
      [
        "backlogAlertDays",
        "exportProfiles",
        "orphanCleanupDays",
        "quietEnd",
        "quietStart",
        "reviewReminderDays",
        "storageAlertPercent",
        "storageQuotaGb",
      ].sort()
    )
  })

  it("requires a reason for a change", () => {
    const result = settingsPatch(
      { ...settingsForm(current), reviewReminderDays: "2" },
      current
    )
    expect(result).toEqual({
      ok: false,
      fieldErrors: { reason: "Say why you are changing this." },
    })
  })
})

describe("settings helpers", () => {
  it("parses the read and refuses a wrong shape", () => {
    expect(
      parseOpsSettings({
        ...DEFAULT_SETTINGS,
        revision: 2,
        exportProfiles: ["original", "tiff"],
      })
    ).toMatchObject({ revision: 2, exportProfiles: ["original"] })
    expect(parseOpsSettings({ quietStart: "21:00" })).toBeNull()
    expect(parseOpsSettings(null)).toBeNull()
  })

  it("formats bytes and quiet hours", () => {
    expect(formatBytes(512)).toBe("512 bytes")
    expect(formatBytes(20 * 1024 ** 2)).toBe("20 MB")
    expect(formatBytes(1.5 * 1024 ** 3)).toBe("1.5 GB")
    expect(formatBytes(-1)).toBe("unknown")
    expect(quietHoursText("21:00", "08:00", "Europe/London")).toBe(
      "21:00 to 08:00, Europe/London time"
    )
    expect(quietHoursText("08:00", "08:00", "Europe/London")).toBe(
      "No quiet hours"
    )
  })
})

describe("activity", () => {
  it("round-trips the cursor and refuses anything else", () => {
    const cursor = {
      id: 42,
      source: "menu_photo",
      at: "2026-11-18T09:15:00.123+00:00",
    }
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor)
    expect(decodeCursor("nope")).toBeNull()
    expect(decodeCursor("1.Menu.2026")).toBeNull()
    expect(decodeCursor("1.menu.not-a-date")).toBeNull()
    expect(decodeCursor(undefined)).toBeNull()
  })

  it("parses rows and keeps unknown actions readable", () => {
    const page = parseActivityPage({
      items: [
        {
          source: "activity",
          id: 1,
          at: "2026-11-18T09:00:00Z",
          actorId: "a",
          actorName: "Sam",
          actorRole: "admin",
          action: "settings_changed",
          objectType: "settings",
          oldRevision: 1,
          newRevision: 2,
          reason: "Why",
        },
        { source: "x" },
      ],
      nextCursor: { at: "2026-11-18T09:00:00Z", source: "activity", id: 1 },
    })
    expect(page?.items).toHaveLength(1)
    expect(page?.nextCursor).toEqual({
      at: "2026-11-18T09:00:00Z",
      source: "activity",
      id: 1,
    })
    expect(revisionText(page!.items[0])).toBe("rev 1 → 2")
    expect(actionWords("settings_changed")).toBe("Changed settings")
    expect(actionWords("membership_added")).toBe("Added someone to a venue")
    expect(actionWords("membership_ended")).toBe(
      "Ended someone's place at a venue"
    )
    expect(actionWords("check_reopened")).toBe("Check reopened")
  })
})

const notice = (
  kind: AppNotification["kind"],
  payload: Record<string, unknown>
): AppNotification => ({
  id: 1,
  kind,
  subjectType: "x",
  subjectId: null,
  venueId: null,
  venueName: "The Bell",
  payload,
  createdAt: "2026-11-18T09:00:00Z",
  state: "unread",
})

describe("notifications", () => {
  it("words each kind in Album's language", () => {
    expect(
      notificationWords(
        notice("retake_requested", { itemName: "Korma", reason: "Too dark" })
      )
    ).toEqual({ title: "Retake: Korma", detail: "Too dark" })
    expect(
      notificationWords(notice("retake_requested", { source: "checklist" }))
        .title
    ).toBe("Retake: a checklist photo")
    expect(
      notificationWords(notice("assigned", { question: "guest_wifi" }))
    ).toEqual({ title: "A check was given to you", detail: "guest wifi" })
    expect(
      notificationWords(notice("upload_problem", { problem: "upload_failed" }))
        .title
    ).toBe("A photo did not send")
    expect(
      notificationWords(
        notice("review_digest", { waiting: 3, overdueChecks: 1 })
      )
    ).toEqual({
      title: "The Bell",
      detail: "3 photos waiting for review · 1 check past due",
    })
    expect(
      notificationWords(notice("exception", { topic: "storage" })).title
    ).toBe("Storage is nearly full")
  })

  it("parses the inbox and preferences defensively", () => {
    const inbox = parseInbox({
      items: [
        {
          id: 2,
          kind: "assigned",
          state: "unread",
          createdAt: "2026-11-18T09:00:00Z",
          subjectType: "amenity_check",
          subjectId: "c",
          payload: {},
        },
        { id: 3, kind: "toast", state: "unread" },
      ],
      unread: 1,
      nextBefore: null,
    })
    expect(inbox?.items.map((i) => i.id)).toEqual([2])
    expect(inbox?.unread).toBe(1)
    expect(parsePreferences({ retakes: true })).toBeNull()
    expect(
      parsePreferences({
        retakes: true,
        assignments: false,
        uploadProblems: true,
        digests: true,
        quietStart: null,
        quietEnd: null,
      })
    ).toMatchObject({ assignments: false, organisationQuietStart: "21:00" })
  })
})

describe("ops status", () => {
  it("parses with safe defaults and words every exception", () => {
    const status = parseOpsStatus({
      generatedAt: "2026-11-18T09:00:00Z",
      storage: { usedBytes: 9, quotaBytes: 10, percent: 90, state: "warning" },
      jobs: [{ job: "export", lastState: "failed", failuresLastWeek: 2 }],
      exceptions: [
        {
          topic: "venue_setup",
          venueName: "The Bell",
          detail: { noManager: true, noActiveMenu: true },
        },
        {
          topic: "backlog",
          venueName: "The Bell",
          detail: { waiting: 4, thresholdDays: 7 },
        },
        { topic: "job", detail: { job: "export", errorCode: "zip_failed" } },
      ],
    })
    expect(status?.storage.state).toBe("warning")
    expect(status?.processing.stuck).toBe(0)
    expect(status?.jobs[0]).toMatchObject({
      job: "export",
      failuresLastWeek: 2,
    })
    expect(status!.exceptions.map((e) => exceptionText(e).detail)).toEqual([
      "The Bell: no current menu and no manager.",
      "The Bell: 4 waiting, the oldest for more than 7 days.",
      "Export packages: zip_failed.",
    ])
    expect(parseOpsStatus({})).toBeNull()
  })
})
