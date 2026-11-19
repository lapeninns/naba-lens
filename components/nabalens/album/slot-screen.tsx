"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowLeftIcon,
  ArrowUUpLeftIcon,
  ImagesIcon,
  MegaphoneSimpleIcon,
} from "@phosphor-icons/react"

import {
  ReportChangeDialog,
  type ReportSender,
} from "@/components/nabalens/album/report-change-dialog"
import { SlotTile } from "@/components/nabalens/album/slot-tile"
import { Notice } from "@/components/nabalens/notice"
import { useAdd } from "@/components/nabalens/shell/add-context"
import { StatusChip } from "@/components/nabalens/status-chip"
import { VenueBar } from "@/components/nabalens/venue-bar"
import { Button } from "@/components/ui/button"
import { Photo } from "@/components/ui/photo"
import type { AlbumSlot } from "@/lib/album/model"
import { cn } from "@/lib/utils"
import {
  OUTCOME_CHIP,
  shortDay,
  type UploadOutcome,
} from "@/lib/staff/my-uploads"
import { REPORT_COPY } from "@/lib/staff/slot-reports"

/*
 * A slot's own page (spec §6 S3; DESIGN.md §5 "tapping a filled slot opens
 * the slot"; S2-STAFF): the photo in the album, the brief, how many photos
 * wait for review (a number, never a colleague's photo: FA-20), the
 * reviewer's reason when the person was asked to retake it (AC17), the
 * person's own photos of it, Add a photo (gallery first, §2) and Report a
 * change. An amenity slot keeps its question page (§6.3).
 */

export const SLOT_COPY = {
  back: (place: string) => place,
  briefTitle: "What the photo must show",
  noBrief: "No brief yet. Show it clearly, as a guest would see it.",
  example: "Example of a good photo",
  inAlbum: "The photo in the album",
  noPhoto: "No photo in the album yet.",
  /** FA-51: a packaged item without Photo wanted. */
  optional: "Optional: a photo is welcome, but none is needed.",
  waiting: (n: number) =>
    n === 1
      ? "1 photo is waiting for a manager to check it."
      : `${n} photos are waiting for a manager to check them.`,
  retakeTitle: "You were asked to retake this",
  retakeNoReason: "Your manager asked for another photo.",
  yours: "Your photos here",
  add: "Add a photo for this slot",
  addAnother: "Add another photo",
  report: REPORT_COPY.slotTitle,
} as const

export type SlotOwnPhoto = {
  assetId: string
  outcome: UploadOutcome
  uploadedAt: string
}

