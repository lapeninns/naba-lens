// @vitest-environment jsdom
// Amenity evidence stays out of the organisation community: files the capture
// form picks are reserved with purpose "amenity" through the staff layout's
// one Add queue and through the form's own dialog, while every other Add call
// (and other files in the same queue) stays general.
import {
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
import { CaptureClient } from "@/app/staff/tasks/amenities/_capture/capture-client"
import { CaptureForm } from "@/components/nabalens/amenities/capture"
import {
  AddTrigger,
  useAdd,
  type OpenAddOptions,
} from "@/components/nabalens/shell/add-context"
import type {
  UploadContext,
  Uploader,
} from "@/components/nabalens/upload-queue"
import type { CheckSummary } from "@/lib/amenities/contract"

const { refresh, supabase, uploads, amenityActions } = vi.hoisted(() => ({
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
  amenityActions: {
    listSubmittableAssetsAction: vi.fn(async () => ({
      ok: true as const,
      assets: [],
    })),
    submitFindingAction: vi.fn(),
  },
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
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
vi.mock("@/app/_amenities/actions", () => amenityActions)

const jpeg = (name: string) =>
  new File([new Uint8Array(64)], name, { type: "image/jpeg" })

/** Records the purpose each file was sent with ("general" when omitted). */
const sent = new Map<string, string>()
const uploader: Uploader = async (file, context: UploadContext) => {
  sent.set(file.name, context.purpose ?? "general")
  return { assetId: `asset-${file.name}` }
}

const CHECK: CheckSummary = {
  id: "8a000000-0000-4000-8000-000000000001",
  venueId: "v1",
  entry: {
    key: "darts",
    category: "Entertainment",
    question: "Is there a dartboard guests can use?",
    captureBrief: "Photograph the dartboard and the throwing line.",
    evidenceRule: "photo",
    isCore: false,
    position: 30,
    version: 1,
  },
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
}

function Opener({ opts, label }: { opts?: OpenAddOptions; label: string }) {
  const openAdd = useAdd()
  return (
    <button type="button" onClick={() => openAdd?.(opts)}>
      {label}
    </button>
  )
}

const libraryInput = () =>
  document.querySelector<HTMLInputElement>(
    'input[data-photo-source="library"]'
  )!

/** Add starts uploads on pick; a screen's own dialog waits for its button. */
async function uploadAll(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole("dialog")
  const start = within(dialog).queryByRole("button", {
    name: /^Upload \d+ files?$/,
  })
  if (start) await user.click(start)
}

beforeEach(() => {
  vi.clearAllMocks()
  sent.clear()
  uploads.current = uploader
  vi.stubGlobal("matchMedia", () => ({ matches: true }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe("shared Add queue: upload purpose per Add call", () => {
  it("reserves the capture form's picks as amenity evidence", async () => {
    const user = userEvent.setup()
    render(
      <AddHost blocked={null} captchaRequired={false} captchaSiteKey={null}>
        <CaptureClient
          check={CHECK}
          viewerId="1a2b3c4d-0000-4aaa-8bbb-00000000000a"
          initialAssets={{ ok: true, assets: [] }}
          canUpload
          canAttachLegacy={false}
          doneHref="/staff"
        />
      </AddHost>
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Choose from your photos" })
    )
    await user.upload(libraryInput(), [jpeg("wifi.jpg")])
    await uploadAll(user)
    await waitFor(() => expect(sent.get("wifi.jpg")).toBe("amenity"))
  })

  it("keeps later picks in the same queue general", async () => {
    const user = userEvent.setup()
    render(
      <AddHost blocked={null} captchaRequired={false} captchaSiteKey={null}>
        <AddTrigger kind="bar" />
        <Opener
          label="Amenity"
          opts={{ source: "library", purpose: "amenity" }}
        />
      </AddHost>
    )
    fireEvent.click(screen.getByRole("button", { name: "Amenity" }))
    await user.upload(libraryInput(), [jpeg("evidence.jpg")])
    const dialog = await screen.findByRole("dialog", {
      name: "Saving 1 photo",
    })
    // A later pick in the same queue, not from that call: general.
    await user.upload(
      dialog.querySelector<HTMLInputElement>('input[type="file"]')!,
      [jpeg("dish.jpg")]
    )
    await uploadAll(user)
    await waitFor(() => expect(sent.size).toBe(2))
    expect(sent.get("evidence.jpg")).toBe("amenity")
    expect(sent.get("dish.jpg")).toBe("general")
  })

  it("is general from the Add button", async () => {
    const user = userEvent.setup()
    render(
      <AddHost blocked={null} captchaRequired={false} captchaSiteKey={null}>
        <AddTrigger kind="bar" />
      </AddHost>
    )
    await user.click(screen.getByRole("button", { name: "Add photos" }))
    const dialog = await screen.findByRole("dialog", {
      name: "Upload photos or videos",
    })
    const input = dialog.querySelector<HTMLInputElement>('input[type="file"]')!
    await user.upload(input, [jpeg("menu.jpg")])
    await uploadAll(user)
    await waitFor(() => expect(sent.get("menu.jpg")).toBe("general"))
  })
})

describe("capture form's own dialog (no Add queue)", () => {
  it("reserves its uploads as amenity evidence", async () => {
    const user = userEvent.setup()
    render(
      <CaptureForm
        check={CHECK}
        viewerId="1a2b3c4d-0000-4aaa-8bbb-00000000000a"
        initialAssets={{ ok: true, assets: [] }}
        loadAssets={async () => ({ ok: true, assets: [] })}
        submit={vi.fn()}
        upload={{
          uploader,
          limits: {
            maxBatchFiles: 10,
            maxParallelUploads: 2,
            maxPhotoBytes: 20 * 1024 * 1024,
            maxVideoBytes: 200 * 1024 * 1024,
          },
        }}
        onReload={() => {}}
        onDone={() => {}}
        signInHref="/login"
      />
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Choose from your photos" })
    )
    await user.upload(libraryInput(), [jpeg("own.jpg")])
    await uploadAll(user)
    await waitFor(() => expect(sent.get("own.jpg")).toBe("amenity"))
  })
})
