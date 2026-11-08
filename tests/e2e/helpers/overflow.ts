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

/**
 * Whether the md-up AppBar's section links fit beside its right-hand group
 * (Add, name, Log out): the nav must not be squeezed narrower than its links,
 * and the last link must end before the group starts. Null when the bar's
 * nav is not shown (phones).
 */
export async function appBarFit(
  page: Page
): Promise<{ fits: boolean; detail: string } | null> {
  // Streamed copies sit in hidden S: divs until React swaps them in.
  await page.waitForFunction(
    () => !document.querySelector('div[hidden][id^="S:"]')
  )
  return page.evaluate(() => {
    const shown = (el: Element) => el.getClientRects().length > 0
    const nav = Array.from(
      document.querySelectorAll('[data-slot="app-nav"]')
    ).find(shown)
    const group = nav?.nextElementSibling
    if (!nav || !group) return null
    const links = Array.from(nav.querySelectorAll("a")).filter(shown)
    const last = links.at(-1)?.getBoundingClientRect().right ?? 0
    const start = group.getBoundingClientRect().left
    const squeezed = nav.scrollWidth - nav.clientWidth
    return {
      fits: squeezed <= 0 && last <= start + 0.5,
      detail: `links [${links.map((a) => a.textContent).join(", ")}] squeezed by ${squeezed}px; last ends at ${Math.round(last)}, right-hand group starts at ${Math.round(start)}`,
    }
  })
}
