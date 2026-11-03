import { logout } from "@/app/_media/actions"
import { AppShell } from "@/components/nabalens/app-shell"
import { Notice } from "@/components/nabalens/notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import {
  BackToTasks,
  openReplacementRequests,
  askerName,
  pickReplacement,
  ReplacementClosed,
  ReplacementNote,
  SubmissionList,
  submitBlockedCopy,
  TaskSummary,
  type MyAssignment,
  type CoverageScope,
} from "@/components/nabalens/tasks"
import { requireActiveStaff } from "@/lib/auth"
import {
  getCoverageActor,
  getCoverageScope,
  getMyAssignment,
  listMySubmittablePhotos,
} from "@/lib/server/coverage"
import { periodKeyOf } from "@/lib/server/coverage/time"
import { avatarUrl } from "@/lib/server/media/library"

import { TASKS_PATH, unwrap } from "../result"
import { TaskSubmit } from "../task-submit"

const monthFormatter = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  timeZone: "Europe/London",
})

export const metadata = { title: "Task · Naba-Lens" }

// finaliseUpload (Server Action used by the upload dialog on this page) decodes
// HEIC/images; same bound as /staff, below MEDIA_LIMITS.staleProcessingMinutes.
export const maxDuration = 120

function notOpenCopy(assignment: MyAssignment, scope: CoverageScope): string {
  if (!scope.canSubmit) return submitBlockedCopy(scope) ?? ""
  if (!assignment.assigned) {
    return "This task isn't assigned to you, so you can't send photos to it. You can still add photos for this month."
  }
  return "This task is closed to new photos. Photos you sent stay in your history."
}

export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ requirementId: string }>
  searchParams: Promise<{ replaces?: string | string[] }>
}) {
  const profile = await requireActiveStaff()
  const [{ requirementId }, search] = await Promise.all([params, searchParams])
  const { actor } = unwrap(await getCoverageActor())
  const [assignmentResult, scopeResult, photos] = await Promise.all([
    getMyAssignment(actor, { requirementId }),
    getCoverageScope(actor),
    listMySubmittablePhotos(actor, { requirementId, cursor: null }),
  ])
  const { assignment } = unwrap(assignmentResult)
  const { scope } = unwrap(scopeResult)
  const requested = typeof search.replaces === "string" ? search.replaces : null
  const open = pickReplacement(
    openReplacementRequests(assignment.mySubmissions),
    requested
  )
  const replacing = assignment.canSubmit ? open : null
  const closedRequest = !assignment.canSubmit && requested ? open : null
  const currentPeriod = periodKeyOf(new Date())

  return (
    <AppShell
      variant="staff"
      active="tasks"
      canManage={scope.canManageVenue}
      userName={profile.displayName}
      avatarUrl={avatarUrl(profile.id, profile.avatarPath)}
      logoutAction={logout}
    >
      <div className="flex flex-col gap-6 pb-4">
        <BackToTasks href={TASKS_PATH} />
        <OfflineNotice />
        {replacing || closedRequest ? (
          <PageHeader
            scope={[
              scope.venue?.name ?? null,
              monthFormatter.format(new Date()),
            ]}
            title="Send another photo"
          />
        ) : null}
        {closedRequest ? (
          <ReplacementClosed submission={closedRequest} homeHref={TASKS_PATH} />
        ) : (
          <TaskSummary
            assignment={assignment}
            monthLabel={monthFormatter.format(new Date())}
            venueName={scope.venue?.name ?? null}
            sendHref={assignment.canSubmit ? "#send" : undefined}
          />
        )}

        {closedRequest ? null : (
          <section
            id="send"
            aria-label="Send photos"
            className="flex scroll-mt-4 flex-col gap-4"
          >
            {assignment.canSubmit ? (
              <>
                {replacing ? (
                  <ReplacementNote
                    submission={replacing}
                    currentPeriod={currentPeriod}
                  />
                ) : null}
                <TaskSubmit
                  requirementId={assignment.requirement.id}
                  replacesSubmissionId={replacing?.id ?? null}
                  reviewerName={replacing ? askerName(replacing) : null}
                  initialPhotos={photos}
                />
              </>
            ) : (
              <Notice tone="plain">{notOpenCopy(assignment, scope)}</Notice>
            )}
          </section>
        )}

        <section aria-labelledby="mine-heading" className="flex flex-col gap-3">
          <h2 id="mine-heading" className="text-lg font-semibold">
            Your photos for this task
          </h2>
          <SubmissionList
            label="Your photos for this task"
            submissions={assignment.mySubmissions}
            empty="You haven't sent photos for this task yet."
          />
        </section>
      </div>
    </AppShell>
  )
}
