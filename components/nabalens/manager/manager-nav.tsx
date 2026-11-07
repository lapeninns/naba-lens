"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ForkKnifeIcon,
  HouseIcon,
  ImagesIcon,
} from "@phosphor-icons/react/dist/ssr"

import { cn } from "@/lib/utils"

import { SectionTabs } from "../section-tabs"
import { TAB_ITEM } from "../shell/add-context"
import { CountBadge } from "../status-chip"
import { MANAGER_COPY } from "./copy"
import { managerHrefs, managerSectionFor, type ManagerSection } from "./hrefs"
import { useReviewCount } from "./review-count"

const ITEMS: {
  id: ManagerSection
  label: string
  href: string
  icon: typeof HouseIcon
}[] = [
  {
    id: "overview",
    label: "Overview",
    href: managerHrefs.overview,
    icon: HouseIcon,
  },
  {
    id: "review",
    label: "Review",
    href: managerHrefs.review(),
    icon: ImagesIcon,
  },
  { id: "menu", label: "Menu", href: managerHrefs.menu(), icon: ForkKnifeIcon },
]

/**
 * Overview · Review · Menu. `tabs` is the row under the header from md;
 * `bar` is the phone tab bar pinned to the bottom. Both name the same nav, and
 * CSS shows one. There is no Add slot: managers do not upload.
 */
export function ManagerNav({
  kind,
  reviewCount,
}: {
  kind: "tabs" | "bar"
  /** Photos waiting for this manager's decision, shown on Review (the provider's count wins). */
  reviewCount?: number
}) {
  const active = managerSectionFor(usePathname() ?? "") ?? ""
  const shared = useReviewCount().count ?? reviewCount
  const count = shared && shared > 0 ? shared : undefined

  if (kind === "tabs") {
    return (
      <SectionTabs
        label={MANAGER_COPY.navLabel}
        active={active}
        tabs={ITEMS.map((item) => ({
          id: item.id,
          label: item.label,
          href: item.href,
          count:
            item.id === "review" && count
              ? { value: count, label: MANAGER_COPY.reviewBadge(count) }
              : undefined,
        }))}
        className="border-b-0"
      />
    )
  }

  return (
    <nav
      aria-label={MANAGER_COPY.navLabel}
      data-slot="tabbar"
      className="fixed inset-x-0 bottom-0 z-40 grid auto-cols-fr grid-flow-col border-t border-line bg-panel pb-[env(safe-area-inset-bottom,0px)] md:hidden"
    >
      {ITEMS.map((item) => {
        const Icon = item.icon
        const current = active === item.id
        const badge = item.id === "review" ? count : undefined
        return (
          <Link
            key={item.id}
            href={item.href}
            data-nav-item
            aria-current={current ? "page" : undefined}
            className={cn(
              TAB_ITEM,
              "min-h-11 text-ink-muted hover:text-ink",
              current &&
                "text-accent-text before:absolute before:inset-x-[24%] before:-top-px before:h-0.5 before:rounded-b-[2px] before:bg-accent hover:text-accent-text"
            )}
          >
            <Icon aria-hidden className="size-[26px]" />
            {item.label}
            {badge ? (
              <CountBadge
                count={badge}
                label={MANAGER_COPY.reviewBadge(badge)}
                className="absolute top-1.5 left-[calc(50%+6px)]"
              />
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}
