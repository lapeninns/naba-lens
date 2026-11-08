import Link from "next/link"
import {
  CalendarBlankIcon,
  CaretLeftIcon,
  CaretRightIcon,
} from "@phosphor-icons/react/dist/ssr"

import { AppShell } from "@/components/nabalens/app-shell"
import { Row, RowList } from "@/components/nabalens/common-room/row"
import { SectionHeader } from "@/components/nabalens/common-room/section"
import { EmptyState } from "@/components/nabalens/empty-state"
import { ErrorState } from "@/components/nabalens/error-state"
import { Notice } from "@/components/nabalens/notice"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { GUIDE_PATH } from "@/components/nabalens/guide"
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
  listMySubmittablePhotos,
} from "@/lib/server/coverage"
import { periodKeyOf } from "@/lib/server/coverage/time"

import { myTasks, staffShellStatus } from "../../_shell/shell-status"
import { PORTFOLIO_PATH, TASKS_PATH, unwrap } from "../result"
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
  const icon = buttonVariants({
    variant: "secondary",
    size: "icon-lg",
    className: "w-full",
  })
  return (
    <div
      role="group"
      aria-label="Month"
      className="grid grid-cols-[minmax(3rem,1fr)_auto_minmax(3rem,1fr)] items-center gap-2 rounded-card bg-surface p-2 shadow-card"
    >
      <Link
        href={monthHref(previous, current)}
        aria-label={`Previous month, ${periodLabel(previous)}`}
        className={icon}
      >
        <CaretLeftIcon aria-hidden weight="bold" />
      </Link>
      <span
        aria-current={isCurrent ? "date" : undefined}
        className="px-2 text-center font-display text-item-title whitespace-nowrap text-ink"
      >
        {periodLabel(period)}
      </span>
      {isCurrent ? (
        <Button
          variant="secondary"
          size="icon-lg"
          disabled
          aria-label="Next month (not started)"
          className="w-full"
        >
          <CaretRightIcon aria-hidden weight="bold" />
        </Button>
      ) : (
        <Link
          href={monthHref(next, current)}
          aria-label={`Next month, ${periodLabel(next)}`}
          className={icon}
        >
          <CaretRightIcon aria-hidden weight="bold" />
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
  const [tasksResult, monthResult, photos, past, shellStatus] =
    await Promise.all([
      myTasks(actor),
      getMyMonth(actor, { period }),
      isCurrent
        ? listMySubmittablePhotos(actor, { requirementId: null, cursor: null })
        : null,
      isCurrent ? pastMonths(actor, current) : [],
      staffShellStatus(actor, profile),
    ])
  const { tasks } = unwrap(tasksResult)
  const { scope } = tasks

  const shell = (children: React.ReactNode) => (
    <AppShell
      variant="staff"
      active="tasks"
      {...shellStatus}
      userName={profile.displayName}
    >
      <OfflineNotice className="mb-4" />
      <div className="mx-auto flex w-full max-w-(--size-feed) flex-col gap-(--gutter)">
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
            className={buttonVariants({ size: "lg", className: "w-full" })}
          >
            Try again
          </Link>
        }
      />
    )
  }
  const { month, more } = monthResult
  const sentCount = more
    ? `${month.submissions.length}+ photos`
    : plural(month.submissions.length, "photo", "photos")

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
        <p className="max-w-(--size-reading) px-1 text-body text-ink-muted">
          Your manager sets your target for {label}. Until then, photos you add
          still go to Photos and your profile.
        </p>
      ) : null}
      {isCurrent && met && !setupPending ? (
        <p className="max-w-(--size-reading) px-1 text-body text-ink-muted">
          Photos you add now still go to Photos and your profile.
        </p>
      ) : null}

      {isCurrent ? (
        <section
          aria-labelledby="add-heading"
          className="flex scroll-mt-4 flex-col gap-(--gutter)"
        >
          <SectionHeader
            id="add-heading"
            title={
              replacing ? "Send another photo" : "Add photos for this month"
            }
            scope={
              <Link
                href={GUIDE_PATH}
                className="-my-1 inline-flex min-h-11 items-center gap-1 justify-self-start rounded-control text-label text-ink underline underline-offset-3 outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
              >
                How to photograph a dish
                <CaretRightIcon aria-hidden weight="bold" className="size-4" />
              </Link>
            }
          />
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

      <section
        aria-labelledby="sent-heading"
        className="flex flex-col gap-(--gutter)"
      >
        <SectionHeader
          id="sent-heading"
          title={`Sent for ${monthName(period)}`}
          action={
            month.submissions.length > 0 ? (
              <span className="text-body text-ink-muted">{sentCount}</span>
            ) : null
          }
        />
        {month.submissions.length > 0 ? (
          <>
            <SubmissionList
              label={`Sent for ${monthName(period)}`}
              submissions={month.submissions}
              showTask
              empty={null}
            />
            {more ? (
              <p className="max-w-(--size-reading) px-1 text-body text-ink-muted">
                These are your newest {month.submissions.length}. Every photo
                you sent is on{" "}
                <Link
                  href={PORTFOLIO_PATH}
                  className="inline-flex min-h-11 items-center rounded-control font-semibold text-ink underline underline-offset-3 outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
                >
                  Me
                </Link>
                .
              </p>
            ) : null}
          </>
        ) : (
          <EmptyState variant="done" title="No photos were sent this month." />
        )}
      </section>

      {isCurrent && past.length > 0 ? (
        <section
          aria-labelledby="past-heading"
          className="flex flex-col gap-(--gutter)"
        >
          <SectionHeader id="past-heading" title="Past months" />
          <RowList list>
            {past.map((m) => (
              <Row
                key={m.period}
                href={monthHref(m.period, current)}
                icon={<CalendarBlankIcon />}
                title={periodLabel(m.period)}
                subtitle={
                  <>
                    {m.accepted} of {m.target} accepted
                    {m.met ? " · Target met" : ""}
                  </>
                }
              />
            ))}
          </RowList>
        </section>
      ) : null}
    </>
  )
}
