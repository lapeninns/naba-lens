// @vitest-environment jsdom
// B02-c in the manager workspace: Add exists only while R8 (read with the
// entry's choices) says the account can upload; a Menu row has the dish's
// buttons only while the entry offers a dish; a finalise the server refused
// (403) reads its reason with no Retry and can be removed, and Add offers no
// new uploads after it; a 503 keeps Retry.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
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
    startPhotoSet: vi.fn(async () => ({ status: "missing" })),
    addToPhotoSet: vi.fn(async () => ({ status: "missing" })),
    // B05-m5: the set read and replacement Add's host now wires in.
    readPhotoSet: vi.fn(async () => ({ status: "missing" })),
    replaceInPhotoSet: vi.fn(async () => ({ status: "missing" })),
    readPhotoSets: vi.fn(),
    readDeleteEvidence: vi.fn(),
    deleteMedia: vi.fn(),
  },
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/manager/menu",
}))
vi.mock("@/lib/supabase/browser", () => ({ createClient: () => supabase }))
vi.mock("@/app/_media/use-media-uploader", () => ({
  useMediaUploader: () => uploads.current,
}))
vi.mock("@/app/_media/actions", () => sets)
vi.mock("@/app/_labels/actions", () => ({
  loadLabelEditorContext: vi.fn(),
  loadLabelCatalogue: vi.fn(),
  saveLabelBatch: vi.fn(),
}))
vi.mock("@/app/staff/_shell/upload-label-api", () => ({
  loadUploadLabelContext: vi.fn(async () => ({
    ok: false,
    message: "The menu could not be loaded. Try again.",
  })),
  saveUploadLabels: vi.fn(),
  discardUploadLabels: vi.fn(async () => null),
  loadLabelAttention: vi.fn(),
  loadPhotoLabels: vi.fn(),
}))

import { AddHost } from "@/app/staff/_shell/add-host"
import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { ManagerNav } from "@/components/nabalens/manager/manager-nav"
import { REVIEW_COPY } from "@/components/nabalens/manager/review/review-copy"
import { ManagerDishButtons } from "@/components/nabalens/manager/menu/dish-buttons"
import { OUR_MENU_COPY } from "@/components/nabalens/menu-photos/copy"
import {
  AddProvider,
  useAdd,
  useAddContext,
} from "@/components/nabalens/shell/add-context"
import { ACCESS_ENDED } from "@/components/nabalens/shell/add-sheet"
import { ENTRY_COPY } from "@/components/nabalens/shell/entry-copy"
import { ManagerEntrySection } from "@/components/nabalens/shell/manager-entry"
import { QueueUploadError } from "@/lib/upload"
import type { EntryIntent, EntryMenu } from "@/lib/work-client/entry"

const ENDED =
  "Your venue manager access has ended, so this upload can't be finished."
const UNCHECKED = "Could not check this file right now. Try again."

const menu = (intents: EntryIntent[]): EntryMenu => ({
  venueName: "Lakeside",
  intents,
  tasks: [],
  questions: [{ checkId: "c1", question: "Is there step-free access?" }],
  answered: [],
})

const DISH = { itemId: "i1", name: "Onion Bhaji" }

function Probe() {
  return <p data-testid="probe">{useAddContext() ? "add" : "none"}</p>
}

function Opener() {
  const openAdd = useAdd()
  return (
    <button type="button" onClick={() => openAdd?.({ source: "library" })}>
      Pick
    </button>
  )
}

function workspace(entry: Promise<EntryMenu | null> | null) {
  return render(
    <AddHost
      blocked={null}
      captchaRequired={false}
      captchaSiteKey={null}
      entry={entry}
      venueName="Lakeside"
      role="manager"
    >
      <ManagerNav kind="bar" />
      <p id="dish-name">{DISH.name}</p>
      <ManagerDishButtons item={DISH} describedBy="dish-name" />
      <Probe />
      <Opener />
    </AddHost>
  )
}

const nav = () =>
  screen.getByRole("navigation", { name: MANAGER_COPY.navLabel })

afterEach(cleanup)
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }))
  uploads.current = null
})

describe("the workspace's Add follows R8", () => {
  it("none while R8 is unread, failed or says no upload: today's workspace", async () => {
    workspace(Promise.resolve(null))
    await act(async () => {})
    expect(screen.getByTestId("probe").textContent).toBe("none")
    expect(within(nav()).queryByRole("button", { name: "Add" })).toBeNull()
    expect(
      screen.queryByRole("button", { name: OUR_MENU_COPY.takePhoto })
    ).toBeNull()
    // The bar is today's four tabs, and no picker is on the page.
    expect(within(nav()).getAllByRole("link")).toHaveLength(4)
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })

  it("Add in the middle of the phone bar, and the dish's buttons, once R8 says upload and label", async () => {
    workspace(Promise.resolve(menu(["dish", "question", "photos"])))
    const add = await within(nav()).findByRole("button", { name: "Add" })
    const items = Array.from(nav().children).map((el) => el.textContent)
    expect(items).toEqual(["Overview", "Review", "Add", "Menu", "Amenities"])
    expect(add.tagName).toBe("BUTTON")
    expect(
      screen.getByRole("button", { name: OUR_MENU_COPY.takePhoto })
    ).toBeTruthy()
    expect(
      screen.getByRole("button", { name: OUR_MENU_COPY.choosePhoto })
    ).toBeTruthy()
  })

  it("photos without labelling: Add, but no dish buttons", async () => {
    workspace(Promise.resolve(menu(["photos"])))
    await within(nav()).findByRole("button", { name: "Add" })
    expect(
      screen.queryByRole("button", { name: OUR_MENU_COPY.takePhoto })
    ).toBeNull()
  })

  it("staff pages keep their Add without any entry read", () => {
    render(
      <AddHost blocked={null} captchaRequired={false} captchaSiteKey={null}>
        <Probe />
      </AddHost>
    )
    expect(screen.getByTestId("probe").textContent).toBe("add")
  })
})

