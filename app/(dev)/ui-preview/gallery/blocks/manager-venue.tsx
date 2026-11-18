"use client"

import {
  BacklogPanel,
  CategoryCoverage,
  OverviewActions,
  VenueAtAGlance,
} from "@/components/nabalens/manager/overview/overview-panels"
import { ReviewersForm } from "@/components/nabalens/manager/venue/reviewers-form"
import { StillRightList } from "@/components/nabalens/manager/venue/still-right-list"
import { VenueHistoryList } from "@/components/nabalens/manager/venue/venue-history-list"
import type { CoverageView } from "@/lib/album/model"
import type { FactCoverageView } from "@/lib/knowledge/facts"
import {
  backlogSplit,
  categoryRows,
  overviewActions,
  type OverviewInput,
} from "@/lib/manager/overview"
import type { ManagerVenueSummary, VenueReviewers } from "@/lib/manager/venue"

/*
 * S2-MGR fixtures: the manager Overview's panels (spec §7 M1) and the Venue
 * hub's parts (§7 M5) in their states: counts, couldn't-count (null), empty
 * and due/done. Made-up venue and people; every action is a no-op.
 */

const NOW = "2026-11-18T12:00:00Z"
const counts = (total: number, covered: number, pending = 0, missing = 0) => ({
  total,
  covered,
  checkDue: 0,
  pending,
  replacementNeeded: 0,
  missing,
  notHere: 0,
  inactive: 0,
  unavailable: 0,
})

const COVERAGE: CoverageView = {
  venueId: "00000000-0000-4000-8000-00000000b001",
  slots: [],
  categories: [
    { category: "food", ...counts(24, 18, 3, 3) },
    { category: "drinks", ...counts(30, 12, 6, 12) },
    { category: "spaces", ...counts(6, 2, 0, 4) },
    { category: "facilities", ...counts(10, 9, 0, 1) },
    { category: "other", ...counts(0, 0) },
  ],
  totals: { ...counts(70, 41, 9, 20), checkDue: 2, replacementNeeded: 1 },
}

const FACTS: FactCoverageView = {
  venueId: COVERAGE.venueId,
  numerator: 5,
  denominator: 8,
  checkDue: 2,
  unconfirmed: 1,
  withdrawn: 0,
  publicNumerator: 5,
  byCategory: [],
}

const BUSY: OverviewInput = {
  now: NOW,
  pendingPhotos: 50,
  oldestPendingAt: "2026-11-15T09:00:00Z",
  unlabelledPhotos: 4,
  coverage: COVERAGE,
  facts: FACTS,
  publicationIssues: 2,
  menuCheckDue: true,
}

const UNREAD: OverviewInput = {
  now: NOW,
  pendingPhotos: null,
  oldestPendingAt: null,
  unlabelledPhotos: null,
  coverage: null,
  facts: null,
  publicationIssues: null,
  menuCheckDue: null,
}

const HREFS = {
  review: "#review",
  unlabelled: "#unlabelled",
  venue: "#venue",
  requests: "#requests",
  exports: "#exports",
}

const SUMMARY_DUE: ManagerVenueSummary = {
  venueId: COVERAGE.venueId,
  menuCheck: {
    month: "2026-11-01",
    menuVersionId: "00000000-0000-4000-8000-00000000c001",
    menuTitle: "Autumn menu",
    due: true,
    confirmedAt: null,
    confirmedBy: null,
  },
  unlabelledPhotos: 4,
  reviewers: {
    main: { profileId: "p1", name: "Maya Rai", since: NOW },
    backup: null,
  },
}

const SUMMARY_DONE: ManagerVenueSummary = {
  ...SUMMARY_DUE,
  menuCheck: {
    ...SUMMARY_DUE.menuCheck!,
    due: false,
    confirmedAt: NOW,
    confirmedBy: "Maya Rai",
  },
  reviewers: {
    main: { profileId: "p1", name: "Maya Rai", since: NOW },
    backup: { profileId: "p2", name: "Sam Okafor", since: NOW },
  },
}

