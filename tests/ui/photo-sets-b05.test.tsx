// @vitest-environment jsdom
// B05-01e and d in Add: a settled set's one notice is worded from the
// server's read of the set (never from this queue alone, unless the read
// fails), and a photo the server failed offers Replace beside Retry, which
// swaps a different photo in instead of adding it.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { refresh, supabase, uploads, sets } = vi.hoisted(() => ({
  refresh: vi.fn(),
  supabase: {
    auth: {
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      getSession: vi.fn(async () => ({
        data: { session: { user: { id: "u1" } } },
        error: null,
      })),
    },
  },
  uploads: { current: null as unknown },
  sets: {
    startPhotoSet: vi.fn(),
    addToPhotoSet: vi.fn(),
    readPhotoSet: vi.fn(),
    replaceInPhotoSet: vi.fn(),
    readPhotoSets: vi.fn(),
    readDeleteEvidence: vi.fn(async () => ({ status: "missing" })),
    deleteMedia: vi.fn(),
  },
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/staff/menu",
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
vi.mock("@/app/staff/_shell/upload-label-api", () => ({
  loadUploadLabelContext: vi.fn(async () => ({
    ok: false,
    message: "The menu could not be loaded. Try again.",
  })),
  saveUploadLabels: vi.fn(),
  discardUploadLabels: vi.fn(),
  loadLabelAttention: vi.fn(),
  loadPhotoLabels: vi.fn(),
}))

import { AddHost } from "@/app/staff/_shell/add-host"
import {
  useAdd,
  type OpenAddOptions,
} from "@/components/nabalens/shell/add-context"
import { ENTRY_COPY } from "@/components/nabalens/shell/entry-copy"
import { PhotoSets } from "@/components/nabalens/shell/photo-sets"
import {
  serverSetNotice,
  setNotices,
  STOPPED_MARGIN_MS,
} from "@/components/nabalens/upload-dialog"
import type {
  QueueItem,
  UploadContext,
  Uploader,
} from "@/components/nabalens/upload-queue"
import type {
  ContributionGroupMember,
  ContributionGroupView,
  GroupMemberTechnical,
} from "@/lib/knowledge/contract"
import { toQueueUploader } from "@/lib/upload/queue-adapter"
import type { UploadFn } from "@/lib/upload/types"
import type { EntryMenu } from "@/lib/work-client/entry"

const jpeg = (name: string) =>
  new File([new Uint8Array(64)], name, { type: "image/jpeg" })

const GROUP = "00000000-0000-4000-8000-000000006001"
const TANDOOR = "00000000-0000-4000-8000-0000000000c1"
const DAMAGED = "This file is damaged or could not be read."

/** Reserves each file as `asset-{name}`; "bad.jpg" can't be processed. */
const uploader: Uploader = async (file, context: UploadContext) => {
  const assetId = `asset-${file.name}`
  context.onReserved?.(assetId)
  if (file.name === "bad.jpg")
    throw Object.assign(new Error(DAMAGED), {
      error: { code: "processing_failed", retryable: false, message: DAMAGED },
    })
  return { assetId }
}

const MENU: EntryMenu = {
  venueName: "TEST Inn",
  intents: ["dish", "photos"],
  tasks: [],
  questions: [],
  answered: [],
}

const DISH: OpenAddOptions = {
  source: "library",
  imagesOnly: true,
  preset: {
    itemId: TANDOOR,
    variantId: null,
    itemName: "Tandoori chicken",
    variantName: null,
  },
}

const NAAN: OpenAddOptions = {
  ...DISH,
  preset: {
    ...DISH.preset!,
    itemId: "00000000-0000-4000-8000-0000000000c2",
    itemName: "Naan",
  },
}

function Opener({
  opts = DISH,
  label = "Tandoor photos",
}: {
  opts?: OpenAddOptions
  label?: string
}) {
  const openAdd = useAdd()
  return (
    <button type="button" onClick={() => openAdd?.(opts)}>
      {label}
    </button>
  )
}

/**
 * A fake server for the set: members as they join, each ready unless named
 * in `technical`, plus the replacements it accepted.
 */
const server = {
  members: [] as string[],
  technical: new Map<string, GroupMemberTechnical>(),
  replaces: new Map<string, string>(),
  extra: [] as ContributionGroupMember[],
}

const member = (
  assetId: string,
  position: number,
  technical: GroupMemberTechnical,
  replacesAssetId: string | null = null
): ContributionGroupMember => ({
  assetId,
  position,
  mediaType: "image",
  uploadState: technical === "removed" ? "failed" : technical,
  mine: true,
  replacesAssetId,
  technical,
})

function view(): ContributionGroupView {
  return {
    groupId: GROUP,
    venueId: "00000000-0000-4000-8000-000000007001",
    createdAt: "2026-11-12T10:00:00Z",
    mine: true,
    subject: { kind: "menu_item", id: TANDOOR, name: "Tandoori chicken" },
    members: [
      ...server.members.map((id, i) =>
        member(
          id,
          i + 1,
          server.technical.get(id) ?? "ready",
          server.replaces.get(id) ?? null
        )
      ),
      ...server.extra,
    ],
  }
}

