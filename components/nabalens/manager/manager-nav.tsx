"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ForkKnifeIcon,
  HouseIcon,
  ImagesIcon,
  ListChecksIcon,
} from "@phosphor-icons/react/dist/ssr"

import { UI_TEXT, amenityHrefs } from "@/lib/amenities/contract"
import { cn } from "@/lib/utils"

import { SectionTabs } from "../section-tabs"
import { TAB_ITEM } from "../shell/tab-item"
import { TO_CONFIRM_COPY } from "../knowledge/copy"
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
  {
    id: "amenities",
    label: UI_TEXT.navTab,
    href: amenityHrefs(managerHrefs.overview).list,
    icon: ListChecksIcon,
  },
]

/**
 * Overview · Review · Menu · Amenities. `tabs` is the row under the header
 * from md; `bar` is the phone tab bar pinned to the bottom. Both name the same
 * nav, and CSS shows one. There is no Add slot: managers do not upload.
 */
export function ManagerNav({
  kind,
  reviewCount,
  confirmCount,
}: {
  kind: "tabs" | "bar"
  /** Photos waiting for this manager's decision, shown on Review (the provider's count wins). */
  reviewCount?: number
  /** Amenity findings and answers waiting for a decision, shown on Amenities. */
  confirmCount?: number
}) {
  const active = managerSectionFor(usePathname() ?? "") ?? ""
  const shared = useReviewCount().count ?? reviewCount
  const count = shared && shared > 0 ? shared : undefined
  const confirm = confirmCount && confirmCount > 0 ? confirmCount : undefined
  const badgeFor = (id: ManagerSection) =>
    id === "review" && count
      ? { value: count, label: MANAGER_COPY.reviewBadge(count) }
      : id === "amenities" && confirm
        ? { value: confirm, label: TO_CONFIRM_COPY.badge(confirm) }
        : undefined

  if (kind === "tabs") {
    return (
      <SectionTabs
        label={MANAGER_COPY.navLabel}
        active={active}
        tabs={ITEMS.map((item) => ({
          id: item.id,
          label: item.label,
          href: item.href,
          count: badgeFor(item.id),
        }))}
        className="border-b-0"
      />
    )
  }

  return (
    <nav
      aria-label={MANAGER_COPY.navLabel}
      data-slot="tabbar"
      className="fixed inset-x-0 bottom-0 z-40 grid auto-cols-fr grid-flow-col bg-surface px-1 pb-[env(safe-area-inset-bottom,0px)] shadow-[0_-1px_0_var(--line)] md:hidden"
    >
      {ITEMS.map((item) => {
        const Icon = item.icon
        const current = active === item.id
        const badge = badgeFor(item.id)
        return (
          <Link
            key={item.id}
            href={item.href}
            data-nav-item
            aria-current={current ? "page" : undefined}
            className={cn(
              TAB_ITEM,
              "text-ink-muted hover:bg-surface-2 hover:text-ink",
              // Active tab: accent-text, 800, a 3px bar along the top.
              current &&
                "font-extrabold text-accent-text before:absolute before:inset-x-[18%] before:top-0 before:h-[3px] before:rounded-b-[3px] before:bg-accent-text hover:text-accent-text"
            )}
          >
            <Icon aria-hidden className="size-[26px]" />
            {item.label}
            {badge ? (
              <CountBadge
                count={badge.value}
                label={badge.label}
                tone="warn"
                className="absolute top-1 left-[calc(50%+6px)] ring-2 ring-surface"
              />
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}