export function AlbumSlotScreen({
  venueName,
  placeLabel,
  placeHref,
  slot,
  retake,
  ownPhotos,
  canAdd,
  blocked,
  sendReport,
  headingLevel = 1,
}: {
  venueName: string
  placeLabel: string
  placeHref: string
  slot: AlbumSlot
  /** The reviewer's exact reason, when the person was asked to retake it. */
  retake: { reason: string | null } | null
  ownPhotos: SlotOwnPhoto[]
  canAdd: boolean
  /** Why adding is paused (no or inactive venue), or null. */
  blocked: string | null
  sendReport: ReportSender
  headingLevel?: 1 | 2 | 3 | 4
}) {
  const openAdd = useAdd()
  const [reporting, setReporting] = React.useState(false)
  const [sent, setSent] = React.useState<"created" | "open" | null>(null)
  const Title = `h${headingLevel}` as "h1"
  const Section = `h${headingLevel + 1}` as "h2"
  const target = slot.target
  const hasPhoto = slot.state === "accepted" || slot.state === "check-due"
  const empty = slot.state === "needed" || slot.state === "retake"

  const add = () => {
    if (!canAdd || !openAdd || target.kind === "amenity") return
    openAdd({
      slot:
        target.kind === "dish"
          ? { kind: "dish", itemId: target.itemId, name: target.itemName }
          : { kind: "area", subjectId: target.subjectId, name: slot.name },
    })
  }

  return (
    <div className="grid gap-5 pb-4" data-slot="album-slot">
      <VenueBar
        name={venueName}
        className="-mx-page-gutter md:mx-0 md:rounded-card md:border md:border-line"
      />
      <div className="-mt-3">
        <Link
          href={placeHref}
          className="inline-flex min-h-12 items-center gap-1 text-label text-ink focus-ring"
        >
          <ArrowLeftIcon aria-hidden className="size-5" />
          {SLOT_COPY.back(placeLabel)}
        </Link>
      </div>
      <header className="grid gap-0.5">
        <p className="text-caption text-ink-muted">
          {venueName} · {slot.group}
        </p>
        <Title className="type-display [overflow-wrap:anywhere] text-ink">
          {slot.name}
        </Title>
      </header>

      {retake ? (
        <section
          aria-label={SLOT_COPY.retakeTitle}
          // Drawn as v2 Notice (attention): brass soft ground, brass icon and
          // title, the reviewer's words in ink.
          className="flex items-start gap-3 rounded-card bg-warn-bg p-4 text-ink"
          data-slot="slot-retake"
        >
          <ArrowUUpLeftIcon
            aria-hidden
            weight="bold"
            className="mt-0.5 size-6 shrink-0 text-warn-fg"
          />
          <span className="grid gap-0.5">
            <span className="text-heading text-warn-fg">
              {SLOT_COPY.retakeTitle}
            </span>
            <span className="text-body [overflow-wrap:anywhere]">
              {retake.reason ?? SLOT_COPY.retakeNoReason}
            </span>
          </span>
        </section>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] md:items-start">
        <figure className="grid gap-2">
          <div className="w-full max-w-80">
            <SlotTile
              name={slot.name}
              state={slot.state}
              photoSrc={slot.thumbnailUrl ?? undefined}
              onSelect={empty && canAdd ? add : undefined}
              optional={slot.optional}
            />
          </div>
          <figcaption className="text-meta text-ink-muted">
            {hasPhoto && slot.thumbnailUrl
              ? SLOT_COPY.inAlbum
              : SLOT_COPY.noPhoto}
          </figcaption>
          {slot.optional ? (
            <p className="text-body text-ink" data-slot="slot-optional">
              {SLOT_COPY.optional}
            </p>
          ) : null}
        </figure>

        <div className="grid content-start gap-4">
          <section aria-labelledby="slot-brief" className="grid gap-1">
            <Section id="slot-brief" className="type-section-title text-ink">
              {SLOT_COPY.briefTitle}
            </Section>
            <p className="text-body [overflow-wrap:anywhere] text-ink">
              {slot.brief ?? SLOT_COPY.noBrief}
            </p>
            {slot.neededBy ? (
              <p className="text-meta text-ink-muted">{slot.neededBy}</p>
            ) : null}
            {slot.exampleAssetId ? (
              // FA-52 (spec §5.2 step 2): an approved example beside the brief.
              <figure
                className="mt-1 grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-3"
                data-slot="slot-example"
              >
                <Photo
                  src={`/api/media/${encodeURIComponent(slot.exampleAssetId)}/thumb`}
                  alt=""
                  ratio="1/1"
                  radius="square"
                />
                <figcaption className="text-meta text-ink-muted">
                  {SLOT_COPY.example}
                </figcaption>
              </figure>
            ) : null}
          </section>

          {slot.pendingCount > 0 ? (
            <p className="text-body text-ink-muted" data-slot="slot-pending">
              {SLOT_COPY.waiting(slot.pendingCount)}
            </p>
          ) : null}

          {ownPhotos.length > 0 ? (
            <section aria-labelledby="slot-yours" className="grid gap-2">
              <Section id="slot-yours" className="type-section-title text-ink">
                {SLOT_COPY.yours}
              </Section>
              <ul className="grid gap-1.5">
                {ownPhotos.map((photo) => (
                  <li
                    key={photo.assetId}
                    className={cn(
                      "flex min-h-14 flex-wrap items-center gap-2 rounded-card border border-line bg-surface p-2"
                    )}
                  >
                    <Photo
                      src={`/api/media/${encodeURIComponent(photo.assetId)}/thumb`}
                      alt=""
                      ratio="1/1"
                      className="size-10 shrink-0"
                    />
                    <StatusChip state={OUTCOME_CHIP[photo.outcome]} />
                    <span className="text-meta text-ink-muted">
                      Sent {shortDay(photo.uploadedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {sent ? (
            <Notice tone="positive" role="status">
              {sent === "created" ? REPORT_COPY.sent : REPORT_COPY.alreadySent}
            </Notice>
          ) : null}
          {blocked ? <Notice tone="attention">{blocked}</Notice> : null}

          <div className="grid gap-2 sm:flex sm:flex-wrap">
            <Button variant="secondary" onClick={() => setReporting(true)}>
              <MegaphoneSimpleIcon data-icon="inline-start" aria-hidden />
              {SLOT_COPY.report}
            </Button>
          </div>
        </div>
      </div>

      {target.kind !== "amenity" ? (
        <div className="sticky bottom-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom,0px)+0.5rem)] z-dock md:static">
          <Button
            variant="primary"
            size="lg"
            className="min-h-14 w-full md:w-auto"
            disabled={!canAdd}
            onClick={add}
          >
            <ImagesIcon data-icon="inline-start" aria-hidden />
            {empty ? "Add photos for this slot" : "Add more photos"}
          </Button>
        </div>
      ) : null}

      <ReportChangeDialog
        open={reporting}
        onOpenChange={setReporting}
        subject={{
          kind: target.kind,
          subjectId:
            target.kind === "dish"
              ? target.itemId
              : target.kind === "area"
                ? target.subjectId
                : target.checkId,
          name: slot.name,
        }}
        send={sendReport}
        onSent={(created) => setSent(created ? "created" : "open")}
      />
    </div>
  )
}