function host() {
  const menu = Promise.resolve(MENU)
  render(
    <AddHost
      blocked={null}
      captchaRequired={false}
      captchaSiteKey={null}
      entry={menu}
      venueName="TEST Inn"
    >
      <Opener />
      <Opener opts={NAAN} label="Naan photos" />
    </AddHost>
  )
  return menu
}

const libraryInput = () =>
  document.querySelector<HTMLInputElement>(
    'input[data-photo-source="library"]'
  )!

const saved = (n: number) => ENTRY_COPY.setSaved(n, "Tandoori chicken")
const badLine = `bad.jpg: This file can't be used: ${DAMAGED.replace(/\.$/, "")}.`

async function tandoorSet(files: string[]) {
  const user = userEvent.setup()
  await host()
  fireEvent.click(screen.getByRole("button", { name: "Tandoor photos" }))
  await user.upload(libraryInput(), files.map(jpeg))
  const dialog = await screen.findByRole("dialog")
  return { user, dialog }
}

beforeEach(() => {
  vi.clearAllMocks()
  window.sessionStorage.clear()
  uploads.current = uploader
  vi.stubGlobal("matchMedia", () => ({ matches: true }))
  server.members = []
  server.technical = new Map([["asset-bad.jpg", "failed"]])
  server.replaces = new Map()
  server.extra = []
  sets.startPhotoSet.mockResolvedValue({ status: "ok", groupId: GROUP })
  sets.addToPhotoSet.mockImplementation(
    async (input: { assetIds: string[] }) => {
      for (const id of input.assetIds)
        if (!server.members.includes(id)) server.members.push(id)
      return { status: "ok", members: server.members.length }
    }
  )
  sets.readPhotoSet.mockImplementation(async () => ({
    status: "ok",
    group: view(),
  }))
  sets.replaceInPhotoSet.mockImplementation(
    async (input: { failedAssetId: string; newAssetId: string }) => {
      server.members.push(input.newAssetId)
      server.replaces.set(input.newAssetId, input.failedAssetId)
      return {
        status: "ok",
        groupId: GROUP,
        assetId: input.newAssetId,
        replacesAssetId: input.failedAssetId,
        position: server.members.length,
      }
    }
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe("the set's acknowledgement comes from the server (B05-01e)", () => {
  it("says the server's count once the set settles, all ready", async () => {
    const { dialog } = await tandoorSet(["one.jpg", "two.jpg", "three.jpg"])
    expect(await within(dialog).findByText(saved(3))).toBeTruthy()
    expect(sets.readPhotoSet).toHaveBeenCalledWith({ groupId: GROUP })
    expect(within(dialog).queryByText(ENTRY_COPY.setDidntFinish)).toBeNull()
  })

  it("lists a member this tab no longer holds as Didn't finish", async () => {
    // An earlier photo of the set, stopped in another tab.
    server.extra = [member("asset-elsewhere", 9, "uploading")]
    const { dialog } = await tandoorSet(["one.jpg", "two.jpg"])
    expect(await within(dialog).findByText(saved(2))).toBeTruthy()
    expect(within(dialog).getByText(ENTRY_COPY.setDidntFinish)).toBeTruthy()
  })

  it("counts processing as saved and lists a failed one by its row", async () => {
    server.technical.set("asset-two.jpg", "processing")
    const { dialog } = await tandoorSet(["one.jpg", "two.jpg", "bad.jpg"])
    expect(await within(dialog).findByText(saved(2))).toBeTruthy()
    expect(within(dialog).getByText(badLine)).toBeTruthy()
  })

  it("asks a failed read once more, and words the set from it", async () => {
    sets.readPhotoSet.mockResolvedValueOnce({ status: "failed", retry: true })
    server.extra = [member("asset-elsewhere", 9, "uploading")]
    const { dialog } = await tandoorSet(["one.jpg", "two.jpg"])
    // Meanwhile the queue's notice.
    expect(await within(dialog).findByText(saved(2))).toBeTruthy()
    expect(
      await within(dialog).findByText(
        ENTRY_COPY.setDidntFinish,
        {},
        { timeout: 6_000 }
      )
    ).toBeTruthy()
    expect(sets.readPhotoSet).toHaveBeenCalledTimes(2)
  }, 10_000)

  it("keeps the queue's notice when the read fails", async () => {
    sets.readPhotoSet.mockResolvedValue({ status: "failed", retry: true })
    server.extra = [member("asset-elsewhere", 9, "uploading")]
    const { dialog } = await tandoorSet(["one.jpg", "two.jpg", "bad.jpg"])
    expect(await within(dialog).findByText(saved(2))).toBeTruthy()
    expect(within(dialog).getByText(badLine)).toBeTruthy()
    // The queue knows nothing of the other tab's photo.
    expect(within(dialog).queryByText(ENTRY_COPY.setDidntFinish)).toBeNull()
  })
})

describe("Replace a photo that didn't finish (B05-01d)", () => {
  it("swaps a different photo in, and the notice has no failure line once it is ready", async () => {
    const { user, dialog } = await tandoorSet(["one.jpg", "two.jpg", "bad.jpg"])
    expect(await within(dialog).findByText(saved(2))).toBeTruthy()
    const replace = await within(dialog).findByRole("button", {
      name: ENTRY_COPY.replaceLabel("bad.jpg"),
    })
    // The server can't process it, so Retry is not offered; Replace is.
    expect(
      within(dialog).queryByRole("button", { name: "Retry bad.jpg" })
    ).toBeNull()
    fireEvent.click(replace)
    await user.upload(
      dialog.querySelector<HTMLInputElement>("input[data-replace-input]")!,
      jpeg("good.jpg")
    )
    await waitFor(() =>
      expect(sets.replaceInPhotoSet).toHaveBeenCalledWith({
        groupId: GROUP,
        failedAssetId: "asset-bad.jpg",
        newAssetId: "asset-good.jpg",
      })
    )
    expect(
      sets.addToPhotoSet.mock.calls.flatMap(([input]) => input.assetIds)
    ).not.toContain("asset-good.jpg")
    expect(await within(dialog).findByText(saved(3))).toBeTruthy()
    // The replaced row leaves the list; no line for it.
    await waitFor(() =>
      expect(within(dialog).queryByText("bad.jpg")).toBeNull()
    )
    expect(within(dialog).queryByText(badLine)).toBeNull()
  })

  it.each([
    ["in_group", ENTRY_COPY.replaceRefused.in_group],
    ["already_replaced", ENTRY_COPY.replaceRefused.already_replaced],
    ["set_full", ENTRY_COPY.replaceRefused.set_full],
    // No set words of its own: the server's message (R10, S12).
    ["in_other_group", "refused"],
  ])(
    "says the refusal %s on the row, and keeps the new photo",
    async (reason, text) => {
      sets.replaceInPhotoSet.mockResolvedValue({
        status: "failed",
        retry: false,
        refusal: { code: "state_conflict", message: "refused", reason },
      })
      const { user, dialog } = await tandoorSet([
        "one.jpg",
        "two.jpg",
        "bad.jpg",
      ])
      fireEvent.click(
        await within(dialog).findByRole("button", {
          name: ENTRY_COPY.replaceLabel("bad.jpg"),
        })
      )
      await user.upload(
        dialog.querySelector<HTMLInputElement>("input[data-replace-input]")!,
        jpeg("good.jpg")
      )
      expect(await within(dialog).findByText(text)).toBeTruthy()
      expect(within(dialog).getByText("good.jpg")).toBeTruthy()
      expect(within(dialog).getByText("bad.jpg")).toBeTruthy()
    }
  )

  it("refreshes the row when it finished meanwhile (not_replaceable)", async () => {
    sets.replaceInPhotoSet.mockImplementation(async () => {
      // Retried elsewhere: the server has it ready now.
      server.technical.set("asset-bad.jpg", "ready")
      return {
        status: "failed",
        retry: false,
        refusal: {
          code: "asset_ineligible",
          message: "refused",
          reason: "not_replaceable",
          assetId: "asset-bad.jpg",
        },
      }
    })
    const { user, dialog } = await tandoorSet(["one.jpg", "two.jpg", "bad.jpg"])
    fireEvent.click(
      await within(dialog).findByRole("button", {
        name: ENTRY_COPY.replaceLabel("bad.jpg"),
      })
    )
    await user.upload(
      dialog.querySelector<HTMLInputElement>("input[data-replace-input]")!,
      jpeg("good.jpg")
    )
    expect(
      await within(dialog).findByText(ENTRY_COPY.replaceRefused.not_replaceable)
    ).toBeTruthy()
    // Read again: no longer failed, so no Replace.
    await waitFor(() =>
      expect(
        within(dialog).queryByRole("button", {
          name: ENTRY_COPY.replaceLabel("bad.jpg"),
        })
      ).toBeNull()
    )
    expect(sets.readPhotoSet.mock.calls.length).toBeGreaterThan(1)
  })

  it("offers Replace only where the server has the photo failed or removed", async () => {
    // A transfer that failed here is still uploading on the server: Retry
    // resumes it; Replace would be refused within the hour.
    uploads.current = (async (file, context) => {
      context.onReserved?.(`asset-${file.name}`)
      if (file.name === "lost.jpg") throw new Error("The upload failed. Retry.")
      return { assetId: `asset-${file.name}` }
    }) satisfies Uploader
    server.technical.set("asset-lost.jpg", "uploading")
    const { dialog } = await tandoorSet(["one.jpg", "lost.jpg"])
    expect(await within(dialog).findByText(saved(1))).toBeTruthy()
    expect(
      within(dialog).getByRole("button", { name: "Retry lost.jpg" })
    ).toBeTruthy()
    expect(
      within(dialog).queryByRole("button", {
        name: ENTRY_COPY.replaceLabel("lost.jpg"),
      })
    ).toBeNull()
  })
})

describe("a join still on its way when the set settles (spare6 at 3c3141d0)", () => {
  it("waits for the damaged photo to join before reading, so Replace is offered", async () => {
    // The real adapter over an UploadFn shaped like createUploader's: a
    // reservation, then finalise rejects the damaged file as
    // processing_failed (not retryable), as the server pipeline does.
    const upload: UploadFn = async (file, options) => {
      const assetId = `asset-${file.name}`
      options.onReserved?.({ assetId, resumable: false })
      options.onStateChange?.("processing")
      await new Promise((r) => setTimeout(r, 10))
      return file.name === "bad.jpg"
        ? {
            assetId,
            state: "failed",
            error: {
              code: "processing_failed",
              message: DAMAGED,
              retryable: false,
            },
          }
        : { assetId, state: "ready" }
    }
    uploads.current = toQueueUploader(upload)
    // The first join is slow (Server Functions run one after another), so
    // the damaged photo is reserved while it runs and joins only after the
    // set has settled in this tab.
    let release!: () => void
    const firstJoin = new Promise<void>((r) => (release = r))
    const join = sets.addToPhotoSet.getMockImplementation()!
    sets.addToPhotoSet.mockImplementationOnce(async (input) => {
      await firstJoin
      return join(input)
    })
    const { dialog } = await tandoorSet(["one.jpg", "two.jpg", "bad.jpg"])
    // The row has failed here (finalise rejected it) while the join waits.
    expect(
      await within(dialog).findByText(
        `This file can't be used: ${DAMAGED.replace(/\.$/, "")}.`
      )
    ).toBeTruthy()
    // Not worded from the queue meanwhile: the read waits for the join.
    expect(within(dialog).queryByText(badLine)).toBeNull()
    release()
    expect(
      await within(dialog).findByRole("button", {
        name: ENTRY_COPY.replaceLabel("bad.jpg"),
      })
    ).toBeTruthy()
    expect(await within(dialog).findByText(saved(2))).toBeTruthy()
    expect(within(dialog).getByText(badLine)).toBeTruthy()
    // The read that worded the notice saw every member.
    const reads = await Promise.all(
      sets.readPhotoSet.mock.results.map((r) => r.value)
    )
    expect(reads.at(-1).group.members).toHaveLength(3)
  })
})

const replaceInput = (dialog: HTMLElement) =>
  dialog.querySelector<HTMLInputElement>("input[data-replace-input]")!
const replaceButton = (dialog: HTMLElement, name = "bad.jpg") =>
  within(dialog).queryByRole("button", { name: ENTRY_COPY.replaceLabel(name) })
const refusedWith = (reason: string) => ({
  status: "failed",
  retry: false,
  refusal: { code: "state_conflict", message: "refused", reason },
})
const joined = () =>
  sets.addToPhotoSet.mock.calls.flatMap(([input]) => input.assetIds)

describe("Replace: the review repairs (S1 to S13)", () => {
  it("S1: a replacement whose reservation failed and was retried still swaps in", async () => {
    let tries = 0
    uploads.current = (async (file, context) => {
      if (file.name === "good.jpg" && tries++ === 0)
        throw new Error("The upload failed. Retry.")
      return uploader(file, context)
    }) satisfies Uploader
    const { user, dialog } = await tandoorSet(["one.jpg", "two.jpg", "bad.jpg"])
    fireEvent.click(
      await within(dialog).findByRole("button", {
        name: ENTRY_COPY.replaceLabel("bad.jpg"),
      })
    )
    await user.upload(replaceInput(dialog), jpeg("good.jpg"))
    fireEvent.click(
      await within(dialog).findByRole("button", { name: "Retry good.jpg" })
    )
    await waitFor(() =>
      expect(sets.replaceInPhotoSet).toHaveBeenCalledWith({
        groupId: GROUP,
        failedAssetId: "asset-bad.jpg",
        newAssetId: "asset-good.jpg",
      })
    )
    expect(joined()).not.toContain("asset-good.jpg")
    expect(await within(dialog).findByText(saved(3))).toBeTruthy()
  })

  it("S2: replacing in an earlier set leaves Add more on the latest set", async () => {
    const GROUP2 = "00000000-0000-4000-8000-000000006002"
    sets.startPhotoSet
      .mockResolvedValueOnce({ status: "ok", groupId: GROUP })
      .mockResolvedValueOnce({ status: "ok", groupId: GROUP2 })
    const { user, dialog } = await tandoorSet(["one.jpg", "bad.jpg"])
    const replace = await within(dialog).findByRole("button", {
      name: ENTRY_COPY.replaceLabel("bad.jpg"),
    })
    // A second set, of Naan, is the latest pick.
    // Outside the open sheet (inert to assistive tech), as the page's own
    // Add buttons are.
    fireEvent.click(
      screen.getByRole("button", { name: "Naan photos", hidden: true })
    )
    await user.upload(libraryInput(), [jpeg("n1.jpg"), jpeg("n2.jpg")])
    await waitFor(() => expect(sets.startPhotoSet).toHaveBeenCalledTimes(2))
    fireEvent.click(replace)
    await user.upload(replaceInput(dialog), jpeg("good.jpg"))
    await waitFor(() => expect(sets.replaceInPhotoSet).toHaveBeenCalled())
    await user.upload(
      dialog.querySelector<HTMLInputElement>('input[type="file"]')!,
      [jpeg("more.jpg")]
    )
    await waitFor(() =>
      expect(sets.addToPhotoSet).toHaveBeenLastCalledWith({
        groupId: GROUP2,
        assetIds: ["asset-more.jpg"],
      })
    )
  })

  it("S3: a replacement the queue won't take ends, with the reason shown", async () => {
    const { user, dialog } = await tandoorSet(["one.jpg", "two.jpg", "bad.jpg"])
    fireEvent.click(
      await within(dialog).findByRole("button", {
        name: ENTRY_COPY.replaceLabel("bad.jpg"),
      })
    )
    await user.upload(
      replaceInput(dialog),
      new File([], "empty.jpg", { type: "image/jpeg" })
    )
    expect(await within(dialog).findByText(/This file is empty/)).toBeTruthy()
    expect(within(dialog).queryByText(/Replacing with/)).toBeNull()
    expect(replaceButton(dialog)).toBeTruthy()
    expect(sets.replaceInPhotoSet).not.toHaveBeenCalled()
  })

  it("S4: focus goes to the new row when the old one leaves", async () => {
    const { user, dialog } = await tandoorSet(["one.jpg", "two.jpg", "bad.jpg"])
    fireEvent.click(
      await within(dialog).findByRole("button", {
        name: ENTRY_COPY.replaceLabel("bad.jpg"),
      })
    )
    await user.upload(replaceInput(dialog), jpeg("good.jpg"))
    await waitFor(() =>
      expect(within(dialog).queryByText("bad.jpg")).toBeNull()
    )
    const row = within(dialog).getByText("good.jpg").closest("li")!
    await waitFor(() => expect(row.contains(document.activeElement)).toBe(true))
  })

  it("S7: a refusal is said in the polite region", async () => {
    sets.replaceInPhotoSet.mockResolvedValue(refusedWith("set_full"))
    const again = await tandoorSet(["one.jpg", "two.jpg", "bad.jpg"])
    fireEvent.click(
      await within(again.dialog).findByRole("button", {
        name: ENTRY_COPY.replaceLabel("bad.jpg"),
      })
    )
    await again.user.upload(replaceInput(again.dialog), jpeg("good.jpg"))
    const said = await within(again.dialog).findByText(
      `bad.jpg: ${ENTRY_COPY.replaceRefused.set_full}`
    )
    expect(said.closest("[aria-live=polite]")).toBeTruthy()
  })

  it("S5: a member the server has as stopped offers Replace on a row stopped here", async () => {
    uploads.current = (async (file, context) => {
      context.onReserved?.(`asset-${file.name}`)
      if (file.name === "lost.jpg") throw new Error("The upload failed. Retry.")
      return { assetId: `asset-${file.name}` }
    }) satisfies Uploader
    server.technical.set("asset-lost.jpg", "uploading")
    sets.readPhotoSet.mockImplementation(async () => {
      const v = view()
      return {
        status: "ok",
        group: {
          ...v,
          members: v.members.map((m) =>
            m.assetId === "asset-lost.jpg" ? { ...m, stopped: true } : m
          ),
        },
      }
    })
    const { dialog } = await tandoorSet(["one.jpg", "lost.jpg"])
    expect(
      await within(dialog).findByRole("button", {
        name: ENTRY_COPY.replaceLabel("lost.jpg"),
      })
    ).toBeTruthy()
    // Retry still resumes the same asset.
    expect(
      within(dialog).getByRole("button", { name: "Retry lost.jpg" })
    ).toBeTruthy()
  })

  it("S6: a set row that never became a member gets its line in the server's notice", async () => {
    uploads.current = (async (file, context) => {
      if (file.name === "early.jpg")
        throw new Error("We couldn't reserve it. Retry.")
      return uploader(file, context)
    }) satisfies Uploader
    const { dialog } = await tandoorSet(["one.jpg", "two.jpg", "early.jpg"])
    expect(await within(dialog).findByText(saved(2))).toBeTruthy()
    expect(
      within(dialog).getByText("early.jpg: We couldn't reserve it. Retry.")
    ).toBeTruthy()
    expect(sets.readPhotoSet).toHaveBeenCalled()
  })

  it("S8: after a refusal, Replace waits for a read taken since", async () => {
    sets.replaceInPhotoSet.mockResolvedValue(refusedWith("set_full"))
    const { user, dialog } = await tandoorSet(["one.jpg", "two.jpg", "bad.jpg"])
    fireEvent.click(
      await within(dialog).findByRole("button", {
        name: ENTRY_COPY.replaceLabel("bad.jpg"),
      })
    )
    // Reads after this never answer.
    sets.readPhotoSet.mockImplementation(() => new Promise(() => {}))
    await user.upload(replaceInput(dialog), jpeg("good.jpg"))
    expect(
      await within(dialog).findAllByText(ENTRY_COPY.replaceRefused.set_full)
    ).toBeTruthy()
    await new Promise((r) => setTimeout(r, 50))
    expect(replaceButton(dialog)).toBeNull()
  })

  it("S10: no notice is worded while a replace is still pending", async () => {
    let answer!: (v: unknown) => void
    sets.replaceInPhotoSet.mockImplementation(
      () => new Promise((r) => (answer = r))
    )
    const { user, dialog } = await tandoorSet(["one.jpg", "two.jpg", "bad.jpg"])
    fireEvent.click(
      await within(dialog).findByRole("button", {
        name: ENTRY_COPY.replaceLabel("bad.jpg"),
      })
    )
    const before = sets.readPhotoSet.mock.calls.length
    await user.upload(replaceInput(dialog), jpeg("good.jpg"))
    await within(dialog).findByText(/Replacing with good\.jpg/)
    // good.jpg is saved, but the swap has no answer: not settled.
    await waitFor(() =>
      expect(
        within(dialog).getByText("good.jpg").closest("li")!.textContent
      ).not.toMatch(/Uploading|Processing|Waiting/)
    )
    expect(within(dialog).queryByText(saved(2))).toBeNull()
    expect(sets.readPhotoSet.mock.calls.length).toBe(before)
    server.members.push("asset-good.jpg")
    server.replaces.set("asset-good.jpg", "asset-bad.jpg")
    answer({
      status: "ok",
      groupId: GROUP,
      assetId: "asset-good.jpg",
      replacesAssetId: "asset-bad.jpg",
      position: 4,
    })
    expect(await within(dialog).findByText(saved(3))).toBeTruthy()
  })

  it("S11: with no answer from replace, a read that shows the swap counts as replaced", async () => {
    sets.replaceInPhotoSet.mockImplementation(
      async (input: { failedAssetId: string; newAssetId: string }) => {
        // Committed, but the answer never came back.
        server.members.push(input.newAssetId)
        server.replaces.set(input.newAssetId, input.failedAssetId)
        return { status: "missing" }
      }
    )
    const { user, dialog } = await tandoorSet(["one.jpg", "two.jpg", "bad.jpg"])
    fireEvent.click(
      await within(dialog).findByRole("button", {
        name: ENTRY_COPY.replaceLabel("bad.jpg"),
      })
    )
    await user.upload(replaceInput(dialog), jpeg("good.jpg"))
    await waitFor(() =>
      expect(within(dialog).queryByText("bad.jpg")).toBeNull()
    )
    expect(
      within(dialog).queryByText(ENTRY_COPY.replaceRefused.other)
    ).toBeNull()
    expect(await within(dialog).findByText(saved(3))).toBeTruthy()
  })

  it("S13: the server's read words the set with one row left in this tab", async () => {
    const { user, dialog } = await tandoorSet(["one.jpg", "bad.jpg"])
    expect(await within(dialog).findByText(saved(1))).toBeTruthy()
    await user.click(
      within(dialog).getByRole("button", { name: "Remove bad.jpg" })
    )
    expect(
      await within(dialog).findByText(ENTRY_COPY.setDidntFinish)
    ).toBeTruthy()
    expect(within(dialog).getByText(saved(1))).toBeTruthy()
  })

  it("S1 (side): a retried file that fails again is told again", async () => {
    const onUnfinished = vi.fn()
    uploads.current = (async () => {
      throw new Error("The upload failed. Retry.")
    }) satisfies Uploader
    const user = userEvent.setup()
    const menu = Promise.resolve(MENU)
    render(
      <AddHost
        blocked={null}
        captchaRequired={false}
        captchaSiteKey={null}
        entry={menu}
        venueName="TEST Inn"
      >
        <Opener opts={{ ...DISH, onUnfinished }} label="Told" />
      </AddHost>
    )
    await menu
    fireEvent.click(screen.getByRole("button", { name: "Told" }))
    await user.upload(libraryInput(), [jpeg("x.jpg")])
    const dialog = await screen.findByRole("dialog")
    await waitFor(() => expect(onUnfinished).toHaveBeenCalledTimes(1))
    fireEvent.click(within(dialog).getByRole("button", { name: "Retry x.jpg" }))
    await waitFor(() => expect(onUnfinished).toHaveBeenCalledTimes(2))
  })
})

describe("a photo that stops later gets Replace then (S15)", () => {
  const HOUR = 3_600_000
  let stoppedAt = 0

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    // The transfer dies here; the server still has it uploading, fresh.
    uploads.current = (async (file, context) => {
      context.onReserved?.(`asset-${file.name}`)
      if (file.name === "lost.jpg") throw new Error("The upload failed. Retry.")
      return { assetId: `asset-${file.name}` }
    }) satisfies Uploader
    server.technical.set("asset-lost.jpg", "uploading")
    stoppedAt = Date.now() + HOUR
    // The server's rule: stopped once its clock passes stoppedAt.
    sets.readPhotoSet.mockImplementation(async () => {
      const v = view()
      return {
        status: "ok",
        group: {
          ...v,
          members: v.members.map((m) =>
            m.assetId === "asset-lost.jpg"
              ? {
                  ...m,
                  stopped: Date.now() >= stoppedAt,
                  stoppedAt: new Date(stoppedAt).toISOString(),
                }
              : { ...m, stopped: false, stoppedAt: null }
          ),
        },
      }
    })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  async function lostSet() {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await host()
    fireEvent.click(screen.getByRole("button", { name: "Tandoor photos" }))
    await user.upload(libraryInput(), [jpeg("one.jpg"), jpeg("lost.jpg")])
    const dialog = await screen.findByRole("dialog")
    expect(await within(dialog).findByText(saved(1))).toBeTruthy()
    // Fresh on the server: Retry here, no Replace yet.
    expect(
      within(dialog).getByRole("button", { name: "Retry lost.jpg" })
    ).toBeTruthy()
    expect(replaceButton(dialog, "lost.jpg")).toBeNull()
    return dialog
  }

  it("reads the set again at stoppedAt, and offers Replace", async () => {
    const dialog = await lostSet()
    const reads = sets.readPhotoSet.mock.calls.length
    // Not before its time.
    await act(async () => {
      vi.advanceTimersByTime(HOUR - 60_000)
    })
    expect(sets.readPhotoSet.mock.calls.length).toBe(reads)
    await act(async () => {
      vi.advanceTimersByTime(60_000 + STOPPED_MARGIN_MS)
    })
    expect(
      await within(dialog).findByRole("button", {
        name: ENTRY_COPY.replaceLabel("lost.jpg"),
      })
    ).toBeTruthy()
    expect(sets.readPhotoSet.mock.calls.length).toBe(reads + 1)
  })

  it("reads it on coming back to the page once stoppedAt has passed", async () => {
    const dialog = await lostSet()
    const reads = sets.readPhotoSet.mock.calls.length
    // Asleep past it: the clock moved, no timer ran.
    vi.setSystemTime(Date.now() + 2 * HOUR)
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    expect(
      await within(dialog).findByRole("button", {
        name: ENTRY_COPY.replaceLabel("lost.jpg"),
      })
    ).toBeTruthy()
    expect(sets.readPhotoSet.mock.calls.length).toBe(reads + 1)
  })

  it("reads nothing more once the sheet is gone", async () => {
    await lostSet()
    const reads = sets.readPhotoSet.mock.calls.length
    cleanup()
    await act(async () => {
      vi.advanceTimersByTime(2 * HOUR)
    })
    document.dispatchEvent(new Event("visibilitychange"))
    expect(sets.readPhotoSet.mock.calls.length).toBe(reads)
  })

  it("stops waiting when the row is retried", async () => {
    const dialog = await lostSet()
    // The retry fails again at once; a fresh settle reads the set again.
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Retry lost.jpg" })
    )
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Retry lost.jpg" })
      ).toBeTruthy()
    )
    const reads = sets.readPhotoSet.mock.calls.length
    await act(async () => {
      vi.advanceTimersByTime(HOUR + STOPPED_MARGIN_MS)
    })
    // One timer for the latest read only, not one per settle.
    expect(sets.readPhotoSet.mock.calls.length).toBeLessThanOrEqual(reads + 1)
  })
})

