// @vitest-environment jsdom
// Photo library first, one global queue: openAdd({ source }) clicks Add's own
// hidden input inside the click handler, the library input takes several
// files without capture, the camera input captures, a cancelled picker does
// nothing, picked files start uploading at once in the "Saving N photos"
// sheet, Our menu's dish is applied (and sent by asset ID) unless removed,
// and a task screen hears each of its photos as soon as that one is ready.
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

import { AddHost } from "@/app/staff/_shell/add-host"
import {
  CAMERA_LABEL,
  LIBRARY_LABEL,
  PhotoSourceActions,
  photoInputProps,
} from "@/components/nabalens/photo-source"
import {
  AddTrigger,
  useAdd,
  useAddQueue,
  type OpenAddOptions,
} from "@/components/nabalens/shell/add-context"
import { AddSheet } from "@/components/nabalens/shell/add-sheet"
import type {
  UploadContext,
  Uploader,
} from "@/components/nabalens/upload-queue"
import { EMPTY_LABEL_SUMMARY } from "@/lib/menus/types"
import type { FinaliseLabels } from "@/lib/upload/types"

import { CATALOGUE } from "./labels-fixtures"

const { refresh, supabase, uploads, actions } = vi.hoisted(() => ({
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
  uploads: { current: null as Uploader | null },
  actions: {
    loadLabelEditorContext: vi.fn(),
    loadLabelCatalogue: vi.fn(),
    saveLabelBatch: vi.fn(),
  },
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
vi.mock("@/lib/supabase/browser", () => ({ createClient: () => supabase }))
vi.mock("@/app/_media/use-media-uploader", () => ({
  useMediaUploader: () => uploads.current,
}))
vi.mock("@/app/_labels/actions", () => actions)

const jpeg = (name: string) =>
  new File([new Uint8Array(64)], name, { type: "image/jpeg" })

/** Files named *fail* fail on the first try; all become `asset-<name>`. */
const tried = new Set<string>()
const uploader: Uploader = async (file) => {
  await Promise.resolve()
  if (file.name.includes("fail") && !tried.has(file.name)) {
    tried.add(file.name)
    throw new Error("Server validation failed")
  }
  return { assetId: `asset-${file.name}` }
}

function Opener({
  opts,
  label = "Open",
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

function ReadyListener({ onReady }: { onReady: (ids: string[]) => void }) {
  const queue = useAddQueue()
  React.useEffect(() => queue?.onReady(onReady), [queue, onReady])
  return null
}

function host(children: React.ReactNode) {
  return render(
    <AddHost blocked={null} captchaRequired={false} captchaSiteKey={null}>
      <AddTrigger kind="bar" />
      {children}
    </AddHost>
  )
}

const input = (source: "library" | "camera") =>
  document.querySelector<HTMLInputElement>(
    `input[data-photo-source="${source}"]`
  )!

/** The label API (C1): the menu, kept labels, discards. */
const api = vi.hoisted(() => ({
  posted: [] as {
    venueId: string
    input: { assetId: string; items: unknown[]; contentTypes: string[] }
  }[],
  deleted: [] as string[],
  post: null as null | ((body: unknown) => unknown),
  /** The menu's answer; default: CATALOGUE at once. */
  menu: null as null | (() => unknown),
}))
function labelApi(url: string, init?: RequestInit) {
  const method = init?.method ?? "GET"
  let body: unknown
  if (method === "POST") {
    const sent = JSON.parse(String(init!.body))
    api.posted.push(sent)
    body = api.post?.(sent) ?? {
      ok: true,
      assetId: sent.input.assetId,
      state: "pending",
    }
  } else if (method === "DELETE") {
    api.deleted.push(new URL(url, "http://x").searchParams.get("assetId")!)
    body = { ok: true }
  } else if (url.includes("attention=1")) body = { ok: true, items: [] }
  else if (api.menu) return Promise.resolve(api.menu()).then(answer)
  else body = { ok: true, catalogue: CATALOGUE, focus: null }
  return Promise.resolve(answer(body))
}
function answer(body: unknown) {
  return { json: async () => body } as Response
}

let phone = false
beforeEach(() => {
  vi.clearAllMocks()
  tried.clear()
  uploads.current = uploader
  phone = false
  api.posted = []
  api.deleted = []
  api.post = null
  api.menu = null
  vi.stubGlobal("matchMedia", () => ({ matches: !phone }))
  vi.stubGlobal("fetch", vi.fn(labelApi))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("photo source contract", () => {
  it("library takes several files without capture; camera captures", () => {
    expect(photoInputProps("library")).toEqual({
      type: "file",
      accept: expect.stringMatching(/video\/mp4/),
      multiple: true,
    })
    expect(photoInputProps("library", { imagesOnly: true }).accept).not.toMatch(
      /video|\.mp4|\.mov/
    )
    expect(photoInputProps("camera")).toEqual({
      type: "file",
      accept: "image/*,video/*",
      capture: "environment",
    })
    expect(photoInputProps("camera", { imagesOnly: true }).accept).toBe(
      "image/*"
    )
  })

  it("puts the library first as the primary action", () => {
    render(<PhotoSourceActions onChoose={() => {}} />)
    const buttons = screen.getAllByRole("button")
    expect(buttons.map((b) => b.textContent)).toEqual([
      LIBRARY_LABEL,
      CAMERA_LABEL,
    ])
    expect(buttons[0].getAttribute("data-variant")).toBe("primary")
  })
})

describe("openAdd({ source })", () => {
  it("clicks Add's own hidden input synchronously, with no sheet", () => {
    host(
      <>
        <Opener label="Library" opts={{ source: "library" }} />
        <Opener label="Camera" opts={{ source: "camera" }} />
      </>
    )
    const library = input("library")
    const camera = input("camera")
    expect(library.multiple).toBe(true)
    expect(library.hasAttribute("capture")).toBe(false)
    expect(camera.multiple).toBe(false)
    expect(camera.getAttribute("capture")).toBe("environment")

    const libraryClick = vi.spyOn(library, "click")
    const cameraClick = vi.spyOn(camera, "click")
    // fireEvent: the click must happen inside the handler, not after it.
    fireEvent.click(screen.getByRole("button", { name: "Library" }))
    expect(libraryClick).toHaveBeenCalledTimes(1)
    expect(cameraClick).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Camera" }))
    expect(cameraClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("sets a photos-only accept list for that call before clicking", () => {
    host(<Opener opts={{ source: "library", imagesOnly: true }} />)
    const library = input("library")
    let acceptAtClick = ""
    vi.spyOn(library, "click").mockImplementation(() => {
      acceptAtClick = library.accept
    })
    fireEvent.click(screen.getByRole("button", { name: "Open" }))
    expect(acceptAtClick).not.toMatch(/video/)
  })

  it("does nothing when the picker is cancelled (empty selection)", () => {
    const onPicked = vi.fn()
    host(<Opener opts={{ source: "library", onPicked }} />)
    fireEvent.click(screen.getByRole("button", { name: "Open" }))
    fireEvent.change(input("library"), { target: { files: [] } })
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(onPicked).not.toHaveBeenCalled()
  })

  it("starts uploading picked files at once in the one Add queue and tells the caller", async () => {
    const user = userEvent.setup()
    const onPicked = vi.fn()
    const started: string[] = []
    uploads.current = async (file) => {
      started.push(file.name)
      return { assetId: `asset-${file.name}` }
    }
    host(<Opener opts={{ source: "library", onPicked }} />)
    await user.click(screen.getByRole("button", { name: "Open" }))
    await user.upload(input("library"), [jpeg("a.jpg"), jpeg("b.jpg")])
    const dialog = await screen.findByRole("dialog", {
      name: "Saving 2 photos",
    })
    expect(fileRow("a.jpg")).toBeTruthy()
    expect(
      within(dialog).queryByRole("button", { name: /^Upload \d/ })
    ).toBeNull()
    await waitFor(() => expect(started).toEqual(["a.jpg", "b.jpg"]))
    expect(onPicked).toHaveBeenCalledTimes(1)
    expect(within(dialog).getByText("What's in these photos?")).toBeTruthy()
    expect(within(dialog).getByText("(optional)")).toBeTruthy()
  })
})

describe("Add sheet (phones)", () => {
  it("offers the library first with the batch limit, and no task step", () => {
    render(
      <AddSheet
        open
        onOpenChange={() => {}}
        blocked={null}
        onFiles={() => {}}
        maxFiles={7}
      />
    )
    const dialog = screen.getByRole("dialog", { name: "Add photos" })
    const options = within(dialog)
      .getAllByRole("button")
      .map((b) => b.textContent)
    expect(options[0]).toContain(LIBRARY_LABEL)
    expect(options[0]).toContain("Up to 7 at a time")
    expect(options[1]).toContain(CAMERA_LABEL)
    expect(dialog.textContent).not.toMatch(/straight away|choose a task/)
    expect(dialog.textContent).toContain(
      "Photos start saving as soon as you pick them."
    )
    expect(dialog.textContent).not.toMatch(/Nothing uploads/)
  })

  it("opens from Add on phones and ignores a cancelled picker", async () => {
    phone = true
    const user = userEvent.setup()
    host(null)
    await user.click(screen.getByRole("button", { name: "Add photos" }))
    const sheet = screen.getByRole("dialog", { name: "Add photos" })
    const library = sheet.querySelector<HTMLInputElement>(
      'input[data-photo-source="library"]'
    )!
    fireEvent.change(library, { target: { files: [] } })
    expect(screen.getByRole("dialog", { name: "Add photos" })).toBe(sheet)
  })

  it("Me's upload opens the queue dialog even on phones", async () => {
    phone = true
    const user = userEvent.setup()
    host(<Opener opts={{ dialog: true }} />)
    await user.click(screen.getByRole("button", { name: "Open" }))
    expect(
      screen.getByRole("dialog", { name: "Upload photos or videos" })
    ).toBeTruthy()
  })
})

const preset = {
  itemId: "item-bhaji",
  variantId: null,
  itemName: "Onion Bhaji",
  variantName: null,
}

type Held = {
  name: string
  ctx: UploadContext
  finish: (labels?: FinaliseLabels) => void
  fail: (error: Error) => void
}

/** Each upload reserves `asset-<name>` and waits for the test to finish it. */
function holdUploads() {
  const held: Held[] = []
  uploads.current = (file, ctx) =>
    new Promise((resolve, reject) => {
      ctx.onReserved?.(`asset-${file.name}`)
      held.push({
        name: file.name,
        ctx,
        finish: (labels) =>
          resolve({
            assetId: `asset-${file.name}`,
            ...(labels ? { labels } : {}),
          }),
        fail: reject,
      })
    })
  const find = (name: string) => held.find((h) => h.name === name)!
  return { held, find }
}

async function hideSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{Escape}")
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
}

const fileRow = (name: string) =>
  within(screen.getByRole("list", { name: "Files" }))
    .getAllByRole("listitem")
    .find((li) => li.textContent?.includes(name))!

describe("Our menu: the dish is applied by default", () => {
  it("takes a photo of the dish, sends the dish by asset ID and says Saved once it is on the photo", async () => {
    const user = userEvent.setup()
    const { find } = holdUploads()
    host(
      <Opener
        label="Take a photo of this dish"
        opts={{ source: "camera", imagesOnly: true, preset }}
      />
    )
    const camera = input("camera")
    const cameraClick = vi.spyOn(camera, "click")
    fireEvent.click(
      screen.getByRole("button", { name: "Take a photo of this dish" })
    )
    expect(cameraClick).toHaveBeenCalledTimes(1)
    expect(camera.getAttribute("capture")).toBe("environment")
    expect(camera.accept).toBe("image/*")
    await user.upload(camera, [jpeg("dish.jpg")])

    const dialog = await screen.findByRole("dialog", { name: "Saving 1 photo" })
    await waitFor(() => expect(api.posted).toHaveLength(1))
    expect(api.posted[0]).toEqual({
      venueId: "venue-1",
      input: expect.objectContaining({
        assetId: "asset-dish.jpg",
        catalogueVersionId: "version-1",
        items: [{ itemId: "item-bhaji", variantId: null }],
      }),
    })
    // Shown as a chip the person can remove.
    expect(
      await within(dialog).findByRole("button", { name: "Remove Onion Bhaji" })
    ).toBeTruthy()
    expect(find("dish.jpg").ctx.account).toBe("u1")

    await act(async () =>
      find("dish.jpg").finish({
        state: "saved",
        labels: {
          ...EMPTY_LABEL_SUMMARY,
          revision: 1,
          hasLabels: true,
          items: [
            {
              itemId: "item-bhaji",
              variantId: null,
              name: "Onion Bhaji",
              variantName: null,
              sectionName: "Starters",
              labelledAs: null,
              state: "current",
            },
          ],
        },
      })
    )
    await waitFor(() =>
      expect(fileRow("dish.jpg").textContent).toContain(
        "Saved · Onion Bhaji · waiting for manager review"
      )
    )
    expect(refresh).toHaveBeenCalled()
    // Done right away: nothing is left, so the queue clears.
    await user.click(within(dialog).getByRole("button", { name: "Done" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(screen.getByRole("button", { name: "Add photos" })).toBeTruthy()
  })

  it("removing the dish discards what the server kept for that photo", async () => {
    const user = userEvent.setup()
    holdUploads()
    host(<Opener opts={{ source: "library", imagesOnly: true, preset }} />)
    await user.click(screen.getByRole("button", { name: "Open" }))
    await user.upload(input("library"), [jpeg("dish.jpg")])
    await waitFor(() => expect(api.posted).toHaveLength(1))
    await user.click(
      await screen.findByRole("button", { name: "Remove Onion Bhaji" })
    )
    await waitFor(() => expect(api.deleted).toEqual(["asset-dish.jpg"]))
    expect(api.posted).toHaveLength(1)
  })

  it("puts the dish on once: the sheet hands it back with the dish, and it stays single", async () => {
    const user = userEvent.setup()
    holdUploads()
    host(<Opener opts={{ source: "library", preset }} />)
    await user.click(screen.getByRole("button", { name: "Open" }))
    await user.upload(input("library"), [jpeg("dish.jpg")])
    await waitFor(() => expect(api.posted).toHaveLength(1))
    expect(
      await screen.findAllByRole("button", { name: "Remove Onion Bhaji" })
    ).toHaveLength(1)

    // Reopened: the label field mounts again with `initial` already holding
    // the dish, as well as the dish as the preset. Neither adds a second one.
    await hideSheet(user)
    await user.click(
      screen.getByRole("button", { name: "Add photos, 1 in progress" })
    )
    const dialog = await screen.findByRole("dialog", { name: "Saving 1 photo" })
    expect(
      await within(dialog).findAllByRole("button", {
        name: "Remove Onion Bhaji",
      })
    ).toHaveLength(1)
    expect(api.posted).toHaveLength(1)
    expect(api.posted[0].input.items).toEqual([
      { itemId: "item-bhaji", variantId: null },
    ])
  })

  it("a removed dish stays removed when the sheet opens again", async () => {
    const user = userEvent.setup()
    holdUploads()
    host(<Opener opts={{ source: "library", preset }} />)
    await user.click(screen.getByRole("button", { name: "Open" }))
    await user.upload(input("library"), [jpeg("dish.jpg")])
    await waitFor(() => expect(api.posted).toHaveLength(1))
    await user.click(
      await screen.findByRole("button", { name: "Remove Onion Bhaji" })
    )
    await waitFor(() => expect(api.deleted).toEqual(["asset-dish.jpg"]))

    await hideSheet(user)
    await user.click(
      screen.getByRole("button", { name: "Add photos, 1 in progress" })
    )
    const dialog = await screen.findByRole("dialog", { name: "Saving 1 photo" })
    expect(await within(dialog).findByText("No labels")).toBeTruthy()
    expect(
      within(dialog).queryByRole("button", { name: "Remove Onion Bhaji" })
    ).toBeNull()
    expect(api.posted).toHaveLength(1)
  })

  it("applies the dish only to the files picked from it, not earlier or later ones", async () => {
    const user = userEvent.setup()
    const { find } = holdUploads()
    host(
      <>
        <Opener label="Me" opts={{ dialog: true }} />
        <Opener label="Dish" opts={{ source: "library", preset }} />
        <Opener label="Home" opts={{ source: "library" }} />
      </>
    )
    await user.click(screen.getByRole("button", { name: "Me" }))
    await user.upload(
      within(screen.getByRole("dialog")).getByLabelText(
        "Choose photos or videos"
      ),
      [jpeg("early.jpg")]
    )
    await hideSheet(user)
    await user.click(screen.getByRole("button", { name: "Dish" }))
    await user.upload(input("library"), [jpeg("dish.jpg")])
    await waitFor(() => expect(api.posted).toHaveLength(1))
    expect(api.posted[0].input.assetId).toBe("asset-dish.jpg")
    await hideSheet(user)

    // A cancelled dish pick leaves nothing behind for the next pick.
    fireEvent.click(screen.getByRole("button", { name: "Dish" }))
    fireEvent.change(input("library"), { target: { files: [] } })
    await user.click(screen.getByRole("button", { name: "Home" }))
    await user.upload(input("library"), [jpeg("cocktail.jpg")])
    await screen.findByRole("dialog", { name: "Saving 3 photos" })
    // Let every file reserve, then make sure only the dish photo got it.
    await act(async () => {
      find("early.jpg").finish()
      find("dish.jpg").finish()
    })
    await waitFor(() => expect(find("cocktail.jpg")).toBeTruthy())
    await act(async () => find("cocktail.jpg").finish())
    await waitFor(() =>
      expect(fileRow("cocktail.jpg").textContent).toContain("Saved")
    )
    expect(api.posted.map((p) => p.input.assetId)).toEqual(["asset-dish.jpg"])
  })

  it("a dish photo that can't be used keeps its dish as not saved", async () => {
    const user = userEvent.setup()
    const { find } = holdUploads()
    host(<Opener opts={{ source: "library", preset }} />)
    await user.click(screen.getByRole("button", { name: "Open" }))
    await user.upload(input("library"), [jpeg("dish.jpg")])
    await waitFor(() => expect(api.posted).toHaveLength(1))
    await act(async () =>
      find("dish.jpg").fail(
        Object.assign(new Error("The photo could not be decoded."), {
          error: { code: "processing_failed", retryable: false },
        })
      )
    )
    await waitFor(() =>
      expect(fileRow("dish.jpg").textContent).toContain(
        "This file can't be used: The photo could not be decoded."
      )
    )
    expect(fileRow("dish.jpg").textContent).toContain(
      "Not saved (photo not saved)"
    )
  })

  describe("two dishes picked before the menu is known", () => {
    const lassi = {
      itemId: "item-lassi",
      variantId: null,
      itemName: "Mango Lassi",
      variantName: null,
    }
    const BHAJI_ITEM = [{ itemId: "item-bhaji", variantId: null }]
    const LASSI_ITEM = [{ itemId: "item-lassi", variantId: null }]

    /** The last labels sent for each photo. */
    const lastPosted = () =>
      Object.fromEntries(api.posted.map((p) => [p.input.assetId, p.input]))

    /**
     * Onion Bhaji's photo, then Mango Lassi's. `hide`: the sheet is closed in
     * between (the label field mounts again); otherwise the second pick joins
     * the open sheet (the same field gets a second dish).
     */
    async function pickBoth(
      user: ReturnType<typeof userEvent.setup>,
      hide: boolean
    ) {
      host(
        <>
          <Opener label="Bhaji" opts={{ source: "library", preset }} />
          <Opener label="Lassi" opts={{ source: "library", preset: lassi }} />
        </>
      )
      await user.click(screen.getByRole("button", { name: "Bhaji" }))
      await user.upload(input("library"), [jpeg("bhaji.jpg")])
      await screen.findByRole("dialog", { name: "Saving 1 photo" })
      if (hide) await hideSheet(user)
      // fireEvent: the open sheet makes the page behind it inert to user.click.
      fireEvent.click(
        screen.getByRole("button", { name: "Lassi", hidden: true })
      )
      await user.upload(input("library"), [jpeg("lassi.jpg")])
      return screen.findByRole("dialog", { name: "Saving 2 photos" })
    }

    /** Both photos keep their own dish, also after an edit in the field. */
    async function keepsBoth(
      user: ReturnType<typeof userEvent.setup>,
      dialog: HTMLElement
    ) {
      await waitFor(() =>
        expect(lastPosted()).toEqual({
          "asset-bhaji.jpg": expect.objectContaining({ items: BHAJI_ITEM }),
          "asset-lassi.jpg": expect.objectContaining({ items: LASSI_ITEM }),
        })
      )
      await user.click(
        within(dialog).getByRole("button", { name: /^More details/ })
      )
      await user.click(
        within(dialog).getByRole("button", { name: "Finished dish" })
      )
      await waitFor(() =>
        expect(lastPosted()).toEqual({
          "asset-bhaji.jpg": expect.objectContaining({
            items: BHAJI_ITEM,
            contentTypes: ["dish"],
          }),
          "asset-lassi.jpg": expect.objectContaining({
            items: LASSI_ITEM,
            contentTypes: ["dish"],
          }),
        })
      )
      // Nothing was ever sent without its dish, and each shows on its photo.
      for (const p of api.posted)
        expect(p.input.items).toEqual(
          p.input.assetId === "asset-bhaji.jpg" ? BHAJI_ITEM : LASSI_ITEM
        )
      expect(
        within(dialog).getByRole("button", { name: "Remove Onion Bhaji" })
      ).toBeTruthy()
      expect(
        within(dialog).getByRole("button", { name: "Remove Mango Lassi" })
      ).toBeTruthy()
    }

    it("while it is loading: each photo keeps its own dish", async () => {
      const user = userEvent.setup()
      holdUploads()
      let load!: () => void
      api.menu = () =>
        new Promise((resolve) => {
          load = () => resolve({ ok: true, catalogue: CATALOGUE, focus: null })
        })
      const dialog = await pickBoth(user, false)
      expect(api.posted).toEqual([])
      await act(async () => load())
      await keepsBoth(user, dialog)
    })

    it("after it failed to load: each photo keeps its own dish once retried", async () => {
      const user = userEvent.setup()
      holdUploads()
      api.menu = () => ({ ok: false, message: "The menu is unavailable." })
      const dialog = await pickBoth(user, true)
      expect(
        await within(dialog).findByText("The menu couldn't be loaded")
      ).toBeTruthy()
      expect(api.posted).toEqual([])
      api.menu = null
      await user.click(
        within(dialog).getByRole("button", { name: "Retry loading the menu" })
      )
      await keepsBoth(user, dialog)
    })
  })
})

describe("each Add call owns only the files it picked", () => {
  it("hands a task screen each photo as soon as it is ready, before a slow video", async () => {
    const user = userEvent.setup()
    const own = vi.fn()
    const heard = vi.fn()
    const { find } = holdUploads()
    host(
      <>
        <Opener label="Task" opts={{ source: "library", onReady: own }} />
        <ReadyListener onReady={heard} />
      </>
    )
    await user.click(screen.getByRole("button", { name: "Task" }))
    await user.upload(input("library"), [
      new File([new Uint8Array(64)], "slow.mp4", { type: "video/mp4" }),
      jpeg("task.jpg"),
    ])
    const dialog = await screen.findByRole("dialog", { name: "Saving 2 files" })
    // Task photos carry no labels here: the task screen sends them on.
    expect(within(dialog).queryByText("What's in these photos?")).toBeNull()
    await waitFor(() => expect(find("task.jpg")).toBeTruthy())
    await act(async () => find("task.jpg").finish())
    expect(own).toHaveBeenCalledWith(["asset-task.jpg"])
    expect(heard).toHaveBeenCalledWith(["asset-task.jpg"])
    expect(own).toHaveBeenCalledTimes(1)
    await act(async () => find("slow.mp4").finish())
    expect(own).toHaveBeenLastCalledWith(["asset-slow.mp4"])
    expect(api.posted).toEqual([])
  })

  it("never tells a task screen about uploads picked elsewhere", async () => {
    const user = userEvent.setup()
    const own = vi.fn()
    host(
      <>
        <Opener
          label="Task"
          opts={{ source: "library", imagesOnly: true, onReady: own }}
        />
        <Opener label="Me" opts={{ dialog: true }} />
      </>
    )
    await user.click(screen.getByRole("button", { name: "Task" }))
    await user.upload(input("library"), [jpeg("task.jpg")])
    await waitFor(() => expect(own).toHaveBeenCalledWith(["asset-task.jpg"]))
    await hideSheet(user)
    await user.click(screen.getByRole("button", { name: "Me" }))
    await user.upload(
      within(screen.getByRole("dialog")).getByLabelText(/^Choose photos/),
      [jpeg("other.jpg")]
    )
    await waitFor(() =>
      expect(fileRow("other.jpg").textContent).toContain("Saved")
    )
    expect(own).toHaveBeenCalledOnce()
  })
})

describe("Add while work remains", () => {
  it("names what is still going on and reopens the queue", async () => {
    const user = userEvent.setup()
    const { find } = holdUploads()
    api.post = (sent) => {
      const body = sent as { input: { assetId: string } }
      return {
        ok: false,
        assetId: body.input.assetId,
        code: "catalogue_changed",
        message: "The menu changed.",
      }
    }
    host(<Opener opts={{ source: "library", preset }} />)
    await user.click(screen.getByRole("button", { name: "Open" }))
    await user.upload(input("library"), [jpeg("dish.jpg")])
    await hideSheet(user)
    expect(
      await screen.findByRole("button", { name: "Add photos, 1 in progress" })
    ).toBeTruthy()
    await act(async () => find("dish.jpg").finish())
    expect(
      await screen.findByRole("button", {
        name: "Add photos, 1 need attention",
      })
    ).toBeTruthy()
    await user.click(
      screen.getByRole("button", { name: "Add photos, 1 need attention" })
    )
    const dialog = await screen.findByRole("dialog", { name: "Saving 1 photo" })
    expect(fileRow("dish.jpg").textContent).toContain(
      "The menu changed. Check the dish."
    )
    expect(
      within(dialog).getByRole("button", { name: "Fix labels for dish.jpg" })
    ).toBeTruthy()
  })
})

describe("Review 1 regressions: Add host", () => {
  it("n2: a dish picker cancelled behind the open sheet leaves its dish off Add more", async () => {
    const user = userEvent.setup()
    holdUploads()
    host(
      <>
        <Opener label="Me" opts={{ dialog: true }} />
        <Opener label="Dish" opts={{ source: "library", preset }} />
      </>
    )
    await user.click(screen.getByRole("button", { name: "Me" }))
    const choose = () =>
      within(screen.getByRole("dialog")).getByLabelText(/^Choose photos/)
    await user.upload(choose(), [jpeg("first.jpg")])
    await screen.findByRole("dialog", { name: "Saving 1 photo" })
    // The dish's picker opens and closes with nothing picked (browsers send
    // no event at all). fireEvent: the open sheet makes the page inert.
    fireEvent.click(screen.getByRole("button", { name: "Dish", hidden: true }))
    // "Add more" in the sheet picks another file.
    await user.click(screen.getByRole("button", { name: "Add more" }))
    await user.upload(choose(), [jpeg("other.jpg")])
    await screen.findByRole("dialog", { name: "Saving 2 photos" })
    await act(async () => {})
    expect(api.posted).toEqual([])
    expect(
      screen.queryByRole("button", { name: "Remove Onion Bhaji" })
    ).toBeNull()
  })

  it("m9: Done while the dish waits for the menu asks nothing; the dish is sent once it loads", async () => {
    const user = userEvent.setup()
    holdUploads()
    let load!: () => void
    api.menu = () =>
      new Promise((resolve) => {
        load = () => resolve({ ok: true, catalogue: CATALOGUE, focus: null })
      })
    host(<Opener opts={{ source: "library", preset }} />)
    await user.click(screen.getByRole("button", { name: "Open" }))
    await user.upload(input("library"), [jpeg("dish.jpg")])
    const dialog = await screen.findByRole("dialog", { name: "Saving 1 photo" })
    await user.click(within(dialog).getByRole("button", { name: "Done" }))
    expect(
      screen.queryByRole("alertdialog", { name: "Discard these labels?" })
    ).toBeNull()
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await act(async () => load())
    await waitFor(() => expect(api.posted).toHaveLength(1))
    expect(api.posted[0].input.items).toEqual([
      { itemId: "item-bhaji", variantId: null },
    ])
  })

  it("m10: a dish whose menu failed to load says Labels not saved yet, and is sent when the signal returns", async () => {
    const user = userEvent.setup()
    const { find } = holdUploads()
    api.menu = () => ({ ok: false, message: "The menu is unavailable." })
    host(<Opener opts={{ source: "library", preset }} />)
    await user.click(screen.getByRole("button", { name: "Open" }))
    await user.upload(input("library"), [jpeg("dish.jpg")])
    const dialog = await screen.findByRole("dialog", { name: "Saving 1 photo" })
    await act(async () => find("dish.jpg").finish())
    await waitFor(() =>
      expect(fileRow("dish.jpg").textContent).toContain("Labels not saved yet.")
    )
    expect(fileRow("dish.jpg").textContent).not.toContain("Saving…")
    expect(
      within(dialog).getByRole("button", { name: "Retry labels for dish.jpg" })
    ).toBeTruthy()
    expect(api.posted).toEqual([])

    // Tried again when the signal returns; while that try is out the row
    // keeps saying what is true, not "Saving…".
    let load!: () => void
    api.menu = () =>
      new Promise((resolve) => {
        load = () => resolve({ ok: true, catalogue: CATALOGUE, focus: null })
      })
    await act(async () => {
      window.dispatchEvent(new Event("online"))
    })
    expect(load).toBeTypeOf("function")
    expect(fileRow("dish.jpg").textContent).toContain("Labels not saved yet.")
    expect(fileRow("dish.jpg").textContent).not.toContain("Saving…")
    await act(async () => load())
    await waitFor(() => expect(api.posted).toHaveLength(1))
    expect(api.posted[0].input.items).toEqual([
      { itemId: "item-bhaji", variantId: null },
    ])
  })

  it("m16: a photo ready after its task screen closed is listed as not added to the task", async () => {
    const user = userEvent.setup()
    const { find } = holdUploads()
    // The screen is gone: its listener says so.
    const gone = vi.fn(() => false)
    host(
      <Opener
        label="Task"
        opts={{ source: "library", imagesOnly: true, onReady: gone }}
      />
    )
    await user.click(screen.getByRole("button", { name: "Task" }))
    await user.upload(input("library"), [jpeg("task.jpg")])
    await screen.findByRole("dialog", { name: "Saving 1 photo" })
    await hideSheet(user)
    await act(async () => find("task.jpg").finish())
    expect(gone).toHaveBeenCalledWith(["asset-task.jpg"])
    // Not cleared unseen: Add points at it.
    const add = await screen.findByRole("button", {
      name: "Add photos, 1 need attention",
    })
    await user.click(add)
    await screen.findByRole("dialog", { name: "Saving 1 photo" })
    expect(fileRow("task.jpg").textContent).toContain(
      "Saved to your portfolio. Not added to the task: its screen was closed."
    )
  })
})
