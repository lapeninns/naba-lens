// @vitest-environment jsdom
// S1-OPS admin screens (spec §8 A7): Settings shows what needs attention
// first, operations, the form with field errors beside their field and a
// refused stale save, integrations without secrets; Activity lists who did
// what, where and why, with person links that keep the filters.
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
const action = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock("@/app/admin/settings/actions", () => ({
  saveSettingsAction: action.save,
}))

import { ActivityList } from "@/app/admin/activity/activity-list"
import {
  AttentionNotice,
  ExceptionsPanel,
  IntegrationsPanel,
  JobsPanel,
  OperationsPanel,
} from "@/app/admin/settings/ops-panel"
import { SettingsFormView } from "@/app/admin/settings/settings-form"
import { DEFAULT_SETTINGS, settingsForm } from "@/lib/ops/settings"
import { parseOpsStatus } from "@/lib/ops/status"

afterEach(() => {
  cleanup()
  action.save.mockReset()
})

const status = parseOpsStatus({
  generatedAt: "2026-11-18T09:00:00Z",
  storage: {
    usedBytes: 85 * 1024 ** 3,
    quotaBytes: 100 * 1024 ** 3,
    percent: 85,
    alertPercent: 80,
    state: "warning",
  },
  processing: { processing: 1, stuck: 2, failedLastDay: 3, failedLastWeek: 5 },
  archive: { lastRunAt: "2026-11-18T08:00:00Z", outcome: "completed_cycle" },
  preparation: { failedLast30Days: 0 },
  jobs: [
    {
      job: "media_cleanup",
      lastRunAt: "2026-11-18T08:17:00Z",
      lastState: "failed",
      lastErrorCode: "storage_remove_failed",
      failuresLastWeek: 1,
    },
  ],
  restoreRehearsal: {},
  exceptions: [
    { topic: "storage", detail: { alertPercent: 80 } },
    {
      topic: "venue_setup",
      venueId: "v",
      venueName: "The Bell",
      detail: { noManager: true },
    },
  ],
})!

describe("Settings panels", () => {
  it("lists what needs attention first, in words", () => {
    render(<ExceptionsPanel status={status} />)
    const list = screen.getByRole("list")
    expect(within(list).getByText("Storage is nearly full")).toBeTruthy()
    expect(within(list).getByText("The Bell: no manager.")).toBeTruthy()
  })

  it("says so when nothing needs attention", () => {
    render(<ExceptionsPanel status={{ ...status, exceptions: [] }} />)
    expect(screen.getByText("Nothing needs attention.")).toBeTruthy()
  })

  it("puts what needs attention in one notice at the top of Rules", () => {
    const { unmount } = render(<AttentionNotice status={status} />)
    const notice = screen.getByTestId("settings-attention")
    expect(notice.textContent).toContain("2 things need attention")
    expect(notice.textContent).toContain("Storage is nearly full")
    expect(notice.textContent).toContain("The Bell: no manager.")
    unmount()
    // Nothing to say: no notice (Operations shows the rest is fine).
    const { container } = render(
      <AttentionNotice status={{ ...status, exceptions: [] }} />
    )
    expect(container.textContent).toBe("")
  })

  it("shows storage against the quota, stuck work and failed jobs", () => {
    render(
      <>
        <OperationsPanel status={status} />
        <JobsPanel status={status} />
      </>
    )
    expect(screen.getByText(/85\.0 GB of 100\.0 GB/)).toBeTruthy()
    expect(screen.getByText("Stuck processing")).toBeTruthy()
    // The jobs table moved out of Operations into Scheduled jobs.
    expect(screen.getByRole("heading", { name: "Scheduled jobs" })).toBeTruthy()
    expect(screen.getByText("Upload cleanup")).toBeTruthy()
    expect(screen.getByText("storage_remove_failed")).toBeTruthy()
    expect(screen.getByText(/none recorded/)).toBeTruthy()
  })

  it("names integrations by state only", () => {
    render(
      <IntegrationsPanel
        integrations={[
          { id: "a", name: "Scheduled jobs", purpose: "p", configured: true },
          {
            id: "b",
            name: "Archive alert email",
            purpose: "p",
            configured: false,
          },
        ]}
      />
    )
    expect(screen.getByText("Set up")).toBeTruthy()
    expect(screen.getByText("Not set up")).toBeTruthy()
  })
})

