import { AppShell } from "@/components/nabalens/app-shell"
import { NotFoundCard } from "@/components/nabalens/not-found-card"

export default function AdminVenueNotFound() {
  return (
    <AppShell variant="admin" active="venues">
      <NotFoundCard backHref="/admin/venues" backLabel="Go to Venues" />
    </AppShell>
  )
}
