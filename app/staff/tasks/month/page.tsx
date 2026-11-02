import Link from "next/link"
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react/dist/ssr"

import { logout } from "@/app/_media/actions"
import { AppShell } from "@/components/nabalens/app-shell"
import {
  BackToTasks,
  isPeriodKey,
  MonthlyProgressCard,
  periodLabel,
  pickReplacement,
  ReplacementNote,
  shiftPeriod,
  SubmissionList,
  submitBlockedCopy,
} from "@/components/nabalens/tasks"
import { buttonVariants } from "@/components/ui/button"
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

function monthHref(period: string, current: string) {
  return period === current ? MONTH_PATH : `${MONTH_PATH}?period=${period}`
}

/**
 * Monthly photos (no task): this month's progress and sending, plus a
 * read-only history of earlier months with late acceptances and removed
 * evidence. Periods are London calendar months, computed on the server.
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
  const [tasksResult, monthResult, photos] = await Promise.all([
    getMyTasks(actor),
    getMyMonth(actor, { period }),
    isCurrent
      ? listMySubmittablePhotos(actor, { requirementId: null, cursor: null })
      : null,
  ])
  const { tasks } = unwrap(tasksResult)
  const { month } = unwrap(monthResult)
  const { scope } = tasks
  const requested = typeof search.replaces === "string" ? search.replaces : null
  const replacing =
    isCurrent && scope.canSubmit
      ? pickReplacement(
          tasks.needsAnotherPhoto.filter((s) => s.requirement === null),
          requested
        )
      : null
  const previous = shiftPeriod(period, -1)
  const next = shiftPeriod(period, 1)
  const blocked = submitBlockedCopy(scope)

  return (
    <AppShell
      variant="staff"
      active="tasks"
      canManage={scope.canManageVenue}
      userName={profile.displayName}
      logoutAction={logout}
    >
      <div className="flex flex-col gap-6">
        <BackToTasks href={TASKS_PATH} />
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-muted-foreground">
              Monthly photos
            </p>
            <h1 className="font-display text-page-title-compact md:text-page-title">
              {month.period.label}
            </h1>
          </div>
          <nav aria-label="Months" className="flex flex-wrap gap-2">
            <Link
              href={monthHref(previous, current)}
              className={buttonVariants({ variant: "outline", size: "touch" })}
            >
              <CaretLeftIcon data-icon="inline-start" aria-hidden />
              {periodLabel(previous)}
            </Link>
            {!isCurrent ? (
              <Link
                href={monthHref(next, current)}
                className={buttonVariants({
                  variant: "outline",
                  size: "touch",
                })}
              >
                {periodLabel(next)}
                <CaretRightIcon data-icon="inline-end" aria-hidden />
              </Link>
            ) : null}
          </nav>
        </div>

        {month.monthly.length > 0 ? (
          month.monthly.map((monthly) => (
            <MonthlyProgressCard
              key={monthly.venue.id}
              monthly={monthly}
              periodLabel={month.period.label}
              addHref={null}
              canSubmit={false}
              showVenue={month.monthly.length > 1}
            />
          ))
        ) : (
          <MonthlyProgressCard
            monthly={null}
            periodLabel={month.period.label}
            addHref={null}
            canSubmit={false}
          />
        )}

        {isCurrent ? (
          <section
            aria-labelledby="add-heading"
            className="flex flex-col gap-4"
          >
            <h2 id="add-heading" className="text-lg font-semibold">
              Add photos for this month
            </h2>
            {scope.canSubmit && photos ? (
              <>
                {replacing ? <ReplacementNote submission={replacing} /> : null}
                <TaskSubmit
                  requirementId={null}
                  replacesSubmissionId={replacing?.id ?? null}
                  initialPhotos={photos}
                />
              </>
            ) : (
              <p className="rounded-md border bg-muted/40 px-4 py-3 text-sm">
                {blocked}
              </p>
            )}
          </section>
        ) : (
          <p className="text-sm text-muted-foreground">
            Earlier months are read-only. A photo accepted after its month ended
            still counts for the month it was sent.
          </p>
        )}

        <section aria-labelledby="sent-heading" className="flex flex-col gap-3">
          <h2 id="sent-heading" className="text-lg font-semibold">
            Photos sent in {month.period.label}
          </h2>
          <SubmissionList
            label={`Photos sent in ${month.period.label}`}
            submissions={month.submissions}
            showTask
            empty="No photos were sent this month."
          />
        </section>
      </div>
    </AppShell>
  )
}
