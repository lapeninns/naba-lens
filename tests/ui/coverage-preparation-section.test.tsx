// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PREPARATION_COPY } from "@/app/admin/coverage/coverage-copy"
import { buildPreparation } from "@/app/admin/coverage/preparation"
import { PreparationSection } from "@/app/admin/coverage/preparation-section"
import type {
  GroupOverviewRow,
  PeriodView,
  PreparationRunView,
} from "@/lib/server/coverage/types"

// The controls call server actions; Recent runs doesn't need them.
vi.mock("@/app/admin/coverage/prepare-control", () => ({
  PrepareButton: () => null,
  PrepareRetryButton: () => null,
}))
vi.mock("@/app/staff/manage/_shared/controls", () => ({
  PreparationRunsControl: () => null,
}))

afterEach(cleanup)

const PERIOD: PeriodView = {
  key: "2026-11",
  label: "November 2026",
  startsAt: "2026-11-01T00:00:00.000Z",
  endsAt: "2026-12-01T00:00:00.000Z",
  isCurrent: true,
  timeZone: "Europe/London",
}

const BELL = { id: "00000000-0000-4000-8000-000000000001", name: "The Bell" }
const HORSE = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "The White Horse",
}

const at = (hoursIntoMonth: number) =>
  new Date(
    Date.parse(PERIOD.startsAt) + hoursIntoMonth * 3_600_000
  ).toISOString()

function run(
  hoursIntoMonth: number,
  o: Partial<PreparationRunView> = {}
): PreparationRunView {
  const finishedAt = at(hoursIntoMonth)
  return {
    id: `run-${hoursIntoMonth}`,
    period: PERIOD.key,
    venueId: null,
    trigger: "scheduled",
    startedAt: finishedAt,
    finishedAt,
    status: "succeeded",
    staffConsidered: 12,
    targetsCopied: 0,
    placeholdersCreated: 0,
    alreadyPresent: 12,
    candidatesAdded: 0,
    errorCode: null,
    ...o,
  }
}

function row(
  venue: { id: string; name: string },
  lastAt: string
): GroupOverviewRow {
  return {
    venue,
    managers: [],
    coverage: {
      applicable: 10,
      satisfied: 5,
      needsSetup: 0,
      pendingReview: 0,
      overdue: 0,
      needsReassignment: 0,
      amenityUnknown: 0,
      menuState: "current",
      complete: false,
    },
    participation: {
      staff: 6,
      targetsSet: 6,
      targetsNeedingSetup: 0,
      staffWithoutTarget: 0,
      complete: 2,
      acceptedPhotos: 9,
    },
    selfReviews: 0,
    lastPreparation: { at: lastAt, status: "succeeded" },
  } as GroupOverviewRow
}

describe("PreparationSection Recent runs late in the month", () => {
  it("shows an all-venues top-up by its scope and counts", () => {
    // 29 Nov 10:00; the week's runs only, so the 1st's run isn't in view.
    const nowHour = 28 * 24 + 10
    const topUpHour = 25 * 24 + 14
    const runs: PreparationRunView[] = []
    for (let h = nowHour; h >= nowHour - 7 * 24; h--)
      runs.push(
        h === topUpHour
          ? run(h, { placeholdersCreated: 1, alreadyPresent: 11 })
          : run(h)
      )
    const model = buildPreparation(
      [row(BELL, at(nowHour)), row(HORSE, at(nowHour))],
      runs,
      PERIOD,
      new Date(at(nowHour)),
      { complete: false }
    )

    render(
      <PreparationSection
        model={model}
        period={PERIOD}
        venueNames={{ [BELL.id]: BELL.name, [HORSE.id]: HORSE.name }}
        allRuns={{ items: [], nextCursor: null }}
        primary={false}
      />
    )

    const recent = screen.getByRole("table", {
      name: PREPARATION_COPY.recentRuns,
    })
    const rows = within(recent).getAllByRole("row").slice(1)
    expect(rows).toHaveLength(1)
    expect(within(rows[0]!).getByText("All venues: 1 needs setup")).toBeTruthy()
    expect(within(recent).queryByText(/venues? prepared/)).toBeNull()
    expect(
      screen.getByText("Last 7 days · runs that prepared something or failed")
    ).toBeTruthy()
  })
})
