import type { Page } from "@playwright/test"

/**
 * How far the page (or an open dialog) scrolls sideways, and the innermost
 * element or text sticking out furthest, so a failure says what to fix
 * without a trace.
 */
export async function horizontalOverflow(
  page: Page
): Promise<{ overflowPx: number; culprit: string }> {
  return page.evaluate(() => {
    const doc = document.documentElement
    let worst = doc.scrollWidth - window.innerWidth
    const notes = [
      `scrollWidth=${doc.scrollWidth} clientWidth=${doc.clientWidth} innerWidth=${window.innerWidth} scrollX=${window.scrollX}`,
    ]
    for (const el of Array.from(
      document.querySelectorAll('[role="dialog"], [role="alertdialog"]')
    )) {
      const over = el.scrollWidth - el.clientWidth
      if (over > 0)
        notes.push(`dialog ${el.getAttribute("aria-labelledby")} +${over}`)
      worst = Math.max(worst, over)
    }
    // Text can spill past its element's box, and anything inside a
    // horizontally clipping ancestor cannot overflow.
    const clipped = (el: Element | null) => {
      for (
        let a = el?.parentElement;
        a && a !== document.body;
        a = a.parentElement
      )
        if (getComputedStyle(a).overflowX !== "visible") return true
      return false
    }
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.getAttribute("data-slot") ? `[data-slot=${el.getAttribute("data-slot")}]` : ""}.${(el.getAttribute("class") ?? "").split(/\s+/).slice(0, 4).join(".")}`
    let culprit = notes.join("; ")
    let reach = doc.clientWidth + 0.5
    const consider = (right: number, what: string) => {
      if (right < reach) return
      reach = right
      culprit = `${notes.join("; ")}; ${what} right=${Math.round(right)}`
    }
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      if (clipped(el)) continue
      const right =
        el.getBoundingClientRect().right +
        window.scrollX +
        (parseFloat(getComputedStyle(el).marginRight) || 0)
      consider(right, describe(el))
    }
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT
    )
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const parent = n.parentElement
      if (
        !parent ||
        clipped(n as unknown as Element) ||
        getComputedStyle(parent).overflowX !== "visible"
      )
        continue
      const range = document.createRange()
      range.selectNodeContents(n)
      consider(
        range.getBoundingClientRect().right + window.scrollX,
        `text "${n.textContent?.trim().slice(0, 40)}" in ${describe(parent)}`
      )
    }
    return { overflowPx: Math.max(0, worst), culprit }
  })
}
