import type { Metadata } from "next"
import Link from "next/link"
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr"

import { ADMIN_NAV, AppShell } from "@/components/nabalens/app-shell"
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
          <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
            {ADMIN_NAV.map((item) => {
              const Icon = item.icon
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    data-testid={`admin-more-${item.id}`}
                    className="grid min-h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 focus-ring-inset outline-none hover:bg-surface-2"
                  >
                    <Icon aria-hidden className="size-6 text-ink-muted" />
                    <span className="grid min-w-0 gap-0.5">
                      <span className="text-label text-ink">
                        {item.fullLabel}
                      </span>
                      <span className="text-meta text-ink-muted">
                        {item.description}
                      </span>
                    </span>
                    <CaretRightIcon
                      aria-hidden
                      className="size-5 text-ink-muted"
                    />
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      </div>
    </AppShell>
  )
}
