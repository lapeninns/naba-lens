// @vitest-environment jsdom
// FA-52 shot templates (spec §8 A7, §5.2 step 2): the slot page shows the
// resolved brief with its example photo; Asked for falls back to the slot's
// example when the manager gave no reference; the New request form prefills
// Brief with the slot's standing brief and never overwrites what the manager
// wrote; Settings lists the five templates; one template's form keeps what
// was typed after a refusal and puts a field error beside its field.
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/staff",
}))
const save = vi.hoisted(() => vi.fn())
vi.mock("@/app/admin/settings/shot-templates/actions", () => ({
  saveShotTemplateAction: save,
}))
// A native select stands in for the Base UI one.
vi.mock("@/components/nabalens/option-select", () => ({
  OptionSelect: ({
    options,
    value,
    placeholder,
    onValueChange,
  }: {
    options: { id: string; name: string }[]
    value: string | null
    placeholder?: string
    onValueChange: (value: string | null) => void
  }) => (
    <select
      aria-label={placeholder ?? "Choose"}
      value={value ?? ""}
      onChange={(event) => onValueChange(event.currentTarget.value || null)}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  ),
}))

import { ShotTemplateForm } from "@/app/admin/settings/shot-templates/[category]/shot-template-form"
import { ShotTemplatesPanel } from "@/app/admin/settings/shot-templates-panel"
import { AlbumSlotScreen } from "@/components/nabalens/album/slot-screen"
import { RequestForm } from "@/components/nabalens/requests/request-form"
import { AskedFor } from "@/components/nabalens/requests/staff-requests"
import { AddProvider } from "@/components/nabalens/shell/add-context"
import type { ShotTemplate } from "@/lib/album/brief"
import type { AlbumSlot } from "@/lib/album/model"
import type { StaffRequest } from "@/lib/requests/model"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const PIE = "00000000-0000-4000-8000-0000000d0001"
const ALE = "00000000-0000-4000-8000-0000000d0002"
const EX = "00000000-0000-4000-8000-0000000000e1"
const EX2 = "00000000-0000-4000-8000-0000000000e2"

const slot = (over: Partial<AlbumSlot> = {}): AlbumSlot => ({
  id: `dish:${PIE}`,
  name: "Pie",
  group: "Mains",
  state: "needed",
  thumbnailUrl: null,
  neededBy: null,
  brief: "The dish as it is normally served.",
  exampleAssetId: EX,
  target: { kind: "dish", itemId: PIE, itemName: "Pie" },
  category: "food",
  pendingCount: 0,
  needsUpdate: false,
  ...over,
})

const thumbs = () =>
  Array.from(document.querySelectorAll("img")).map((i) => i.getAttribute("src"))

describe("slot page", () => {
  it("shows the resolved brief with its example photo", () => {
    render(
      <AddProvider value={{ openAdd: vi.fn() }}>
        <AlbumSlotScreen
          venueName="The Bell"
          placeLabel="Kitchen"
          placeHref="/staff/album/x"
          slot={slot()}
          retake={null}
          ownPhotos={[]}
          canAdd
          blocked={null}
          sendReport={vi.fn()}
        />
      </AddProvider>
    )
    expect(screen.getByText("The dish as it is normally served.")).toBeTruthy()
    const example = document.querySelector('[data-slot="slot-example"]')!
    expect(within(example as HTMLElement).getByText("Example of a good photo"))
    expect(thumbs()).toContain(`/api/media/${EX}/thumb`)
  })

  it("says an optional slot is optional beside posted photos too (FA-51, D21)", () => {
    render(
      <AddProvider value={{ openAdd: vi.fn() }}>
        <AlbumSlotScreen
          venueName="The Bell"
          placeLabel="Kitchen"
          placeHref="/staff/album/x"
          slot={slot({ optional: true })}
          retake={null}
          ownPhotos={[]}
          postedPhotos={<section aria-label="Posted photos" />}
          canAdd
          blocked={null}
          sendReport={vi.fn()}
        />
      </AddProvider>
    )
    expect(
      document.querySelector('[data-slot="slot-optional"]')?.textContent
    ).toBe("Optional: a photo is welcome, but none is needed.")
  })

  it("shows no example when there is none", () => {
    render(
      <AddProvider value={{ openAdd: vi.fn() }}>
        <AlbumSlotScreen
          venueName="The Bell"
          placeLabel="Kitchen"
          placeHref="/staff/album/x"
          slot={slot({ exampleAssetId: null })}
          retake={null}
          ownPhotos={[]}
          canAdd
          blocked={null}
          sendReport={vi.fn()}
        />
      </AddProvider>
    )
    expect(document.querySelector('[data-slot="slot-example"]')).toBeNull()
  })
})

