// @vitest-environment jsdom
// B05-05d in Add (contracts/b05-05-journal-wiring-scope.md, OD-B5-05-8 to
// 11): the Add sheet says what didn't finish in an earlier tab, worded from
// resumeAction; Continue queues the kept photo in no set, under its earlier
// upload key, with the labels typed before reservation; the probe line.
// The journal is injected (memory backend: jsdom Files do not survive
// fake-indexeddb).
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { refresh, supabase, uploads, sets, labelApi } = vi.hoisted(() => ({
  refresh: vi.fn(),
  supabase: {
    auth: {
      // The signed-in account, as supabase-js reports it on subscribe.
      onAuthStateChange: vi.fn(
        (listener: (event: string, session: unknown) => void) => {
          queueMicrotask(() =>
            listener("INITIAL_SESSION", { user: { id: "u1", email: null } })
          )
          return { data: { subscription: { unsubscribe: vi.fn() } } }
        }
      ),
      getSession: vi.fn(async () => ({
        data: { session: { user: { id: "u1" } } },
        error: null,
      })),
    },
  },
  uploads: { current: null as unknown },
  sets: {
    startPhotoSet: vi.fn(async () => ({ status: "missing" })),
    addToPhotoSet: vi.fn(async () => ({ status: "missing" })),
    readPhotoSet: vi.fn(async () => ({ status: "missing" })),
    replaceInPhotoSet: vi.fn(async () => ({ status: "missing" })),
    readPhotoSets: vi.fn(async () => ({ status: "missing" })),
    readDeleteEvidence: vi.fn(async () => ({ status: "missing" })),
    deleteMedia: vi.fn(),
  },
  labelApi: {
    loadUploadLabelContext: vi.fn(async () => ({
      ok: false,
      message: "The menu could not be loaded. Try again.",
    })),
    saveUploadLabels: vi.fn(
      async (_venue: string, input: { assetId: string }) => ({
        ok: true,
        assetId: input.assetId,
        state: "pending",
      })
    ),
    discardUploadLabels: vi.fn(),
    loadLabelAttention: vi.fn(async () => []),
    loadPhotoLabels: vi.fn(async () => null),
  },
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/staff",
}))
vi.mock("@/lib/supabase/browser", () => ({ createClient: () => supabase }))
vi.mock("@/app/_media/use-media-uploader", () => ({
  useMediaUploader: () => uploads.current,
}))
vi.mock("@/app/_labels/actions", () => ({
  loadLabelEditorContext: vi.fn(),
  loadLabelCatalogue: vi.fn(),
  saveLabelBatch: vi.fn(),
}))
vi.mock("@/app/_media/actions", () => sets)
vi.mock("@/app/staff/_shell/upload-label-api", () => labelApi)

import { AddHost } from "@/app/staff/_shell/add-host"
import { useAdd } from "@/components/nabalens/shell/add-context"
import {
  CAPTURE_COPY,
  CaptureJournalContext,
} from "@/components/nabalens/shell/capture-resume"
import type {
  UploadContext,
  Uploader,
} from "@/components/nabalens/upload-queue"
import { captureAnnotation } from "@/lib/upload/capture-session"
import type { CaptureSession } from "@/lib/upload/capture-session"
import {
  memoryJournalBackend,
  openCaptureJournal,
  type CaptureJournal,
  type PickInput,
} from "@/lib/upload/journal"

const MiB = 1024 * 1024
const caps = (storeBytes: boolean) =>
  ({
    indexedDb: true,
    persisted: true,
    quotaBytes: 10_000 * MiB,
    usageBytes: 0,
    storeBytes,
    reason: storeBytes ? null : "private_mode",
    backgroundSync: "unsupported",
    backgroundFetch: "unsupported",
  }) as const

const jpeg = (name: string) =>
  new File([new Uint8Array(64)], name, {
    type: "image/jpeg",
    lastModified: 1_700_000_000_000,
  })
const video = (name: string) =>
  new File([new Uint8Array(64)], name, { type: "video/mp4" })

let journal: CaptureJournal
let session: CaptureSession
const opened = vi.fn()

async function makeSession(storeBytes = true) {
  journal = await openCaptureJournal({
    backend: memoryJournalBackend(),
    accountHash: "hash-u1",
    capabilities: caps(storeBytes),
  })
  session = {
    accountHash: "hash-u1",
    capabilities: caps(storeBytes),
    journal,
    alive: () => true,
  }
}

const pick = (file: File, over: Partial<PickInput> = {}) =>
  journal.pick({
    purpose: "general",
    subject: { kind: "menu_item", id: "item-1" },
    groupKey: "set-key-1",
    uploadKey: `key-${file.name}`,
    fileFingerprint: `fp-${file.name}`,
    file,
    mediaType: file.type.startsWith("video") ? "video" : "image",
    ...over,
  })

function Opener() {
  const openAdd = useAdd()
  return (
    <button type="button" onClick={() => openAdd?.({})}>
      Add
    </button>
  )
}

function host() {
  render(
    <CaptureJournalContext.Provider
      value={async (userId) => {
        opened(userId)
        return session
      }}
    >
      <AddHost
        blocked={null}
        captchaRequired={false}
        captchaSiteKey={null}
        entry={null}
        venueName="TEST Inn"
      >
        <Opener />
      </AddHost>
    </CaptureJournalContext.Provider>
  )
}