describe("serverSetNotice and setNotices with a read", () => {
  const notice = (
    members: ContributionGroupMember[],
    held = new Set<string>()
  ) =>
    serverSetNotice("set-1", "Naan", { ...view(), members }, (id) =>
      held.has(id) ? `${id}: row` : null
    )

  it("words every mix of states from the members", () => {
    expect(
      notice([member("a", 1, "ready"), member("b", 2, "processing")])
    ).toEqual({
      id: "set-1",
      text: ENTRY_COPY.setSaved(2, "Naan"),
      unfinished: [],
    })
    expect(
      notice(
        [
          member("a", 1, "ready"),
          member("b", 2, "failed"),
          member("c", 3, "removed"),
          member("d", 4, "uploading"),
        ],
        new Set(["b"])
      )
    ).toEqual({
      id: "set-1",
      text: ENTRY_COPY.setSaved(1, "Naan"),
      unfinished: [
        "b: row",
        ENTRY_COPY.setDidntFinish,
        ENTRY_COPY.setDidntFinish,
      ],
    })
    // A replaced member is left out, even once its old upload is ready.
    expect(
      notice([
        member("a", 1, "ready"),
        member("old", 2, "ready"),
        member("new", 3, "ready", "old"),
      ])
    ).toEqual({
      id: "set-1",
      text: ENTRY_COPY.setSaved(2, "Naan"),
      unfinished: [],
    })
    // Nothing saved: no notice; a member without its state: the queue's.
    expect(notice([member("a", 1, "failed")])).toBeNull()
    expect(
      notice([{ ...member("a", 1, "ready"), technical: undefined }])
    ).toBeUndefined()
  })

  it("waits for the read, falls back without one, and skips replaced rows", () => {
    const item = (name: string, status: QueueItem["status"]): QueueItem => ({
      id: name,
      file: jpeg(name),
      kind: "image",
      status,
      progress: 1,
      error: null,
      attempts: 1,
      assetId: `asset-${name}`,
    })
    const setOf = () => ({ id: "set-1", subject: "Naan" })
    const items = [item("a", "done"), item("b", "done"), item("c", "failed")]
    const detail = () => "x"
    expect(
      setNotices(items, setOf, detail, { server: () => undefined })
    ).toEqual([])
    expect(setNotices(items, setOf, detail, { server: () => null })).toEqual([
      {
        id: "set-1",
        text: ENTRY_COPY.setSaved(2, "Naan"),
        unfinished: ["c: x"],
      },
    ])
    expect(
      setNotices(items, setOf, detail, {
        server: () => null,
        skip: (i) => i.id === "c",
      })
    ).toEqual([
      { id: "set-1", text: ENTRY_COPY.setSaved(2, "Naan"), unfinished: [] },
    ])
    expect(
      setNotices(items, setOf, detail, {
        server: () => ({
          ...view(),
          members: [
            member("asset-a", 1, "ready"),
            member("asset-b", 2, "ready"),
            member("asset-c", 3, "failed"),
          ],
        }),
      })
    ).toEqual([
      {
        id: "set-1",
        text: ENTRY_COPY.setSaved(2, "Naan"),
        unfinished: ["c: x"],
      },
    ])
  })

  it("words a member no row holds from this device's journal (OD-B5-01-9 follow-up)", () => {
    const item = (name: string): QueueItem => ({
      id: name,
      file: jpeg(name),
      kind: "image",
      status: "done",
      progress: 1,
      error: null,
      attempts: 1,
      assetId: `asset-${name}`,
    })
    const setOf = () => ({ id: "set-1", subject: "Naan" })
    const server = () => ({
      ...view(),
      members: [
        member("asset-a", 1, "ready"),
        member("asset-gone", 2, "failed"),
        member("asset-unknown", 3, "failed"),
      ],
    })
    expect(
      setNotices([item("a")], setOf, () => null, {
        server,
        memberLine: (id) =>
          id === "asset-gone"
            ? "gone.jpg can't be used. Choose a different photo."
            : null,
      })
    ).toEqual([
      {
        id: "set-1",
        text: ENTRY_COPY.setSaved(1, "Naan"),
        unfinished: [
          "gone.jpg can't be used. Choose a different photo.",
          ENTRY_COPY.setDidntFinish,
        ],
      },
    ])
  })
})

