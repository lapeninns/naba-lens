// @vitest-environment jsdom
// Dialog and AlertDialog share one sheet recipe and one set of size names;
// the table keeps its roles when it stacks; menu items share one focus class.
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  ITEM_FOCUS,
} from "@/components/ui/dropdown-menu"
import {
  sheetBackdrop,
  sheetFooter,
  sheetPopup,
} from "@/components/ui/sheet-recipe"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

afterEach(cleanup)

const classes = (el: Element) => el.className.split(/\s+/)

const WIDTHS = {
  sm: "md:max-w-110",
  md: "md:max-w-dialog",
  wide: "md:max-w-dialog-wide",
} as const

describe("sheet recipe", () => {
  it.each(Object.entries(WIDTHS))(
    "size %s is a padded sheet with a grip, %s wide from md",
    (size, width) => {
      const cls = sheetPopup({ size: size as keyof typeof WIDTHS }).split(" ")
      expect(cls).toContain(width)
      expect(cls).toContain("w-safe")
      expect(cls).toContain("max-h-[88dvh]")
      expect(cls).toContain("rounded-t-sheet")
      expect(cls).toContain("md:rounded-sheet")
      expect(cls).toContain("z-overlay")
      expect(cls).toContain("duration-sheet")
      // The grip and the safe-area padding under the last control.
      expect(cls).toContain("before:w-11")
      expect(cls).toContain("md:before:hidden")
      expect(cls).toContain(
        "pb-[calc(1.75rem+env(safe-area-inset-bottom,0px))]"
      )
      // Forced colours remove the shadow: the popup keeps an outline.
      expect(cls).toContain("forced-colors:outline-solid")
    }
  )

  it("defaults to md", () => {
    expect(sheetPopup()).toBe(sheetPopup({ size: "md" }))
  })

  it("viewer fills a phone screen and has no padding or grip", () => {
    const cls = sheetPopup({ size: "viewer" }).split(" ")
    expect(cls).toContain("p-0")
    expect(cls).toContain("max-md:min-h-dvh")
    expect(cls).toContain("max-md:rounded-none")
    expect(cls.some((c) => c.startsWith("before:"))).toBe(false)
    expect(cls.some((c) => c.startsWith("px-") || c.startsWith("pb-"))).toBe(
      false
    )
  })

  it("the footer stacks full width on phones and sits right from md", () => {
    const cls = sheetFooter().split(" ")
    expect(cls).toEqual(
      expect.arrayContaining([
        "flex-col",
        "max-md:*:w-full",
        "md:flex-row",
        "md:justify-end",
        "md:*:min-w-35",
      ])
    )
    expect(cls).not.toContain("sticky")
  })

  it("a sticky footer stays at the bottom edge, clear of the home indicator", () => {
    const cls = sheetFooter({ sticky: true }).split(" ")
    expect(cls).toEqual(
      expect.arrayContaining([
        "sticky",
        "bottom-0",
        "shadow-bar",
        "pb-[calc(1rem+env(safe-area-inset-bottom,0px))]",
      ])
    )
  })
})