describe("Asked for", () => {
  const request = (over: Partial<StaffRequest> = {}): StaffRequest =>
    ({
      id: "00000000-0000-4000-8000-000000000e01",
      type: "missing_photo",
      slot: {
        kind: "dish",
        slotId: PIE,
        name: "Pie",
        category: "food",
        state: "missing",
      },
      subject: "Pie",
      brief: "Whole pie, steam visible",
      photoCount: 1,
      neededBy: null,
      orientation: null,
      wantsVideo: false,
      captureWindow: null,
      referenceAssetId: null,
      forMe: false,
      state: "open",
      priority: "normal",
      ...over,
    }) as StaffRequest

  const draw = (r: StaffRequest) =>
    render(
      <AddProvider value={{ openAdd: vi.fn() }}>
        <AskedFor
          items={[{ request: r, slot: slot({ brief: r.brief }) }]}
          today="2026-11-18"
          canAdd
        />
      </AddProvider>
    )

  it("shows the slot's example when the manager gave no reference", () => {
    draw(request())
    expect(thumbs()).toContain(`/api/media/${EX}/thumb`)
  })

  it("prefers the manager's reference photo", () => {
    draw(request({ referenceAssetId: EX2 }))
    expect(thumbs()).toContain(`/api/media/${EX2}/thumb`)
    expect(thumbs()).not.toContain(`/api/media/${EX}/thumb`)
  })
})

describe("New request form prefill", () => {
  const slots = [
    {
      kind: "dish" as const,
      slotId: PIE,
      name: "Pie",
      categoryLabel: "Food",
      state: "missing",
      brief: "Pie in its dish",
    },
    {
      kind: "dish" as const,
      slotId: ALE,
      name: "Ale",
      categoryLabel: "Drinks",
      state: "missing",
      brief: "The drink as it is normally served.",
    },
  ]
  const form = (initial: string | null) =>
    render(
      <RequestForm
        mode="slot"
        today="2026-11-18"
        slots={slots}
        facts={[]}
        people={[]}
        shotLists={[]}
        initialSlot={initial ? { kind: "dish", slotId: initial } : null}
        create={vi.fn()}
      />
    )
  const brief = () =>
    screen.getByRole("textbox", { name: /Brief/ }) as HTMLInputElement

  it("starts with the linked slot's standing brief", () => {
    form(PIE)
    expect(brief().value).toBe("Pie in its dish")
  })

  it("replaces a prefilled brief when another slot is chosen, but never one the manager wrote", async () => {
    const user = userEvent.setup()
    form(null)
    expect(brief().value).toBe("")
    const pick = (id: string) =>
      user.selectOptions(
        screen.getByRole("combobox", { name: "Choose a slot" }),
        `dish:${id}`
      )
    await pick(ALE)
    expect(brief().value).toBe("The drink as it is normally served.")
    await pick(PIE)
    expect(brief().value).toBe("Pie in its dish")
    await user.clear(brief())
    await user.type(brief(), "Close-up of the crust")
    await pick(ALE)
    expect(brief().value).toBe("Close-up of the crust")
  })
})

