import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { AppShell } from "@/components/nabalens/app-shell"
import { TasksOverview } from "@/components/nabalens/tasks"

import { FAKE_MEDIA } from "../fixtures"
import {
  HOME_AMENITY_TASKS,
  HOME_OUR_MENU,
  HOME_PROFILE,
  homeTasksView,
} from "./home-fixtures"

export const metadata: Metadata = {
  title: "Staff Home preview (dev only)",
  robots: { index: false, follow: false },
}

/**
 * Dev-only harness: the real staff Home (AppShell + TasksOverview) with every
 * section filled from fake data, no session or database. 404 in production.
 * `?notices=1` adds the transient "photos sent" and "finding sent" notices.
 */
export default async function HomePreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ notices?: string }>
}) {
  if (process.env.NODE_ENV === "production") notFound()
  const notices = (await searchParams).notices === "1"
  const tasks = homeTasksView()
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
        colleagues={FAKE_MEDIA.filter((m) => m.uploadState === "ready").slice(
          0,
          6
        )}
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
}