function ReasonDialog(props: React.ComponentProps<typeof DialogContent>) {
  return (
    <Dialog>
      <DialogTrigger render={<Button />}>Ask again</DialogTrigger>
      <DialogContent {...props}>
        <DialogHeader>
          <DialogTitle>Ask for another photo</DialogTitle>
          <DialogDescription>They see your reason.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button />}>Keep the photo</DialogClose>
          <Button variant="primary">Ask for another</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

async function openDialog(props?: React.ComponentProps<typeof DialogContent>) {
  const user = userEvent.setup()
  render(<ReasonDialog {...props} />)
  const trigger = screen.getByRole("button", { name: "Ask again" })
  await user.click(trigger)
  const dialog = await screen.findByRole("dialog", {
    name: "Ask for another photo",
  })
  return { user, trigger, dialog }
}

describe("Dialog", () => {
  it("opens as a named dialog at md, described by its description", async () => {
    const { dialog } = await openDialog()
    expect(dialog.getAttribute("data-slot")).toBe("dialog-content")
    expect(dialog.getAttribute("data-size")).toBe("md")
    expect(dialog.className).toBe(sheetPopup({ size: "md" }))
    const description = within(dialog).getByText("They see your reason.")
    expect(dialog.getAttribute("aria-describedby")).toBe(description.id)
    const overlay = document.querySelector("[data-slot=dialog-overlay]")!
    expect(overlay.className).toBe(sheetBackdrop)
  })

  it.each(["sm", "wide", "viewer"] as const)(
    "size %s is named on the popup and sets its width",
    async (size) => {
      const { dialog } = await openDialog({ size })
      expect(dialog.getAttribute("data-size")).toBe(size)
      expect(dialog.className).toBe(sheetPopup({ size }))
    }
  )

  it("a caller's class is merged last and replaces the size's width", async () => {
    const { dialog } = await openDialog({ className: "md:max-w-dialog-wide" })
    expect(classes(dialog)).toContain("md:max-w-dialog-wide")
    expect(classes(dialog)).not.toContain("md:max-w-dialog")
  })

  it("has a labelled Close, a quiet button with a 48px target", async () => {
    const { user, dialog, trigger } = await openDialog()
    const close = within(dialog).getByRole("button", { name: "Close" })
    expect(close.getAttribute("data-slot")).toBe("dialog-close")
    expect(close.getAttribute("data-variant")).toBe("quiet")
    expect(close.textContent).toBe("Close")
    expect(close.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true")
    expect(classes(close)).toContain("min-h-12")
    expect(classes(close)).toContain("focus-ring")
    await user.click(close)
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it("can leave Close to the content", async () => {
    const { dialog } = await openDialog({ showCloseButton: false })
    expect(within(dialog).queryByRole("button", { name: "Close" })).toBeNull()
  })

  it("keeps focus inside and closes on Escape", async () => {
    const { user, dialog, trigger } = await openDialog()
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true)
    )
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it("the footer keeps the safe choice first and the primary last", async () => {
    const { dialog } = await openDialog()
    const footer = dialog.querySelector("[data-slot=dialog-footer]")!
    expect(footer.className).toBe(sheetFooter())
    expect(footer.hasAttribute("data-sticky")).toBe(false)
    const [safe, primary] = [...footer.children]
    expect(safe.textContent).toBe("Keep the photo")
    expect(safe.getAttribute("data-variant")).toBe("secondary")
    expect(primary.textContent).toBe("Ask for another")
    expect(primary.getAttribute("data-variant")).toBe("primary")
  })

  it("a sticky footer says so, and its own Close comes before the actions", () => {
    render(
      <Dialog open>
        <DialogContent showCloseButton={false}>
          <DialogTitle>Photo rules</DialogTitle>
          <DialogFooter sticky showCloseButton className="md:justify-start">
            <Button variant="primary">Save rules</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
    const footer = document.querySelector("[data-slot=dialog-footer]")!
    expect(footer.getAttribute("data-sticky")).toBe("true")
    expect(classes(footer)).toContain("sticky")
    expect(classes(footer)).toContain("md:justify-start")
    expect(classes(footer)).not.toContain("md:justify-end")
    expect([...footer.children].map((el) => el.textContent)).toEqual([
      "Close",
      "Save rules",
    ])
  })
})

function DeleteDialog({
  onDelete,
  size,
}: {
  onDelete?: () => void
  size?: "sm" | "md"
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="danger" />}>
        Delete photo
      </AlertDialogTrigger>
      <AlertDialogContent size={size}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this photo?</AlertDialogTitle>
          <AlertDialogDescription>You cannot undo this.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep photo</AlertDialogCancel>
          <AlertDialogAction variant="danger" onClick={onDelete}>
            Delete it
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

describe("AlertDialog", () => {
  it("is a named alertdialog on the same recipe, sm by default, with no Close", async () => {
    const user = userEvent.setup()
    render(<DeleteDialog />)
    await user.click(screen.getByRole("button", { name: "Delete photo" }))
    const dialog = await screen.findByRole("alertdialog", {
      name: "Delete this photo?",
    })
    expect(dialog.getAttribute("data-slot")).toBe("alert-dialog-content")
    expect(dialog.getAttribute("data-size")).toBe("sm")
    expect(dialog.className).toBe(sheetPopup({ size: "sm" }))
    expect(
      document.querySelector("[data-slot=alert-dialog-overlay]")!.className
    ).toBe(sheetBackdrop)
    expect(within(dialog).queryByRole("button", { name: "Close" })).toBeNull()
    const footer = dialog.querySelector("[data-slot=alert-dialog-footer]")!
    expect(footer.className).toBe(sheetFooter())
    expect([...footer.children].map((el) => el.textContent)).toEqual([
      "Keep photo",
      "Delete it",
    ])
  })

  it("md is the same popup as a md Dialog", async () => {
    const user = userEvent.setup()
    render(<DeleteDialog size="md" />)
    await user.click(screen.getByRole("button", { name: "Delete photo" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.getAttribute("data-size")).toBe("md")
    expect(dialog.className).toBe(sheetPopup({ size: "md" }))
  })

  it("the safe choice closes it and returns focus; the action is the caller's", async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    render(<DeleteDialog onDelete={onDelete} />)
    const trigger = screen.getByRole("button", { name: "Delete photo" })
    await user.click(trigger)
    const dialog = await screen.findByRole("alertdialog")
    const action = within(dialog).getByRole("button", { name: "Delete it" })
    expect(action.getAttribute("data-slot")).toBe("alert-dialog-action")
    expect(action.getAttribute("data-variant")).toBe("danger")
    await user.click(action)
    expect(onDelete).toHaveBeenCalledTimes(1)
    // The action does not close the dialog by itself: the caller decides.
    expect(screen.getByRole("alertdialog")).toBe(dialog)
    const cancel = within(dialog).getByRole("button", { name: "Keep photo" })
    expect(cancel.getAttribute("data-slot")).toBe("alert-dialog-cancel")
    expect(cancel.getAttribute("data-variant")).toBe("secondary")
    await user.click(cancel)
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })
})

describe("DropdownMenu", () => {
  it("exports the item focus recipe for other option lists", () => {
    expect(ITEM_FOCUS).toBe("focus-ring-inset")
  })

  it("opens from the keyboard, lists its items and runs the chosen one", async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    render(
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="quiet" size="icon" aria-label="More" />}
        />
        <DropdownMenuContent>
          <DropdownMenuItem onClick={onEdit}>Edit details</DropdownMenuItem>
          <DropdownMenuItem disabled>Resend invitation</DropdownMenuItem>
          <DropdownMenuItem variant="danger">Deactivate</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
    const trigger = screen.getByRole("button", { name: "More" })
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu")
    trigger.focus()
    await user.keyboard("{Enter}")
    const menu = await screen.findByRole("menu")
    expect(menu.getAttribute("data-slot")).toBe("dropdown-menu-content")
    expect(classes(menu)).toContain("duration-quick")
    const items = within(menu).getAllByRole("menuitem")
    expect(items.map((item) => item.textContent)).toEqual([
      "Edit details",
      "Resend invitation",
      "Deactivate",
    ])
    for (const item of items) expect(classes(item)).toContain(ITEM_FOCUS)
    expect(items[1].getAttribute("aria-disabled")).toBe("true")
    expect(items[2].getAttribute("data-variant")).toBe("danger")
    await user.click(items[0])
    expect(onEdit).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull())
  })
})

function Venues({ stacked }: { stacked?: boolean }) {
  return (
    <Table stacked={stacked} aria-label="Venues">
      <TableCaption>Photos this month</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Venue</TableHead>
          <TableHead>Venue manager</TableHead>
          <TableHead numeric>Photos</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow aria-selected>
          <TableHead scope="row">The Railway</TableHead>
          <TableCell label="Venue manager">Priya Nair</TableCell>
          <TableCell label="Photos" numeric>
            128
          </TableCell>
        </TableRow>
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell>All venues</TableCell>
          <TableCell />
          <TableCell numeric>128</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  )
}

describe("Table", () => {
  it("scrolls sideways by default and names every part's role", () => {
    render(<Venues />)
    const table = screen.getByRole("table", { name: "Venues" })
    expect(table.tagName).toBe("TABLE")
    const container = table.parentElement!
    expect(container.getAttribute("data-slot")).toBe("table-container")
    expect(container.getAttribute("data-mode")).toBe("scroll")
    expect(container.hasAttribute("data-stacked")).toBe(false)
    expect(classes(container)).toContain("overflow-x-auto")
    // Written out, so they survive the display change that stacking makes.
    expect(table.getAttribute("role")).toBe("table")
    expect(
      [...table.querySelectorAll("thead, tbody, tfoot")].map((el) =>
        el.getAttribute("role")
      )
    ).toEqual(["rowgroup", "rowgroup", "rowgroup"])
    expect(
      [...table.querySelectorAll("tr")].map((el) => el.getAttribute("role"))
    ).toEqual(["row", "row", "row"])
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => [th.textContent, th.getAttribute("scope")])
    ).toEqual([
      ["Venue", "col"],
      ["Venue manager", "col"],
      ["Photos", "col"],
    ])
    const rowHeader = within(table).getByRole("rowheader")
    expect(rowHeader.textContent).toBe("The Railway")
    expect(rowHeader.getAttribute("scope")).toBe("row")
    expect(within(table).getAllByRole("cell")).toHaveLength(5)
  })

  it("stacked mode is marked on the container and keeps the header for screen readers", () => {
    render(<Venues stacked />)
    const table = screen.getByRole("table", { name: "Venues" })
    const container = table.parentElement!
    expect(container.getAttribute("data-mode")).toBe("stacked")
    expect(container.getAttribute("data-stacked")).toBe("true")
    expect(classes(container)).toContain("group/table")
    const thead = table.querySelector("thead")!
    // Hidden from sight below md, never removed.
    expect(classes(thead)).toContain("max-md:group-data-stacked/table:sr-only")
    expect(classes(thead)).not.toContain("hidden")
    expect(within(table).getAllByRole("columnheader")).toHaveLength(3)
    expect(classes(table.querySelector("tbody tr")!)).toContain(
      "max-md:group-data-stacked/table:block"
    )
  })

  it("a labelled cell shows its column name to sighted readers only", () => {
    render(<Venues stacked />)
    const cell = screen.getByText("Priya Nair").closest("td")!
    expect(cell.getAttribute("data-label")).toBe("Venue manager")
    const label = cell.querySelector("[data-slot=table-cell-label]")!
    expect(label.textContent).toBe("Venue manager")
    expect(label.getAttribute("aria-hidden")).toBe("true")
    // Shown only below md inside a stacked table.
    expect(classes(label)).toContain("hidden")
    expect(classes(label)).toContain("max-md:group-data-stacked/table:block")
    expect(
      cell.querySelector("[data-slot=table-cell-value]")!.textContent
    ).toBe("Priya Nair")
    // A cell with no label renders its children directly.
    const plain = screen.getByText("All venues")
    expect(plain.tagName).toBe("TD")
    expect(plain.hasAttribute("data-label")).toBe(false)
    expect(plain.querySelector("[data-slot=table-cell-label]")).toBeNull()
  })

  it("number cells are right-aligned in tabular mono figures", () => {
    render(<Venues />)
    const cell = screen
      .getAllByText("128")
      .map((el) => el.closest("td")!)
      .find((td) => td.hasAttribute("data-label"))!
    expect(cell.getAttribute("data-numeric")).toBe("true")
    expect(classes(cell)).toEqual(
      expect.arrayContaining(["text-right", "font-mono", "tabular-nums"])
    )
    const head = screen.getByRole("columnheader", { name: "Photos" })
    expect(head.getAttribute("data-numeric")).toBe("true")
    expect(classes(head)).toContain("text-right")
  })

  it("a selected row has a fill, and an outline in forced colours", () => {
    render(<Venues />)
    const row = screen.getByRole("rowheader").closest("tr")!
    expect(row.getAttribute("aria-selected")).toBe("true")
    expect(classes(row)).toEqual(
      expect.arrayContaining([
        "aria-selected:bg-accent-soft",
        "forced-colors:aria-selected:outline-solid",
      ])
    )
  })

  it("the caption is a heading above the table and a caller's class wins", () => {
    render(
      <Table className="table-fixed">
        <TableCaption className="text-meta">Staff</TableCaption>
        <TableBody>
          <TableRow>
            <TableCell className="whitespace-normal">Priya Nair</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )
    const table = screen.getByRole("table", { name: "Staff" })
    expect(classes(table)).toEqual(
      expect.arrayContaining(["caption-top", "table-fixed"])
    )
    const caption = table.querySelector("caption")!
    expect(caption.getAttribute("data-slot")).toBe("table-caption")
    expect(classes(caption)).toContain("text-meta")
    expect(classes(caption)).not.toContain("type-section-title")
    const cell = screen.getByRole("cell", { name: "Priya Nair" })
    expect(classes(cell)).toContain("whitespace-normal")
    expect(classes(cell)).not.toContain("whitespace-nowrap")
  })
})
