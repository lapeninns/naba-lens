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

const { refresh, supabase, uploads, sets, labelApi, keyStore } = vi.hoisted(
  () => ({
    keyStore: {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    },
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
  })
)

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
vi.mock("@/lib/upload/upload-keys", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload/upload-keys")>()),
  localUploadKeyStore: () => keyStore,
}))

import { AddHost } from "@/app/staff/_shell/add-host"
import { useAdd } from "@/components/nabalens/shell/add-context"
import {
  CAPTURE_COPY,
  CaptureJournalContext,
  createLabelJournal,
  journalLabels,
  journalMemberLines,
  panelChoiceCounts,
  resumableEntries,
  sendClearsLabels,
} from "@/components/nabalens/shell/capture-resume"
import type {
  UploadContext,
  Uploader,
} from "@/components/nabalens/upload-queue"
import {
  annotateCapture,
  bindCapture,
  captureAnnotation,
} from "@/lib/upload/capture-session"
import type { CaptureSession } from "@/lib/upload/capture-session"
import type { SaveLabelsInput } from "@/lib/menus/types"
import type { EntryMenu } from "@/lib/work-client/entry"
import { CATALOGUE } from "./labels-fixtures"
import {
  memoryJournalBackend,
  openCaptureJournal,
  type CaptureJournal,
  type JournalEntry,
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

let alive = true
async function makeSession(storeBytes = true) {
  alive = true
  journal = await openCaptureJournal({
    backend: memoryJournalBackend(),
    accountHash: "hash-u1",
    capabilities: caps(storeBytes),
  })
  session = {
    accountHash: "hash-u1",
    capabilities: caps(storeBytes),
    journal,
    alive: () => alive,
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

function host(entry: Promise<EntryMenu | null> | null = null) {
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
        entry={entry}
        venueName="TEST Inn"
      >
        <Opener />
      </AddHost>
    </CaptureJournalContext.Provider>
  )
}

async function openSheet(entry: Promise<EntryMenu | null> | null = null) {
  host(entry)
  await waitFor(() => expect(opened).toHaveBeenCalledWith("u1"))
  fireEvent.click(screen.getByRole("button", { name: "Add" }))
  return screen.findByRole("dialog", { name: "Add photos" })
}

const uploaded: { file: File; context: UploadContext; keysSet: number }[] = []
const uploader: Uploader = async (file, context) => {
  uploaded.push({ file, context, keysSet: keyStore.set.mock.calls.length })
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
    // Continue only where the bytes are here; Dismiss on each.
    expect(
      within(block)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label"))
        .filter((l) => !l?.startsWith("Dismiss"))
    ).toEqual([CAPTURE_COPY.continueLabel("kept.jpg")])
    expect(
      within(block).getAllByRole("button", { name: /^Dismiss / })
    ).toHaveLength(5)
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

describe("B05-05 follow-ups: Dismiss and the rebuilt set", () => {
  const MENU: EntryMenu = {
    venueName: "TEST Inn",
    intents: ["dish", "photos"],
    tasks: [],
    questions: [],
    answered: [],
  }

  it("Dismiss drops the entry from the block and this device's journal", async () => {
    await pick(jpeg("kept.jpg"))
    const bad = (await pick(jpeg("bad.jpg")))!
    await journal.fail(bad.id, "processing_failed", true)
    const sheet = await openSheet()
    fireEvent.click(
      await within(sheet).findByRole("button", {
        name: CAPTURE_COPY.dismissLabel("bad.jpg"),
      })
    )
    await waitFor(() =>
      expect(
        within(sheet).queryByText(CAPTURE_COPY.chooseDifferentLine("bad.jpg"))
      ).toBeNull()
    )
    expect(
      within(sheet).getByText(CAPTURE_COPY.continueLine("kept.jpg"))
    ).toBeTruthy()
    await waitFor(async () =>
      expect((await journal.unfinished()).map((e) => e.displayName)).toEqual([
        "kept.jpg",
      ])
    )
    // Nothing is uploaded or sent for it.
    expect(uploaded).toHaveLength(0)
    expect(keyStore.set).not.toHaveBeenCalled()
  })

  it("Continue rejoins the earlier tab's set under its key", async () => {
    sets.startPhotoSet.mockResolvedValue({
      status: "ok",
      groupId: "g-1",
    } as never)
    sets.addToPhotoSet.mockResolvedValue({
      status: "ok",
      members: 2,
    } as never)
    const kept = jpeg("kept.jpg")
    await pick(kept, {
      subject: { kind: "menu_item", id: "item-1", name: "Naan" },
    })
    const sheet = await openSheet(Promise.resolve(MENU))
    fireEvent.click(
      await within(sheet).findByRole("button", {
        name: CAPTURE_COPY.continueLabel("kept.jpg"),
      })
    )
    await waitFor(() =>
      expect(sets.addToPhotoSet).toHaveBeenCalledWith({
        groupId: "g-1",
        assetIds: ["asset-kept.jpg"],
      })
    )
    expect(sets.startPhotoSet).toHaveBeenCalledWith({
      key: "set-key-1",
      subject: { kind: "menu_item", id: "item-1" },
    })
    expect(sets.startPhotoSet).toHaveBeenCalledTimes(1)
  })

  it("Continue joins no set without a set key, or where sets are off", async () => {
    await pick(jpeg("single.jpg"), { groupKey: null })
    const sheet = await openSheet(Promise.resolve(MENU))
    fireEvent.click(
      await within(sheet).findByRole("button", {
        name: CAPTURE_COPY.continueLabel("single.jpg"),
      })
    )
    await waitFor(() => expect(uploaded).toHaveLength(1))
    expect(sets.startPhotoSet).not.toHaveBeenCalled()
  })

  it("words each unfinished asset for set notices from the journal", async () => {
    const bad = (await pick(jpeg("bad.jpg")))!
    await journal.update(bad.id, { state: "reserved", assetId: "asset-bad" })
    await journal.fail(bad.id, "processing_failed", true)
    await pick(jpeg("unreserved.jpg"))
    const lines = journalMemberLines(await journal.unfinished())
    expect([...lines]).toEqual([
      ["asset-bad", CAPTURE_COPY.chooseDifferentLine("bad.jpg")],
    ])
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

describe("from md, the upload dialog (J2)", () => {
  async function openDialog() {
    // Desktop: idle Add opens the upload dialog, as before.
    vi.stubGlobal("matchMedia", () => ({ matches: true }))
    host()
    await waitFor(() => expect(opened).toHaveBeenCalledWith("u1"))
    fireEvent.click(screen.getByRole("button", { name: "Add" }))
    const dialog = await screen.findByRole("dialog", {
      name: "Upload photos or videos",
    })
    expect(screen.queryByRole("dialog", { name: "Add photos" })).toBeNull()
    return dialog
  }

  it("shows the block above the pickers, with Continue, until a file is queued", async () => {
    await pick(jpeg("kept.jpg"))
    await pick(video("clip.mp4"))
    const dialog = await openDialog()
    const block = await within(dialog).findByRole("region", {
      name: CAPTURE_COPY.heading,
    })
    expect(
      within(block).getByText(CAPTURE_COPY.reselectLine("clip.mp4"))
    ).toBeTruthy()
    fireEvent.click(
      within(block).getByRole("button", {
        name: CAPTURE_COPY.continueLabel("kept.jpg"),
      })
    )
    await waitFor(() => expect(uploaded).toHaveLength(1))
    // Queued: the dialog is the queue now, and the block is gone.
    await waitFor(() =>
      expect(dialog.querySelector("[data-capture-resume]")).toBeNull()
    )
  })

  it("still takes a picked file in the same dialog", async () => {
    await pick(video("clip.mp4"))
    const dialog = await openDialog()
    await within(dialog).findByRole("region", { name: CAPTURE_COPY.heading })
    const input = within(dialog).getByLabelText("Choose photos or videos")
    fireEvent.change(input, { target: { files: [jpeg("new.jpg")] } })
    await waitFor(() =>
      expect(uploaded.map((u) => u.file.name)).toEqual(["new.jpg"])
    )
  })

  it("says to keep the page open there too", async () => {
    await makeSession(false)
    const dialog = await openDialog()
    expect(await within(dialog).findByText(CAPTURE_COPY.keepOpen)).toBeTruthy()
  })
})

describe("review repairs (K2, K3, K8, K13)", () => {
  it("K13: Continue gives the stored File its earlier upload key back", async () => {
    const kept = jpeg("kept.jpg")
    const entry = (await pick(kept))!
    const sheet = await openSheet()
    fireEvent.click(
      await within(sheet).findByRole("button", {
        name: CAPTURE_COPY.continueLabel("kept.jpg"),
      })
    )
    await waitFor(() => expect(uploaded).toHaveLength(1))
    expect(keyStore.set).toHaveBeenCalledWith(kept, entry.uploadKey, {
      purpose: "general",
      account: "u1",
    })
    // Set before the file reached the transport (which reads it).
    expect(uploaded[0]!.keysSet).toBe(1)
  })

  const typed = {
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
  }

  it("L1: reserved, then the tab died before the label send answered: Continue sends them once", async () => {
    const kept = jpeg("kept.jpg")
    const entry = (await pick(kept, { pendingLabels: typed }))!
    await journal.update(entry.id, { state: "transferring", assetId: "a-1" })
    const sheet = await openSheet()
    fireEvent.click(
      await within(sheet).findByRole("button", {
        name: CAPTURE_COPY.continueLabel("kept.jpg"),
      })
    )
    await waitFor(() => expect(uploaded).toHaveLength(1))
    await waitFor(() =>
      expect(labelApi.saveUploadLabels).toHaveBeenCalledWith(
        "venue-1",
        expect.objectContaining({
          assetId: "asset-kept.jpg",
          note: "TEST typed before",
        })
      )
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(labelApi.saveUploadLabels).toHaveBeenCalledTimes(1)
  })

  it("L1: once the server took them, the entry drops them and Continue sends nothing again", async () => {
    const kept = jpeg("kept.jpg")
    const entry = (await pick(kept, { pendingLabels: typed }))!
    // The transport records the continued file as this entry (as the
    // adapter does: same upload key, same entry).
    uploads.current = (async (file, context) => {
      bindCapture(file, journal, entry.id)
      context.onReserved?.(`asset-${file.name}`)
      return { assetId: `asset-${file.name}` }
    }) satisfies Uploader
    let sheet = await openSheet()
    fireEvent.click(
      await within(sheet).findByRole("button", {
        name: CAPTURE_COPY.continueLabel("kept.jpg"),
      })
    )
    await waitFor(() =>
      expect(labelApi.saveUploadLabels).toHaveBeenCalledTimes(1)
    )
    await waitFor(async () =>
      expect(
        (await journal.unfinished()).find((e) => e.id === entry.id)
      ).not.toHaveProperty("pendingLabels")
    )
    // Another visit: the entry is still there (not finished), with no labels.
    cleanup()
    sheet = await openSheet()
    fireEvent.click(
      await within(sheet).findByRole("button", {
        name: CAPTURE_COPY.continueLabel("kept.jpg"),
      })
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(labelApi.saveUploadLabels).toHaveBeenCalledTimes(1)
  })

  it("K3: task and question uploads are not Add's to continue", async () => {
    await pick(jpeg("task.jpg"), { subject: { kind: "task", id: "t-1" } })
    await pick(jpeg("evidence.jpg"), {
      purpose: "amenity",
      subject: { kind: "question", id: "q-1" },
    })
    await pick(jpeg("dish.jpg"))
    const sheet = await openSheet()
    expect(
      await within(sheet).findByText(CAPTURE_COPY.continueLine("dish.jpg"))
    ).toBeTruthy()
    expect(within(sheet).queryByText(/task\.jpg/)).toBeNull()
    expect(within(sheet).queryByText(/evidence\.jpg/)).toBeNull()
  })

  it("K8: a journal signed out in another tab shows nothing and writes no key", async () => {
    await pick(jpeg("kept.jpg"))
    const sheet = await openSheet()
    await within(sheet).findByText(CAPTURE_COPY.continueLine("kept.jpg"))
    alive = false
    // Any re-render (here: closing and opening the sheet) drops the block.
    fireEvent.keyDown(sheet, { key: "Escape" })
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Add photos" })).toBeNull()
    )
    fireEvent.click(screen.getByRole("button", { name: "Add" }))
    const again = await screen.findByRole("dialog", { name: "Add photos" })
    await new Promise((r) => setTimeout(r, 20))
    expect(again.querySelector("[data-capture-resume]")).toBeNull()
    expect(keyStore.set).not.toHaveBeenCalled()
  })

  it("K13: lists neither what this tab's queue holds nor what it picked", () => {
    const entry = (id: string, over: Partial<JournalEntry> = {}) =>
      ({
        id,
        purpose: "general",
        subject: { kind: "none", id: null },
        assetId: null,
        state: "reserved",
        ...over,
      }) as JournalEntry
    const all = [
      entry("held", { assetId: "asset-held" }),
      entry("picked-here"),
      entry("finalising", { state: "finalising" }),
      entry("other"),
    ]
    expect(
      resumableEntries(
        all,
        new Set(["asset-held"]),
        new Set(["picked-here"])
      ).map((e) => e.id)
    ).toEqual(["other"])
    expect(
      resumableEntries(all, new Set(), new Set()).map((e) => e.id)
    ).toEqual(["held", "picked-here", "other"])
  })
})

describe("the latest label choice (M3)", () => {
  const choice = (
    note: string | null,
    contentTypes: SaveLabelsInput["contentTypes"] = []
  ): SaveLabelsInput => ({
    assetId: "row-1",
    expectedRevision: 0,
    catalogueVersionId: null,
    contentTypes,
    note,
    items: [],
    missingItem: null,
  })

  it("keeps the latest choice, nothing for an empty one, and clears only on its own confirmation", () => {
    expect(journalLabels("v", choice("x", ["dish"]))).toEqual({
      venueId: "v",
      input: choice("x", ["dish"]),
    })
    expect(journalLabels("v", choice(null))).toBeUndefined()
    const heldB = journalLabels("v", choice("B", ["dish"]))
    // X's late confirmation must not clear B; B's own does.
    expect(
      sendClearsLabels(heldB, { ...choice("X", ["dish"]), assetId: "a" })
    ).toBe(false)
    expect(
      sendClearsLabels(heldB, { ...choice("B", ["dish"]), assetId: "a" })
    ).toBe(true)
    expect(sendClearsLabels(undefined, choice("X"))).toBe(true)
  })

  async function reservedWithX() {
    const kept = jpeg("kept.jpg")
    const entry = (await pick(kept, {
      pendingLabels: { venueId: "venue-1", input: choice("TEST X", ["dish"]) },
    }))!
    await journal.update(entry.id, { state: "transferring", assetId: "a-1" })
    // The earlier tab's file, bound to its entry (as the transport does);
    // its first send got no answer.
    const earlier = jpeg("kept.jpg")
    bindCapture(earlier, journal, entry.id)
    return { earlier }
  }

  it("changed to B after reserve, then reopened: B is sent, never X", async () => {
    const { earlier } = await reservedWithX()
    annotateCapture(earlier, {
      pendingLabels: journalLabels("venue-1", choice("TEST B", ["dish"])),
    })
    const sheet = await openSheet()
    fireEvent.click(
      await within(sheet).findByRole("button", {
        name: CAPTURE_COPY.continueLabel("kept.jpg"),
      })
    )
    await waitFor(() =>
      expect(labelApi.saveUploadLabels).toHaveBeenCalledWith(
        "venue-1",
        expect.objectContaining({ note: "TEST B" })
      )
    )
    expect(
      labelApi.saveUploadLabels.mock.calls.some(
        ([, input]) => (input as { note?: string }).note === "TEST X"
      )
    ).toBe(false)
  })

  it("X removed after reserve, then reopened: nothing is sent", async () => {
    const { earlier } = await reservedWithX()
    annotateCapture(earlier, {
      pendingLabels: journalLabels("venue-1", choice(null)),
    })
    const sheet = await openSheet()
    fireEvent.click(
      await within(sheet).findByRole("button", {
        name: CAPTURE_COPY.continueLabel("kept.jpg"),
      })
    )
    await waitFor(() => expect(uploaded).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 50))
    expect(labelApi.saveUploadLabels).not.toHaveBeenCalled()
  })
})

describe("the journal's label copy follows the server (N2, N3, N4)", () => {
  const choice = (
    note: string,
    items: SaveLabelsInput["items"] = []
  ): SaveLabelsInput => ({
    assetId: "row-1",
    expectedRevision: 0,
    catalogueVersionId: null,
    contentTypes: ["dish"],
    note,
    items,
    missingItem: null,
  })

  function tracked() {
    const held = new Map<File, unknown>()
    const sync = createLabelJournal(
      (file, patch) => held.set(file, patch.pendingLabels),
      (file) => (held.has(file) ? { pendingLabels: held.get(file) } : undefined)
    )
    return { held, sync }
  }

  it("N3: a later confirmation still clears: confirming never forgets the file", () => {
    const { held, sync } = tracked()
    const file = jpeg("a.jpg")
    sync.reserved("asset-a", file)
    held.set(file, journalLabels("v", choice("X")))
    sync.sending({ ...choice("X"), assetId: "asset-a" })
    sync.confirmed({ ...choice("X"), assetId: "asset-a" })
    expect(held.get(file)).toBeUndefined()
    // Changed to B afterwards, then confirmed: cleared again.
    held.set(file, journalLabels("v", choice("B")))
    sync.sending({ ...choice("B"), assetId: "asset-a" })
    sync.confirmed({ ...choice("B"), assetId: "asset-a" })
    expect(held.get(file)).toBeUndefined()
    expect(sync.size()).toBe(1)
  })

  it("N2: a discard clears only the choice it discarded", () => {
    const { held, sync } = tracked()
    const file = jpeg("a.jpg")
    sync.reserved("asset-a", file)
    sync.sending({ ...choice("X"), assetId: "asset-a" })
    // A newer choice, not sent yet: the discard of X keeps it.
    held.set(file, journalLabels("v", choice("B")))
    sync.discarded("asset-a")
    expect(held.get(file)).toEqual(journalLabels("v", choice("B")))
    // Still X: the discard clears it.
    held.set(file, journalLabels("v", choice("X")))
    sync.discarded("asset-a")
    expect(held.get(file)).toBeUndefined()
  })

  it("forgets files on upload end, remove and another account, within 100", () => {
    const { held, sync } = tracked()
    const a = jpeg("a.jpg")
    sync.reserved("asset-a", a)
    sync.forgetAsset("asset-a")
    held.set(a, journalLabels("v", choice("X")))
    sync.confirmed({ ...choice("X"), assetId: "asset-a" })
    expect(held.get(a)).toBeDefined()
    sync.reserved("asset-a", a)
    sync.forgetFile(a)
    expect(sync.size()).toBe(0)
    for (let i = 0; i < 120; i++) sync.reserved(`asset-${i}`, jpeg(`${i}.jpg`))
    expect(sync.size()).toBe(100)
    sync.clear()
    expect(sync.size()).toBe(0)
  })

  it("N4: a continued row's empty first panel choice doesn't count until its seed is in", () => {
    const empty = { ...choice(""), contentTypes: [] }
    expect(panelChoiceCounts(empty, true, undefined)).toBe(false)
    expect(panelChoiceCounts(empty, true, choice("X"))).toBe(true)
    expect(panelChoiceCounts(choice("X"), true, undefined)).toBe(true)
    expect(panelChoiceCounts(empty, false, undefined)).toBe(true)
  })

  it("N4 through Add: the panel mounting for a continued row keeps its labels in the journal", async () => {
    labelApi.loadUploadLabelContext.mockResolvedValue({
      ok: true,
      catalogue: CATALOGUE,
      focus: null,
    } as never)
    // The send never answers: only the panel could clear the journal's copy.
    labelApi.saveUploadLabels.mockImplementation(() => new Promise(() => {}))
    const kept = jpeg("kept.jpg")
    const x = choice("TEST X", [{ itemId: "item-bhaji", variantId: null }])
    const entry = (await pick(kept, {
      pendingLabels: { venueId: "venue-1", input: x },
    }))!
    uploads.current = (async (file, context) => {
      bindCapture(file, journal, entry.id)
      context.onReserved?.(`asset-${file.name}`)
      return { assetId: `asset-${file.name}` }
    }) satisfies Uploader
    const sheet = await openSheet()
    fireEvent.click(
      await within(sheet).findByRole("button", {
        name: CAPTURE_COPY.continueLabel("kept.jpg"),
      })
    )
    await waitFor(() => expect(labelApi.saveUploadLabels).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 100))
    const stored = (await journal.unfinished()).find((e) => e.id === entry.id)
    expect(stored?.pendingLabels).toMatchObject({
      input: { note: "TEST X", items: [{ itemId: "item-bhaji" }] },
    })
  })
})
