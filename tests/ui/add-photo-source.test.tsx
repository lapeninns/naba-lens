// @vitest-environment jsdom
// Photo library first, one global queue: openAdd({ source }) clicks Add's own
// hidden input inside the click handler, the library input takes several
// files without capture, the camera input captures, a cancelled picker does
// nothing, and the queue offers labels for finished files (with the Our menu
// preset as a draft) while failed ones stay retryable.
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

import type { LabelEditorContextResult } from "@/app/_labels/actions"
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
  useAddLabelled,
  useAddQueue,
  type OpenAddOptions,
} from "@/components/nabalens/shell/add-context"
import { AddSheet } from "@/components/nabalens/shell/add-sheet"
import type { Uploader } from "@/components/nabalens/upload-queue"

import { CATALOGUE, asset } from "./labels-fixtures"

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

let phone = false
beforeEach(() => {
  vi.clearAllMocks()
  tried.clear()
  uploads.current = uploader
  phone = false
  vi.stubGlobal("matchMedia", () => ({ matches: !phone }))
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

  it("queues picked files in the one Add queue and tells the caller", async () => {
    const user = userEvent.setup()
    const onPicked = vi.fn()
    host(<Opener opts={{ source: "library", onPicked }} />)
    await user.click(screen.getByRole("button", { name: "Open" }))
    await user.upload(input("library"), [jpeg("a.jpg"), jpeg("b.jpg")])
    const dialog = await screen.findByRole("dialog", {
      name: "Upload photos or videos",
    })
    expect(within(dialog).getByText("a.jpg")).toBeTruthy()
    expect(
      within(dialog).getByRole("button", { name: "Upload 2 files" })
    ).toBeTruthy()
    expect(onPicked).toHaveBeenCalledTimes(1)
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

describe("one queue: label finished files, retry failed ones", () => {
  const preset = {
    itemId: "item-bhaji",
    variantId: null,
    itemName: "Onion Bhaji",
    variantName: null,
  }

  function ready(ids: string[]): LabelEditorContextResult {
    return {
      ok: true,
      viewer: "staff",
      assets: ids.map((id) => asset(id)),
      missing: [],
      catalogue: CATALOGUE,
    }
  }

  it("labels the done files with the preset as a draft, then retries the failed one", async () => {
    const user = userEvent.setup()
    const heard = vi.fn()
    actions.loadLabelEditorContext.mockImplementation(async (ids: string[]) =>
      ready(ids)
    )
    host(
      <>
        <Opener opts={{ preset }} />
        <ReadyListener onReady={heard} />
      </>
    )
    await user.click(screen.getByRole("button", { name: "Open" }))
    let dialog = screen.getByRole("dialog", { name: "Upload photos or videos" })
    await user.upload(
      within(dialog).getByLabelText("Choose photos or videos"),
      [jpeg("dish.jpg"), jpeg("fail.jpg")]
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Upload 2 files" })
    )
    expect(
      await within(dialog).findByText("1 uploaded · 1 failed")
    ).toBeTruthy()
    expect(heard).toHaveBeenCalledWith(["asset-dish.jpg"])

    await user.click(
      within(dialog).getByRole("button", { name: "Label this file" })
    )
    const editor = await screen.findByRole("dialog", { name: "Labels" })
    expect(actions.loadLabelEditorContext).toHaveBeenCalledWith([
      "asset-dish.jpg",
    ])
    // The preset is an unsaved draft: shown and selected, nothing saved yet.
    expect(within(editor).getByText("Suggested from Our menu")).toBeTruthy()
    expect(
      within(
        within(editor).getByRole("list", { name: "Selected menu items" })
      ).getByText("Onion Bhaji")
    ).toBeTruthy()
    expect(actions.saveLabelBatch).not.toHaveBeenCalled()
    await user.click(within(editor).getByRole("button", { name: "Cancel" }))
    await user.click(
      await screen.findByRole("button", { name: "Discard changes" })
    )
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Labels" })).toBeNull()
    )
    expect(actions.saveLabelBatch).not.toHaveBeenCalled()

    // The failed file is still in the queue: Add shows it, and it retries.
    const add = screen.getByRole("button", { name: /^Add photos, 1 failed/ })
    await user.click(add)
    dialog = screen.getByRole("dialog", { name: "Upload photos or videos" })
    expect(within(dialog).getByText("fail.jpg")).toBeTruthy()
    await user.click(
      within(dialog).getByRole("button", { name: "Retry 1 failed" })
    )
    expect(await within(dialog).findByText("2 uploaded")).toBeTruthy()
  })

  it("files that finish out of sight are ready to label from Add", async () => {
    const user = userEvent.setup()
    let release!: () => void
    uploads.current = (file) =>
      new Promise((resolve) => {
        release = () => resolve({ assetId: `asset-${file.name}` })
      })
    actions.loadLabelEditorContext.mockImplementation(async (ids: string[]) =>
      ready(ids)
    )
    host(<Opener />)
    await user.click(screen.getByRole("button", { name: "Open" }))
    const dialog = screen.getByRole("dialog", {
      name: "Upload photos or videos",
    })
    await user.upload(
      within(dialog).getByLabelText("Choose photos or videos"),
      [jpeg("late.jpg")]
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Upload 1 file" })
    )
    // Hide the running queue; it keeps uploading.
    await user.keyboard("{Escape}")
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Upload photos or videos" })
      ).toBeNull()
    )
    await act(async () => release())
    const add = await screen.findByRole("button", {
      name: "Add photos, 1 ready to label",
    })
    await user.click(add)
    const reopened = screen.getByRole("dialog", {
      name: "Upload photos or videos",
    })
    await user.click(
      within(reopened).getByRole("button", { name: "Label this file" })
    )
    expect(await screen.findByRole("dialog", { name: "Labels" })).toBeTruthy()
    expect(actions.loadLabelEditorContext).toHaveBeenCalledWith([
      "asset-late.jpg",
    ])
    // Labelling took the files off the waiting list.
    expect(
      screen.getByRole("button", { name: "Add photos", hidden: true })
    ).toBeTruthy()
  })
})

describe("each Add call owns only the files it picked", () => {
  const preset = {
    itemId: "item-bhaji",
    variantId: null,
    itemName: "Onion Bhaji",
    variantName: null,
  }

  function deferUploads() {
    const pending: (() => void)[] = []
    uploads.current = (file) =>
      new Promise((resolve) => {
        pending.push(() => resolve({ assetId: `asset-${file.name}` }))
      })
    return () => pending.splice(0).forEach((release) => release())
  }

  async function hideQueue(user: ReturnType<typeof userEvent.setup>) {
    await user.keyboard("{Escape}")
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /^Upload photos/ })
      ).toBeNull()
    )
  }

  function MarkLabelled({ ids }: { ids: string[] }) {
    const labelled = useAddLabelled()
    return (
      <button type="button" onClick={() => labelled(ids)}>
        Labelled elsewhere
      </button>
    )
  }

  it("tells a task screen only about its own files, which are then not ready to label", async () => {
    const user = userEvent.setup()
    const own = vi.fn()
    const release = deferUploads()
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
    const dialog = await screen.findByRole("dialog", {
      name: "Upload photos",
    })
    await user.click(
      within(dialog).getByRole("button", { name: "Upload 1 file" })
    )
    await hideQueue(user)
    await act(async () => release())
    await waitFor(() => expect(own).toHaveBeenCalledWith(["asset-task.jpg"]))
    // Claimed by the task screen: Add does not also call it ready to label.
    expect(screen.getByRole("button", { name: "Add photos" })).toBeTruthy()

    // A later upload from elsewhere is not the task screen's.
    uploads.current = uploader
    await user.click(screen.getByRole("button", { name: "Me" }))
    const again = screen.getByRole("dialog", {
      name: "Upload photos or videos",
    })
    await user.upload(within(again).getByLabelText("Choose photos or videos"), [
      jpeg("other.jpg"),
    ])
    await user.click(
      within(again).getByRole("button", { name: "Upload 1 file" })
    )
    expect(await within(again).findByText("2 uploaded")).toBeTruthy()
    expect(own).toHaveBeenCalledOnce()
  })

  it("keeps a gone task screen's files as ready to label", async () => {
    const user = userEvent.setup()
    const release = deferUploads()
    host(
      <Opener
        opts={{ source: "library", imagesOnly: true, onReady: () => false }}
      />
    )
    await user.click(screen.getByRole("button", { name: "Open" }))
    await user.upload(input("library"), [jpeg("left.jpg")])
    const dialog = await screen.findByRole("dialog", {
      name: "Upload photos",
    })
    await user.click(
      within(dialog).getByRole("button", { name: "Upload 1 file" })
    )
    await hideQueue(user)
    await act(async () => release())
    expect(
      await screen.findByRole("button", {
        name: "Add photos, 1 ready to label",
      })
    ).toBeTruthy()
  })

  it("suggests the dish only for the files picked from it, not earlier ones", async () => {
    const user = userEvent.setup()
    actions.loadLabelEditorContext.mockImplementation(
      async (ids: string[]) => ({
        ok: true,
        viewer: "staff",
        assets: ids.map((id) => asset(id)),
        missing: [],
        catalogue: CATALOGUE,
      })
    )
    const release = deferUploads()
    host(
      <>
        <Opener label="Me" opts={{ dialog: true }} />
        <Opener label="Dish" opts={{ source: "library", preset }} />
      </>
    )
    // An earlier file finishes out of sight and waits to be labelled.
    await user.click(screen.getByRole("button", { name: "Me" }))
    const first = screen.getByRole("dialog", {
      name: "Upload photos or videos",
    })
    await user.upload(within(first).getByLabelText("Choose photos or videos"), [
      jpeg("early.jpg"),
    ])
    await user.click(
      within(first).getByRole("button", { name: "Upload 1 file" })
    )
    await hideQueue(user)
    await act(async () => release())
    await screen.findByRole("button", { name: "Add photos, 1 ready to label" })

    // Then a photo of the dish joins the same queue.
    uploads.current = uploader
    await user.click(screen.getByRole("button", { name: "Dish" }))
    await user.upload(input("library"), [jpeg("dish.jpg")])
    const dialog = await screen.findByRole("dialog", {
      name: "Upload photos or videos",
    })
    await user.click(
      within(dialog).getByRole("button", { name: "Upload 1 file" })
    )
    await user.click(
      await within(dialog).findByRole("button", { name: "Label these files" })
    )
    const editor = await screen.findByRole("dialog", { name: "Labels" })
    expect(actions.loadLabelEditorContext).toHaveBeenCalledWith([
      "asset-early.jpg",
      "asset-dish.jpg",
    ])
    expect(
      (await within(editor).findByText(/Onion Bhaji is added as a label/))
        .textContent
    ).toMatch(/for the photo picked for it, not the others/)
  })

  it("drops a cancelled dish pick's suggestion for the next batch", async () => {
    const user = userEvent.setup()
    actions.loadLabelEditorContext.mockImplementation(
      async (ids: string[]) => ({
        ok: true,
        viewer: "staff",
        assets: ids.map((id) => asset(id)),
        missing: [],
        catalogue: CATALOGUE,
      })
    )
    const release = deferUploads()
    host(
      <>
        <Opener label="Me" opts={{ dialog: true }} />
        <Opener label="Dish" opts={{ source: "library", preset }} />
        <Opener label="Home" opts={{ source: "library" }} />
      </>
    )
    // A file waits in the queue (ready to label), so the queue is not empty.
    await user.click(screen.getByRole("button", { name: "Me" }))
    const first = screen.getByRole("dialog", {
      name: "Upload photos or videos",
    })
    await user.upload(within(first).getByLabelText("Choose photos or videos"), [
      jpeg("early.jpg"),
    ])
    await user.click(
      within(first).getByRole("button", { name: "Upload 1 file" })
    )
    await hideQueue(user)
    await act(async () => release())
    await screen.findByRole("button", { name: "Add photos, 1 ready to label" })

    uploads.current = uploader
    fireEvent.click(screen.getByRole("button", { name: "Dish" }))
    fireEvent.change(input("library"), { target: { files: [] } })
    await user.click(screen.getByRole("button", { name: "Home" }))
    await user.upload(input("library"), [jpeg("cocktail.jpg")])
    const dialog = await screen.findByRole("dialog", {
      name: "Upload photos or videos",
    })
    await user.click(
      within(dialog).getByRole("button", { name: "Upload 1 file" })
    )
    await user.click(
      await within(dialog).findByRole("button", { name: "Label these files" })
    )
    const editor = await screen.findByRole("dialog", { name: "Labels" })
    await within(editor).findByRole("button", { name: /Save/ })
    expect(within(editor).queryByText("Suggested from Our menu")).toBeNull()
  })

  it("stops counting files labelled elsewhere as ready to label", async () => {
    const user = userEvent.setup()
    const release = deferUploads()
    host(
      <>
        <Opener opts={{ dialog: true }} />
        <MarkLabelled ids={["asset-late.jpg"]} />
      </>
    )
    await user.click(screen.getByRole("button", { name: "Open" }))
    const dialog = screen.getByRole("dialog", {
      name: "Upload photos or videos",
    })
    await user.upload(
      within(dialog).getByLabelText("Choose photos or videos"),
      [jpeg("late.jpg")]
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Upload 1 file" })
    )
    await hideQueue(user)
    await act(async () => release())
    await screen.findByRole("button", { name: "Add photos, 1 ready to label" })
    await user.click(screen.getByRole("button", { name: "Labelled elsewhere" }))
    expect(screen.getByRole("button", { name: "Add photos" })).toBeTruthy()
  })
})
