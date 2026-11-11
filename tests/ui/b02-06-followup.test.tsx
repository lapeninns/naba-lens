// @vitest-environment jsdom
// B02-06 follow-up: row links keep a 44 px target (UP-14), the Add badge is
// the shared tab badge (UP-18), Prepare month's offline outcome names no
// time and manager pages say when they were rendered (X-01), and tile
// captions wrap with their full text (HM-20).
import { readFileSync } from "node:fs"
import path from "node:path"

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { prepareOfflineText } from "@/components/nabalens/coverage/prepare-month-button"
import { UploadLabelPanel } from "@/components/nabalens/labels"
import { MediaTile } from "@/components/nabalens/media-tile"
import { OFFLINE_COPY } from "@/components/nabalens/offline-notice"
import {
  AddProvider,
  AddTrigger,
} from "@/components/nabalens/shell/add-context"
import type { MediaItem } from "@/components/nabalens/types"

import { CATALOGUE } from "./labels-fixtures"

afterEach(cleanup)

describe("row links (UP-14)", () => {
  it("More details keeps a 44 px target at every width", () => {
    render(
      <UploadLabelPanel
        catalogue={{ state: "ready", catalogue: CATALOGUE }}
        onRetryCatalogue={() => {}}
        files={[{ id: "f1", name: "f1.jpg", kind: "image" }]}
        onChange={() => {}}
        onPendingChange={() => {}}
      />
    )
    const more = screen.getByRole("button", { name: /^More details/ })
    expect(more.className).toContain("min-h-11")
    expect(more.className).not.toContain("md:min-h-0")
  })

  it("the upload sheet's Retry labels and Fix labels are row links", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/nabalens/upload-dialog.tsx"),
      "utf8"
    )
    expect(source).not.toContain('variant="link"')
    expect(source.match(/variant="row-link"/g)).toHaveLength(2)
  })
})

describe("the Add badge (UP-18)", () => {
  function trigger(count: number) {
    render(
      <AddProvider
        value={{
          openAdd: () => {},
          busy: { count, words: `${count} in progress` },
        }}
      >
        <AddTrigger kind="tab" />
      </AddProvider>
    )
    return screen.getByRole("button")
  }

  it("caps at 9+ on the tab, keeping the full number in the name", () => {
    const add = trigger(12)
    expect(add.getAttribute("aria-label")).toBe("Add, 12 in progress")
    const badge = add.querySelector("[data-slot=count]")!
    expect(badge.textContent).toContain("9+")
    expect(badge.className).toContain("absolute")
    expect(badge.closest("[aria-hidden]")).toBeTruthy()
  })

  it("shows a small count as it is", () => {
    const add = trigger(3)
    expect(add.querySelector("[data-slot=count]")!.textContent).toContain("3")
  })
})

describe("offline outcomes and times (X-01)", () => {
  it("Prepare month says what happened to this request, with no time", () => {
    expect(prepareOfflineText("December", false)).toBe(
      "You're offline, so December wasn't prepared. Try again when you have a signal."
    )
    expect(prepareOfflineText("December", true)).toBe(
      "We couldn't confirm December was prepared. Try again; nothing is sent twice."
    )
    expect("body" in OFFLINE_COPY).toBe(false)
  })

  it.each([
    "app/manager/page.tsx",
    "app/manager/menu/page.tsx",
    "app/manager/menu/[itemId]/page.tsx",
    "app/manager/review/page.tsx",
    "app/manager/review/contributors/[staffId]/page.tsx",
    "app/manager/account/page.tsx",
  ])("%s renders its own OfflineNotice with its render time", (file) => {
    const source = readFileSync(path.join(process.cwd(), file), "utf8")
    expect(source).toMatch(/<OfflineNotice[\s\S]*?loadedAt=\{/)
  })
})

describe("tile captions (HM-20)", () => {
  it("wrap to two lines with the full text available", () => {
    const long = "Bartholomew-Fitzwilliam Montgomery-Smythe"
    const item: MediaItem = {
      id: "a1",
      mediaType: "image",
      uploadState: "ready",
      thumbnailUrl: null,
      previewUrl: null,
      mimeType: null,
      originalFilename: null,
      createdAt: "2026-11-10T10:00:00Z",
      contributorId: "u1",
      contributorName: long,
      venueName: "The Barley Mow at Lapen Inns",
      labels: null,
    }
    render(<MediaTile item={item} onOpen={() => {}} showAttribution />)
    const name = screen.getByText(long)
    expect(name.getAttribute("title")).toBe(long)
    expect(name.className).toContain("line-clamp-2")
    expect(name.className).toContain("[overflow-wrap:anywhere]")
    expect(name.className).not.toContain("truncate")
  })

  it("Me's milestone detail wraps too", () => {
    const source = readFileSync(
      path.join(process.cwd(), "app/staff/staff-portfolio.tsx"),
      "utf8"
    )
    expect(source).not.toMatch(
      /className="truncate text-meta text-ink-muted">\{detail\}/
    )
    expect(source).toMatch(/title=\{detail\}/)
  })
})