async function openSheet() {
  host()
  await waitFor(() => expect(opened).toHaveBeenCalledWith("u1"))
  fireEvent.click(screen.getByRole("button", { name: "Add" }))
  return screen.findByRole("dialog", { name: "Add photos" })
}

const uploaded: { file: File; context: UploadContext }[] = []
const uploader: Uploader = async (file, context) => {
  uploaded.push({ file, context })
  const assetId = `asset-${file.name}`
  context.onReserved?.(assetId)
  return { assetId }
}

beforeEach(async () => {
  vi.clearAllMocks()
  uploaded.length = 0
  window.sessionStorage.clear()
  uploads.current = uploader
  // Phone width: idle Add opens the sheet.
  vi.stubGlobal("matchMedia", () => ({ matches: false }))
  await makeSession()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe("the resume block (OD-B5-05-11)", () => {
  it("words each kind from resumeAction", async () => {
    await pick(video("clip.mp4"))
    const lost = (await pick(jpeg("lost.jpg"), { mediaType: "image" }))!
    await journal.update(lost.id, { state: "needs_reselection" })
    const bad = (await pick(jpeg("bad.jpg")))!
    await journal.fail(bad.id, "processing_failed", true)
    const refused = (await pick(jpeg("refused.jpg")))!
    await journal.fail(refused.id, "finalise_refused", true)
    await pick(jpeg("kept.jpg"))
    const sheet = await openSheet()
    const block = await within(sheet).findByRole("region", {
      name: CAPTURE_COPY.heading,
    })
    expect(
      within(block).getByText(CAPTURE_COPY.reselectLine("clip.mp4"))
    ).toBeTruthy()
    expect(
      within(block).getByText(CAPTURE_COPY.reselectLine("lost.jpg"))
    ).toBeTruthy()
    expect(
      within(block).getByText(CAPTURE_COPY.chooseDifferentLine("bad.jpg"))
    ).toBeTruthy()
    expect(
      within(block).getByText(CAPTURE_COPY.signInAgainLine("refused.jpg"))
    ).toBeTruthy()
    expect(
      within(block).getByText(CAPTURE_COPY.continueLine("kept.jpg"))
    ).toBeTruthy()
    // Continue only where the bytes are here.
    expect(
      within(block)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label"))
    ).toEqual([CAPTURE_COPY.continueLabel("kept.jpg")])
    // Nothing promises a background upload.
    expect(block.textContent).not.toMatch(
      /background|while (the page is )?closed/i
    )
  })

  it("leaves out what the server is finalising, and shows nothing when all is done", async () => {
    const handed = (await pick(jpeg("handed.jpg")))!
    await journal.update(handed.id, { state: "finalising" })
    const sheet = await openSheet()
    await waitFor(() =>
      expect(sheet.querySelector("[data-capture-resume]")).toBeNull()
    )
    expect(within(sheet).queryByText(/handed\.jpg/)).toBeNull()
  })

  it("Continue queues the kept photo in no set, with its labels typed before reservation", async () => {
    const kept = jpeg("kept.jpg")
    await pick(kept, {
      pendingLabels: {
        venueId: "venue-1",
        input: {
          assetId: "old-row",
          expectedRevision: 0,
          catalogueVersionId: null,
          contentTypes: ["dish"],
          note: "TEST typed before",
          items: [],
          missingItem: null,
        },
      },
    })
    const sheet = await openSheet()
    fireEvent.click(
      await within(sheet).findByRole("button", {
        name: CAPTURE_COPY.continueLabel("kept.jpg"),
      })
    )
    await waitFor(() => expect(uploaded).toHaveLength(1))
    expect(uploaded[0]!.file).toBe(kept)
    // Its subject and set key are known to the transport; no set is made.
    expect(captureAnnotation(kept)).toMatchObject({
      subject: { kind: "menu_item", id: "item-1" },
      groupKey: "set-key-1",
    })
    expect(sets.startPhotoSet).not.toHaveBeenCalled()
    // The labels typed before go to the new asset once it is reserved.
    await waitFor(() =>
      expect(labelApi.saveUploadLabels).toHaveBeenCalledWith(
        "venue-1",
        expect.objectContaining({
          assetId: "asset-kept.jpg",
          note: "TEST typed before",
          contentTypes: ["dish"],
        })
      )
    )
    // The block no longer lists it.
    await waitFor(() =>
      expect(
        screen.queryByText(CAPTURE_COPY.continueLine("kept.jpg"))
      ).toBeNull()
    )
  })
})

describe("the probe line (OD-B5-05-3)", () => {
  it("says to keep the page open when this browser can't keep photos", async () => {
    await makeSession(false)
    const sheet = await openSheet()
    expect(await within(sheet).findByText(CAPTURE_COPY.keepOpen)).toBeTruthy()
  })

  it("says nothing when it can", async () => {
    const sheet = await openSheet()
    await new Promise((r) => setTimeout(r, 20))
    expect(within(sheet).queryByText(CAPTURE_COPY.keepOpen)).toBeNull()
  })
})
