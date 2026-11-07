// @vitest-environment jsdom
// The Add host stores a file's dish on its own (Our menu's dish, applied by
// default), so whatever the label field sends may not drop it unless the
// person removed it: a dish the field never showed stays in what is sent, and
// one it showed and then lost was removed by the person. The field is a stub
// here, so each emitted input is exactly what the test says.
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AddHost } from "@/app/staff/_shell/add-host"
import type { UploadLabelPanelProps } from "@/components/nabalens/labels"
import {
  useAdd,
  type OpenAddOptions,
} from "@/components/nabalens/shell/add-context"
import type { Uploader } from "@/components/nabalens/upload-queue"
import type { SaveLabelsInput } from "@/lib/menus/types"

import { CATALOGUE } from "./labels-fixtures"

const { supabase, uploads, panel, api } = vi.hoisted(() => ({
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
  panel: { current: null as UploadLabelPanelProps | null },
  api: { posted: [] as { venueId: string; input: SaveLabelsInput }[] },
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/lib/supabase/browser", () => ({ createClient: () => supabase }))
vi.mock("@/app/_media/use-media-uploader", () => ({
  useMediaUploader: () => uploads.current,
}))
vi.mock("@/components/nabalens/labels", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/nabalens/labels")>()),
  UploadLabelPanel: (props: UploadLabelPanelProps) => {
    panel.current = props
    return null
  },
}))

const preset = {
  itemId: "item-bhaji",
  variantId: null,
  itemName: "Onion Bhaji",
  variantName: null,
}
const BHAJI_ITEM = [{ itemId: "item-bhaji", variantId: null }]

function labelApi(_url: string, init?: RequestInit) {
  let body: unknown
  if (init?.method === "POST") {
    const sent = JSON.parse(String(init.body))
    api.posted.push(sent)
    body = { ok: true, assetId: sent.input.assetId, state: "pending" }
  } else if (init?.method === "DELETE") body = { ok: true }
  else if (_url.includes("attention=1")) body = { ok: true, items: [] }
  else body = { ok: true, catalogue: CATALOGUE, focus: null }
  return Promise.resolve({ json: async () => body } as Response)
}

function Opener({ opts }: { opts: OpenAddOptions }) {
  const openAdd = useAdd()
  return (
    <button type="button" onClick={() => openAdd?.(opts)}>
      Take a photo of this dish
    </button>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  panel.current = null
  api.posted = []
  // Uploads stay unfinished: labels are kept on the server until finalise.
  uploads.current = (file, ctx) =>
    new Promise(() => ctx.onReserved?.(`asset-${file.name}`))
  vi.stubGlobal("matchMedia", () => ({ matches: true }))
  vi.stubGlobal("fetch", vi.fn(labelApi))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** A dish photo whose dish the host has stored (sent by asset ID). */
async function dishPhoto() {
  const user = userEvent.setup()
  render(
    <AddHost blocked={null} captchaRequired={false} captchaSiteKey={null}>
      <Opener opts={{ source: "library", preset }} />
    </AddHost>
  )
  await user.click(
    screen.getByRole("button", { name: "Take a photo of this dish" })
  )
  await user.upload(
    document.querySelector<HTMLInputElement>(
      'input[data-photo-source="library"]'
    )!,
    [new File([new Uint8Array(64)], "dish.jpg", { type: "image/jpeg" })]
  )
  await waitFor(() => expect(api.posted).toHaveLength(1))
  expect(api.posted[0].input.items).toEqual(BHAJI_ITEM)
  await waitFor(() => expect(panel.current?.files).toHaveLength(1))
  const id = panel.current!.files[0].id
  const emit = (change: Partial<SaveLabelsInput>) =>
    act(() =>
      panel.current!.onChange([
        {
          assetId: id,
          expectedRevision: 0,
          catalogueVersionId: "version-1",
          contentTypes: [],
          note: null,
          items: [],
          missingItem: null,
          ...change,
        },
      ])
    )
  return { id, emit }
}

describe("Add host: a stored dish is never dropped by the label field", () => {
  it("offers each file its own dish through presetFor", async () => {
    const { id } = await dishPhoto()
    expect(panel.current!.presetFor?.(id)).toEqual(preset)
    expect(panel.current!.preset).toBeUndefined()
  })

  it("keeps a dish the field never showed when the field sends other labels", async () => {
    const { emit } = await dishPhoto()
    emit({ contentTypes: ["dish"] })
    await waitFor(() => expect(api.posted).toHaveLength(2))
    expect(api.posted[1].input).toMatchObject({
      assetId: "asset-dish.jpg",
      items: BHAJI_ITEM,
      contentTypes: ["dish"],
    })
  })

  it("drops the dish once the field showed it and the person removed it", async () => {
    const { id, emit } = await dishPhoto()
    emit({ items: BHAJI_ITEM })
    emit({ contentTypes: ["dish"] })
    await waitFor(() => expect(api.posted).toHaveLength(2))
    expect(api.posted[1].input).toMatchObject({
      items: [],
      contentTypes: ["dish"],
    })
    // And it is not offered again when the field mounts again.
    expect(panel.current!.presetFor?.(id)).toBeNull()
  })
})
