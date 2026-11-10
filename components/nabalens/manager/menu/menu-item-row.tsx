import Link from "next/link"
import {
  CameraIcon,
  ImageIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr"

import { EvidenceThumb } from "@/components/nabalens/coverage/evidence-image"
import { StatusChip, type ChipTone } from "@/components/nabalens/status-chip"

import type {
  ManagerMenuItem,
  MenuItemStatus,
} from "@/lib/server/menu-photos/types"

import { MANAGER_COPY } from "../copy"
import { ManagerDishButtons } from "./dish-buttons"

const HEADLINE: Record<MenuItemStatus, { word: string; tone: ChipTone }> = {
  covered: { word: MANAGER_COPY.menu.status.covered, tone: "positive" },
  awaiting_review: {
    word: MANAGER_COPY.menu.status.awaiting_review,
    tone: "pending",
  },
  needs_photo: { word: MANAGER_COPY.menu.status.needs_photo, tone: "neutral" },
}

/** The item's headline chip: Has a photo, Awaiting review or Still needs a photo. */
export function MenuStatusChip({ status }: { status: MenuItemStatus }) {
  const { word, tone } = HEADLINE[status] ?? HEADLINE.needs_photo
  return (
    <StatusChip tone={tone}>
      {status === "covered" ? (
        // An ok outline square with a photo icon: never the filled tick
        // square, which is Accepted's alone (DESIGN.md §3).
        <ImageIcon aria-hidden className="size-4" />
      ) : null}
      {word}
    </StatusChip>
  )
}

/** Secondary chips: a newer photo waiting, a recheck, the caller's own photo. */
export function MenuItemChips({ item }: { item: ManagerMenuItem }) {
  const copy = MANAGER_COPY.menu
  return (
    <>
      {item.hasPendingReplacement ? (
        <StatusChip tone="pending">{copy.replacementChip}</StatusChip>
      ) : null}
      {item.needsRecheck ? (
        <StatusChip tone="attention">
          <WarningIcon aria-hidden />
          {copy.recheckChip}
        </StatusChip>
      ) : null}
      {item.ownWaiting > 0 ? (
        <StatusChip tone="closed">{copy.ownWaiting}</StatusChip>
      ) : null}
    </>
  )
}

/**
 * One active-menu item on Menu: the menu photo's thumbnail, the name (never
 * truncated) and options, the headline state and secondary chips. The whole
 * row opens the item. While the workspace's Add offers dishes (B02-c), the
 * row also has the dish's photo buttons, as on Our menu.
 */
export function MenuItemRow({
  item,
  href,
}: {
  item: ManagerMenuItem
  href: string
}) {
  const variants = item.variants.map((v) => v.name).join(", ")
  const nameId = `menu-item-${item.itemId}-name`
  return (
    <article className="relative grid min-h-16 grid-cols-[3.5rem_minmax(0,1fr)] gap-3 py-3">
      {item.preferred ? (
        <EvidenceThumb
          src={item.preferred.thumbnailUrl}
          className="aspect-square w-14 rounded-control"
        />
      ) : (
        <span
          aria-hidden
          className="grid aspect-square w-14 place-items-center rounded-control border-2 border-dashed border-border-strong text-ink-muted"
        >
          <CameraIcon className="size-6" />
        </span>
      )}
      <div className="grid min-w-0 content-start gap-1">
        <h3 id={nameId} className="text-item-title break-words text-ink">
          <Link
            href={href}
            className="rounded-control outline-none after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
          >
            {item.name}
          </Link>
        </h3>
        {variants ? (
          <p className="text-meta break-words text-ink-muted">{variants}</p>
        ) : null}
        <p className="flex flex-wrap items-center gap-1.5">
          <MenuStatusChip status={item.status} />
          <MenuItemChips item={item} />
        </p>
      </div>
      <ManagerDishButtons item={item} describedBy={nameId} />
    </article>
  )
}

/** Shared list class: rows split by hairlines inside the section's card. */
export const MENU_LIST_CLASS = "divide-y divide-line px-3 sm:px-4"
