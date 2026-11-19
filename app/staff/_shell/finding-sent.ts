import { sentNoticeFor } from "@/components/nabalens/knowledge/copy"
import type { FindingSentCopy } from "@/components/nabalens/amenities/capture/finding-sent-notice"
import { FINDING_SENT_PARAM } from "@/components/nabalens/amenities/capture/finding-sent"
import { getCheck } from "@/lib/server/amenities"
import type { MediaActor } from "@/lib/server/media/types"

import { withRecheckSent } from "../tasks/sent-recheck"
import { myWorkingList } from "./shell-status"

type SearchParams = Record<string, string | string[] | undefined>

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value

// After an amenity answer the capture screen comes back with
// `?finding_sent=<checkId>`; Today says what happened to it, written on the
// page (DESIGN.md §6.7). Moved from the retired Album home (/staff/tasks).

/**
 * When the working list can't be read, a complete check may still have a
 * newer finding of mine waiting: say it was sent, never that it is complete.
 */
const SENT_NEUTRAL: FindingSentCopy = {
  title: "Sent",
  body: "",
  tone: "positive",
}

/**
 * The amenity check named by `?finding_sent=<id>`, as the database has it now:
 * the notice is never shown on the word of the URL alone. A working-list
 * question says what happened to my latest finding (design §4.3); any other
 * check only once it is complete and answered by me.
 */
export async function sentFinding(
  actor: MediaActor,
  params: SearchParams
): Promise<string | { question: string; copy: FindingSentCopy } | null> {
  const checkId = first(params[FINDING_SENT_PARAM])
  if (!checkId) return null
  const list = await myWorkingList(actor)
  const slot = list?.slots.find((item) => item.checkId === checkId)
  if (slot) {
    const copy = sentNoticeFor(slot)
    return copy
      ? {
          question: slot.question,
          copy: await withRecheckSent(actor, slot, copy),
        }
      : null
  }
  try {
    const result = await getCheck(actor, { checkId })
    if (!result.ok) return null
    const { check } = result.detail
    if (
      check.progress !== "complete" ||
      check.answeredBy?.id !== actor.profile.id
    )
      return null
    return list === undefined
      ? { question: check.entry.question, copy: SENT_NEUTRAL }
      : check.entry.question
  } catch {
    return null
  }
}
