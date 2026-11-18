import Link from "next/link"
import { notFound } from "next/navigation"
import { FilmStripIcon, ImageIcon } from "@phosphor-icons/react/dist/ssr"

import { AlbumAddTrigger } from "@/components/nabalens/album/album-add-trigger"
import { MatchLaterRow } from "@/components/nabalens/album/match/match-later"
import { UnfinishedRow } from "@/components/nabalens/album/unfinished-row"
import { YourMonthCard } from "@/components/nabalens/album/your-month-card"
import { AppShell } from "@/components/nabalens/app-shell"
import { Notice } from "@/components/nabalens/notice"
import { StatusChip } from "@/components/nabalens/status-chip"
import { Photo } from "@/components/ui/photo"
import { requireActiveStaff, uploadBlockReason } from "@/lib/auth"
import {
  ALBUM_UPLOAD_TRAY,
  STAFF_PHOTO_ROUTES,
} from "@/lib/config/album-upload-tray"
import { getCoverageActor } from "@/lib/server/coverage"
import { getMyUploads } from "@/lib/server/staff"
import { datesLine, OUTCOME_CHIP, receiptWord } from "@/lib/staff/my-uploads"

import { listMatchLater } from "../_shell/match-later"
import { ownMonth, staffShellStatus } from "../_shell/shell-status"
import { ADD_BLOCKED } from "../add-blocked"
import { unwrap } from "../tasks/result"

export const metadata = { title: "Home" }

/** Gallery-first staff Home and a short view of your own work (DESIGN.md §6.1a). */
export default async function StaffHomePage() {
  if (!ALBUM_UPLOAD_TRAY) notFound()
  const profile = await requireActiveStaff()
  const { actor } = unwrap(await getCoverageActor())
  const [shell, monthly, later, uploads] = await Promise.all([
    staffShellStatus(actor, profile),
    ownMonth(actor),
    listMatchLater(actor).catch(() => null),
    getMyUploads(actor).catch(() => null),
  ])
  const blocked = uploadBlockReason(profile)
  const recent = uploads?.ok
    ? uploads.page.items
        .filter((item) => item.venueId === profile.venueId)
        .slice(0, 6)
    : null

  return (
    <AppShell
      variant="staff"
      active="home"
      {...shell}
      userName={profile.displayName}
      venueName={profile.venue?.name}
      monthly={monthly}
    >
      <div className="mx-auto grid w-full max-w-feed gap-4">
        <section
          className="grid gap-3 rounded-card border border-line bg-surface p-4"
          aria-labelledby="home-add-title"
        >
          <div className="grid gap-1">
            <h1 id="home-add-title" className="type-page-title text-ink">
              Add to the album
            </h1>
            <p className="text-body text-ink-muted">
              Pick photos from your gallery, then match them to a dish or space.
            </p>
          </div>
          {blocked ? (
            <Notice tone="attention">{ADD_BLOCKED[blocked]}</Notice>
          ) : (
            <AlbumAddTrigger kind="home" />
          )}
        </section>

        <UnfinishedRow />
        <MatchLaterRow count={later?.length ?? 0} />
        <YourMonthCard monthly={monthly} compact />

        <section className="grid gap-2" aria-labelledby="home-recent-title">
          <div className="flex flex-wrap items-center justify-between gap-x-3">
            <h2 id="home-recent-title" className="type-section-title">
              Recent activity
            </h2>
            <Link
              href={STAFF_PHOTO_ROUTES.me}
              className="inline-flex min-h-11 items-center rounded-control text-label text-accent-text underline underline-offset-4 focus-ring"
            >
              See your photos
            </Link>
          </div>
          {recent === null ? (
            <p className="rounded-card border border-line bg-surface p-4 text-body text-ink-muted">
              Recent activity couldn’t be loaded. Reload to try again.
            </p>
          ) : recent.length === 0 ? (
            <p className="rounded-card border border-dashed border-line bg-surface p-4 text-body text-ink-muted">
              Photos you send to this venue will appear here.
            </p>
          ) : (
            <ul className="grid gap-2">
              {recent.map((item) => {
                const word = receiptWord(item)
                const slot =
                  item.slots.find(
                    ({ outcome }) => outcome === "awaiting_review"
                  ) ?? item.slots[0]
                const name =
                  item.slots.map(({ name }) => name).join(", ") ||
                  (item.labelHelp
                    ? "With your manager"
                    : item.sharedKinds.length
                      ? "Shared photo"
                      : item.mediaType === "video"
                        ? "Video"
                        : "Photo without a slot")
                const Icon =
                  item.mediaType === "video" ? FilmStripIcon : ImageIcon
                return (
                  <li
                    key={item.assetId}
                    className="flex min-h-16 items-center gap-3 rounded-card border border-line bg-surface p-2.5"
                  >
                    {item.mediaType === "image" &&
                    item.uploadState === "ready" ? (
                      <Photo
                        alt=""
                        ratio="1/1"
                        src={`/api/media/${item.assetId}/thumb`}
                        className="size-12 shrink-0"
                      />
                    ) : (
                      <span className="grid size-12 shrink-0 place-items-center rounded-control bg-surface-2">
                        <Icon aria-hidden className="size-5" />
                      </span>
                    )}
                    <div className="grid min-w-0 gap-0.5">
                      <p className="text-label [overflow-wrap:anywhere]">
                        {name}
                      </p>
                      <p className="text-meta text-ink-muted">
                        {datesLine(item)}
                      </p>
                      {word ? (
                        <span className="text-meta font-semibold">{word}</span>
                      ) : slot ? (
                        <StatusChip
                          state={OUTCOME_CHIP[slot.outcome]}
                          className="justify-self-start"
                        />
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  )
}
