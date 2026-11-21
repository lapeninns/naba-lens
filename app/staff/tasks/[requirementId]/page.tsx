import { STAFF_PHOTO_ROUTES } from "@/lib/config/album-upload-tray"
import { redirect } from "next/navigation"

import { AppShell } from "@/components/nabalens/app-shell"
import { TaskPhotoGuide } from "@/components/nabalens/guide"
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
  SECTION_SEND_COPY,
  SubmissionList,
  submitBlockedCopy,
  TaskSummary,
  type MyAssignment,
  type CoverageScope,
} from "@/components/nabalens/tasks"
import { requireActiveStaff } from "@/lib/auth"
import { showsDishGuide, suggestedAngles } from "@/lib/guide/dish-guide"
import {
  getCoverageActor,
  getCoverageScope,
  getMyAssignment,
  listMySubmittablePhotos,
} from "@/lib/server/coverage"
import {
  getMyRequirementRoute,
  menuSectionHref,
} from "@/lib/server/coverage/requirement-route"
import { periodKeyOf } from "@/lib/server/coverage/time"

import { staffShellStatus } from "../../_shell/shell-status"
import { TASKS_PATH, unwrap } from "../result"
import { backFrom } from "../back-from"
import { TaskSubmit } from "../task-submit"

const monthFormatter = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  timeZone: "Europe/London",
})

export const metadata = { title: "Task" }

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
  searchParams: Promise<{
    replaces?: string | string[]
    from?: string | string[]
  }>
}) {
  const profile = await requireActiveStaff()
  const [{ requirementId }, search] = await Promise.all([params, searchParams])
  const { actor } = unwrap(await getCoverageActor())
  const requested = typeof search.replaces === "string" ? search.replaces : null
  // Menu work lives on Our menu (G-4, decision 15): a menu-section task is
  // served only to answer an open "needs another photo" request.
  const { route } = unwrap(
    await getMyRequirementRoute(actor, { requirementId })
  )
  const menuSection = route.kind === "menu_section"
  if (menuSection && !requested) redirect(menuSectionHref(route.menuSectionId))
  const [assignmentResult, scopeResult, photos, shell] = await Promise.all([
    getMyAssignment(actor, { requirementId }),
    getCoverageScope(actor),
    listMySubmittablePhotos(actor, { requirementId, cursor: null }),
    staffShellStatus(actor, profile),
  ])
  const { assignment } = unwrap(assignmentResult)
  const { scope } = unwrap(scopeResult)
  const open = pickReplacement(
    openReplacementRequests(assignment.mySubmissions),
    requested
  )
  if (menuSection && !open) redirect(menuSectionHref(route.menuSectionId))
  const replacing = assignment.canSubmit ? open : null
  const closedRequest = !assignment.canSubmit && requested ? open : null
  const currentPeriod = periodKeyOf(new Date())
  const guide = showsDishGuide(assignment.requirement) ? (
    <TaskPhotoGuide
      photoTarget={assignment.requirement.photoTarget}
      suggested={suggestedAngles(assignment.requirement.photoTarget)}
    />
  ) : null
  // Menu work never says "task" on staff screens.
  const mineCopy = menuSection
    ? SECTION_SEND_COPY
    : {
        heading: "Your photos for this task",
        empty: "You haven't sent photos for this task yet.",
      }
  const back = backFrom(search.from, `${TASKS_PATH}/${requirementId}`)

  return (
    <AppShell
      variant="staff"
      active="tasks"
      {...shell}
      userName={profile.displayName}
    >
      <div className="mx-auto flex w-full max-w-feed flex-col gap-gutter pb-4">
        <BackToTasks {...back} />
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
          <ReplacementClosed submission={closedRequest} homeHref={STAFF_PHOTO_ROUTES.home} />
        ) : menuSection ? (
          // No task post (title, due, Overdue) for menu work: the request
          // above says what to retake, and the guide still helps.
          guide
        ) : (
          <TaskSummary
            assignment={assignment}
            monthLabel={monthFormatter.format(new Date())}
            venueName={scope.venue?.name ?? null}
            sendHref={assignment.canSubmit ? "#send" : undefined}
            guide={guide}
          />
        )}

        {closedRequest ? null : (
          <section
            id="send"
            aria-label="Send photos"
            className="flex scroll-mt-4 flex-col gap-gutter"
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
                  taskTitle={assignment.requirement.title}
                  venueName={scope.venue?.name ?? null}
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

        <section
          aria-labelledby="mine-heading"
          className="flex flex-col gap-gutter"
        >
          <h2
            id="mine-heading"
            className="px-1 pt-2 type-section-title text-ink"
          >
            {mineCopy.heading}
          </h2>
          <SubmissionList
            variant="post"
            label={mineCopy.heading}
            submissions={assignment.mySubmissions}
            empty={mineCopy.empty}
          />
        </section>
      </div>
    </AppShell>
  )
}
