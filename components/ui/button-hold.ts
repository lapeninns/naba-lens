"use client"

import type * as React from "react"

/*
 * The click handler of a button that is switched off but still focusable
 * (`aria-disabled` or `loading`): it stops the click and a form submit.
 * Enter and Space arrive here as clicks.
 *
 * It lives in a client module so that Button itself can stay server-safe: a
 * server component cannot hand a plain function to Base UI's client Button,
 * but it can hand over a reference to one exported from here.
 */
export function hold(event: React.MouseEvent) {
  event.preventDefault()
}
