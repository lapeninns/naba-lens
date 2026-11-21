import { STAFF_PHOTO_ROUTES } from "@/lib/config/album-upload-tray"
import { dismissClosedAssignmentAction } from "@/app/_knowledge/actions"
import { AppShell } from "@/components/nabalens/app-shell"
import { WorkingListSection } from "@/components/nabalens/knowledge/working-list"
import { Notice } from "@/components/nabalens/notice"
import { PageHeader } from "@/components/nabalens/page-header"
import {
  AllTasks,
  BackToTasks,
  HOME_READ_FAILED,
  OTHER_JOBS_COPY,
  otherJobs,
} from "@/components/nabalens/tasks"
import { recheckCards } from "@/components/nabalens/tasks/next-actions-model"
import { RecheckCards } from "@/components/nabalens/tasks/next-actions"
import { requireActiveStaff } from "@/lib/auth"
import { withWorkingListEntrances } from "@/lib/knowledge-client/entrances"
import { getCoverageActor } from "@/lib/server/coverage"

import {
  myAmenityTasks,
  myRechecks,
  myTasks,
  myWorkingList,
  staffShellStatus,
} from "../../_shell/shell-status"
import { TASKS_PATH, unwrap } from "../result"

export const metadata = { title: "Other jobs" }

/**
 * Other jobs (decisions 8 and 10, docs/plans/goals-not-tasks.md): the
 * service, venue-specific and amenity tasks and amenity checks assigned to me,
 * with their due dates (rule 28), and the venue's working-list questions,
 * including those waiting on me. Menu sections are left out: menu work is on
 * Our menu, and Home links here only when there is something to list.
 */
export default async function OtherJobsPage() {
  const profile = await requireActiveStaff()
  const { actor } = unwrap(await getCoverageActor())
  const [{ tasks }, amenityTasks, shell, workingList, rechecks] =
    await Promise.all([
      myTasks(actor).then(unwrap),
      myAmenityTasks(actor),
      staffShellStatus(actor, profile),
      myWorkingList(actor),
      myRechecks(actor),
    ])
  // A step-free Yes names its entrances here too (B03 UI §3.5).
  const listed = workingList
    ? await withWorkingListEntrances(actor, workingList)
    : workingList

  return (
    <AppShell
      variant="staff"
      active="tasks"
      {...shell}
      userName={profile.displayName}
    >
      <div className="mx-auto flex w-full max-w-feed flex-col gap-gutter pb-4">
        <BackToTasks href={STAFF_PHOTO_ROUTES.home} />
        <PageHeader
          scope={[tasks.scope.venue?.name, tasks.period.label]}
          venueScope={Boolean(tasks.scope.venue)}
          title={OTHER_JOBS_COPY.title}
          summary={OTHER_JOBS_COPY.summary}
        />
        {/* B03-e: my open rechecks lead, each with its server-given cause. */}
        {rechecks === null ? (
          <Notice tone="attention" role="status">
            {HOME_READ_FAILED.rechecks}
          </Notice>
        ) : (
          <RecheckCards
            label={OTHER_JOBS_COPY.rechecks}
            checks={recheckCards({
              rechecks,
              slots: workingList?.slots ?? [],
              amenityChecks: amenityTasks ?? [],
            })}
          />
        )}
        <AllTasks
          tasks={otherJobs(tasks)}
          tasksPath={TASKS_PATH}
          amenityTasks={amenityTasks}
        />
        {listed === undefined ? (
          <Notice tone="attention" role="status">
            {HOME_READ_FAILED.otherJobs}
          </Notice>
        ) : listed ? (
          <WorkingListSection
            list={listed}
            onDismiss={dismissClosedAssignmentAction}
          />
        ) : null}
      </div>
    </AppShell>
  )
}