const TEMPLATES: ShotTemplate[] = [
  {
    category: "food",
    instruction: "The dish as it is normally served.",
    exampleAssetId: EX,
    storedExampleAssetId: EX,
    exampleUnavailable: false,
    revision: 2,
  },
  {
    category: "drinks",
    instruction: "The drink as it is normally served.",
    exampleAssetId: null,
    storedExampleAssetId: EX2,
    exampleUnavailable: true,
    revision: 1,
  },
  {
    category: "spaces",
    instruction: "The space as guests see it.",
    exampleAssetId: null,
    revision: 1,
  },
]

describe("Settings › Shot templates", () => {
  it("lists each category with its instruction, example state and Edit", () => {
    render(<ShotTemplatesPanel templates={TEMPLATES} />)
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>("[data-category]")
    )
    expect(rows.map((r) => r.dataset.category)).toEqual([
      "food",
      "drinks",
      "spaces",
    ])
    expect(within(rows[1]!).getByText(/no longer accepted for public use/))
    expect(within(rows[2]!).getByText("No example photo"))
    expect(
      screen
        .getByRole("link", { name: "Edit the Food template" })
        .getAttribute("href")
    ).toBe("/admin/settings/shot-templates/food")
  })

  it("says so when the templates could not be read", () => {
    render(<ShotTemplatesPanel templates={null} />)
    expect(screen.getByRole("alert").textContent).toMatch(
      /Shot templates couldn't be loaded/
    )
  })
})

describe("one template's form", () => {
  const choices = [
    {
      assetId: EX2,
      venueId: "v",
      venueName: "The Bell",
      uploadedAt: "2026-11-01T09:00:00Z",
    },
  ]

  it("sends the instruction, chosen example and revision", async () => {
    save.mockResolvedValue({ status: "saved", changed: true, revision: 3 })
    const user = userEvent.setup()
    render(
      <ShotTemplateForm
        template={TEMPLATES[0]!}
        storedExampleAssetId={EX}
        choices={choices}
        olderHref={null}
      />
    )
    const field = screen.getByRole("textbox", { name: "Instruction" })
    await user.clear(field)
    await user.type(field, "A clear, true photo of the plate")
    await user.click(screen.getByRole("radio", { name: /The Bell/ }))
    fireEvent.click(screen.getByRole("button", { name: "Save template" }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    const sent = save.mock.calls[0]![1] as FormData
    expect(sent.get("category")).toBe("food")
    expect(sent.get("instruction")).toBe("A clear, true photo of the plate")
    expect(sent.get("exampleAssetId")).toBe(EX2)
    expect(sent.get("revision")).toBe("2")
    expect((await screen.findByRole("status")).textContent).toMatch(
      /Template saved/
    )
  })

  it("clears the example with No example", async () => {
    save.mockResolvedValue({ status: "saved", changed: true, revision: 3 })
    const user = userEvent.setup()
    render(
      <ShotTemplateForm
        template={TEMPLATES[0]!}
        storedExampleAssetId={EX}
        choices={choices}
        olderHref="/admin/settings/shot-templates/food?before=x"
      />
    )
    await user.click(screen.getByRole("radio", { name: "No example" }))
    fireEvent.click(screen.getByRole("button", { name: "Save template" }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect((save.mock.calls[0]![1] as FormData).get("exampleAssetId")).toBe("")
    expect(
      screen.getByRole("link", { name: "Older photos" }).getAttribute("href")
    ).toBe("/admin/settings/shot-templates/food?before=x")
  })

  it("puts a refusal beside the field and keeps what was typed", async () => {
    save.mockResolvedValue({
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: {
        instruction: "Write one line on what the photo must show.",
      },
      values: { instruction: "  ", exampleAssetId: "", reason: "tidy" },
    })
    render(
      <ShotTemplateForm
        template={TEMPLATES[0]!}
        storedExampleAssetId={EX}
        choices={[]}
        olderHref={null}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "Save template" }))
    expect(
      await screen.findByText("Write one line on what the photo must show.")
    ).toBeTruthy()
    expect(
      (
        screen.getByRole("textbox", {
          name: /Why are you changing this/,
        }) as HTMLTextAreaElement
      ).value
    ).toBe("tidy")
  })
})
