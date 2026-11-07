import Link from "next/link"
import {
  CameraIcon,
  CheckCircleIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr"

import { EvidenceThumb } from "@/components/nabalens/coverage/evidence-image"
import { StatusChip, type ChipTone } from "@/components/nabalens/status-chip"

import type {
  ManagerMenuItem,
  MenuItemStatus,
} from "@/lib/server/menu-photos/types"

import { MANAGER_COPY } from "../copy"

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
        <CheckCircleIcon aria-hidden className="size-3.5" />
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
 * row opens the item.
 */
export function MenuItemRow({
  item,
  href,
}: {
  item: ManagerMenuItem
  href: string
}) {
  const variants = item.variants.map((v) => v.name).join(", ")
  return (
    <article className="relative grid grid-cols-[4rem_minmax(0,1fr)] gap-3 py-3">
      {item.preferred ? (
        <EvidenceThumb
          src={item.preferred.thumbnailUrl}
          className="aspect-square w-16"
        />
      ) : (
        <span
          aria-hidden
          className="grid aspect-square w-16 place-items-center rounded-print border border-dashed border-line-control text-ink-subtle"
        >
          <CameraIcon className="size-6" />
        </span>
      )}
      <div className="grid min-w-0 content-start gap-1">
        <h3 className="text-item-title-touch break-words text-ink md:text-item-title">
          <Link
            href={href}
            className="rounded-control outline-none after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
          >
            {item.name}
          </Link>
        </h3>
        {variants ? (
          <p className="text-meta-touch break-words text-ink-muted md:text-meta">
            {variants}
          </p>
        ) : null}
        <p className="flex flex-wrap items-center gap-1.5">
          <MenuStatusChip status={item.status} />
          <MenuItemChips item={item} />
        </p>
      </div>
    </article>
  )
}

/** Shared list class: one bordered panel, rows split by lines. */
export const MENU_LIST_CLASS =
  "divide-y divide-line rounded-panel border border-line bg-panel px-3 sm:px-4"
