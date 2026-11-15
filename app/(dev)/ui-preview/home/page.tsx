import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { AppShell } from "@/components/nabalens/app-shell"
import { GoalsHome } from "@/components/nabalens/home/goals-home"
import { TasksOverview } from "@/components/nabalens/tasks"

import { FAKE_MEDIA } from "../fixtures"
import {
  GOALS_LABEL_WORK,
  GOALS_RETAKE_NOTES,
  GOALS_STATES,
  goalsOurMenu,
  HOME_AMENITY_TASKS,
  HOME_OUR_MENU,
  HOME_PROFILE,
  homeTasksView,
  type GoalsPreviewState,
} from "./home-fixtures"

export const metadata: Metadata = {
  title: "Staff Home preview (dev only)",
  robots: { index: false, follow: false },
}

const isGoalsState = (value: string | undefined): value is GoalsPreviewState =>
  (GOALS_STATES as readonly string[]).includes(value ?? "")

/**
 * Dev-only harness: the real staff Home with every section filled from fake
 * data, no session or database. 404 in production. The goal-led Home is the
 * default; `?state=` picks one of GOALS_STATES (ready, retake, recheck,
 * complete, no_menu, empty, unavailable, needs_setup, blocked).
 * `?layout=b01` shows the B01 Home kept as a rollback. `?notices=1` adds the
 * transient "photos sent" and "finding sent" notices.
 */
export default async function HomePreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ notices?: string; layout?: string; state?: string }>
}) {
  if (process.env.NODE_ENV === "production") notFound()
  const params = await searchParams
  const notices = params.notices === "1"
  const tasks = homeTasksView()
  const colleagues = FAKE_MEDIA.filter((m) => m.uploadState === "ready").slice(
    0,
    6
  )

  if (params.layout === "b01")
    return (
      <AppShell
        variant="staff"
        active="tasks"
        userName={HOME_PROFILE.displayName}
        canManage
        reviewCount={3}
        todoCount={5}
      >
        <TasksOverview
          tasks={tasks}
          profile={HOME_PROFILE}
          tasksPath="/staff/tasks"
          portfolioPath="/staff"
          reviewCount={3}
          justSent={
            notices ? { kind: "sent", count: 2, taskTitle: "Starters" } : null
          }
          colleagues={colleagues}
          welcomeHref="/staff/tasks/welcome"
          contribute={{
            prompt: "What did you pour or serve today?",
            blocked: null,
          }}
          ourMenu={HOME_OUR_MENU}
          amenityTasks={HOME_AMENITY_TASKS}
          findingSent={notices ? "Is there guest Wi-Fi?" : null}
        />
      </AppShell>
    )

  const state = isGoalsState(params.state) ? params.state : "ready"
  const needsSetup = state === "needs_setup"
  const scope = needsSetup
    ? {
        ...tasks.scope,
        venue: null,
        canSubmit: false,
        setup: { complete: false, missing: ["venue" as const] },
      }
    : tasks.scope
  const notes = state === "retake" ? GOALS_RETAKE_NOTES : []
  const labels = state === "retake" ? GOALS_LABEL_WORK : null
  // Setup, the retake note, labels, Other jobs and Photos to review: never
  // dishes.
  const badge =
    (needsSetup ? 1 : 0) + (notes.length > 0 ? 1 : 0) + (labels ? 1 : 0) + 2
  return (
    <AppShell
      variant="staff"
      active="tasks"
      userName={HOME_PROFILE.displayName}
      canManage
      reviewCount={3}
      todoCount={badge}
    >
      <GoalsHome
        scope={scope}
        period={tasks.period}
        profile={
          needsSetup ? { ...HOME_PROFILE, venueName: null } : HOME_PROFILE
        }
        monthly={tasks.monthly}
        ourMenu={goalsOurMenu(state)}
        notes={notes}
        labels={labels}
        otherJobs={HOME_AMENITY_TASKS.length + 1}
        reviewCount={3}
        canAdd={!needsSetup && state !== "blocked"}
        blocked={
          state === "blocked"
            ? "Your venue isn't taking photos right now, so you can't add any. Ask an admin to check your venue."
            : null
        }
        welcomeHref="/staff/tasks/welcome"
        justSent={
          notices ? { kind: "sent", count: 2, taskTitle: "Starters" } : null
        }
        findingSent={notices ? "Is there guest Wi-Fi?" : null}
        colleagues={colleagues}
        tasksPath="/staff/tasks"
        portfolioPath="/staff"
        otherJobsHref="/staff/tasks/other"
      />
    </AppShell>
  )
}