describe("SettingsFormView", () => {
  const settings = { ...DEFAULT_SETTINGS, revision: 7 }

  it("starts from the current values with the revision", () => {
    const { container } = render(<SettingsFormView settings={settings} />)
    expect(
      (container.querySelector('input[name="revision"]') as HTMLInputElement)
        .value
    ).toBe("7")
    expect(
      (
        screen.getByLabelText(
          /Remove unfinished uploads after/
        ) as HTMLInputElement
      ).value
    ).toBe("7")
    expect(
      screen.getAllByRole("button", { name: "Save settings" })
    ).toHaveLength(1)
  })

  it("shows a field's error beside it and keeps what was typed", async () => {
    action.save.mockResolvedValue({
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: { orphanCleanupDays: "Choose 1 to 30 days." },
      // The real action returns what was sent (see actions.ts).
      values: {
        ...settingsForm(settings),
        orphanCleanupDays: "45",
        reason: "Longer",
      },
    })
    render(<SettingsFormView settings={settings} />)
    const field = screen.getByLabelText(
      /Remove unfinished uploads after/
    ) as HTMLInputElement
    fireEvent.change(field, { target: { value: "45" } })
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }))
    await waitFor(() =>
      expect(screen.getByText("Choose 1 to 30 days.")).toBeTruthy()
    )
    expect(field.getAttribute("aria-invalid")).toBe("true")
    expect(field.value).toBe("45")
    expect(
      (
        screen.getByLabelText(
          /Why are you changing this/
        ) as HTMLTextAreaElement
      ).value
    ).toBe("Longer")
    expect(screen.getByText("Check the highlighted fields.")).toBeTruthy()
  })

  it("says when a save changed nothing", async () => {
    action.save.mockResolvedValue({
      status: "saved",
      changed: false,
      revision: 7,
    })
    render(<SettingsFormView settings={settings} />)
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }))
    await waitFor(() =>
      expect(screen.getByText("Nothing changed.")).toBeTruthy()
    )
  })
})

describe("ActivityList", () => {
  it("shows actor, venue, revision and reason, linking to the person's changes", () => {
    render(
      <ActivityList
        filters="venue=v1"
        items={[
          {
            source: "activity",
            id: 1,
            at: "2026-11-18T09:00:00Z",
            actorId: "p1",
            actorName: "Sam Admin",
            actorRole: "admin",
            venueId: "v1",
            venueName: "The Bell",
            action: "settings_changed",
            objectType: "settings",
            objectId: "organisation",
            oldRevision: 1,
            newRevision: 2,
            reason: "Later close",
          },
          {
            source: "menu",
            id: 9,
            at: "2026-11-17T09:00:00Z",
            actorId: null,
            actorName: null,
            actorRole: "system",
            venueId: null,
            venueName: null,
            action: "activated",
            objectType: "menu_version",
            objectId: "m",
            oldRevision: null,
            newRevision: null,
            reason: null,
          },
        ]}
      />
    )
    expect(screen.getByText("Changed settings")).toBeTruthy()
    expect(screen.getByText(/rev 1 → 2/)).toBeTruthy()
    expect(screen.getByText(/Later close/)).toBeTruthy()
    const link = screen.getByRole("link", { name: "Sam Admin" })
    expect(link.getAttribute("href")).toBe("/admin/activity?venue=v1&person=p1")
    expect(screen.getByText("Made a menu current")).toBeTruthy()
    expect(screen.getByText("System")).toBeTruthy()
  })
})
