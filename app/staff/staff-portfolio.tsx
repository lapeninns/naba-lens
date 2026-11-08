"use client"

import * as React from "react"

import type { Department } from "@/lib/config/departments"
import {
  BookOpenTextIcon,
  BriefcaseIcon,
  CameraIcon,
  CameraPlusIcon,
  CaretRightIcon,
  CheckCircleIcon,
  ClipboardTextIcon,
  ForkKnifeIcon,
  ImagesIcon,
  PencilSimpleIcon,
  SignOutIcon,
  TagIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { LabelEditorHost } from "@/app/_labels/label-editor-host"
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
import { formatBytes } from "@/components/nabalens/format"
import { GUIDE_PATH } from "@/components/nabalens/guide"
import { CountBadge, StatusChip } from "@/components/nabalens/status-chip"
import {
  useAdd,
  useAddDiscarded,
  useAddLabelled,
  useAddRefreshSignal,
  type AddLabelPreset,
  type OpenAddOptions,
} from "@/components/nabalens/shell/add-context"
import { Button } from "@/components/ui/button"
import { MEDIA_LIMITS } from "@/lib/config/media"
import type { MyMenuPhotoState } from "@/lib/server/coverage/types"
import type { MediaPage } from "@/lib/server/media/types"
import { LABEL_LIMITS } from "@/lib/menus/types"

import { loadMyMedia } from "./actions"
import { NeedsAttention } from "./needs-attention"
import { SIGNED_OUT_MESSAGE } from "./needs-attention-api"

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

/**
 * What to call a set of own uploads, as the upload sheet does: "photo(s)"
 * when they are all photos, "video" for one video, else "file(s)".
 */
export function uploadsNoun(items: readonly Pick<MediaItem, "mediaType">[]) {
  if (items.every((item) => item.mediaType === "image"))
    return items.length === 1 ? "photo" : "photos"
  if (items.length === 1) return "video"
  return "files"
}

/** Abortable foreground refresh of the own portfolio (see MediaGallery). */
function refreshMyMedia(signal: AbortSignal, cursor?: string | null) {
  return fetchMediaPage("/api/portfolio", { cursor }, signal)
}

export const PROFILE_SAVE_COPY = {
  saved: "Profile saved.",
  offline: "Could not save. Check your connection.",
  tooLarge: `This photo is too large. Profile photos can be up to ${formatBytes(MEDIA_LIMITS.maxAvatarBytes)}.`,
  timeout: "Saving took too long, so it may not have finished. Try again.",
  failed: "Your changes could not be saved. Try again.",
} as const

/**
 * Saves name and photo through /api/profile. The route answers in JSON; an
 * HTML page instead comes from the platform in front of it (a body over its
 * size limit, a timeout), so the status says what happened, not the network.
 */
export async function saveProfile(
  values: ProfileFormValues
): Promise<ActionResult> {
  const body = new FormData()
  body.set("displayName", values.displayName)
  if (values.avatarFile) body.set("avatar", values.avatarFile)
  let response: Response
  try {
    response = await fetch("/api/profile", { method: "POST", body })
  } catch {
    return { ok: false, error: PROFILE_SAVE_COPY.offline }
  }
  const result: unknown = await response.json().catch(() => null)
  if (
    result &&
    typeof result === "object" &&
    "ok" in result &&
    typeof result.ok === "boolean"
  )
    return result as ActionResult
  switch (response.status) {
    case 401:
      return { ok: false, error: SIGNED_OUT_MESSAGE }
    case 413:
      return {
        ok: false,
        error: PROFILE_SAVE_COPY.tooLarge,
        fieldErrors: { avatar: PROFILE_SAVE_COPY.tooLarge },
      }
    case 408:
    case 504:
      return { ok: false, error: PROFILE_SAVE_COPY.timeout }
    default:
      return { ok: false, error: PROFILE_SAVE_COPY.failed }
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
        <span className="truncate text-meta text-ink-muted">{detail}</span>
      ) : null}
    </li>
  )
}

/** One manager request for a better photo of one dish on one own photo. */
export type BetterPhotoRequest = {
  key: string
  item: MediaItem
  dish: string
  reason: string | null
  preset: AddLabelPreset
  /** A newer own photo of this dish is labelled and waiting for a decision. */
  sent: boolean
  /**
   * The dish is on the person's current venue's active menu, so a retake can
   * be labelled with it (see listMyMenuPhotoDecisions).
   */
  canRetake: boolean
}

export const BETTER_PHOTO_COPY = {
  intro:
    "A manager would like a better photo of these dishes. Take a new one and it goes to them for review, already labelled with the dish.",
  take: "Take a new photo",
  choose: "Choose from photos",
  sent: "New photo sent · waiting for manager review",
  again: "Take another",
  offMenu:
    "This dish isn't on your venue's menu now, so a new photo can't be sent for it.",
} as const

