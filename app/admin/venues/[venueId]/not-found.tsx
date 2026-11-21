import { AppShell } from "@/components/nabalens/app-shell"
import { BackLink } from "@/components/nabalens/back-link"
import { NotFoundCard } from "@/components/nabalens/not-found-card"

/** An unknown venue: Venues stays lit, and the way back is Venues. */
export default function AdminVenueNotFound() {
  return (
    <AppShell variant="admin" active="venues">
      <div className="grid gap-4">
        <BackLink href="/admin/venues" compact>
          Venues
        </BackLink>
        <NotFoundCard backHref="/admin/venues" backLabel="Go to Venues" />
      </div>
    </AppShell>
  )
}
