// Opens an emailed /auth/confirm link the way a person does: GET the page (which
// must not use the token), then submit its Continue form to /auth/confirm/verify.
// Kept apart from ./auth-support.ts, which the next/headers mock itself imports.

import ConfirmPage from "@/app/auth/confirm/page"
import { POST as verify } from "@/app/auth/confirm/verify/route"

import { APP_ORIGIN, appRequest, Browser, redirectOf } from "./auth-support"

export type ContinueForm = {
  action: string
  method: string
  fields: Record<string, string>
  heading: string
}

function walk(
  node: unknown,
  visit: (props: Record<string, unknown>, type: unknown) => void
) {
  if (!node || typeof node !== "object") return
  if (Array.isArray(node)) return node.forEach((child) => walk(child, visit))
  const element = node as { type?: unknown; props?: Record<string, unknown> }
  if (!element.props) return
  visit(element.props, element.type)
  walk(element.props.children, visit)
}

/** GETs the confirm page; returns its form, or where it redirected instead. */
export async function loadConfirmPage(
  browser: Browser,
  confirmPath: string
): Promise<{ form: ContinueForm | null; location: string | null }> {
  const url = new URL(confirmPath, APP_ORIGIN)
  const searchParams = Promise.resolve(Object.fromEntries(url.searchParams))
  const page = await browser.run(() =>
    redirectOf(() => ConfirmPage({ searchParams }))
  )
  if (page.location) return { form: null, location: page.location }

  let form: ContinueForm | null = null
  walk(page.value, (props, type) => {
    if (type === "form") {
      form = {
        action: String(props.action),
        method: String(props.method),
        fields: {},
        heading: "",
      }
    }
    if (type === "input" && form && props.type === "hidden") {
      form.fields[String(props.name)] = String(props.value)
    }
    if (type === "h1" && form) form.heading = String(props.children)
  })
  return { form, location: null }
}

/**
 * Submits fields to /auth/confirm/verify as a browser's form POST. By default
 * the headers a same-origin submission carries; override them (null = omit).
 */
export async function submitConfirm(
  browser: Browser,
  fields: Record<string, string>,
  override: Record<string, string | null> = {}
) {
  const headers = new Headers({
    "content-type": "application/x-www-form-urlencoded",
    host: new URL(APP_ORIGIN).host,
    origin: APP_ORIGIN,
    "sec-fetch-site": "same-origin",
  })
  for (const [name, value] of Object.entries(override)) {
    if (value === null) headers.delete(name)
    else headers.set(name, value)
  }
  const body = new URLSearchParams(fields)
  const res = await browser.run(() =>
    verify(
      appRequest(browser, "/auth/confirm/verify", {
        method: "POST",
        headers,
        body,
      })
    )
  )
  return { status: res.status, location: res.headers.get("location") }
}

/** GET the link, then press Continue. Returns the final redirect. */
export async function followEmailLink(browser: Browser, confirmPath: string) {
  const page = await loadConfirmPage(browser, confirmPath)
  if (!page.form) return { status: 307, location: page.location }
  if (
    page.form.action !== "/auth/confirm/verify" ||
    page.form.method !== "post"
  ) {
    throw new Error("Confirm page form does not POST to /auth/confirm/verify")
  }
  return submitConfirm(browser, page.form.fields)
}
