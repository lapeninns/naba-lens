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
  it("states that PDF, image, Word and JavaScript menus are not parsed", () => {
    render(<MenuImportPanel onPreview={vi.fn()} />)
    expect(screen.getByText(UNSUPPORTED_IMPORT_COPY)).toBeTruthy()
    expect(UNSUPPORTED_IMPORT_COPY).toMatch(/PDF, image, Word and JavaScript/)
    expect(fileInput().accept).toBe(".json,.csv")
    expect(
      screen.getByRole("button", { name: "Choose JSON or CSV file" })
    ).toBeTruthy()
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

  it("rejects an unsupported extension before onPreview", async () => {
    const user = setup()
    const onPreview = vi.fn()
    render(<MenuImportPanel onPreview={onPreview} />)
    await user.upload(
      fileInput(),
      new File(["%PDF-1.7"], "menu.pdf", { type: "application/pdf" })
    )
    expect(onPreview).not.toHaveBeenCalled()
    const alert = screen.getByRole("alert")
    expect(alert.textContent).toContain("menu.pdf was not imported")
    expect(alert.textContent).toContain("Only .json and .csv files")
    expect(alert.textContent).toContain(UNSUPPORTED_IMPORT_COPY)
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
    expect(screen.getByRole("alert").textContent).toContain(
      "The limit is 1.0 MB"
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
  })

  it("shows pending, request errors and issues split into errors and warnings", () => {
    const { rerender } = render(<MenuImportPanel onPreview={vi.fn()} pending />)
    const busy = screen.getByRole("button", { name: "Reading file…" })
    expect(busy.hasAttribute("disabled")).toBe(true)

    rerender(
      <MenuImportPanel
        onPreview={vi.fn()}
        error="The preview service is unavailable."
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
    expect(screen.getByRole("alert").textContent).toContain(
      "The preview service is unavailable."
    )
    const errors = screen.getByRole("region", { name: "2 errors" })
    expect(within(errors).getByText("Item name is empty.")).toBeTruthy()
    expect(within(errors).getByText("Unknown kind.")).toBeTruthy()
    const warnings = screen.getByRole("region", { name: "1 warning" })
    expect(
      within(warnings).getByText("Price is kept as source information only.")
    ).toBeTruthy()
  })

  it("checkImportFile covers extension, empty and size", () => {
    expect(checkImportFile({ name: "a.json", size: 10 })).toBeNull()
    expect(checkImportFile({ name: "a.docx", size: 10 })).toMatch(/Only/)
    expect(checkImportFile({ name: "menu", size: 10 })).toMatch(/Only/)
    expect(checkImportFile({ name: "a.js", size: 10 })).toMatch(/Only/)
    expect(checkImportFile({ name: "a.csv", size: 0 })).toBe(
      "The file is empty."
    )
    expect(checkImportFile({ name: "a.csv", size: 11 }, 10)).toMatch(/limit/)
  })
})
