"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import {
  ArrowLeftIcon,
  ArrowUpIcon,
  HouseIcon,
  UserCircleIcon,
  CaretRightIcon,
  CheckIcon,
  DeviceMobileIcon,
  ImagesIcon,
  ImagesSquareIcon,
  PlusIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"

import { TAB_ITEM } from "@/components/nabalens/shell/tab-item"
import { CountBadge, StatusChip } from "@/components/nabalens/status-chip"
import { Photo as PhotoBox } from "@/components/ui/photo"
import { STAFF_POSTED } from "@/lib/config/staff-album-posts"
import { cn } from "@/lib/utils"

import { loadBlob } from "./blobs"
import { SAMPLES } from "./samples"
import { notices, useWorld } from "./world"
import {
  failed,
  stageOf,
  useProgress,
  type PhoneState,
  type Photo,
  type Stage,
} from "./store"

export const BASE = "/dev/photo-flow"

/* ------------------------------------------------------------------ photos */

const urls = new Map<string, string>()

/** The picture's address: a bundled sample, or the file kept on the phone. */
export function usePhotoSrc(photo: Photo): string | undefined {
  const sample =
    photo.source.kind === "sample" ? SAMPLES[photo.source.key].image.src : null
  const [url, setUrl] = useState<string | undefined>(() => urls.get(photo.id))
  useEffect(() => {
    if (sample || urls.has(photo.id)) return
    let live = true
    void loadBlob(photo.id).then((blob) => {
      if (!blob || !live) return
      const made = urls.get(photo.id) ?? URL.createObjectURL(blob)
      urls.set(photo.id, made)
      setUrl(made)
    })
    return () => {
      live = false
    }
  }, [photo.id, sample])
  return sample ?? url ?? urls.get(photo.id)
}

/** What the picture shows, for someone who cannot see it. */
export function altOf(photo: Photo): string {
  return photo.source.kind === "sample"
    ? SAMPLES[photo.source.key].alt
    : `Photo ${photo.fileName}`
}

const RATIO = {
  "4/3": "aspect-4/3",
  "1/1": "aspect-square",
  "16/9": "aspect-video",
  "3/4": "aspect-3/4",
} as const
const RADIUS = {
  none: "rounded-none",
  square: "rounded-square",
  control: "rounded-control",
  card: "rounded-card",
} as const

export function PhotoImage({
  photo,
  ratio = "4/3",
  radius = "card",
  alt,
  eager,
  className,
  contain = false,
}: {
  photo: Photo
  ratio?: "4/3" | "1/1" | "16/9" | "3/4"
  radius?: "none" | "square" | "control" | "card"
  /** Pass "" when words beside the photo already name it. */
  alt?: string
  eager?: boolean
  className?: string
  contain?: boolean
}) {
  const src = usePhotoSrc(photo)
  // A file kept on the phone takes a moment to read: hold the shape, and
  // say nothing is wrong, until it is there.
  if (!src) {
    return (
      <span
        data-slot="photo"
        data-state="loading"
        className={cn(
          "block w-full bg-media-placeholder",
          RATIO[ratio],
          RADIUS[radius],
          className
        )}
      />
    )
  }
  return (
    <PhotoBox
      src={src}
      alt={alt ?? altOf(photo)}
      ratio={ratio}
      radius={radius}
      eager={eager}
      className={className}
      imgClassName={contain ? "object-contain" : undefined}
      unavailableLabel="This browser can't show this photo"
    />
  )
}

/* ------------------------------------------------------------------- words */

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/London",
})
const DAY_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
})

/** The capture date the file supplied, or "Unknown". Never the upload date. */
export function takenWords(photo: Photo, withTime = false): string {
  if (!photo.takenAt) return "Unknown"
  return (withTime ? DAY_TIME : DAY).format(new Date(photo.takenAt))
}

export function dayWords(iso: string): string {
  return DAY.format(new Date(iso))
}

export function photosWord(count: number): string {
  return count === 1 ? "1 photo" : `${count} photos`
}

/* ------------------------------------------------------------------ status */

/** The one status word for a photo, in a chip: tone, icon and word. */
export function StageChip({
  photo,
  className,
}: {
  photo: Photo
  className?: string
}) {
  const stage = stageOf(photo)
  switch (stage) {
    case "failed":
      return (
        <StatusChip tone="attention" className={className}>
          Needs attention
        </StatusChip>
      )
    case "local":
      return (
        <StatusChip tone="neutral" className={className}>
          Saved on this phone
        </StatusChip>
      )
    case "uploading":
      return (
        <StatusChip tone="pending" className={className}>
          Uploading
        </StatusChip>
      )
    case "posted":
      return (
        <StatusChip tone="positive" className={className}>
          {STAFF_POSTED}
        </StatusChip>
      )
  }
}

const UPLOAD_LINE: Record<
  Photo["upload"],
  { word: string; tone: string; Icon: typeof CheckIcon }
> = {
  local: {
    word: "Saved on this phone",
    tone: "text-ink",
    Icon: DeviceMobileIcon,
  },
  uploading: { word: "Uploading", tone: "text-info-fg", Icon: ArrowUpIcon },
  uploaded: { word: STAFF_POSTED, tone: "text-ok-fg", Icon: CheckIcon },
  failed: {
    word: "Needs attention",
    tone: "text-warn-fg",
    Icon: WarningCircleIcon,
  },
}

