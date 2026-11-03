// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  MenuImportPanel,
  UNSUPPORTED_IMPORT_COPY,
  checkImportFile,
} from "@/components/nabalens/menus"
import { MENU_IMPORT_LIMITS } from "@/lib/menus/types"

afterEach(cleanup)

// The input's accept attribute would filter these in a real picker; bypass it
// to prove the panel's own checks run before onPreview.
const setup = () => userEvent.setup({ applyAccept: false })
const fileInput = () =>
  screen.getByLabelText("Menu file (JSON or CSV)") as HTMLInputElement

describe("MenuImportPanel", () => {
  it("says which files are read and that others are not", () => {
    render(<MenuImportPanel onPreview={vi.fn()} />)
    expect(UNSUPPORTED_IMPORT_COPY).toBe(
      "PDF, image, Word and spreadsheet menus aren't read."
    )
    expect(
      screen.getByText(
        "JSON (nabalens-menu@1) or CSV, up to 1 MB. PDF, image, Word and spreadsheet menus aren't read."
      )
    ).toBeTruthy()
    expect(fileInput().accept).toBe(".json,.csv")
    expect(screen.getByRole("button", { name: "Choose a file" })).toBeTruthy()
  })

  it("documents both structured formats with examples", async () => {
    const user = setup()
    render(<MenuImportPanel onPreview={vi.fn()} />)
    await user.click(screen.getByText("Supported formats"))
    expect(screen.getByText(/"format": "nabalens-menu@1"/)).toBeTruthy()
    expect(
      screen.getByText(
        /section,section_kind,item,description,variants,aliases,key,price,dietary/
      )
    ).toBeTruthy()
  })

  it("rejects a PDF before onPreview", async () => {
    const user = setup()
    const onPreview = vi.fn()
    render(<MenuImportPanel onPreview={onPreview} />)
    await user.upload(
      fileInput(),
      new File(["%PDF-1.7"], "railway-menu.pdf", { type: "application/pdf" })
    )
    expect(onPreview).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toBe(
      "railway-menu.pdf is a PDF, so it can't be read. Export the menu as JSON or CSV and choose that file."
    )
    expect(
      screen.getByRole("button", { name: "Choose another file" })
    ).toBeTruthy()
  })

  it("rejects an oversize file before onPreview", async () => {
    const user = setup()
    const onPreview = vi.fn()
    render(<MenuImportPanel onPreview={onPreview} />)
    const big = new File(
      [new Uint8Array(MENU_IMPORT_LIMITS.maxBytes + 1)],
      "menu.json",
      { type: "application/json" }
    )
    await user.upload(fileInput(), big)
    expect(onPreview).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toBe(
      "menu.json is 1.0 MB. The limit is 1 MB; split drinks into their own file or remove source notes."
    )
  })

  it("previews a supported file within the limit", async () => {
    const user = setup()
    const onPreview = vi.fn()
    render(<MenuImportPanel onPreview={onPreview} />)
    const csv = new File(["section,item\nMains,Pie\n"], "Menu.CSV", {
      type: "text/csv",
    })
    await user.upload(fileInput(), csv)
    expect(onPreview).toHaveBeenCalledWith(csv)
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.getByText("Menu.CSV")).toBeTruthy()
  })

  it("shows comparing, request errors and a file's problems", async () => {
    const user = setup()
    const onPreview = vi.fn()
    const { rerender } = render(<MenuImportPanel onPreview={onPreview} />)
    await user.upload(
      fileInput(),
      new File(["{}"], "railway.json", { type: "application/json" })
    )
    rerender(<MenuImportPanel onPreview={onPreview} pending />)
    expect(screen.getByText("Comparing…")).toBeTruthy()
    expect(
      screen
        .getByRole("button", { name: "Choose another file" })
        .hasAttribute("disabled")
    ).toBe(true)

    rerender(
      <MenuImportPanel
        onPreview={onPreview}
        error="The preview service is unavailable."
      />
    )
    expect(screen.getByRole("alert").textContent).toContain(
      "The preview service is unavailable."
    )

    rerender(
      <MenuImportPanel
        onPreview={onPreview}
        error="The file has problems."
        issues={[
          { severity: "error", path: "row 3", message: "Item name is empty." },
          {
            severity: "warning",
            path: "row 7",
            message: "Price is kept as source information only.",
          },
          { severity: "error", path: "row 9", message: "Unknown kind." },
        ]}
      />
    )
    const problems = screen.getByRole("alert")
    expect(
      within(problems).getByText("2 problems stop this file being imported")
    ).toBeTruthy()
    const rows = within(problems)
      .getAllByRole("listitem")
      .map((li) => li.textContent)
    expect(rows).toEqual([
      "Row 3: Item name is empty.",
      "Row 9: Unknown kind.",
      "Row 7: Price is kept as source information only.",
    ])
  })

  it("checkImportFile covers extension, empty and size", () => {
    expect(checkImportFile({ name: "a.json", size: 10 })).toBeNull()
    expect(checkImportFile({ name: "a.pdf", size: 10 })).toMatch(
      /is a PDF, so it can't be read/
    )
    for (const name of ["a.docx", "menu", "a.js", "a.xlsx"])
      expect(checkImportFile({ name, size: 10 })).toMatch(
        /can't be read\. Export the menu as JSON or CSV/
      )
    expect(checkImportFile({ name: "a.csv", size: 0 })).toMatch(/is empty/)
    expect(checkImportFile({ name: "a.csv", size: 11 }, 10)).toMatch(/limit/)
  })
})
