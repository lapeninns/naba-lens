// @vitest-environment jsdom
// Staff amenity capture: answer, evidence rule, Wi-Fi redaction tick and test
// notes, and a per-check draft whose idempotency key survives failures and
// reloads, so "Try again" never records a finding twice.
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { cloneElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  CaptureForm,
  clearAllDrafts,
  emptyDraft,
  loadDraft as loadStoredDraft,
  saveDraft,
  type AssetsResult,
  type CaptureDraft,
  type SubmitHandler,
} from "@/components/nabalens/amenities/capture"
import {
  UI_TEXT,
  type AmenityFailure,
  type AmenityResult,
  type CatalogueEntry,
  type CheckSummary,
  type EvidenceRule,
  type SubmitInput,
  type SubmitResult,
  type SubmittableAsset,
} from "@/lib/amenities/contract"
import type { OpenAddOptions } from "@/components/nabalens/shell/add-context"
import type { Uploader } from "@/components/nabalens/upload-queue"
import { SESSION_ENDED_MESSAGE } from "@/lib/auth/session-ended"

const CHECK_ID = "8a000000-0000-4000-8000-000000000001"
const VIEWER_ID = "1a2b3c4d-0000-4aaa-8bbb-00000000000a"
const OWNER = { userId: VIEWER_ID, checkId: CHECK_ID }
const loadDraft = (checkId = CHECK_ID, userId = VIEWER_ID) =>
  loadStoredDraft({ userId, checkId })

function entry(overrides: Partial<CatalogueEntry> = {}): CatalogueEntry {
  return {
    key: "darts",
    category: "Entertainment",
    question: "Is there a dartboard guests can use?",
    captureBrief: "Photograph the dartboard and the throwing line.",
    evidenceRule: "photo",
    isCore: false,
    position: 30,
    version: 1,
    ...overrides,
  }
}

function check(overrides: Partial<CheckSummary> = {}): CheckSummary {
  return {
    id: CHECK_ID,
    venueId: "v1",
    entry: entry(),
    status: "active",
    progress: "needs_capture",
    answer: "to_check",
    assignee: { id: "me", displayName: "TEST Sam" },
    answeredBy: null,
    answeredAt: null,
    recheckReason: null,
    notes: null,
    revision: 4,
    updatedAt: "2026-11-05T10:00:00.000Z",
    ...overrides,
  }
}

const withRule = (evidenceRule: EvidenceRule, key = "darts") =>
  check({ entry: entry({ evidenceRule, key }) })

const PHOTO: SubmittableAsset = {
  assetId: "7d000000-0000-4000-8000-00000000000a",
  kind: "photo",
  createdAt: "2026-11-02T10:00:00.000Z",
  source: "own",
  thumbUrl: null,
}
const VIDEO: SubmittableAsset = {
  assetId: "7d000000-0000-4000-8000-00000000000b",
  kind: "video",
  createdAt: "2026-11-03T10:00:00.000Z",
  source: "own",
  thumbUrl: null,
}
const LEGACY: SubmittableAsset = {
  assetId: "7d000000-0000-4000-8000-00000000000c",
  kind: "photo",
  createdAt: "2026-05-01T10:00:00.000Z",
  source: "legacy_coverage",
  thumbUrl: null,
}

const assetsOk = (assets: SubmittableAsset[]): AssetsResult => ({
  ok: true,
  assets,
})
const sentOk = (replayed = false): AmenityResult<SubmitResult> => ({
  ok: true,
  submissionId: "5b000000-0000-4000-8000-000000000001",
  revision: 5,
  replayed,
})
const failure = (
  code: AmenityFailure["code"],
  extra: Partial<AmenityFailure> = {}
): AmenityFailure => ({
  ok: false,
  code,
  status: 409,
  message: `failed: ${code}`,
  ...extra,
})

const LIMITS = {
  maxBatchFiles: 10,
  maxParallelUploads: 2,
  maxPhotoBytes: 20 * 1024 * 1024,
  maxVideoBytes: 200 * 1024 * 1024,
}
const noUpload: Uploader = async () => {}

function keys() {
  let n = 0
  return () => `key-${++n}`
}

function setup({
  summary = check(),
  assets = [PHOTO, VIDEO],
  submit = vi.fn<SubmitHandler>(async () => sentOk()),
  upload = { uploader: noUpload, limits: LIMITS } as Parameters<
    typeof CaptureForm
  >[0]["upload"],
  newKey = keys(),
  viewerId = VIEWER_ID,
}: {
  viewerId?: string
  summary?: CheckSummary
  assets?: SubmittableAsset[]
  submit?: ReturnType<typeof vi.fn<SubmitHandler>>
  upload?: Parameters<typeof CaptureForm>[0]["upload"]
  newKey?: () => string
} = {}) {
  const onReload = vi.fn()
  const onDone = vi.fn()
  const loadAssets = vi.fn(async () => assetsOk(assets))
  const ui = () => (
    <CaptureForm
      check={summary}
      viewerId={viewerId}
      initialAssets={assetsOk(assets)}
      loadAssets={loadAssets}
      submit={submit}
      upload={upload}
      onReload={onReload}
      onDone={onDone}
      signInHref="/login"
      newKey={newKey}
    />
  )
  const utils = render(ui())
  return {
    user: userEvent.setup(),
    submit,
    onReload,
    onDone,
    loadAssets,
    ui,
    ...utils,
  }
}

