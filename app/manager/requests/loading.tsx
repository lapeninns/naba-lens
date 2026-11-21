import { ManagerWorkspaceLoading } from "@/components/nabalens/manager/workspace-loading"

/** Requests loading: the real title, sunken filter chips and rows. */
export default function ManagerRequestsLoading() {
  return (
    <ManagerWorkspaceLoading
      label="Loading requests"
      title="Requests"
      chips={3}
    />
  )
}
