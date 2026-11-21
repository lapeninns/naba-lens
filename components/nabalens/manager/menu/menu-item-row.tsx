import Link from "next/link"
import { MinusIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr"

import { EvidenceThumb } from "@/components/nabalens/coverage/evidence-image"
import { NeededByChip } from "@/components/nabalens/menu-photos/needed-by-chip"
import { requestHrefs } from "@/components/nabalens/requests/hrefs"
import { StatusChip, type ChipTone } from "@/components/nabalens/status-chip"
import { LinkButton } from "@/components/ui/link-button"
import { OPTIONAL_SLOT_WORD } from "@/lib/album/model"
import { cn } from "@/lib/utils"

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
  // FA-51: a packaged item without Photo wanted is never a gap (S5-R1). The
  // word is Album's Optional (DESIGN.md §4).
  optional: { word: OPTIONAL_SLOT_WORD, tone: "closed" },
}

/**
 * The item's headline chip in the StatusChip words (ia.md decision 4): In
 * the album, Waiting, Missing or Optional.
 */
export function MenuStatusChip({ status }: { status: MenuItemStatus }) {
  const { word, tone } = HEADLINE[status] ?? HEADLINE.needs_photo
  return <StatusChip tone={tone}>{word}</StatusChip>
}

/** Secondary chips: a "needed by" date (G-7), a newer photo waiting, a recheck, the caller's own photo. */
export function MenuItemChips({ item }: { item: ManagerMenuItem }) {
  const copy = MANAGER_COPY.menu
  return (
    <>
      {item.neededBy ? <NeededByChip neededBy={item.neededBy} /> : null}
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
 * One active-menu item on Album › Menu, drawn as an Album slot (DESIGN.md §4;
 * the handoff's Album › Menu figures): the photo box with the slot's state
 * frame (Missing a dashed edge and a dash, Waiting a sky ring over the
 * photo, Optional a plain edge), the name (never truncated) and options,
 * then the state chip and secondary chips. A row on phones; a tile in a
 * grid from bp-desktop. The whole row opens the item. A gap has one action
 * of its own, Ask, a New request with the slot filled in. While the
 * workspace's Add offers dishes (B02-c), the row also has the dish's photo
 * buttons, as on Our menu.
 */
export function MenuItemRow({
  item,
  href,
}: {
  item: ManagerMenuItem
  href: string
}) {
  const copy = MANAGER_COPY.menu
  const variants = item.variants.map((v) => v.name).join(", ")
  const nameId = `menu-item-${item.itemId}-name`
  const gap = item.status === "needs_photo"
  const box =
    "relative grid aspect-square w-14 place-items-center overflow-hidden rounded-control desktop:aspect-4/3 desktop:w-full desktop:rounded-card"
  return (
    <article className="relative grid min-h-16 grid-cols-[3.5rem_minmax(0,1fr)] gap-3 py-3 desktop:grid-cols-1 desktop:content-start desktop:gap-2 desktop:py-0">
      {item.preferred ? (
        <span className={cn(box, "bg-media-placeholder")}>
          <EvidenceThumb
            src={item.preferred.thumbnailUrl}
            className="absolute inset-0 size-full"
          />
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-0 rounded-[inherit]",
              (item.status === "awaiting_review" ||
                item.hasPendingReplacement) &&
                "slot-ring-waiting"
            )}
          />
        </span>
      ) : (
        <span
          aria-hidden
          className={cn(
            box,
            "bg-surface text-ink-muted",
            item.status === "optional" ? "edge-strong" : "slot-needed"
          )}
        >
          <MinusIcon className="size-5 desktop:size-6" />
        </span>
      )}
      <div className="grid min-w-0 content-start gap-1">
        <h3 id={nameId} className="text-item-title break-words text-ink">
          <Link
            href={href}
            className="rounded-control focus-ring outline-none after:absolute after:inset-0 after:content-[''] hover:underline"
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
      {gap ? (
        <div className="relative z-local col-start-2 desktop:col-start-1">
          <LinkButton
            href={requestHrefs.newFor("dish", item.itemId)}
            variant="secondary"
            size="sm"
            // The visible word starts the name (WCAG 2.5.3).
            aria-label={`${copy.ask} ${copy.askFor(item.name)}`}
          >
            {copy.ask}
          </LinkButton>
        </div>
      ) : null}
      <ManagerDishButtons item={item} describedBy={nameId} />
    </article>
  )
}

/**
 * Shared list class: rows split by hairlines inside the section's card on
 * phones; from bp-desktop a grid of tiles.
 */
export const MENU_LIST_CLASS =
  "divide-y divide-line px-3 sm:px-4 desktop:grid desktop:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] desktop:gap-x-4 desktop:gap-y-6 desktop:divide-y-0 desktop:px-4 desktop:pt-2 desktop:pb-4"