const photoBox = () =>
  screen.getByRole("checkbox", { name: "Photo added 2 Nov 2026, 10:00" })
const videoBox = () =>
  screen.getByRole("checkbox", { name: "Video added 3 Nov 2026, 10:00" })
const submitButton = () => screen.getByRole("button", { name: UI_TEXT.submit })
const ruleStatus = () => screen.getByTestId("evidence-rule-status")
const lastInput = (submit: ReturnType<typeof vi.fn<SubmitHandler>>) =>
  submit.mock.lastCall?.[0] as SubmitInput

beforeEach(() => window.localStorage.clear())
afterEach(cleanup)

describe("CaptureForm", () => {
  it("shows the question, capture brief and required evidence with a live rule status", async () => {
    const { user } = setup()
    expect(
      screen.getByRole("group", {
        name: "Is there a dartboard guests can use?",
      })
    ).toBeTruthy()
    expect(
      screen.getByText("Photograph the dartboard and the throwing line.")
    ).toBeTruthy()
    expect(
      screen.getByText(/Required evidence:/).parentElement?.textContent
    ).toBe("Required evidence: Photo (for a Yes answer)")
    expect(ruleStatus().textContent).toContain("Needed for Yes: Photo")
    await user.click(screen.getByRole("radio", { name: "Yes" }))
    expect(ruleStatus().textContent).toBe("Add a photo to answer Yes.")
    await user.click(photoBox())
    expect(ruleStatus().textContent).toBe("Evidence rule met: Photo.")
  })

  it("submits Yes with the check revision, a client key and the chosen evidence, then goes back", async () => {
    const { user, submit, onDone } = setup()
    await user.click(screen.getByRole("radio", { name: "Yes" }))
    await user.click(photoBox())
    await user.type(
      screen.getByRole("textbox", { name: /What you found/ }),
      "Board by the bar"
    )
    await user.click(submitButton())
    expect(submit).toHaveBeenCalledTimes(1)
    expect(lastInput(submit)).toEqual({
      checkId: CHECK_ID,
      revision: 4,
      idempotencyKey: "key-1",
      answer: "yes",
      finding: "Board by the bar",
      assetIds: [PHOTO.assetId],
    })
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(loadDraft(CHECK_ID)).toBeNull()
  })

  it("blocks a photo-only Yes for a video rule, then sends once a video is chosen", async () => {
    const { user, submit } = setup({ summary: withRule("video") })
    await user.click(screen.getByRole("radio", { name: "Yes" }))
    await user.click(photoBox())
    expect(ruleStatus().textContent).toContain("A photo isn't enough here")
    await user.click(submitButton())
    expect(submit).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toContain("Required: Video.")
    await user.click(videoBox())
    expect(ruleStatus().textContent).toBe("Evidence rule met: Video.")
    await user.click(submitButton())
    expect(lastInput(submit).assetIds).toEqual([PHOTO.assetId, VIDEO.assetId])
  })

  it("needs a reason for No and Not applicable; evidence is optional", async () => {
    const { user, submit } = setup()
    await user.click(screen.getByRole("radio", { name: "Not applicable" }))
    await user.click(submitButton())
    expect(submit).not.toHaveBeenCalled()
    expect(screen.getByText("Say why, so your manager knows.")).toBeTruthy()
    await user.type(
      screen.getByRole("textbox", { name: "Reason" }),
      "No dartboard"
    )
    await user.click(submitButton())
    expect(lastInput(submit)).toMatchObject({
      answer: "not_applicable",
      reason: "No dartboard",
      assetIds: [],
    })
  })

  describe("guest Wi-Fi", () => {
    const wifi = () => withRule("both", "guest_wifi")

    it("warns about the password and gates Yes on the redaction tick and the test notes", async () => {
      const { user, submit } = setup({ summary: wifi() })
      expect(screen.getByText(/cover the Wi-Fi password/)).toBeTruthy()
      await user.click(screen.getByRole("radio", { name: "Yes" }))
      await user.click(photoBox())
      await user.click(videoBox())
      await user.click(submitButton())
      expect(submit).not.toHaveBeenCalled()
      expect(
        screen.getByText(
          "Tick this once the password and join QR code are covered."
        )
      ).toBeTruthy()
      expect(screen.getByText("Say where you tested the Wi-Fi.")).toBeTruthy()

      await user.click(
        screen.getByRole("checkbox", { name: UI_TEXT.redactionConfirm })
      )
      await user.type(
        screen.getByRole("textbox", { name: "Where you tested" }),
        "Garden"
      )
      await user.type(screen.getByLabelText("Test date"), "2026-11-01")
      await user.type(
        screen.getByRole("textbox", { name: "Download (Mbps)" }),
        "55.5"
      )
      await user.type(
        screen.getByRole("textbox", { name: "Upload (Mbps)" }),
        "12"
      )
      await user.click(submitButton())
      expect(lastInput(submit)).toMatchObject({
        answer: "yes",
        redactionConfirmed: true,
        wifi: {
          testSpot: "Garden",
          testedOn: "2026-11-01",
          downloadMbps: 55.5,
          uploadMbps: 12,
        },
      })
    })

    it("still needs the tick for No when a photo is attached", async () => {
      const { user, submit } = setup({ summary: wifi() })
      await user.click(screen.getByRole("radio", { name: "No" }))
      await user.type(screen.getByRole("textbox", { name: "Reason" }), "None")
      await user.click(photoBox())
      await user.click(submitButton())
      expect(submit).not.toHaveBeenCalled()
      await user.click(
        screen.getByRole("checkbox", { name: UI_TEXT.redactionConfirm })
      )
      await user.click(submitButton())
      expect(lastInput(submit)).toMatchObject({
        answer: "no",
        redactionConfirmed: true,
      })
      expect(lastInput(submit).wifi).toBeUndefined()
    })
  })

  describe("draft and retry", () => {
    it("keeps the draft (answer, text, evidence, key) across a reload", async () => {
      const first = setup()
      await first.user.click(screen.getByRole("radio", { name: "Yes" }))
      await first.user.click(photoBox())
      await first.user.type(
        screen.getByRole("textbox", { name: /Limitations/ }),
        "Side door only"
      )
      first.unmount()

      const second = setup({ newKey: () => "fresh-key" })
      await waitFor(() =>
        expect(
          (screen.getByRole("radio", { name: "Yes" }) as HTMLInputElement)
            .checked
        ).toBe(true)
      )
      expect((photoBox() as HTMLInputElement).checked).toBe(true)
      expect(
        (
          screen.getByRole("textbox", {
            name: /Limitations/,
          }) as HTMLTextAreaElement
        ).value
      ).toBe("Side door only")
      await second.user.click(submitButton())
      expect(lastInput(second.submit).idempotencyKey).toBe("key-1")
    })

    it("retries a dropped connection with the same key, and after a reload too", async () => {
      const submit = vi
        .fn<SubmitHandler>()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValueOnce(failure("unavailable", { status: 503 }))
        .mockResolvedValue(sentOk(true))
      const first = setup({ submit })
      await first.user.click(screen.getByRole("radio", { name: "Yes" }))
      await first.user.click(photoBox())
      await first.user.click(submitButton())
      const retry = await screen.findByRole("button", { name: UI_TEXT.retry })
      expect(loadDraft(CHECK_ID)?.idempotencyKey).toBe("key-1")
      await first.user.click(retry)
      await screen.findByRole("button", { name: UI_TEXT.retry })
      expect(submit.mock.calls.map(([i]) => i.idempotencyKey)).toEqual([
        "key-1",
        "key-1",
      ])
      first.unmount()

      const second = setup({ submit, newKey: () => "fresh-key" })
      await waitFor(() =>
        expect((photoBox() as HTMLInputElement).checked).toBe(true)
      )
      await second.user.click(submitButton())
      expect(lastInput(submit).idempotencyKey).toBe("key-1")
      await waitFor(() => expect(second.onDone).toHaveBeenCalled())
      expect(loadDraft(CHECK_ID)).toBeNull()
    })

    it("starts a new key when the draft is edited after a failed attempt", async () => {
      const submit = vi
        .fn<SubmitHandler>()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValue(sentOk())
      const { user } = setup({ submit })
      await user.click(screen.getByRole("radio", { name: "Yes" }))
      await user.click(photoBox())
      await user.click(submitButton())
      await screen.findByRole("button", { name: UI_TEXT.retry })
      await user.click(videoBox())
      await user.click(submitButton())
      expect(submit.mock.calls.map(([i]) => i.idempotencyKey)).toEqual([
        "key-1",
        "key-2",
      ])
    })
  })

  it("asks for a reload on a revision conflict and keeps the draft", async () => {
    const submit = vi
      .fn<SubmitHandler>()
      .mockResolvedValue(failure("revision_conflict", { currentRevision: 6 }))
    const { user, onReload } = setup({ submit })
    await user.click(screen.getByRole("radio", { name: "Yes" }))
    await user.click(photoBox())
    await user.click(submitButton())
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("This check changed")
    await user.click(within(alert).getByRole("button", { name: "Reload" }))
    expect(onReload).toHaveBeenCalled()
    expect(loadDraft(CHECK_ID)?.answer).toBe("yes")
  })

  it("explains an unmet evidence rule from the server", async () => {
    const submit = vi
      .fn<SubmitHandler>()
      .mockResolvedValue(failure("evidence_rule_unmet", { rule: "both" }))
    const { user } = setup({ submit, summary: withRule("either") })
    await user.click(screen.getByRole("radio", { name: "Yes" }))
    await user.click(photoBox())
    await user.click(submitButton())
    expect(
      await screen.findByText("This answer needs evidence: Photo and video.")
    ).toBeTruthy()
  })

  it("unticks and names an ineligible asset", async () => {
    const submit = vi.fn<SubmitHandler>().mockResolvedValue(
      failure("asset_ineligible", {
        assetId: PHOTO.assetId,
        assetReason: "not_ready",
      })
    )
    const { user, loadAssets } = setup({ submit, summary: withRule("either") })
    await user.click(screen.getByRole("radio", { name: "Yes" }))
    await user.click(photoBox())
    await user.click(submitButton())
    expect(
      (await screen.findAllByText(/It's still processing\./)).length
    ).toBeGreaterThan(0)
    await waitFor(() => expect(loadAssets).toHaveBeenCalled())
    expect((photoBox() as HTMLInputElement).checked).toBe(false)
    expect((photoBox() as HTMLInputElement).disabled).toBe(true)
  })

  it("shows field errors from the server next to their fields", async () => {
    const submit = vi.fn<SubmitHandler>().mockResolvedValue(
      failure("invalid_input", {
        status: 400,
        fieldErrors: { finding: "Too long for the server.", other: "Odd." },
      })
    )
    const { user } = setup({ submit })
    await user.click(screen.getByRole("radio", { name: "No" }))
    await user.type(screen.getByRole("textbox", { name: "Reason" }), "None")
    await user.click(submitButton())
    expect(await screen.findByText("Too long for the server.")).toBeTruthy()
    expect(screen.getByText("Odd.")).toBeTruthy()
  })

  it("without uploads (admin, manager account) offers existing media only, with earlier Coverage photos under their own heading", async () => {
    setup({ upload: null, assets: [PHOTO, LEGACY] })
    expect(
      screen.queryByRole("button", { name: "Choose from your photos" })
    ).toBeNull()
    expect(screen.getByText(/You can't upload here/)).toBeTruthy()
    const legacy = screen.getByRole("list", { name: UI_TEXT.legacyMedia })
    expect(
      within(legacy).getByRole("checkbox", {
        name: "Photo added 1 May 2026, 11:00",
      })
    ).toBeTruthy()
  })

  it("offers the upload flow and selects new ready uploads", async () => {
    const openAdd = vi.fn()
    const { user, loadAssets } = setup({
      assets: [PHOTO],
      upload: { addQueue: { openAdd }, uploader: noUpload, limits: LIMITS },
    })
    await user.click(
      screen.getByRole("button", { name: "Choose from your photos" })
    )
    const opts = openAdd.mock.lastCall?.[0]
    expect(opts.source).toBe("library")
    expect(opts.imagesOnly).toBeUndefined()
    // Reserved as amenity evidence, never community-visible.
    expect(opts.purpose).toBe("amenity")
    loadAssets.mockResolvedValue(assetsOk([VIDEO, PHOTO]))
    opts.onReady([VIDEO.assetId])
    await waitFor(() =>
      expect((videoBox() as HTMLInputElement).checked).toBe(true)
    )
    expect(screen.getByText("1 new upload selected.")).toBeTruthy()
  })

  it("shows the manager's recheck reason, wrapping a long unbroken one", () => {
    const long = "x".repeat(400)
    setup({
      summary: check({ progress: "needs_recheck", recheckReason: long }),
    })
    expect(screen.getByText(long).className).toContain("break-words")
  })
})

describe("CaptureForm: whose draft, and which revision", () => {
  const stored = (overrides: Partial<CaptureDraft> = {}): CaptureDraft => ({
    ...emptyDraft(() => "old-key", 4),
    answer: "yes",
    finding: "Board by the bar",
    assetIds: [PHOTO.assetId],
    ...overrides,
  })

  it("keeps each person's draft under their own user id", async () => {
    const { user, unmount } = setup()
    await user.click(screen.getByRole("radio", { name: "Yes" }))
    await waitFor(() => expect(loadDraft()?.answer).toBe("yes"))
    expect(
      Object.keys(window.localStorage).filter((k) => k.includes(CHECK_ID))
    ).toEqual([`nabalens.amenity-draft.v2:${VIEWER_ID}:${CHECK_ID}`])
    unmount()

    setup({ viewerId: "someone-else" })
    await waitFor(() =>
      expect(
        Object.keys(window.localStorage).filter((k) => k.includes(CHECK_ID))
      ).toHaveLength(1)
    )
    expect(
      (screen.getByRole("radio", { name: "Yes" }) as HTMLInputElement).checked
    ).toBe(false)
    expect(loadDraft(CHECK_ID, "someone-else")).toBeNull()
  })

  it("removes every amenity draft on this device at sign-out", () => {
    saveDraft(OWNER, stored())
    saveDraft({ userId: "other", checkId: "c2" }, stored())
    window.localStorage.setItem("nabalens.amenity-draft.v1:legacy", "{}")
    window.localStorage.setItem("nabalens.other", "kept")
    clearAllDrafts()
    expect(Object.keys(window.localStorage)).toEqual(["nabalens.other"])
  })

  it("replays the key of a sent draft after the check moved on, never sending twice", async () => {
    // Sent at revision 4 and recorded (the check moved to 5), but the answer
    // was lost: the reload must replay the same key, not record it again.
    saveDraft(OWNER, stored({ attempted: true }))
    const submit = vi.fn<SubmitHandler>(async () => sentOk(true))
    const { user, onDone } = setup({
      summary: check({ revision: 5 }),
      submit,
      newKey: () => "fresh-key",
    })
    await waitFor(() =>
      expect(
        (
          screen.getByRole("textbox", {
            name: /What you found/,
          }) as HTMLTextAreaElement
        ).value
      ).toBe("Board by the bar")
    )
    await waitFor(() => expect(loadDraft()?.revision).toBe(5))
    expect(loadDraft()).toMatchObject({
      attempted: true,
      idempotencyKey: "old-key",
    })
    await user.click(submitButton())
    expect(submit).toHaveBeenCalledTimes(1)
    expect(lastInput(submit)).toMatchObject({
      revision: 5,
      idempotencyKey: "old-key",
      assetIds: [PHOTO.assetId],
    })
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(loadDraft()).toBeNull()
  })

  it("asks to send again with a new key when the replayed finding is older than the check", async () => {
    // Sent at 4 and recorded (5), the answer lost, then reopened: now 6.
    saveDraft(OWNER, stored({ attempted: true }))
    const submit = vi
      .fn<SubmitHandler>()
      .mockResolvedValueOnce(sentOk(true))
      .mockResolvedValue({
        ok: true,
        submissionId: "5b000000-0000-4000-8000-000000000002",
        revision: 7,
        replayed: false,
      })
    const { user, onDone } = setup({
      summary: check({ revision: 6, progress: "needs_recheck" }),
      submit,
      newKey: () => "fresh-key",
    })
    await waitFor(() =>
      expect((photoBox() as HTMLInputElement).checked).toBe(true)
    )
    await user.click(submitButton())
    expect(lastInput(submit).idempotencyKey).toBe("old-key")
    const notice = await screen.findByRole("alert")
    expect(notice.textContent).toContain(
      "Your earlier finding was recorded. This check has changed since, so review your answer and send it again."
    )
    expect(onDone).not.toHaveBeenCalled()
    // The words and evidence stay; the key is new.
    expect(
      (
        screen.getByRole("textbox", {
          name: /What you found/,
        }) as HTMLTextAreaElement
      ).value
    ).toBe("Board by the bar")
    expect((photoBox() as HTMLInputElement).checked).toBe(true)
    await waitFor(() =>
      expect(loadDraft()).toMatchObject({
        attempted: false,
        idempotencyKey: "fresh-key",
        revision: 6,
      })
    )
    await user.click(submitButton())
    expect(submit.mock.calls.map(([i]) => i.idempotencyKey)).toEqual([
      "old-key",
      "fresh-key",
    ])
    expect(lastInput(submit).revision).toBe(6)
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(loadDraft()).toBeNull()
  })

  it("sends a never-sent draft from an older revision with a new key", async () => {
    saveDraft(OWNER, stored())
    const { user, submit } = setup({
      summary: check({ revision: 6, progress: "needs_recheck" }),
      newKey: () => "fresh-key",
    })
    await waitFor(() => expect(loadDraft()?.idempotencyKey).toBe("fresh-key"))
    expect(loadDraft()).toMatchObject({ attempted: false, revision: 6 })
    await user.click(submitButton())
    expect(lastInput(submit)).toMatchObject({
      revision: 6,
      idempotencyKey: "fresh-key",
      assetIds: [PHOTO.assetId],
    })
  })

  it("replays the same key for a draft from the same revision", async () => {
    saveDraft(OWNER, stored({ attempted: true }))
    const { user, submit } = setup({ newKey: () => "fresh-key" })
    await waitFor(() =>
      expect((photoBox() as HTMLInputElement).checked).toBe(true)
    )
    await user.click(submitButton())
    expect(lastInput(submit).idempotencyKey).toBe("old-key")
  })

  it("drops the stored draft on success even when the form was left first", async () => {
    let answer!: (result: AmenityResult<SubmitResult>) => void
    const submit = vi.fn<SubmitHandler>(
      () => new Promise((resolve) => (answer = resolve))
    )
    const { user, unmount, onDone } = setup({ submit })
    await user.click(screen.getByRole("radio", { name: "Yes" }))
    await user.click(photoBox())
    await user.click(submitButton())
    await waitFor(() => expect(loadDraft()?.attempted).toBe(true))
    unmount()
    answer(sentOk())
    await waitFor(() => expect(loadDraft()).toBeNull())
    expect(onDone).not.toHaveBeenCalled()
  })
})

describe("CaptureForm: Wi-Fi redaction tick follows the evidence", () => {
  const wifi = () => withRule("both", "guest_wifi")
  const tick = () =>
    screen.getByRole("checkbox", {
      name: UI_TEXT.redactionConfirm,
    }) as HTMLInputElement

  it("clears the tick when a photo or video is added or removed", async () => {
    const { user } = setup({ summary: wifi() })
    await user.click(photoBox())
    await user.click(tick())
    expect(tick().checked).toBe(true)
    await user.click(videoBox())
    expect(tick().checked).toBe(false)
    await user.click(tick())
    expect(tick().checked).toBe(true)
    await user.click(videoBox())
    expect(tick().checked).toBe(false)
    // Putting the same evidence back doesn't bring an old tick back.
    await user.click(videoBox())
    expect(tick().checked).toBe(false)
  })

  it("keeps the tick across a reload only while the evidence is unchanged", async () => {
    const first = setup({ summary: wifi() })
    await first.user.click(photoBox())
    await first.user.click(tick())
    await waitFor(() => expect(loadDraft()?.redactionConfirmed).toBe(true))
    first.unmount()

    const same = setup({ summary: wifi() })
    await waitFor(() =>
      expect((photoBox() as HTMLInputElement).checked).toBe(true)
    )
    expect(tick().checked).toBe(true)
    same.unmount()

    // The ticked photo is gone (deleted) and another is listed instead.
    setup({ summary: wifi(), assets: [VIDEO] })
    await waitFor(() => expect(loadDraft()?.assetIds).toEqual([PHOTO.assetId]))
    expect(tick().checked).toBe(false)
  })

  it("asks for the tick again when the check was reopened since", async () => {
    saveDraft(OWNER, {
      ...emptyDraft(() => "old-key", 4),
      answer: "no",
      reason: "None",
      assetIds: [PHOTO.assetId],
      redactionConfirmed: true,
      redactionAssetIds: [PHOTO.assetId],
    })
    setup({ summary: { ...wifi(), revision: 6 } })
    await waitFor(() =>
      expect((photoBox() as HTMLInputElement).checked).toBe(true)
    )
    expect(tick().checked).toBe(false)
  })

  it("asks for the tick again on a sent draft from an older revision, and still replays its key", async () => {
    saveDraft(OWNER, {
      ...emptyDraft(() => "old-key", 4),
      attempted: true,
      answer: "no",
      reason: "None",
      assetIds: [PHOTO.assetId],
      redactionConfirmed: true,
      redactionAssetIds: [PHOTO.assetId],
    })
    const submit = vi.fn<SubmitHandler>(async () => sentOk(true))
    const { user } = setup({
      summary: { ...wifi(), revision: 5 },
      submit,
      newKey: () => "fresh-key",
    })
    await waitFor(() =>
      expect((photoBox() as HTMLInputElement).checked).toBe(true)
    )
    expect(tick().checked).toBe(false)
    await user.click(tick())
    await user.click(submitButton())
    expect(lastInput(submit)).toMatchObject({
      idempotencyKey: "old-key",
      redactionConfirmed: true,
    })
  })
})

describe("CaptureForm: uploads ready while an answer is sending (B1)", () => {
  function sending(assets: SubmittableAsset[] = [PHOTO]) {
    const openAdd = vi.fn()
    let answer!: (result: AmenityResult<SubmitResult>) => void
    const submit = vi.fn<SubmitHandler>(
      () => new Promise((resolve) => (answer = resolve))
    )
    const view = setup({
      assets,
      submit,
      upload: { addQueue: { openAdd }, uploader: noUpload, limits: LIMITS },
    })
    return {
      ...view,
      answer: (result: AmenityResult<SubmitResult>) =>
        act(async () => answer(result)),
      async start() {
        await view.user.click(
          screen.getByRole("button", { name: "Choose from your photos" })
        )
        await view.user.click(screen.getByRole("radio", { name: "Yes" }))
        await view.user.click(photoBox())
        return openAdd.mock.lastCall?.[0] as OpenAddOptions
      },
    }
  }

  it("stays and says so when an upload is ready during a send that succeeds", async () => {
    const { user, submit, loadAssets, onDone, answer, start } = sending()
    const opts = await start()
    await user.click(submitButton())
    loadAssets.mockResolvedValue(assetsOk([VIDEO, PHOTO]))
    expect(opts.onReady?.([VIDEO.assetId])).toBeUndefined()
    await answer(sentOk())
    expect(
      await screen.findByText(
        "1 new upload finished while your answer was sending, so it wasn't added to this check. The upload is saved."
      )
    ).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()
    expect(lastInput(submit).assetIds).toEqual([PHOTO.assetId])
  })

  it("also when its list was still loading as the send started", async () => {
    const { user, loadAssets, onDone, answer, start } = sending()
    const opts = await start()
    let list!: (result: AssetsResult) => void
    loadAssets.mockImplementationOnce(
      () => new Promise((resolve) => (list = resolve))
    )
    opts.onReady?.([VIDEO.assetId])
    await user.click(submitButton())
    await act(async () => list(assetsOk([VIDEO, PHOTO])))
    await answer(sentOk())
    expect(
      await screen.findByText(/1 new upload finished while your answer/)
    ).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()
  })

  it("selects it for the next try when the send is refused", async () => {
    const { user, loadAssets, onDone, answer, start } = sending()
    const opts = await start()
    await user.click(submitButton())
    loadAssets.mockResolvedValue(assetsOk([VIDEO, PHOTO]))
    opts.onReady?.([VIDEO.assetId])
    await answer(failure("evidence_rule_unmet", { rule: "photo" }))
    await waitFor(() =>
      expect((videoBox() as HTMLInputElement).checked).toBe(true)
    )
    expect((photoBox() as HTMLInputElement).checked).toBe(true)
    expect(onDone).not.toHaveBeenCalled()
  })
})

describe("CaptureForm: Try again replays the same answer (B1a)", () => {
  it("keeps uploads that arrive before a definite answer out of the replay", async () => {
    const openAdd = vi.fn()
    const LATER: SubmittableAsset = {
      ...PHOTO,
      assetId: "7d000000-0000-4000-8000-00000000000d",
      createdAt: "2026-11-04T10:00:00.000Z",
    }
    let lose!: (error: Error) => void
    let reply!: (result: AmenityResult<SubmitResult>) => void
    const submit = vi
      .fn<SubmitHandler>()
      .mockImplementationOnce(() => new Promise((_, reject) => (lose = reject)))
      .mockImplementationOnce(() => new Promise((resolve) => (reply = resolve)))
    const { user, loadAssets, onDone } = setup({
      assets: [PHOTO],
      submit,
      upload: { addQueue: { openAdd }, uploader: noUpload, limits: LIMITS },
    })
    await user.click(
      screen.getByRole("button", { name: "Choose from your photos" })
    )
    const opts = openAdd.mock.lastCall?.[0] as OpenAddOptions
    await user.click(screen.getByRole("radio", { name: "Yes" }))
    await user.click(photoBox())
    loadAssets.mockResolvedValue(assetsOk([LATER, VIDEO, PHOTO]))

    // An upload is ready mid-send, the reply is lost, another arrives.
    await user.click(submitButton())
    opts.onReady?.([VIDEO.assetId])
    await act(async () => lose(new TypeError("Failed to fetch")))
    const retry = await screen.findByRole("button", { name: UI_TEXT.retry })
    opts.onReady?.([LATER.assetId])
    await act(async () => {})
    const ticked = screen
      .queryAllByRole("checkbox")
      .filter((box) => (box as HTMLInputElement).checked)
    expect(ticked).toEqual([photoBox()])

    await user.click(retry)
    expect(submit).toHaveBeenCalledTimes(2)
    expect(submit.mock.calls[1][0]).toEqual(submit.mock.calls[0][0])
    expect(lastInput(submit)).toMatchObject({
      idempotencyKey: "key-1",
      assetIds: [PHOTO.assetId],
    })

    await act(async () => reply(sentOk()))
    expect(
      await screen.findByText(/2 new uploads finished while your answer/)
    ).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()
  })
})

describe("CaptureForm: Try again while offline (S-H1)", () => {
  function goOffline(offline: boolean) {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(!offline)
    window.dispatchEvent(new Event(offline ? "offline" : "online"))
  }
  afterEach(() => vi.restoreAllMocks())

  it("waits offline and says so, then replays the same answer once back online", async () => {
    const openAdd = vi.fn()
    const LATER: SubmittableAsset = {
      ...PHOTO,
      assetId: "7d000000-0000-4000-8000-00000000000d",
      createdAt: "2026-11-04T10:00:00.000Z",
    }
    const submit = vi
      .fn<SubmitHandler>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(sentOk())
    const { user, loadAssets, onDone } = setup({
      assets: [PHOTO],
      submit,
      upload: { addQueue: { openAdd }, uploader: noUpload, limits: LIMITS },
    })
    await user.click(
      screen.getByRole("button", { name: "Choose from your photos" })
    )
    const opts = openAdd.mock.lastCall?.[0] as OpenAddOptions
    await user.click(screen.getByRole("radio", { name: "Yes" }))
    await user.click(photoBox())
    loadAssets.mockResolvedValue(assetsOk([LATER, PHOTO]))

    await act(async () => goOffline(true))
    await user.click(submitButton())
    const retry = await screen.findByRole("button", { name: UI_TEXT.retry })
    expect((retry as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole("alert").textContent).toContain(
      "You're offline. We'll try when you're back online."
    )
    // An upload finishing while the answer is unresolved waits, as before.
    opts.onReady?.([LATER.assetId])
    await act(async () => {})
    expect(submit).toHaveBeenCalledTimes(1)

    await act(async () => goOffline(false))
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2))
    expect(submit.mock.calls[1][0]).toEqual(submit.mock.calls[0][0])
    expect(lastInput(submit)).toMatchObject({
      idempotencyKey: "key-1",
      revision: 4,
      assetIds: [PHOTO.assetId],
    })
    expect(await screen.findByText(/new upload/)).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()
  })

  it("Try again is a live button again once online, and nothing sends by itself without a failed send", async () => {
    const submit = vi.fn<SubmitHandler>(async () => sentOk())
    const { user } = setup({ submit })
    await act(async () => goOffline(true))
    await act(async () => goOffline(false))
    expect(submit).not.toHaveBeenCalled()
    await user.click(screen.getByRole("radio", { name: "Yes" }))
    await user.click(photoBox())
    await user.click(submitButton())
    expect(submit).toHaveBeenCalledTimes(1)
  })
})

describe("CaptureForm: uploads after a refused or resent answer (B5)", () => {
  const LATER: SubmittableAsset = {
    ...PHOTO,
    assetId: "7d000000-0000-4000-8000-00000000000d",
    createdAt: "2026-11-04T10:00:00.000Z",
  }
  const laterBox = () =>
    screen.getByRole("checkbox", { name: "Photo added 4 Nov 2026, 10:00" })

  async function withAddQueue(submit: ReturnType<typeof vi.fn<SubmitHandler>>) {
    const openAdd = vi.fn()
    const utils = setup({
      assets: [PHOTO],
      submit,
      upload: { addQueue: { openAdd }, uploader: noUpload, limits: LIMITS },
    })
    await utils.user.click(
      screen.getByRole("button", { name: "Choose from your photos" })
    )
    const opts = openAdd.mock.lastCall?.[0] as OpenAddOptions
    await utils.user.click(screen.getByRole("radio", { name: "Yes" }))
    await utils.user.click(photoBox())
    utils.loadAssets.mockResolvedValue(assetsOk([LATER, VIDEO, PHOTO]))
    return { ...utils, opts }
  }

  it("selects new uploads again once a send is refused for an ended session", async () => {
    let refuse!: (error: Error) => void
    const submit = vi
      .fn<SubmitHandler>()
      .mockImplementationOnce(
        () => new Promise((_, reject) => (refuse = reject))
      )
    const { user, opts } = await withAddQueue(submit)
    await user.click(submitButton())
    // Ready while the answer was sending, then refused: nothing was recorded.
    opts.onReady?.([VIDEO.assetId])
    await act(async () => refuse(new Error(SESSION_ENDED_MESSAGE)))
    await waitFor(() =>
      expect((videoBox() as HTMLInputElement).checked).toBe(true)
    )
    // Later uploads are selected for the person as the form promises.
    opts.onReady?.([LATER.assetId])
    await waitFor(() =>
      expect((laterBox() as HTMLInputElement).checked).toBe(true)
    )
  })

  it("never calls an upload the person ticked and sent a missed one", async () => {
    const submit = vi
      .fn<SubmitHandler>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(sentOk())
    const { user, opts, onDone, rerender, ui } = await withAddQueue(submit)
    await user.click(submitButton())
    await screen.findByRole("button", { name: UI_TEXT.retry })
    // Unresolved: the new upload waits. A list refresh (another Add) shows
    // it unticked, and the person ticks it by hand.
    opts.onReady?.([LATER.assetId])
    await act(async () => {})
    rerender(cloneElement(ui(), { refreshSignal: 1 }))
    await waitFor(() => expect(laterBox()).toBeTruthy())
    expect((laterBox() as HTMLInputElement).checked).toBe(false)
    await user.click(laterBox())
    await user.click(submitButton())
    expect(lastInput(submit).assetIds).toEqual([PHOTO.assetId, LATER.assetId])
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(screen.queryByText(/wasn't added to this check/)).toBeNull()
  })
})
