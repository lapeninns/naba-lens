import Link from "next/link"
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react/dist/ssr"

import { logout } from "@/app/_media/actions"
import { AppShell } from "@/components/nabalens/app-shell"
import { EmptyState } from "@/components/nabalens/empty-state"
import { ErrorState } from "@/components/nabalens/error-state"
import { Notice } from "@/components/nabalens/notice"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import {
  askerName,
  BackToTasks,
  isPeriodKey,
  MonthCard,
  periodLabel,
  pickReplacement,
  plural,
  ReplacementNote,
  shiftPeriod,
  SubmissionList,
  submitBlockedCopy,
} from "@/components/nabalens/tasks"
import { Button, buttonVariants } from "@/components/ui/button"
import { requireActiveStaff } from "@/lib/auth"
import {
  getCoverageActor,
  getMyMonth,
  getMyTasks,
  listMySubmittablePhotos,
} from "@/lib/server/coverage"
import { periodKeyOf } from "@/lib/server/coverage/time"

import { TASKS_PATH, unwrap } from "../result"
import { TaskSubmit } from "../task-submit"

export const metadata = { title: "Monthly photos · Naba-Lens" }

// finaliseUpload (Server Action used by the upload dialog on this page) decodes
// HEIC/images; same bound as /staff, below MEDIA_LIMITS.staleProcessingMinutes.
export const maxDuration = 120

const MONTH_PATH = `${TASKS_PATH}/month`
const PAST_MONTHS = 3
const SUMMARY =
  "Accepted photos count toward your target. Each photo counts for the month its upload started."

function monthHref(period: string, current: string) {
  return period === current ? MONTH_PATH : `${MONTH_PATH}?period=${period}`
}

const monthName = (key: string) => periodLabel(key).split(" ")[0]

/** The person's earlier months across venues; a month with no target is left out. */
async function pastMonths(
  actor: Parameters<typeof getMyMonth>[0],
  current: string
) {
  const keys = Array.from({ length: PAST_MONTHS }, (_, i) =>
    shiftPeriod(current, -(i + 1))
  )
  const results = await Promise.all(
    keys.map((period) => getMyMonth(actor, { period }).catch(() => null))
  )
  return keys.flatMap((period, i) => {
    const result = results[i]
    if (!result?.ok) return []
    const set = result.month.monthly.filter(
      (m) => m.status === "set" && m.targetCount
    )
    if (set.length === 0) return []
    return [
      {
        period,
        accepted: set.reduce((sum, m) => sum + m.accepted, 0),
        target: set.reduce((sum, m) => sum + (m.targetCount ?? 0), 0),
        met: set.every((m) => m.complete),
      },
    ]
  })
}

function MonthNav({ period, current }: { period: string; current: string }) {
  const previous = shiftPeriod(period, -1)
  const next = shiftPeriod(period, 1)
  const isCurrent = period === current
  const icon = buttonVariants({ variant: "outline", size: "touch" })
  return (
    <div role="group" aria-label="Month" className="flex items-center gap-3">
      <Link
        href={monthHref(previous, current)}
        aria-label={`Previous month, ${periodLabel(previous)}`}
        className={icon}
      >
        <CaretLeftIcon aria-hidden />
      </Link>
      <span
        aria-current={isCurrent ? "date" : undefined}
        className="text-item-title-touch text-ink md:text-item-title"
      >
        {periodLabel(period)}
      </span>
      {isCurrent ? (
        <Button
          variant="outline"
          size="touch"
          disabled
          aria-label="Next month (not started)"
        >
          <CaretRightIcon aria-hidden />
        </Button>
      ) : (
        <Link
          href={monthHref(next, current)}
          aria-label={`Next month, ${periodLabel(next)}`}
          className={icon}
        >
          <CaretRightIcon aria-hidden />
        </Link>
      )}
    </div>
  )
}

/**
 * Monthly photos (no task): this month's progress and sending, plus a
 * read-only history of earlier months. Periods are London calendar months,
 * computed per request. A person's month counts only their own photos at
 * their venue and is never added to venue checklist progress.
 */
