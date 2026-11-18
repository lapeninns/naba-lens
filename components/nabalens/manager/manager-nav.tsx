"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ClipboardTextIcon,
  HouseIcon,
  ImagesIcon,
  SquaresFourIcon,
  StorefrontIcon,
} from "@phosphor-icons/react/dist/ssr"

import { cn } from "@/lib/utils"

import { SectionTabs } from "../section-tabs"
import { SideNav } from "../side-nav"
import { AddTrigger, useAddContext } from "../shell/add-context"
import { TabBadge } from "../shell/tab-badge"
import { TAB_ITEM } from "../shell/tab-item"
import { TO_CONFIRM_COPY } from "../knowledge/copy"
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
  {
    id: "album",
    label: "Album",
    href: managerHrefs.menu(),
    icon: SquaresFourIcon,
  },
  {
    id: "requests",
    label: "Requests",
    href: managerHrefs.requests,
    icon: ClipboardTextIcon,
  },
  {
    id: "venue",
    label: "Venue",
    href: managerHrefs.venue,
    icon: StorefrontIcon,
  },
]

/**
 * Overview · Review · Album · Requests · Venue (spec §7, S2-MGR). `rail` is
 * v2's SideNav from bp-desktop (1100px); `tabs` is the row under the header
 * from md to desktop; `bar` is the phone tab bar pinned to the bottom. All
 * name the same nav, and CSS shows one. Five tabs fill the phone
 * bar at 320px, so Add is in the header at every width while the workspace's
 * Add is on (R8 says this account can upload): ManagerAddButton (departure
 * A-M1 in docs/design-system/departures.md). Album's badge counts the amenity
 * findings waiting for a decision (they live under Album).
 */
export function ManagerNav({
  kind,
  reviewCount,
  confirmCount,
}: {
  kind: "rail" | "tabs" | "bar"
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
      : id === "album" && confirm
        ? { value: confirm, label: TO_CONFIRM_COPY.badge(confirm) }
        : undefined

  if (kind === "rail") {
    return (
      <SideNav
        label={MANAGER_COPY.navLabel}
        active={active}
        homeHref={managerHrefs.overview}
        items={ITEMS.map((item) => {
          const badge = badgeFor(item.id)
          return {
            ...item,
            count: badge
              ? { value: badge.value, label: badge.label }
              : undefined,
          }
        })}
      />
    )
  }

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
      className="fixed inset-x-0 bottom-0 z-nav grid auto-cols-fr grid-flow-col bg-surface pr-[max(0.25rem,env(safe-area-inset-right,0px))] pb-[env(safe-area-inset-bottom,0px)] pl-[max(0.25rem,env(safe-area-inset-left,0px))] shadow-bar md:hidden"
    >
      {ITEMS.map((item) => {
        const Icon = item.icon
        const current = active === item.id
        const badge = badgeFor(item.id)
        const link = (
          <Link
            key={item.id}
            href={item.href}
            data-nav-item
            aria-current={current ? "page" : undefined}
            className={cn(
              TAB_ITEM,
              // Five tabs share the phone bar (v2 TabBar for managers): the
              // v2 caption label fits a fifth of the bar at 320px.
              "px-0",
              "text-ink-muted hover:bg-raised hover:text-ink",
              // Active tab (v2): bottle, a 3px bar along the top edge.
              current &&
                "text-accent-text before:absolute before:inset-x-1/4 before:top-0 before:h-[3px] before:rounded-b-[3px] before:bg-accent-text hover:text-accent-text"
            )}
          >
            <Icon aria-hidden className="size-6" />
            {item.label}
            {badge ? (
              <TabBadge count={badge.value} label={badge.label} />
            ) : null}
          </Link>
        )
        return link
      })}
    </nav>
  )
}

/**
 * "Add photos" in the header while the workspace's Add is on: a button from
 * md, the Add tab item (icon over its label) on phones, where the bottom bar
 * holds the five tabs.
 */
export function ManagerAddButton() {
  return useAddContext() ? (
    <>
      <div className="hidden md:block">
        <AddTrigger kind="bar" />
      </div>
      <div data-slot="manager-add-compact" className="-my-2 md:hidden">
        <AddTrigger kind="tab" />
      </div>
    </>
  ) : null
}
