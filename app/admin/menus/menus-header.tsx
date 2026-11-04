import { MENUS_SUMMARY_COPY } from "@/components/nabalens"
import { PageHeader } from "@/components/nabalens/page-header"

/** A12's header, shared by the page and its loading state. */
export function MenusHeader() {
  return (
    <PageHeader
      scope="All venues"
      venueScope
      title="Menus"
      summary={MENUS_SUMMARY_COPY}
    />
  )
}