describe("PhotoSets.resume (OD-B5-05-9 follow-up)", () => {
  const transport = () => ({
    start: vi.fn(async () => ({ status: "ok" as const, groupId: "g-1" })),
    add: vi.fn(async () => ({ status: "ok" as const, members: 1 })),
  })
  const keys = () => ({ keyFor: vi.fn(() => "fresh-key"), settle: vi.fn() })
  const naan = { kind: "menu_item" as const, id: "item-1", name: "Naan" }

  it("rejoins the earlier tab's group under its key with one photo", async () => {
    const t = transport()
    const k = keys()
    const ps = new PhotoSets(t, k)
    const id = ps.resume(naan, "earlier-key")
    expect(ps.resume(naan, "earlier-key")).toBe(id)
    ps.reserved(id, "asset-1")
    await vi.waitFor(() => expect(t.add).toHaveBeenCalled())
    expect(t.start).toHaveBeenCalledWith({
      key: "earlier-key",
      subject: { kind: "menu_item", id: "item-1" },
    })
    expect(t.add).toHaveBeenCalledWith({
      groupId: "g-1",
      assetIds: ["asset-1"],
    })
    expect(k.keyFor).not.toHaveBeenCalled()
    expect(k.settle).not.toHaveBeenCalled()
    expect(ps.isMember(id, "asset-1")).toBe(true)
  })

  it("leaves the photo single when the server refuses the key", async () => {
    const t = transport()
    t.start.mockResolvedValueOnce({
      status: "failed",
      retry: false,
    } as never)
    const ps = new PhotoSets(t, keys())
    const id = ps.resume(naan, "earlier-key")
    ps.reserved(id, "asset-1")
    await vi.waitFor(() => expect(t.start).toHaveBeenCalled())
    await Promise.resolve()
    expect(t.add).not.toHaveBeenCalled()
    expect(ps.groupOf(id)).toBeNull()
  })

  it("still waits for two photos in a set opened here", async () => {
    const t = transport()
    const ps = new PhotoSets(t, keys())
    const id = ps.open(naan)
    ps.reserved(id, "asset-1")
    await Promise.resolve()
    expect(t.start).not.toHaveBeenCalled()
  })
})