describe("a Menu row's dish buttons", () => {
  it("open Add with the dish preset after the guidance step", () => {
    const openAdd = vi.fn()
    render(
      <AddProvider value={{ openAdd, intents: ["dish", "photos"] }}>
        <p id="dish-name">{DISH.name}</p>
        <ManagerDishButtons item={DISH} describedBy="dish-name" />
      </AddProvider>
    )
    const take = screen.getByRole("button", { name: OUR_MENU_COPY.takePhoto })
    expect(take.getAttribute("aria-describedby")).toBe("dish-name")
    fireEvent.click(take)
    expect(openAdd).toHaveBeenCalledWith({
      source: "camera",
      imagesOnly: true,
      preset: {
        itemId: "i1",
        variantId: null,
        itemName: "Onion Bhaji",
        variantName: null,
      },
    })
  })
})

describe("the amenities page's inline entry", () => {
  it("A dish or drink goes to Menu and Just photos opens Add", () => {
    const openAdd = vi.fn()
    render(
      <AddProvider value={{ openAdd, intents: ["dish", "question", "photos"] }}>
        <ManagerEntrySection menu={menu(["dish", "question", "photos"])} />
      </AddProvider>
    )
    expect(
      screen
        .getByRole("link", { name: new RegExp(ENTRY_COPY.intents.dish) })
        .getAttribute("href")
    ).toBe("/manager/menu")
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(ENTRY_COPY.intents.photos),
      })
    )
    expect(openAdd).toHaveBeenCalledTimes(1)
  })

  it("without the workspace's Add, only the questions are offered", () => {
    render(<ManagerEntrySection menu={menu(["dish", "question", "photos"])} />)
    expect(screen.getAllByRole("listitem")).toHaveLength(1)
    expect(
      screen.queryByText(ENTRY_COPY.intents.photos, { exact: false })
    ).toBeNull()
  })
})

async function pickFailing(error: QueueUploadError) {
  uploads.current = async () => {
    throw error
  }
  workspace(Promise.resolve(menu(["photos"])))
  await within(nav()).findByRole("button", { name: "Add" })
  fireEvent.click(screen.getByRole("button", { name: "Pick" }))
  const input = document.querySelector<HTMLInputElement>(
    'input[data-photo-source="library"]'
  )!
  await act(async () => {
    fireEvent.change(input, {
      target: {
        files: [
          new File([new Uint8Array(64)], "sign.jpg", { type: "image/jpeg" }),
        ],
      },
    })
  })
}

describe("an upload the server refused to finish (403 after the grant ended)", () => {
  it("says why, offers no Retry, can be removed, and Add starts no new uploads", async () => {
    await pickFailing(
      new QueueUploadError({
        code: "finalise_refused",
        message: ENDED,
        retryable: false,
      })
    )
    expect(await screen.findByText(ENDED)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Retry sign.jpg" })).toBeNull()
    expect(screen.queryByText(/can't be used/)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Remove sign.jpg" }))
    await waitFor(() => expect(screen.queryByText(ENDED)).toBeNull())
    await act(async () => {
      fireEvent.click(
        screen.getAllByRole("button", { name: /^(Done|Close)$/ })[0]
      )
    })
    // Add again: why, instead of a picker.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pick" }))
    })
    expect(await screen.findByText(ACCESS_ENDED)).toBeTruthy()
  })

  it("a 503 keeps Retry and today's words", async () => {
    await pickFailing(
      new QueueUploadError({
        code: "finalise_failed",
        message: UNCHECKED,
        retryable: true,
      })
    )
    expect(await screen.findByText(UNCHECKED)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Retry sign.jpg" })).toBeTruthy()
    expect(screen.queryByText(ACCESS_ENDED)).toBeNull()
  })
})

describe("what stays the same for a manager account", () => {
  it("its own menu photo is decided by another reviewer", () => {
    expect(REVIEW_COPY.ownPhoto).toBe(
      "This is your photo. Another reviewer decides on it."
    )
  })

  it("no credit, recognition, target or milestone words, and no delete", async () => {
    workspace(Promise.resolve(menu(["dish", "question", "photos"])))
    await within(nav()).findByRole("button", { name: "Add" })
    fireEvent.click(within(nav()).getByRole("button", { name: "Add" }))
    await act(async () => {})
    const text = document.body.textContent ?? ""
    expect(text).not.toMatch(/credit|recogni|target|milestone/i)
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull()
  })
})
