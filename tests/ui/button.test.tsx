// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Button, buttonVariants } from "@/components/ui/button"
import { LinkButton } from "@/components/ui/link-button"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

afterEach(cleanup)

const VARIANTS = [
  "primary",
  "secondary",
  "quiet",
  "danger",
  "danger-quiet",
  "link",
] as const

// sm is a 48px staff target; inside a manager or admin shell
// (data-density="compact") it is v2's compact 44/40px (V2-4, review Z1).
const HEIGHTS = { sm: "min-h-12", md: "min-h-12", lg: "min-h-12" } as const

describe("Button", () => {
  it("is the outlined default at md unless told otherwise", () => {
    render(<Button>Edit profile</Button>)
    const button = screen.getByRole("button", { name: "Edit profile" })
    expect(button.tagName).toBe("BUTTON")
    expect(button.getAttribute("type")).toBe("button")
    expect(button.getAttribute("data-slot")).toBe("button")
    expect(button.getAttribute("data-variant")).toBe("secondary")
    expect(button.getAttribute("data-size")).toBe("md")
    expect(button.className.split(" ")).toContain("bg-surface")
    expect(button.className.split(" ")).toContain("edge-strong")
    expect(button.className).not.toContain("bg-accent")
    expect(button.className).toContain("min-h-12")
    expect(button.className).toContain("focus-ring")
  })

  it.each(VARIANTS)("names the %s variant on the root", (variant) => {
    render(<Button variant={variant}>Go</Button>)
    expect(screen.getByRole("button").getAttribute("data-variant")).toBe(
      variant
    )
  })

  it.each(Object.entries(HEIGHTS))("size %s is %s tall", (size, minHeight) => {
    render(<Button size={size as keyof typeof HEIGHTS}>Go</Button>)
    const button = screen.getByRole("button")
    expect(button.getAttribute("data-size")).toBe(size)
    expect(button.className.split(" ")).toContain(minHeight)
  })

  it("size sm is compact only inside a manager or admin shell", () => {
    render(<Button size="sm">Go</Button>)
    const classes = screen.getByRole("button").className.split(" ")
    expect(classes).toContain("in-data-[density=compact]:min-h-11")
    expect(classes).toContain("desktop:in-data-[density=compact]:min-h-10")
    // No bare compact step: staff keep 48px at every width.
    expect(classes).not.toContain("desktop:min-h-10")
  })

  it("icon sizes are 44px and 48px squares", () => {
    render(
      <>
        <Button size="icon" aria-label="Close" />
        <Button size="icon-lg" aria-label="Edit" />
      </>
    )
    const close = screen.getByRole("button", { name: "Close" })
    const edit = screen.getByRole("button", { name: "Edit" })
    expect(close.className.split(" ")).toContain("size-11")
    expect(close.getAttribute("data-size")).toBe("icon")
    expect(edit.className.split(" ")).toContain("size-12")
    expect(edit.getAttribute("data-size")).toBe("icon-lg")
  })

  it("danger is v2's outline: signal words and a 1px signal edge", () => {
    const danger = cn(buttonVariants({ variant: "danger" })).split(" ")
    expect(danger).toContain("bg-surface")
    expect(danger).toContain("text-signal")
    expect(danger).toContain("inset-ring-signal")
    expect(danger).toContain("hover:bg-raised")
    // danger-quiet is the same without the edge or the fill.
    const quiet = cn(buttonVariants({ variant: "danger-quiet" })).split(" ")
    expect(quiet).toContain("bg-transparent")
    expect(quiet).not.toContain("inset-ring-signal")
  })

  it("an icon size never replaces the variant's colour", () => {
    const classes = (
      variant: (typeof VARIANTS)[number],
      size: "icon" | "icon-lg"
    ) =>
      // As Button applies it: merged, so a later colour replaces an earlier.
      cn(buttonVariants({ variant, size })).split(" ")
    for (const size of ["icon", "icon-lg"] as const) {
      expect(classes("primary", size)).toContain("text-on-accent")
      expect(classes("primary", size)).not.toContain("text-ink-muted")
      expect(classes("danger", size)).toContain("text-signal")
      expect(classes("danger-quiet", size)).toContain("text-signal")
    }
    // The muted glyph belongs to the small outlined and quiet icon buttons.
    expect(classes("quiet", "icon")).toContain("text-ink-muted")
    expect(classes("secondary", "icon")).toContain("text-ink-muted")
    expect(classes("quiet", "icon")).not.toContain("text-ink")
    expect(classes("quiet", "icon-lg")).toContain("text-accent-text")
  })

  it("a link button has no icon square (the type refuses the pair)", () => {
    render(
      <>
        {/* @ts-expect-error a link is text-sized: no icon size */}
        <Button variant="link" size="icon" aria-label="No" />
        {/* @ts-expect-error the same for LinkButton */}
        <LinkButton
          href="/staff"
          variant="link"
          size="icon-lg"
          aria-label="No"
        />
        <LinkButton
          href="/staff"
          variant="quiet"
          size="icon"
          aria-label="Guide"
        />
      </>
    )
    expect(
      screen.getByRole("link", { name: "Guide" }).getAttribute("data-size")
    ).toBe("icon")
  })

  it("a pressed toggle has its own fill, edge and a tick; off has none", () => {
    render(
      <>
        <Button aria-pressed>Show accepted</Button>
        <Button aria-pressed={false}>Show waiting</Button>
        <Button>Plain</Button>
      </>
    )
    const on = screen.getByRole("button", { name: "Show accepted" })
    const off = screen.getByRole("button", { name: "Show waiting" })
    expect(on.getAttribute("aria-pressed")).toBe("true")
    expect(off.getAttribute("aria-pressed")).toBe("false")
    expect(
      screen.getByRole("button", { name: "Plain" }).hasAttribute("aria-pressed")
    ).toBe(false)
    for (const toggle of [on, off]) {
      const classes = toggle.className.split(" ")
      expect(classes).toContain("aria-pressed:bg-accent-soft")
      expect(classes).toContain("aria-pressed:edge-selected")
    }
    // A button that is not a toggle carries none of it.
    expect(
      screen.getByRole("button", { name: "Plain" }).className
    ).not.toContain("aria-pressed:bg-accent-soft")
    render(
      <Button variant="quiet" aria-pressed>
        Quiet toggle
      </Button>
    )
    expect(
      screen.getByRole("button", { name: "Quiet toggle" }).className
    ).toContain("aria-pressed:edge-selected")
    // Never colour alone: the tick is the mark.
    const tick = on.querySelector('[data-slot="button-pressed-mark"]')
    expect(tick?.getAttribute("aria-hidden")).toBe("true")
    expect(off.querySelector('[data-slot="button-pressed-mark"]')).toBeNull()
  })

  it("an icon-only toggle gets no tick: there is no room in the square", () => {
    render(
      <Button size="icon" aria-pressed aria-label="Pin this photo">
        <svg aria-hidden />
      </Button>
    )
    const button = screen.getByRole("button", { name: "Pin this photo" })
    expect(button.getAttribute("aria-pressed")).toBe("true")
    expect(button.querySelector('[data-slot="button-pressed-mark"]')).toBeNull()
  })

  it("every size uses v2's label type (the button role)", () => {
    for (const size of ["sm", "md", "lg"] as const) {
      render(<Button size={size}>Go {size}</Button>)
      const merged = screen
        .getByRole("button", { name: `Go ${size}` })
        .className.split(" ")
      expect(merged).toContain("text-button")
    }
  })

  it("has no alias variants or sizes left", () => {
    // Unknown names fall through cva with no classes of their own.
    const bare = (name: string) =>
      // @ts-expect-error the old names are no longer in the type
      buttonVariants({ variant: name, size: name })
    for (const name of [
      "default",
      "outline",
      "ghost",
      "destructive",
      "touch",
    ]) {
      expect(bare(name)).not.toMatch(/bg-accent|edge-strong|min-h-12/)
    }
  })

  it("merges the caller's className last", () => {
    render(<Button className="min-h-11 w-full">Go</Button>)
    const classes = screen.getByRole("button").className.split(" ")
    expect(classes).toContain("w-full")
    expect(classes).toContain("min-h-11")
    expect(classes).not.toContain("min-h-12")
  })

  it("fires onClick when enabled", async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Save</Button>)
    await userEvent.click(screen.getByRole("button", { name: "Save" }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("aria-disabled keeps focus and does not fire onClick", async () => {
    const onClick = vi.fn()
    render(
      <Button aria-disabled="true" onClick={onClick}>
        Save
      </Button>
    )
    const button = screen.getByRole("button", { name: "Save" })
    expect(button.getAttribute("aria-disabled")).toBe("true")
    expect(button.hasAttribute("disabled")).toBe(false)
    await userEvent.tab()
    expect(document.activeElement).toBe(button)
    await userEvent.click(button)
    await userEvent.keyboard("{Enter}")
    await userEvent.keyboard(" ")
    expect(onClick).not.toHaveBeenCalled()
  })

  it("an aria-disabled submit button does not submit its form", async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" aria-disabled>
          Send
        </Button>
      </form>
    )
    await userEvent.click(screen.getByRole("button", { name: "Send" }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("disabled leaves the focus order", async () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>
    )
    const button = screen.getByRole("button", { name: "Save" })
    expect(button.hasAttribute("disabled")).toBe(true)
    await userEvent.tab()
    expect(document.activeElement).not.toBe(button)
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it("passes aria-invalid through for the invalid edge", () => {
    render(<Button aria-invalid="true">Choose a venue</Button>)
    const button = screen.getByRole("button")
    expect(button.getAttribute("aria-invalid")).toBe("true")
    expect(button.className).toContain("aria-invalid:edge-invalid")
  })

  describe("loading", () => {
    it("is busy, blocked, focusable and keeps its label", async () => {
      const onClick = vi.fn()
      render(
        <Button variant="primary" loading onClick={onClick}>
          Send photos
        </Button>
      )
      const button = screen.getByRole("button", { name: "Send photos" })
      expect(button.getAttribute("aria-busy")).toBe("true")
      expect(button.getAttribute("aria-disabled")).toBe("true")
      expect(button.hasAttribute("disabled")).toBe(false)
      expect(button.hasAttribute("data-loading")).toBe(true)
      expect(button.getAttribute("data-variant")).toBe("primary")

      const spinner = button.querySelector('[data-slot="spinner"]')
      expect(spinner).not.toBeNull()
      expect(spinner?.getAttribute("aria-hidden")).toBe("true")
      // The spinner comes before the label.
      expect(button.firstElementChild).toBe(spinner)

      await userEvent.tab()
      expect(document.activeElement).toBe(button)
      await userEvent.click(button)
      await userEvent.keyboard("{Enter}")
      expect(onClick).not.toHaveBeenCalled()
    })

    it("shows loadingLabel in place of the label", () => {
      render(
        <Button loading loadingLabel="Saving">
          Save
        </Button>
      )
      expect(screen.getByRole("button", { name: "Saving" })).toBeTruthy()
      expect(screen.queryByText("Save")).toBeNull()
    })

    it("is not busy and shows no spinner when not loading", () => {
      render(<Button loadingLabel="Saving">Save</Button>)
      const button = screen.getByRole("button", { name: "Save" })
      expect(button.hasAttribute("aria-busy")).toBe(false)
      expect(button.hasAttribute("aria-disabled")).toBe(false)
      expect(button.hasAttribute("data-loading")).toBe(false)
      expect(button.querySelector('[data-slot="spinner"]')).toBeNull()
    })

    it("a loading submit button does not submit its form", async () => {
      const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
      render(
        <form onSubmit={onSubmit}>
          <Button type="submit" loading>
            Send
          </Button>
        </form>
      )
      await userEvent.click(screen.getByRole("button", { name: "Send" }))
      expect(onSubmit).not.toHaveBeenCalled()
    })
  })
})

describe("LinkButton", () => {
  it("renders an anchor with the button's classes and data attributes", () => {
    render(
      <>
        <Button variant="primary" size="lg">
          Button
        </Button>
        <LinkButton href="/staff/tasks" variant="primary" size="lg">
          Open tasks
        </LinkButton>
      </>
    )
    const link = screen.getByRole("link", { name: "Open tasks" })
    expect(link.tagName).toBe("A")
    expect(link.getAttribute("href")).toBe("/staff/tasks")
    expect(link.getAttribute("data-slot")).toBe("link-button")
    expect(link.getAttribute("data-variant")).toBe("primary")
    expect(link.getAttribute("data-size")).toBe("lg")
    expect(link.className).toBe(screen.getByRole("button").className)
  })

  it("is a grey secondary at md by default and merges className last", () => {
    render(
      <LinkButton href="/staff" className="w-full">
        Home
      </LinkButton>
    )
    const link = screen.getByRole("link", { name: "Home" })
    expect(link.getAttribute("data-variant")).toBe("secondary")
    expect(link.getAttribute("data-size")).toBe("md")
    expect(link.className).toBe(
      `${buttonVariants({ variant: "secondary", size: "md" })} w-full`
    )
  })
})

describe("Spinner", () => {
  it("is hidden decoration by default", () => {
    const { container } = render(<Spinner />)
    const svg = container.querySelector("svg")
    expect(svg?.getAttribute("aria-hidden")).toBe("true")
    expect(svg?.getAttribute("data-slot")).toBe("spinner")
    expect(svg?.getAttribute("data-size")).toBe("md")
    expect(svg?.getAttribute("class")).toContain("size-5")
    expect(svg?.getAttribute("class")).toContain("motion-safe:animate-spin")
    expect(screen.queryByRole("status")).toBeNull()
  })

  it.each([
    ["sm", "size-4.5"],
    ["md", "size-5"],
    ["lg", "size-6"],
  ] as const)("size %s draws %s", (size, className) => {
    const { container } = render(<Spinner size={size} />)
    expect(
      container.querySelector("svg")?.getAttribute("class")?.split(" ")
    ).toContain(className)
  })

  it("reads its label out as a status", () => {
    const { container } = render(<Spinner label="Loading photos" />)
    const status = screen.getByRole("status")
    expect(status.textContent).toBe("Loading photos")
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true"
    )
  })
})
