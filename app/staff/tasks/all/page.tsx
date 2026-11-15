import { redirect } from "next/navigation"

import { OTHER_JOBS_PATH } from "../result"

/** All tasks became Other jobs (G-4); older links still land there. */
export default function AllTasksPage(): never {
  redirect(OTHER_JOBS_PATH)
}