const REVIEWERS: VenueReviewers = {
  venueId: COVERAGE.venueId,
  main: { profileId: "p1", name: "Maya Rai", since: NOW },
  backup: null,
  candidates: [
    { profileId: "p1", name: "Maya Rai" },
    { profileId: "p2", name: "Sam Okafor" },
  ],
}

const noop = async () => ({ ok: true as const })

function Frame({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-3">
      <h3 className="type-heading-sm text-ink">{title}</h3>
      <div className="grid max-w-page gap-6 rounded-card bg-canvas p-3 edge">
        {children}
      </div>
    </div>
  )
}

export function ManagerVenueBlock() {
  return (
    <div className="grid gap-8">
      <Frame title="Manager Overview: actions first, a busy venue (§7 M1)">
        <OverviewActions
          actions={overviewActions(BUSY, HREFS)}
          pendingPhotos={50}
          reviewHref="#review"
        />
        <BacklogPanel split={backlogSplit(BUSY)} />
        <CategoryCoverage rows={categoryRows(COVERAGE, FACTS)} />
        <VenueAtAGlance
          summary={SUMMARY_DUE}
          venueHref="#venue"
          reviewersHref="#reviewers"
        />
      </Frame>
      <Frame title="Manager Overview: nothing could be counted">
        <OverviewActions
          actions={overviewActions(UNREAD, HREFS)}
          pendingPhotos={null}
          reviewHref="#review"
        />
        <BacklogPanel split={backlogSplit(UNREAD)} />
        <CategoryCoverage rows={null} />
        <VenueAtAGlance summary={null} venueHref="#venue" reviewersHref="#r" />
      </Frame>
      <Frame title="This venue: menu confirmed, both reviewers chosen">
        <VenueAtAGlance
          summary={SUMMARY_DONE}
          venueHref="#venue"
          reviewersHref="#reviewers"
        />
      </Frame>
      <Frame title="Venue: Review assignments (§7 M5)">
        <ReviewersForm
          reviewers={REVIEWERS}
          onSet={async () => ({ ok: true, reviewers: REVIEWERS })}
        />
        <ReviewersForm
          reviewers={{ ...REVIEWERS, main: null, candidates: [] }}
          onSet={async () => ({ ok: true, reviewers: REVIEWERS })}
        />
      </Frame>
      <Frame title="Venue: To confirm (§9.3)">
        <StillRightList
          label="Facts"
          onConfirm={noop}
          items={[
            {
              id: "fact:1",
              title: "Is there step-free access to the entrance?",
              lines: ["Check due · Answer: Yes", "Last checked 12 Aug 2026"],
              payload: { checkId: "c1", slotRevision: 4 },
              href: "#c1",
            },
            {
              id: "fact:2",
              title: "Are dogs allowed inside?",
              lines: ["Unconfirmed · No answer yet"],
              payload: null,
              href: "#c2",
            },
          ]}
        />
      </Frame>
      <Frame title="Venue: History (§7 M5)">
        <VenueHistoryList
          items={[
            {
              source: "activity",
              id: "3",
              at: NOW,
              actorName: "Maya Rai",
              actorRole: "manager",
              action: "reviewer_assigned",
              objectType: "venue_reviewer",
              objectId: null,
              reason: "Covers weekends",
            },
            {
              source: "amenity_scope",
              id: "2",
              at: "2026-11-17T18:30:00Z",
              actorName: "Maya Rai",
              actorRole: "manager",
              action: "applicability_removed",
              objectType: "amenity_check",
              objectId: null,
              reason: "No darts board since the refit",
            },
            {
              source: "activity",
              id: "1",
              at: "2026-11-17T08:00:00Z",
              actorName: null,
              actorRole: "system",
              action: "reviewer_ended",
              objectType: "venue_reviewer",
              objectId: null,
              reason: "No longer a manager at this venue",
            },
          ]}
        />
      </Frame>
    </div>
  )
}
