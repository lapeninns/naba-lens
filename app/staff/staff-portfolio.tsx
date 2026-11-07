"use client"

import * as React from "react"

import type { Department } from "@/lib/config/departments"
import {
  BookOpenTextIcon,
  BriefcaseIcon,
  CameraIcon,
  CaretRightIcon,
  ClipboardTextIcon,
  ForkKnifeIcon,
  PencilSimpleIcon,
  SignOutIcon,
  TagIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { LabelEditorHost } from "@/app/_labels/label-editor-host"
import { logout } from "@/app/_media/actions"
import { fetchMediaPage } from "@/app/_media/fetch-page"
import { MediaGallery } from "@/app/_media/media-gallery"
import {
  EditProfileDialog,
  EmptyState,
  Notice,
  ProfileHeader,
  type ActionResult,
  type ProfileFormValues,
} from "@/components/nabalens"
import type { MediaItem } from "@/components/nabalens/types"
import { GUIDE_PATH } from "@/components/nabalens/guide"
import { CountBadge, StatusChip } from "@/components/nabalens/status-chip"
import {
  useAdd,
  useAddLabelled,
  useAddRefreshSignal,
} from "@/components/nabalens/shell/add-context"
import { Button } from "@/components/ui/button"
import { MEDIA_LIMITS } from "@/lib/config/media"
import type { MyMenuPhotoState } from "@/lib/server/coverage/types"
import type { MediaPage } from "@/lib/server/media/types"
import { LABEL_LIMITS } from "@/lib/menus/types"

import { loadMyMedia } from "./actions"
import { NeedsAttention } from "./needs-attention"

type StaffPortfolioProps = {
  profile: {
    displayName: string
    jobTitle: string | null
    department?: Department | null
    venueName: string | null
    avatarUrl: string | null
    /** The self-described main job (work details), or null. */
    workRole?: string | null
  }
  /** Why uploads are paused (no or inactive venue), or null. */
  uploadBlocked: string | null
  initialPage: MediaPage
  /** Set for an effective venue manager: the way into Manage on phones. */
  manage?: { venueName: string | null; reviewCount: number } | null
  /** Open Edit profile straight away (`/staff?edit=profile`). */
  initialEditOpen?: boolean
  /** The caller's own newest menu photo decisions (accepted, better photo requested). */
  menuPhotos?: MyMenuPhotoState[]
  /** The own photos those decisions are on, whichever gallery page they are on. */
  menuPhotoItems?: MediaItem[]
}

/** The three milestones of an own photo, in these exact words. */
export const MILESTONES = {
  saved: "Saved to your portfolio",
  label: "Ready to label",
  accepted: "Accepted for menu use",
  better: "Better photo requested",
} as const

export type Milestone = keyof typeof MILESTONES

/**
 * Where one own photo stands: accepted for menu use (any live accepted
 * decision), ready to label (ready, labels loaded and none yet), or saved.
 * Files still uploading, processing or failed have no milestone.
 */
export function photoMilestone(
  item: MediaItem,
  acceptedAssetIds: ReadonlySet<string>
): Milestone | null {
  if (item.uploadState !== "ready") return null
  if (acceptedAssetIds.has(item.id)) return "accepted"
  if (item.labels && !item.labels.hasLabels) return "label"
  return "saved"
}

/** Ready photos with no labels yet, newest first, at most one label batch. */
export function photosNeedingLabels(
  items: readonly MediaItem[],
  done: ReadonlySet<string> = new Set()
): MediaItem[] {
  return items
    .filter(
      (item) =>
        item.uploadState === "ready" &&
        item.labels != null &&
        !item.labels.hasLabels &&
        !done.has(item.id)
    )
    .slice(0, LABEL_LIMITS.maxBatchAssets)
}

/** Abortable foreground refresh of the own portfolio (see MediaGallery). */
function refreshMyMedia(signal: AbortSignal, cursor?: string | null) {
  return fetchMediaPage("/api/portfolio", { cursor }, signal)
}

async function saveProfile(values: ProfileFormValues): Promise<ActionResult> {
  const body = new FormData()
  body.set("displayName", values.displayName)
  if (values.avatarFile) body.set("avatar", values.avatarFile)
  try {
    const response = await fetch("/api/profile", { method: "POST", body })
    const result = (await response.json()) as ActionResult
    return result
  } catch {
    return { ok: false, error: "Could not save. Check your connection." }
  }
}

/** A Common Room row inside a white card: icon disc, two lines, chevron. */
const ROW_LINK =
  "grid min-h-16 w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 p-3 text-ink transition-colors duration-(--duration-quick) outline-none hover:bg-surface-2 focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-focus focus-visible:outline-solid"

/** The row's 44px grey disc around a decorative icon. */
function RowIcon({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className="grid size-11 shrink-0 place-items-center rounded-round bg-surface-2 text-ink [&_svg]:size-6"
    >
      {children}
    </span>
  )
}

/** The Manage row at the top of Me, with the photos waiting for review. */
function ManageRow({
  venueName,
  reviewCount,
}: {
  venueName: string | null
  reviewCount: number
}) {
  const hintId = React.useId()
  const title = venueName ? `Manage ${venueName}` : "Manage"
  const toReview = `${reviewCount === 1 ? "photo" : "photos"} to review`
  return (
    <nav
      aria-label="Manage"
      className="grid overflow-hidden rounded-card bg-surface shadow-card"
    >
      <Link
        href="/staff/manage"
        aria-label={
          reviewCount > 0 ? `${title}, ${reviewCount} ${toReview}` : title
        }
        aria-describedby={hintId}
        className={ROW_LINK}
      >
        <RowIcon>
          <ClipboardTextIcon />
        </RowIcon>
        <span className="grid min-w-0 gap-0.5">
          <span className="text-item-title [overflow-wrap:anywhere]">
            {title}
          </span>
          <span id={hintId} className="text-body text-ink-muted">
            Review, checklist, menu and team
          </span>
        </span>
        <span className="flex items-center gap-2 text-ink-muted">
          <CountBadge count={reviewCount} label={toReview} />
          <CaretRightIcon aria-hidden weight="bold" className="size-5" />
        </span>
      </Link>
    </nav>
  )
}

/** One row of Me's own links, like the Manage row. */
function MeRow({
  href,
  icon,
  title,
  hint,
}: {
  href: string
  icon: React.ReactNode
  title: string
  hint: string
}) {
  // No aria-label: the name is the visible title and hint, so speech input
  // and screen readers match what is on screen (axe label-content-name-mismatch).
  return (
    <li>
      <Link href={href} className={ROW_LINK}>
        <RowIcon>{icon}</RowIcon>
        <span className="grid min-w-0 gap-0.5">
          <span className="text-item-title [overflow-wrap:anywhere]">
            {title}
          </span>
          <span className="text-body [overflow-wrap:anywhere] text-ink-muted">
            {hint}
          </span>
        </span>
        <CaretRightIcon
          aria-hidden
          weight="bold"
          className="size-5 text-ink-muted"
        />
      </Link>
    </li>
  )
}

/** A small square of one own photo with its milestone (and dish) underneath. */
function MilestoneTile({
  item,
  milestone,
  detail,
}: {
  item: MediaItem
  milestone: Milestone
  detail?: string | null
}) {
  const kind = item.mediaType === "video" ? "Video" : "Photo"
  return (
    <li className="grid min-w-0 content-start gap-1.5">
      <span className="relative block aspect-square w-full overflow-hidden rounded-control bg-plate">
        {item.thumbnailUrl ? (
          // Signed private URLs never go through next/image (see MediaTile).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.thumbnailUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 size-full object-cover"
          />
        ) : null}
      </span>
      <span className="sr-only">{kind}: </span>
      {/* Common Room §3 shapes: Accepted is the filled ok square, a better
          photo request the warn pill, the rest a plain grey pill. */}
      <StatusChip state={MILESTONE_STATE[milestone]} className="w-fit">
        {MILESTONES[milestone]}
      </StatusChip>
      {detail ? (
        <span
          className={
            milestone === "better"
              ? "text-meta [overflow-wrap:anywhere] text-ink-muted"
              : "truncate text-meta text-ink-muted"
          }
        >
          {detail}
        </span>
      ) : null}
    </li>
  )
}

/** Which §3 state shape draws each milestone (the word stays MILESTONES'). */
const MILESTONE_STATE: Record<Milestone, string> = {
  saved: "saved",
  label: "needs_labels",
  accepted: "accepted",
  better: "needs_another_photo",
}

const TILE_GRID =
  "grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-5 md:grid-cols-[repeat(auto-fill,minmax(7rem,1fr))]"

export function StaffPortfolio({
  profile,
  uploadBlocked,
  initialPage,
  manage = null,
  initialEditOpen = false,
  menuPhotos = [],
  menuPhotoItems = [],
}: StaffPortfolioProps) {
  const router = useRouter()
  const [editOpen, setEditOpen] = React.useState(initialEditOpen)
  // Closing drops `?edit=profile`, so Back, Forward or a reload to this entry
  // does not open Edit profile again.
  const onEditOpenChange = React.useCallback((open: boolean) => {
    setEditOpen(open)
    if (open) return
    const url = new URL(window.location.href)
    if (url.searchParams.get("edit") !== "profile") return
    url.searchParams.delete("edit")
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`
    )
  }, [])
  // Uploads go through the one Add queue in the staff layout, which refreshes
  // this gallery when they finish and offers labelling afterwards.
  const openAdd = useAdd()
  const addRefreshSignal = useAddRefreshSignal()
  const addLabelled = useAddLabelled()
  // Labels saved from "Needs labels": hide those photos here and refresh the
  // gallery so its badges catch up.
  const [labelled, setLabelled] = React.useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [labelSaves, setLabelSaves] = React.useState(0)
  const [labelIds, setLabelIds] = React.useState<string[] | null>(null)
  const needsLabels = photosNeedingLabels(initialPage.items, labelled)
  const { accepted, better } = React.useMemo(() => {
    const accepted = new Map<string, string[]>()
    const better = new Map<string, string[]>()
    for (const state of menuPhotos) {
      const name = state.variantName
        ? `${state.itemName} (${state.variantName})`
        : state.itemName
      if (state.state === "accepted") {
        accepted.set(state.assetId, [
          ...(accepted.get(state.assetId) ?? []),
          name,
        ])
      } else if (state.state === "better_photo_requested") {
        const note = state.reason ? `${name}: ${state.reason}` : name
        better.set(state.assetId, [...(better.get(state.assetId) ?? []), note])
      }
    }
    return { accepted, better }
  }, [menuPhotos])
  const acceptedIds = React.useMemo(() => new Set(accepted.keys()), [accepted])
  // From the decisions themselves, not the newest gallery page, so an older
  // accepted photo still shows.
  const acceptedItems = menuPhotoItems.filter(
    (item) => photoMilestone(item, acceptedIds) === "accepted"
  )
  const betterItems = menuPhotoItems.filter(
    (item) => item.uploadState === "ready" && better.has(item.id)
  )

  const uploadButton = (variant: "primary" | "secondary" = "primary") =>
    uploadBlocked || !openAdd ? null : (
      <Button
        variant={variant}
        size="touch"
        onClick={() => openAdd({ dialog: true })}
      >
        <UploadSimpleIcon data-icon="inline-start" aria-hidden />
        Upload photos or videos
      </Button>
    )

  return (
    // Common Room Me: a feed of white cards on the grey canvas.
    <div className="mx-auto flex w-full max-w-(--size-feed) flex-col gap-(--gutter)">
      <ProfileHeader
        displayName={profile.displayName}
        avatarUrl={profile.avatarUrl}
        jobTitle={profile.jobTitle}
        department={profile.department}
        venueName={profile.venueName}
        workRole={profile.workRole}
        actions={
          // Grey first, blue last: on phones the order flips, so Upload sits
          // on top with Edit profile under it; from md blue is on the right.
          <>
            {/* From md, Log out is in the AppBar; on phones it lives on Me. */}
            <form action={logout} className="md:hidden" data-logout>
              <Button type="submit" variant="quiet" size="touch">
                <SignOutIcon data-icon="inline-start" aria-hidden />
                Log out
              </Button>
            </form>
            <Button
              variant="secondary"
              size="touch"
              onClick={() => setEditOpen(true)}
            >
              <PencilSimpleIcon data-icon="inline-start" aria-hidden />
              Edit profile
            </Button>
            {uploadButton()}
          </>
        }
      />
      {manage ? (
        <ManageRow
          venueName={manage.venueName}
          reviewCount={manage.reviewCount}
        />
      ) : null}
      <nav aria-label="Your work">
        <ul className="grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card">
          <MeRow
            href="/staff/profile?next=/staff"
            icon={<BriefcaseIcon />}
            title="Edit work details"
            hint={profile.workRole ?? "Your main job and the areas you work in"}
          />
          <MeRow
            href="/staff/tasks/welcome?from=me"
            icon={<BookOpenTextIcon />}
            title="How Naba-Lens works"
            hint="What your photos are for and how to add them"
          />
          <MeRow
            href={GUIDE_PATH}
            icon={<CameraIcon aria-hidden className="size-5 text-ink-muted" />}
            title="Photo guide"
            hint="How to photograph a dish: the checklist and four angles"
          />
          <MeRow
            href="/staff/menu"
            icon={<ForkKnifeIcon />}
            title="Our menu"
            hint="See which dishes and drinks still need a photo"
          />
        </ul>
      </nav>
      <NeedsAttention
        refreshSignal={addRefreshSignal}
        onFixed={(saved) => {
          addLabelled(saved)
          setLabelled((current) => new Set([...current, ...saved]))
          setLabelSaves((n) => n + 1)
        }}
      />
      {needsLabels.length > 0 ? (
        // One listing only: these photos are already in the portfolio grid
        // below with a "Needs labels" badge, so this is the batch action
        // and its count, not a second row of the same tiles.
        <section
          aria-labelledby="needs-labels-heading"
          className="grid gap-3 pt-2"
        >
          <div className="grid gap-1 px-1">
            <h2
              id="needs-labels-heading"
              className="flex items-center gap-2 font-display text-section-title text-ink"
            >
              Needs labels
              <CountBadge
                count={needsLabels.length}
                label={needsLabels.length === 1 ? "photo" : "photos"}
              />
            </h2>
            <p className="text-body text-ink-muted">
              Say which dish or drink each one shows, so it can be found and
              chosen for the menu. They&apos;re marked &ldquo;Needs
              labels&rdquo; in your portfolio below.
            </p>
          </div>
          <Button
            size="touch"
            variant="secondary"
            className="w-full md:w-fit"
            onClick={() => setLabelIds(needsLabels.map((item) => item.id))}
          >
            <TagIcon data-icon="inline-start" aria-hidden />
            {needsLabels.length === 1
              ? "Label this photo"
              : `Label these ${needsLabels.length} photos`}
          </Button>
        </section>
      ) : null}
      {acceptedItems.length > 0 ? (
        <section aria-labelledby="accepted-heading" className="grid gap-3 pt-2">
          <h2
            id="accepted-heading"
            className="px-1 font-display text-section-title text-ink"
          >
            {MILESTONES.accepted}
          </h2>
          <ul aria-label="Photos accepted for menu use" className={TILE_GRID}>
            {acceptedItems.map((item) => (
              <MilestoneTile
                key={item.id}
                item={item}
                milestone="accepted"
                detail={accepted.get(item.id)?.join(", ")}
              />
            ))}
          </ul>
        </section>
      ) : null}
      {betterItems.length > 0 ? (
        <section aria-labelledby="better-heading" className="grid gap-3 pt-2">
          <div className="grid gap-1 px-1">
            <h2
              id="better-heading"
              className="font-display text-section-title text-ink"
            >
              {MILESTONES.better}
            </h2>
            <p className="text-body text-ink-muted">
              A manager would like a better photo of these dishes. Their note is
              under each photo.
            </p>
          </div>
          <ul
            aria-label="Photos with a better photo requested"
            className={TILE_GRID}
          >
            {betterItems.map((item) => (
              <MilestoneTile
                key={item.id}
                item={item}
                milestone="better"
                detail={better.get(item.id)?.join("; ")}
              />
            ))}
          </ul>
        </section>
      ) : null}
      {uploadBlocked ? (
        <Notice tone="attention" role="status">
          {uploadBlocked}
        </Notice>
      ) : null}
      <MediaGallery
        label="Your portfolio"
        initialPage={initialPage}
        loadPage={loadMyMedia}
        refreshPage={refreshMyMedia}
        canDelete
        refreshSignal={addRefreshSignal + labelSaves}
        canLabel
        showLabelBadge
        // Needs labels, menu decisions and better-photo requests are read on
        // the server; a delete or label change in the gallery can move them.
        onChanged={() => router.refresh()}
        // The profile card holds the screen's one blue Upload; the empty
        // state repeats it in grey.
        empty={<EmptyState action={uploadButton("secondary")} />}
      />
      <LabelEditorHost
        assetIds={labelIds ?? []}
        open={labelIds !== null}
        onOpenChange={(open) => {
          if (!open) setLabelIds(null)
        }}
        onSaved={(results) => {
          const saved = results.flatMap((r) => (r.ok ? [r.assetId] : []))
          if (saved.length === 0) return
          // Add stops counting these as "ready to label".
          addLabelled(saved)
          setLabelled((current) => new Set([...current, ...saved]))
          setLabelSaves((n) => n + 1)
        }}
      />
      <EditProfileDialog
        open={editOpen}
        onOpenChange={onEditOpenChange}
        variant="staff"
        initial={{
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
        }}
        maxAvatarBytes={MEDIA_LIMITS.maxAvatarBytes}
        onSubmit={async (values) => {
          const result = await saveProfile(values)
          if (result.ok) router.refresh()
          return result
        }}
      />
    </div>
  )
}
