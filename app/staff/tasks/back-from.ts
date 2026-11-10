import { FROM_BACK_LABEL } from "@/components/nabalens/shell/entry-copy"
import { fromHref } from "@/lib/work-client/entry"

import { TASKS_PATH } from "./result"

/**
 * A task page's back link: Home, or the allow-listed page in `?from=`
 * (B02-02 §4.3) unless that is this page.
 */
export function backFrom(
  from: string | string[] | undefined,
  self: string
): { href: string; label?: string } {
  const origin = fromHref(typeof from === "string" ? from : null)
  return origin && origin.origin !== "home" && origin.href !== self
    ? { href: origin.href, label: FROM_BACK_LABEL[origin.origin] }
    : { href: TASKS_PATH }
}
