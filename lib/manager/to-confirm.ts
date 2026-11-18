/**
 * S2-MGR: what the Venue › To confirm page lists (spec §7 M5, §9.3). Facts
 * awaiting confirmation are the in-scope questions reading Unconfirmed or
 * Check due (S1-FACTS); space photos to check are accepted place photos
 * whose routine check is due. Pure, so the lists are unit tested.
 */

import {
  FACT_VERIFICATION_LABEL,
  type FactStateView,
  type SpacePhotoFreshnessRow,
} from "@/lib/knowledge/facts"

export type ToConfirm = {
  id: string
  title: string
  lines: string[]
  payload: Record<string, unknown> | null
  href: string | null
}

const ANSWER_WORDS: Record<string, string> = {
  yes: "Yes",
  no: "No",
  not_applicable: "Not here",
  unknown: "Not known",
}

const day = (iso: string | null): string | null => {
  if (!iso) return null
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso)
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Europe/London",
      })
}

export function factsToConfirm(
  items: ReadonlyArray<FactStateView>,
  checkHref: (checkId: string) => string
): ToConfirm[] {
  return items
    .filter(
      (f) => f.verification === "unconfirmed" || f.verification === "check_due"
    )
    .map((f) => {
      const answer =
        f.answer && f.answer !== "unknown" ? ANSWER_WORDS[f.answer] : null
      const checked = day(f.verifiedOn)
      return {
        id: `fact:${f.checkId}`,
        title: f.question,
        lines: [
          [
            FACT_VERIFICATION_LABEL[f.verification!],
            answer ? `Answer: ${answer}` : "No answer yet",
          ].join(" · "),
          ...(checked ? [`Last checked ${checked}`] : []),
        ],
        // Only a recorded answer can be reconfirmed unchanged.
        payload: answer
          ? { checkId: f.checkId, slotRevision: f.revision }
          : null,
        href: checkHref(f.checkId),
      }
    })
}

export function spacesToConfirm(
  rows: ReadonlyArray<SpacePhotoFreshnessRow>,
  placesHref: string
): ToConfirm[] {
  const bySubject = new Map<string, SpacePhotoFreshnessRow[]>()
  for (const row of rows) {
    if (row.state !== "check_due") continue
    const list = bySubject.get(row.subject_id) ?? []
    list.push(row)
    bySubject.set(row.subject_id, list)
  }
  return [...bySubject.entries()].map(([subjectId, photos]) => {
    const first = photos[0]!
    const checked = day(first.verified_on)
    return {
      id: `space:${subjectId}`,
      title: first.subject_label,
      lines: [
        `${photos.length} ${photos.length === 1 ? "photo" : "photos"} due a check`,
        ...(checked ? [`Last checked ${checked}`] : []),
      ],
      payload: { subjectId },
      href: placesHref,
    }
  })
}