const sameDish = (
  a: { itemId: string; variantId: string | null },
  b: { itemId: string; variantId: string | null }
) => a.itemId === b.itemId && a.variantId === b.variantId

/**
 * Open better-photo requests on photos that are ready, newest decision first.
 * The dish and its variant become Add's label preset, as on Our menu.
 *
 * A retake only labels a new photo, so the request itself stays open until a
 * manager decides on the old photo. Among the person's loaded own photos
 * (`own`), a newer one labelled with the same dish and variant marks the
 * request sent while it has no decision, and drops it once it is accepted.
 */
export function betterPhotoRequests(
  states: readonly MyMenuPhotoState[],
  items: readonly MediaItem[],
  own: readonly MediaItem[] = items
): BetterPhotoRequest[] {
  const ready = new Map(
    items
      .filter((item) => item.uploadState === "ready")
      .map((item) => [item.id, item])
  )
  const photos = new Map(own.map((photo) => [photo.id, photo]))
  for (const item of items) photos.set(item.id, item)
  return states.flatMap((state) => {
    const item = ready.get(state.assetId)
    if (state.state !== "better_photo_requested" || !item) return []
    const requestedAt = Date.parse(item.createdAt)
    // Only a photo can answer: videos are never review candidates for a
    // dish, and a review of one is refused.
    const newer = [...photos.values()].filter(
      (photo) =>
        photo.id !== item.id &&
        photo.mediaType === "image" &&
        Date.parse(photo.createdAt) > requestedAt
    )
    const decided = (photo: MediaItem) =>
      states.filter((s) => s.assetId === photo.id && sameDish(s, state))
    if (
      newer.some((photo) =>
        decided(photo).some((decision) => decision.state === "accepted")
      )
    )
      return []
    const sent = newer.some(
      (photo) =>
        decided(photo).length === 0 &&
        (photo.labels?.items ?? []).some((label) => sameDish(label, state))
    )
    return [
      {
        key: state.photoId,
        item,
        dish: state.variantName
          ? `${state.itemName} (${state.variantName})`
          : state.itemName,
        reason: state.reason,
        preset: {
          itemId: state.itemId,
          variantId: state.variantId,
          itemName: state.itemName,
          variantName: state.variantName,
        },
        sent,
        canRetake: state.canRetake !== false,
      },
    ]
  })
}

/**
 * A better-photo request: the photo, the dish, the manager's note, and the
 * camera (or library) straight away with the dish preset. Grey buttons: the
 * profile card keeps the screen's one blue action.
 */
