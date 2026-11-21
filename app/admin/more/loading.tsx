import { AdminLoadingPage } from "../_components/admin-boundary"

/** The seven sections' rows, while the More page loads (redesign R5). */
export default function AdminMoreLoading() {
  return (
    <AdminLoadingPage
      section="more"
      title="All sections"
      label="Loading all sections…"
      rows={7}
    />
  )
}
