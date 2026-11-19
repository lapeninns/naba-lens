import type { Metadata } from "next"

import { ADMIN_NAV, AppShell } from "@/components/nabalens/app-shell"
import { Row, RowList } from "@/components/nabalens/common-room/row"
import { PageHeader } from "@/components/nabalens/page-header"
import { requireActiveAdmin } from "@/lib/auth"

export const metadata: Metadata = { title: "More" }

/**
 * Every admin section by the spec's name (§8 intro), for phones and tablets,
 * whose tab bar holds three of them and More. Desktop shows all seven in the
 * bar; this page still works there.
 */
export default async function AdminMorePage() {
  const profile = await requireActiveAdmin()
  return (
    <AppShell variant="admin" active="more" userName={profile.displayName}>
      <div className="flex flex-col gap-6">
        <PageHeader
          scope="All venues"
          title="All sections"
          className="pb-0 md:pb-0"
        />
        <nav aria-label="All sections">
          <RowList list>
            {ADMIN_NAV.map((item) => {
              const Icon = item.icon
              return (
                <Row
                  key={item.id}
                  href={item.href}
                  data-testid={`admin-more-${item.id}`}
                  icon={<Icon />}
                  title={item.fullLabel}
                  subtitle={item.description}
                />
              )
            })}
          </RowList>
        </nav>
      </div>
    </AppShell>
  )
}