function BetterPhotoRow({
  request,
  openAdd,
}: {
  request: BetterPhotoRequest
  openAdd: ((opts?: OpenAddOptions) => void) | null
}) {
  const nameId = React.useId()
  const { item, dish, reason, preset, sent, canRetake } = request
  const retake = canRetake ? openAdd : null
  return (
    <li>
      <article
        aria-labelledby={nameId}
        className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 p-3"
      >
        <span className="relative block size-16 shrink-0 overflow-hidden rounded-control bg-plate">
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
        <div className="grid min-w-0 content-start gap-1">
          <StatusChip state={MILESTONE_STATE.better} className="w-fit">
            {MILESTONES.better}
          </StatusChip>
          <h3
            id={nameId}
            className="text-item-title [overflow-wrap:anywhere] text-ink"
          >
            {dish}
          </h3>
          {reason ? (
            <p className="text-body [overflow-wrap:anywhere] text-ink-muted">
              {reason}
            </p>
          ) : null}
          {!canRetake ? (
            <p className="text-body [overflow-wrap:anywhere] text-ink">
              {BETTER_PHOTO_COPY.offMenu}
            </p>
          ) : null}
          {sent ? (
            <p className="flex items-center gap-1.5 text-body text-ink">
              <CheckCircleIcon aria-hidden className="size-5 text-ok-fg" />
              {BETTER_PHOTO_COPY.sent}
            </p>
          ) : null}
        </div>
        {retake && sent ? (
          <div className="col-span-2 flex flex-wrap gap-2 *:flex-auto sm:*:flex-none">
            <Button
              variant="quiet"
              size="touch"
              aria-describedby={nameId}
              onClick={() =>
                retake({ source: "camera", imagesOnly: true, preset })
              }
            >
              <CameraPlusIcon data-icon="inline-start" aria-hidden />
              {BETTER_PHOTO_COPY.again}
            </Button>
          </div>
        ) : retake ? (
          <div className="col-span-2 flex flex-wrap gap-2 *:flex-auto sm:*:flex-none">
            <Button
              variant="secondary"
              size="touch"
              aria-describedby={nameId}
              // openAdd clicks the camera input inside this click handler.
              onClick={() =>
                retake({ source: "camera", imagesOnly: true, preset })
              }
            >
              <CameraPlusIcon data-icon="inline-start" aria-hidden />
              {BETTER_PHOTO_COPY.take}
            </Button>
            <Button
              variant="quiet"
              size="touch"
              aria-describedby={nameId}
              onClick={() =>
                retake({ source: "library", imagesOnly: true, preset })
              }
            >
              <ImagesIcon data-icon="inline-start" aria-hidden />
              {BETTER_PHOTO_COPY.choose}
            </Button>
          </div>
        ) : null}
      </article>
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
  // Shown after a save until Edit profile opens again.
  const [profileSaved, setProfileSaved] = React.useState(false)
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
  const addDiscarded = useAddDiscarded()
  // Labels saved from "Needs labels": hide those photos here and refresh the
  // gallery so its badges catch up.
  const [labelled, setLabelled] = React.useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [labelSaves, setLabelSaves] = React.useState(0)
  const [labelIds, setLabelIds] = React.useState<string[] | null>(null)
  const needsLabels = photosNeedingLabels(initialPage.items, labelled)
  const needsLabelsNoun = uploadsNoun(needsLabels)
  const accepted = React.useMemo(() => {
    const accepted = new Map<string, string[]>()
    for (const state of menuPhotos) {
      if (state.state !== "accepted") continue
      const name = state.variantName
        ? `${state.itemName} (${state.variantName})`
        : state.itemName
      accepted.set(state.assetId, [
        ...(accepted.get(state.assetId) ?? []),
        name,
      ])
    }
    return accepted
  }, [menuPhotos])
  const acceptedIds = React.useMemo(() => new Set(accepted.keys()), [accepted])
  // From the decisions themselves, not the newest gallery page, so an older
  // accepted photo still shows.
  const acceptedItems = menuPhotoItems.filter(
    (item) => photoMilestone(item, acceptedIds) === "accepted"
  )
  const betterRequests = betterPhotoRequests(menuPhotos, menuPhotoItems, [
    ...initialPage.items,
    ...menuPhotoItems,
  ])
  const betterWaiting = betterRequests.filter(
    (request) => !request.sent && request.canRetake
  )
  // A blocked account sees why in the notice below, not a camera that fails.
  const openRetake = uploadBlocked ? null : openAdd

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
            {/* A plain POST, not a Server Action: it still signs out after the
                session has ended, when the proxy refuses an action. */}
            <form
              action="/auth/logout"
              method="post"
              className="md:hidden"
              data-logout
            >
              <Button type="submit" variant="quiet" size="touch">
                <SignOutIcon data-icon="inline-start" aria-hidden />
                Log out
              </Button>
            </form>
            <Button
              variant="secondary"
              size="touch"
              onClick={() => {
                setProfileSaved(false)
                setEditOpen(true)
              }}
            >
              <PencilSimpleIcon data-icon="inline-start" aria-hidden />
              Edit profile
            </Button>
            {uploadButton()}
          </>
        }
      />
      {profileSaved ? (
        <Notice tone="positive">{PROFILE_SAVE_COPY.saved}</Notice>
      ) : null}
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
        // The Add sheet's row for that photo reads Saved with no labels.
        onDiscarded={addDiscarded}
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
              <CountBadge count={needsLabels.length} label={needsLabelsNoun} />
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
              ? `Label this ${needsLabelsNoun}`
              : `Label these ${needsLabels.length} ${needsLabelsNoun}`}
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
      {betterRequests.length > 0 ? (
        <section aria-labelledby="better-heading" className="grid gap-3 pt-2">
          <div className="grid gap-1 px-1">
            <h2
              id="better-heading"
              className="flex items-center gap-2 font-display text-section-title text-ink"
            >
              {MILESTONES.better}
              <CountBadge
                count={betterWaiting.length}
                label={betterWaiting.length === 1 ? "request" : "requests"}
              />
            </h2>
            <p className="text-body text-ink-muted">
              {BETTER_PHOTO_COPY.intro}
            </p>
          </div>
          <ul
            aria-label="Photos with a better photo requested"
            className="grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card"
          >
            {betterRequests.map((request) => (
              <BetterPhotoRow
                key={request.key}
                request={request}
                openAdd={openRetake}
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
        getDeleteImpact={(item) => {
          const dishes = accepted.get(item.id)
          return dishes ? { kind: "menu", dishes } : undefined
        }}
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
          // Saved here, so Add's sheet settles its rows for them (C6).
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
          if (result.ok) {
            setProfileSaved(true)
            router.refresh()
          }
          return result
        }}
      />
    </div>
  )
}
