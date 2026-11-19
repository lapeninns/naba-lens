/**
 * S2-MGR (Full App v1): what the manager Overview says and links to (spec §7
 * M1). Actions come before charts: Review next, Check venue details, Request
 * missing photos, Resolve outdated public content. A collection problem (slots
 * nobody has sent a photo for) is shown apart from a review backlog (photos
 * sent and waiting for a decision), so fifty photos awaiting review never look
 * like staff supplied nothing.
 *
 * Every number is from one rule: slot states from public.coverage_slots
 * (S1-COV), facts from knowledge_fact_coverage (S1-FACTS), publication issues
 * from publication_overview().outstanding (S1-EXPORT), unlabelled photos from
 * manager_venue_summary. A count that could not be read is null and says so;
 * it never reads as zero.
 */

import { plural } from "@/components/nabalens/coverage/copy"
import { waitingFor } from "@/components/nabalens/menu-photos/copy"
import type {
  CoverageCategory,
  CoverageCounts,
  CoverageView,
} from "@/lib/album/model"
import { COVERAGE_CATEGORIES } from "@/lib/album/model"
import type { FactCoverageView } from "@/lib/knowledge/facts"
import { coverageWords } from "@/lib/knowledge/facts"

export type OverviewInput = {
  now: string
  /** Photos the manager can decide on now (the Review badge); null unread. */
  pendingPhotos: number | null
  oldestPendingAt: string | null
  unlabelledPhotos: number | null
  coverage: CoverageView | null
  facts: FactCoverageView | null
  publicationIssues: number | null
  /** This month's menu check is still to do; null without a menu or unread. */
  menuCheckDue: boolean | null
}

export type OverviewActionKey = "review" | "venue" | "request" | "outdated"

export type OverviewAction = {
  key: OverviewActionKey
  title: string
  line: string
  href: string
  /** Something here is waiting on the manager. */
  waiting: boolean
}

export type OverviewHrefs = {
  review: string
  unlabelled: string
  venue: string
  requests: string
  exports: string
}

const COULD_NOT = "We couldn't count"

/** Facts reading Unconfirmed or Check due (S1-FACTS: "awaiting confirmation"). */
export function factsAwaiting(facts: FactCoverageView | null): number | null {
  return facts ? facts.unconfirmed + facts.checkDue : null
}

function join(parts: Array<string | null | false>): string {
  return parts.filter(Boolean).join(" · ")
}

export function overviewActions(
  input: OverviewInput,
  hrefs: OverviewHrefs
): OverviewAction[] {
  const totals = input.coverage?.totals ?? null
  const waited = waitingFor(input.oldestPendingAt, input.now)
  const pending = input.pendingPhotos
  const unlabelled = input.unlabelledPhotos
  const facts = factsAwaiting(input.facts)

  const review: OverviewAction = {
    key: "review",
    title: "Review next",
    line:
      pending === null
        ? `${COULD_NOT} the photos waiting`
        : join([
            pending > 0
              ? `${plural(pending, "photo")} waiting`
              : "Nothing waiting for review",
            pending > 0 && waited ? `oldest ${waited}` : null,
            unlabelled === null
              ? null
              : unlabelled > 0
                ? `${unlabelled} ${unlabelled === 1 ? "needs" : "need"} a label`
                : null,
          ]),
    href:
      (pending ?? 0) === 0 && (unlabelled ?? 0) > 0
        ? hrefs.unlabelled
        : hrefs.review,
    waiting: (pending ?? 0) > 0 || (unlabelled ?? 0) > 0,
  }

  const venue: OverviewAction = {
    key: "venue",
    title: "Check venue details",
    line: join([
      facts === null
        ? `${COULD_NOT} facts awaiting confirmation`
        : facts > 0
          ? `${plural(facts, "fact")} awaiting confirmation`
          : "Facts confirmed",
      input.menuCheckDue ? "this month's menu check is due" : null,
    ]),
    href: hrefs.venue,
    waiting: (facts ?? 0) > 0 || input.menuCheckDue === true,
  }

  const missing = totals ? totals.missing : null
  const replace = totals ? totals.replacementNeeded : null
  const request: OverviewAction = {
    key: "request",
    title: "Request missing photos",
    line:
      missing === null
        ? `${COULD_NOT} the empty slots`
        : join([
            missing > 0
              ? `${plural(missing, "slot")} still empty`
              : "No empty slots",
            replace ? `${replace} need replacing` : null,
          ]),
    href: hrefs.requests,
    waiting: (missing ?? 0) > 0 || (replace ?? 0) > 0,
  }

  const issues = input.publicationIssues
  const checkDue = totals ? totals.checkDue : null
  const outdated: OverviewAction = {
    key: "outdated",
    title: "Resolve outdated public content",
    line: join([
      issues === null
        ? `${COULD_NOT} publication issues`
        : issues > 0
          ? `${plural(issues, "publication issue")}`
          : "No publication issues",
      checkDue
        ? `${checkDue} ${checkDue === 1 ? "needs" : "need"} checking`
        : null,
    ]),
    href: (issues ?? 0) > 0 ? hrefs.exports : hrefs.venue,
    waiting: (issues ?? 0) > 0 || (checkDue ?? 0) > 0,
  }

  return [review, venue, request, outdated]
}

/** The two backlogs, kept apart (spec §7 M1). */
export type BacklogSplit = {
  /** Slots with no photo sent (Missing), or null when unread. */
  toCollect: number | null
  /** Slots that have a photo waiting for a decision. */
  slotsWaiting: number | null
  /** Photos waiting for the manager's decision. */
  photosWaiting: number | null
}

export function backlogSplit(input: OverviewInput): BacklogSplit {
  const totals = input.coverage?.totals ?? null
  return {
    toCollect: totals ? totals.missing : null,
    slotsWaiting: totals ? totals.pending : null,
    photosWaiting: input.pendingPhotos,
  }
}

export type CategoryRow = {
  key: CoverageCategory | "facts"
  label: string
  /** "18 of 24" */
  text: string
  /** "75%" or empty without a total. */
  percent: string
  covered: number
  total: number
}

/**
 * Coverage counts and percentages for food, drinks, spaces and facilities
 * (and Other when the venue has any), then confirmed facts (spec §7 M1,
 * §18.1, FA-8: "n of N" first, the percentage as secondary text).
 */
export function categoryRows(
  coverage: CoverageView | null,
  facts: FactCoverageView | null
): CategoryRow[] {
  const rows: CategoryRow[] = []
  if (coverage) {
    const byKey = new Map<CoverageCategory, CoverageCounts>(
      coverage.categories.map((c) => [c.category, c])
    )
    for (const { key, label } of COVERAGE_CATEGORIES) {
      const counts = byKey.get(key)
      const total = counts?.total ?? 0
      if (key === "other" && total === 0) continue
      const covered = counts?.covered ?? 0
      const words = coverageWords(covered, total)
      rows.push({
        key,
        label,
        text: words.text,
        percent: words.percent ?? "",
        covered,
        total,
      })
    }
  }
  if (facts) {
    const words = coverageWords(facts.numerator, facts.denominator)
    rows.push({
      key: "facts",
      label: "Facts confirmed",
      text: words.text,
      percent: words.percent ?? "",
      covered: facts.numerator,
      total: facts.denominator,
    })
  }
  return rows
}
