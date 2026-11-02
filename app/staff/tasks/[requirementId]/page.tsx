import { logout } from "@/app/_media/actions"
import { AppShell } from "@/components/nabalens/app-shell"
import {
  BackToTasks,
  openReplacementRequests,
  pickReplacement,
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

import { TASKS_PATH, unwrap } from "../result"
import { TaskSubmit } from "../task-submit"

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
  const replacing = assignment.canSubmit
    ? pickReplacement(
        openReplacementRequests(assignment.mySubmissions),
        requested
      )
    : null

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
        <TaskSummary assignment={assignment} />

        <section aria-labelledby="send-heading" className="flex flex-col gap-4">
          <h2 id="send-heading" className="text-lg font-semibold">
            Send photos
          </h2>
          {assignment.canSubmit ? (
            <>
              {replacing ? <ReplacementNote submission={replacing} /> : null}
              <TaskSubmit
                requirementId={assignment.requirement.id}
                replacesSubmissionId={replacing?.id ?? null}
                initialPhotos={photos}
              />
            </>
          ) : (
            <p className="rounded-md border bg-muted/40 px-4 py-3 text-sm">
              {notOpenCopy(assignment, scope)}
            </p>
          )}
        </section>

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
