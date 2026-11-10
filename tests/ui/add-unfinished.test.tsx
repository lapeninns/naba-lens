// @vitest-environment jsdom
// CA-11: Add tells the screen that picked a file why it never became ready
// (failed, cancelled or removed), so its upload-wait copy can name it.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AddHost } from "@/app/staff/_shell/add-host"
import {
  useAdd,
  type OpenAddOptions,
} from "@/components/nabalens/shell/add-context"
import type { Uploader } from "@/components/nabalens/upload-queue"

const { refresh, supabase, uploads } = vi.hoisted(() => ({
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
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
vi.mock("@/lib/supabase/browser", () => ({ createClient: () => supabase }))
vi.mock("@/app/_media/use-media-uploader", () => ({
  useMediaUploader: () => uploads.current,
}))

const jpeg = (name: string) =>
  new File([new Uint8Array(64)], name, { type: "image/jpeg" })

function Opener({ opts }: { opts: OpenAddOptions }) {
  const openAdd = useAdd()
  return (
    <button type="button" onClick={() => openAdd?.(opts)}>
      Pick
    </button>
  )
}

afterEach(cleanup)
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }))
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response(JSON.stringify({ ok: false }), { status: 500 })
    )
  )
})

async function pick(onUnfinished: OpenAddOptions["onUnfinished"]) {
  render(
    <AddHost blocked={null} captchaRequired={false} captchaSiteKey={null}>
      <Opener opts={{ source: "library", purpose: "amenity", onUnfinished }} />
    </AddHost>
  )
  fireEvent.click(screen.getByRole("button", { name: "Pick" }))
  const input = document.querySelector<HTMLInputElement>(
    'input[data-photo-source="library"]'
  )!
  const file = jpeg("sign.jpg")
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } })
  })
  return file
}

describe("Add says why a picked file didn't finish (CA-11)", () => {
  it("failed", async () => {
    uploads.current = async () => {
      throw new Error("Server validation failed")
    }
    const onUnfinished = vi.fn()
    const file = await pick(onUnfinished)
    await waitFor(() =>
      expect(onUnfinished).toHaveBeenCalledWith("failed", file)
    )
    expect(onUnfinished).toHaveBeenCalledTimes(1)
  })

  it("removed, once", async () => {
    uploads.current = async () => {
      throw new Error("Server validation failed")
    }
    const onUnfinished = vi.fn()
    await pick(onUnfinished)
    await waitFor(() => expect(onUnfinished).toHaveBeenCalled())
    // Already reported as failed: removing it says nothing more.
    const remove = await screen.findByRole("button", { name: /Remove/ })
    fireEvent.click(remove)
    expect(onUnfinished).toHaveBeenCalledTimes(1)
  })

  it("cancelled", async () => {
    uploads.current = () => new Promise(() => {})
    const onUnfinished = vi.fn()
    const file = await pick(onUnfinished)
    const cancel = await screen.findByRole("button", { name: /^Cancel/ })
    await act(async () => {
      fireEvent.click(cancel)
    })
    expect(onUnfinished).toHaveBeenCalledWith("cancelled", file)
  })
})
