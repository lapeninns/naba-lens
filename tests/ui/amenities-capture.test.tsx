// @vitest-environment jsdom
// Staff amenity capture: answer, evidence rule, Wi-Fi redaction tick and test
// notes, and a per-check draft whose idempotency key survives failures and
// reloads, so "Try again" never records a finding twice.
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  CaptureForm,
  loadDraft,
  type AssetsResult,
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
import type { Uploader } from "@/components/nabalens/upload-queue"

const CHECK_ID = "8a000000-0000-4000-8000-000000000001"

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
}: {
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

  it("lets an admin pick existing media only, with earlier Coverage photos under their own heading", async () => {
    setup({ upload: null, assets: [PHOTO, LEGACY] })
    expect(
      screen.queryByRole("button", { name: "Choose from your photos" })
    ).toBeNull()
    expect(screen.getByText(/Admins can't upload/)).toBeTruthy()
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
    loadAssets.mockResolvedValue(assetsOk([VIDEO, PHOTO]))
    opts.onReady([VIDEO.assetId])
    await waitFor(() =>
      expect((videoBox() as HTMLInputElement).checked).toBe(true)
    )
    expect(screen.getByText("1 new upload selected.")).toBeTruthy()
  })

  it("shows the manager's recheck reason", () => {
    setup({
      summary: check({
        progress: "needs_recheck",
        recheckReason: "Password visible in the photo",
      }),
    })
    expect(screen.getByText("Password visible in the photo")).toBeTruthy()
  })
})