export default async function MonthPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string | string[]
    replaces?: string | string[]
  }>
}) {
  const profile = await requireActiveStaff()
  const search = await searchParams
  const current = periodKeyOf(new Date())
  const period =
    isPeriodKey(search.period) && search.period < current
      ? search.period
      : current
  const isCurrent = period === current

  const { actor } = unwrap(await getCoverageActor())
  const [tasksResult, monthResult, photos, past] = await Promise.all([
    getMyTasks(actor),
    getMyMonth(actor, { period }),
    isCurrent
      ? listMySubmittablePhotos(actor, { requirementId: null, cursor: null })
      : null,
    isCurrent ? pastMonths(actor, current) : [],
  ])
  const { tasks } = unwrap(tasksResult)
  const { scope } = tasks

  const shell = (children: React.ReactNode) => (
    <AppShell
      variant="staff"
      active="tasks"
      canManage={scope.canManageVenue}
      userName={profile.displayName}
      logoutAction={logout}
    >
      <OfflineNotice className="mb-4" />
      <div className="flex flex-col gap-6">
        <BackToTasks href={TASKS_PATH} />
        <PageHeader
          scope={[scope.venue?.name, periodLabel(period)]}
          venueScope
          title="Monthly photos"
          summary={SUMMARY}
        />
        {children}
      </div>
    </AppShell>
  )

  if (!monthResult.ok) {
    if (
      monthResult.code === "unauthenticated" ||
      monthResult.code === "account_inactive" ||
      monthResult.code === "not_found"
    ) {
      unwrap(monthResult)
    }
    return shell(
      <ErrorState
        title="We couldn't load your month"
        action={
          <Link
            href={monthHref(period, current)}
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            Try again
          </Link>
        }
      />
    )
  }
  const { month } = monthResult

  const requested = typeof search.replaces === "string" ? search.replaces : null
  const open = isCurrent
    ? tasks.needsAnotherPhoto.filter((s) => s.requirement === null)
    : []
  const replacing = scope.canSubmit ? pickReplacement(open, requested) : null
  const lead = scope.canSubmit ? pickReplacement(open, null) : null
  const blocked = submitBlockedCopy(scope)
  const entries = month.monthly
  const here = entries.find((m) => m.isCurrentMember)
  const elsewhere = entries.find((m) => !m.isCurrentMember)
  const moved = isCurrent && here && elsewhere
  const setupPending = entries.some((m) => m.status === "needs_setup")
  const met = entries.some((m) => m.complete)
  const label = periodLabel(period)

  return shell(
    <>
      <MonthNav period={period} current={current} />

      {moved ? (
        <Notice>
          You moved to {here.venue.name}. Photos you sent at{" "}
          {elsewhere.venue.name} keep counting there.
        </Notice>
      ) : null}

      {entries.length > 0 ? (
        entries.map((monthly) => (
          <MonthCard
            key={monthly.venue.id}
            monthly={monthly}
            periodLabel={label}
            venueName={entries.length > 1 ? monthly.venue.name : null}
            readOnly={!isCurrent}
            replaceHref={
              isCurrent && monthly.isCurrentMember && lead
                ? `${MONTH_PATH}?replaces=${lead.id}#add-heading`
                : null
            }
            replaceCount={open.length}
            addHref={
              isCurrent && monthly.isCurrentMember && scope.canSubmit
                ? "#add-heading"
                : null
            }
          />
        ))
      ) : (
        <MonthCard
          monthly={null}
          periodLabel={label}
          readOnly={!isCurrent}
          addHref={isCurrent && scope.canSubmit ? "#add-heading" : null}
        />
      )}

      {isCurrent && setupPending ? (
        <p className="max-w-(--size-reading) text-body-touch text-ink-muted md:text-body-sm">
          Your manager sets your target for {label}. Until then, photos you add
          still go to Photos and your profile.
        </p>
      ) : null}
      {isCurrent && met && !setupPending ? (
        <p className="max-w-(--size-reading) text-body-touch text-ink-muted md:text-body-sm">
          Photos you add now still go to Photos and your profile.
        </p>
      ) : null}

      {isCurrent ? (
        <section aria-labelledby="add-heading" className="flex flex-col gap-4">
          <h2
            id="add-heading"
            className="text-section-title-touch text-ink md:text-section-title"
          >
            {replacing ? "Send another photo" : "Add photos for this month"}
          </h2>
          {scope.canSubmit && photos ? (
            <>
              {replacing ? (
                <ReplacementNote
                  submission={replacing}
                  currentPeriod={current}
                />
              ) : null}
              <TaskSubmit
                requirementId={null}
                replacesSubmissionId={replacing?.id ?? null}
                reviewerName={replacing ? askerName(replacing) : null}
                initialPhotos={photos}
              />
            </>
          ) : (
            <Notice role="status">{blocked}</Notice>
          )}
        </section>
      ) : null}

      <section aria-labelledby="sent-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id="sent-heading"
            className="text-section-title-touch text-ink md:text-section-title"
          >
            Sent for {monthName(period)}
          </h2>
          {month.submissions.length > 0 ? (
            <span className="text-body-touch text-ink-muted md:text-body-sm">
              {plural(month.submissions.length, "photo", "photos")}
            </span>
          ) : null}
        </div>
        {month.submissions.length > 0 ? (
          <SubmissionList
            label={`Sent for ${monthName(period)}`}
            submissions={month.submissions}
            showTask
            empty={null}
          />
        ) : (
          <EmptyState variant="done" title="No photos were sent this month." />
        )}
      </section>

      {isCurrent && past.length > 0 ? (
        <section aria-labelledby="past-heading" className="flex flex-col gap-3">
          <h2
            id="past-heading"
            className="text-section-title-touch text-ink md:text-section-title"
          >
            Past months
          </h2>
          <ul className="divide-y divide-line rounded-panel border border-line">
            {past.map((m) => (
              <li key={m.period}>
                <Link
                  href={monthHref(m.period, current)}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <span className="grid gap-0.5">
                    <span className="text-item-title-touch text-ink md:text-item-title">
                      {periodLabel(m.period)}
                    </span>
                    <span className="text-body-touch text-ink-muted md:text-body-sm">
                      {m.accepted} of {m.target} accepted
                      {m.met ? " · Target met" : ""}
                    </span>
                  </span>
                  <CaretRightIcon
                    aria-hidden
                    className="size-4 text-ink-muted"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  )
}