/** Where the file is: on the phone, on its way, or uploaded. Icon and words. */
export function UploadLine({
  photo,
  className,
}: {
  photo: Photo
  className?: string
}) {
  const line = UPLOAD_LINE[photo.upload]
  const done = useProgress(photo.id)
  return (
    <span
      data-upload={photo.upload}
      className={cn(
        "flex min-w-0 items-center gap-1.5 text-meta font-semibold",
        line.tone,
        className
      )}
    >
      <line.Icon aria-hidden weight="bold" className="size-4 shrink-0" />
      <span className="min-w-0">
        {line.word}
        {photo.upload === "uploading" && done > 0
          ? ` ${Math.round(done * 100)}%`
          : ""}
      </span>
    </span>
  )
}

export function stageCount(state: PhoneState, stage: Stage): number {
  return state.photos.filter((photo) => stageOf(photo) === stage).length
}

/* ------------------------------------------------------------------ layout */

/** A phone-width column at every size, with room for the bar at the foot. */
export function Screen({
  children,
  foot = "tabs",
  className,
}: {
  children: React.ReactNode
  /** What is fixed to the bottom: the tab bar, an action dock, or nothing. */
  foot?: "tabs" | "dock" | "none"
  className?: string
}) {
  return (
    <div
      className={cn(
        "mx-auto min-h-dvh w-full max-w-feed bg-canvas text-ink",
        foot === "tabs" &&
          "pb-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom,0px)+1rem)]",
        foot === "dock" && "pb-[calc(9.5rem+env(safe-area-inset-bottom,0px))]",
        foot === "none" && "pb-8",
        className
      )}
    >
      {children}
    </div>
  )
}

/** The top of a screen: an optional way back, then what the screen is. */
export function TopBar({
  back,
  title,
  children,
}: {
  back?: { href: string; label: string }
  title: string
  children?: React.ReactNode
}) {
  return (
    <header className="grid gap-1 px-gutter pt-3 pb-2">
      {back ? (
        <Link
          href={back.href}
          className="-ml-1 inline-flex min-h-11 items-center gap-1.5 justify-self-start rounded-control px-1 text-label text-accent-text focus-ring"
        >
          <ArrowLeftIcon aria-hidden weight="bold" className="size-5" />
          {back.label}
        </Link>
      ) : null}
      <h1
        tabIndex={-1}
        data-screen-title=""
        className="type-page-title text-balance outline-none"
      >
        {title}
      </h1>
      {children}
    </header>
  )
}

/** Album → Menu → Starters → Momo, as links up to the last step. */
export function Trail({
  steps,
  className,
}: {
  steps: { name: string; href?: string }[]
  className?: string
}) {
  return (
    <nav aria-label="Where this is" className={className}>
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-meta text-ink-muted">
        {steps.map((step, index) => (
          <li key={step.name + index} className="flex items-center gap-1">
            {index > 0 ? (
              <CaretRightIcon aria-hidden weight="bold" className="size-3" />
            ) : null}
            {step.href ? (
              <Link
                href={step.href}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-square text-accent-text underline decoration-1 underline-offset-3 focus-ring"
              >
                {step.name}
              </Link>
            ) : (
              <span aria-current="page" className="font-semibold text-ink">
                {step.name}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

/** The trail as plain words, for a sentence: "Album → Menu → Starters". */
export function trailWords(steps: string[]): string {
  return steps.join(" → ")
}

const TABS = [
  { id: "today", label: "Today", href: `${BASE}/today`, Icon: HouseIcon },
  {
    id: "album",
    label: "Album",
    href: `${BASE}/album`,
    Icon: ImagesSquareIcon,
  },
  { id: "add", label: "Add", href: `${BASE}/add`, Icon: PlusIcon },
  {
    id: "my-photos",
    label: "My photos",
    href: `${BASE}/my-photos`,
    Icon: ImagesIcon,
  },
  { id: "me", label: "Me", href: `${BASE}/me`, Icon: UserCircleIcon },
] as const

export type TabId = (typeof TABS)[number]["id"]

export function TabBar({
  active,
  state,
}: {
  active: TabId | null
  state: PhoneState
}) {
  const world = useWorld()
  // My photos counts what is stuck on the phone; Me counts unread notices.
  const stuck = failed(state).length
  const unread = world
    ? notices(world, state, BASE).filter((item) => item.unread).length
    : 0
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-nav mx-auto w-full max-w-feed bg-surface pb-[env(safe-area-inset-bottom,0px)] shadow-bar"
    >
      <ul className="grid grid-cols-5">
        {TABS.map(({ id, label, href, Icon }) => {
          const on = id === active
          return (
            <li key={id}>
              <Link
                href={href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  TAB_ITEM,
                  on ? "font-bold text-accent-text" : "text-ink-muted"
                )}
              >
                <span className="relative">
                  {id === "add" ? (
                    <span className="grid size-8 place-items-center rounded-round bg-accent text-on-accent">
                      <Icon aria-hidden weight="bold" className="size-5" />
                    </span>
                  ) : (
                    <Icon
                      aria-hidden
                      weight={on ? "fill" : "regular"}
                      className="size-6"
                    />
                  )}
                  {id === "my-photos" && !on ? (
                    <CountBadge
                      tone="warn"
                      count={stuck}
                      label={stuck === 1 ? "didn’t upload" : "didn’t upload"}
                      className="absolute -top-1.5 -right-3"
                    />
                  ) : null}
                  {id === "me" && !on ? (
                    <CountBadge
                      tone="warn"
                      count={unread}
                      label={unread === 1 ? "new notice" : "new notices"}
                      className="absolute -top-1.5 -right-3"
                    />
                  ) : null}
                </span>
                <span className={on ? "text-accent-text" : "text-ink"}>
                  {label}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
