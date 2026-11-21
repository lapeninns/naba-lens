"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowCounterClockwiseIcon,
  DownloadSimpleIcon,
  ExportIcon,
  StarIcon,
} from "@phosphor-icons/react"

import { CoverageSection } from "@/components/nabalens/coverage/layout"
import { MetaList } from "@/components/nabalens/meta-list"
import { ReasonDialog } from "@/components/nabalens/coverage/reason-dialog"
import { Notice } from "@/components/nabalens/notice"
import { OptionSelect } from "@/components/nabalens/option-select"
import { StatusChip } from "@/components/nabalens/status-chip"
import type { Option } from "@/components/nabalens/types"
import { Button, buttonVariants } from "@/components/ui/button"
import { FilterPill, PillGroup } from "@/components/ui/filter-pill"
import { FormField } from "@/components/ui/field"
import { Photo } from "@/components/ui/photo"
import { cn } from "@/lib/utils"
import {
  CAPTURE_SOURCE_WORDS,
  canSelectPrimary,
  EVIDENCE_WORDS,
  HISTORY_WORDS,
  orientationOf,
  ORIENTATION_WORDS,
  REVIEW_CHIP,
  REVIEW_WORDS,
  SLOT_KIND_WORDS,
  USAGE_CHIP,
  type AssetDetail,
  type AssetSlot,
} from "@/lib/library/model"

import {
  correctVenueAction,
  restoreAssetAction,
  selectPrimaryAction,
  setCollectionItemsAction,
  suspendAssetAction,
  tagAssetsAction,
  withdrawAssetAction,
} from "../actions"
import { formatBytes, formatWhen } from "./format"

/*
 * Asset detail (spec §8 A4, §11; S2-LIBRARY): original provenance, renditions,
 * labels and their history, review decisions, the slots it is used for with
 * Select primary, eligibility, evidence links, exports and publication, tags,
 * collections, possible duplicates, withdrawal, removal and venue
 * corrections. Admins only. Feedback is written beside the control (§6.7);
 * the page refreshes after each change. Laid out as the handoff's "One
 * photo": the photo and where it is used on the left; provenance, tags and
 * collections, and taking it out of use in a side column.
 */

export type AssetDetailOptions = {
  venues: Option[]
  tags: Option[]
  collections: Option[]
}

export function AssetDetailView({
  detail,
  options,
}: {
  detail: AssetDetail
  options: AssetDetailOptions
}) {
  const a = detail.asset
  const tz = a.timezone
  const removed = a.deletedAt !== null
  const orientation = orientationOf(a.width, a.height)
  const packages = detail.exports?.packages ?? []

  return (
    <div className="grid gap-6" data-testid="asset-detail">
      {/* Under the title (the photo's label, set by the page): its review in
          chips, the file and whether it can be exported, then the two
          actions that take a copy away (handoff "One photo"). */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div
          className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
          data-testid="asset-state"
        >
          {detail.review ? (
            <StatusChip state={REVIEW_CHIP[detail.review]} />
          ) : null}
          {detail.withdrawal ? (
            <StatusChip tone="closed">Withdrawn from use</StatusChip>
          ) : null}
          {a.duplicateOfAssetId ? (
            <StatusChip tone="attention">Duplicate of another file</StatusChip>
          ) : null}
          <span className="text-meta [overflow-wrap:anywhere] text-ink-muted">
            {a.originalFilename}
            {" · "}
            {detail.exportEligible ? "can be exported" : "can't be exported"}
          </span>
        </div>
        {removed ? null : (
          <div className="flex flex-wrap gap-2">
            <a
              href={`/api/media/${a.id}/download`}
              download
              className={buttonVariants({ variant: "secondary" })}
            >
              <DownloadSimpleIcon aria-hidden />
              Download original
            </a>
            {detail.exportEligible ? (
              <Link
                href={`/admin/publishing/new?venue=${a.venueId}&assets=${a.id}`}
                className={buttonVariants({ variant: "primary" })}
              >
                <ExportIcon aria-hidden />
                Export this photo
              </Link>
            ) : null}
          </div>
        )}
      </div>

      {detail.withdrawal ? (
        <Notice tone="attention" role="status">
          Withdrawn {formatWhen(detail.withdrawal.withdrawnAt, tz)}
          {detail.withdrawal.byName
            ? ` by ${detail.withdrawal.byName}`
            : ""}: {detail.withdrawal.reason}.{" "}
          {detail.corrections.length > 0
            ? // S3-R6 (V19): a corrected photo is never restored at the
              // venue it was wrongly recorded at.
              "It was recorded at the wrong venue, so it stays withdrawn: it can't be exported or made a main photo. To use it at the right venue, add it again there."
            : "It is kept, but it can't be exported or made a main photo until it is restored."}
        </Notice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22.5rem] lg:items-start">
        <div className="grid min-w-0 gap-6">
          {removed ? (
            <Notice tone="negative" role="status">
              Permanently removed {formatWhen(a.deletedAt, tz)}. The record and
              its history are kept.
            </Notice>
          ) : (
            <div className="rounded-card bg-stage p-4">
              <Photo
                src={`/api/media/${a.id}/${a.mediaType === "video" ? "thumb" : "preview"}`}
                alt={`Photo by ${a.uploaderName} at ${a.venueName}`}
                ratio="4/3"
                eager
              />
            </div>
          )}

          <CoverageSection title="Where it's used" id="slots">
            <div className="overflow-hidden rounded-card border border-line bg-surface">
              {detail.slots.length === 0 ? (
                <p className={cn(ROW, "text-body text-ink-muted")}>
                  Not linked to a dish, place or facility yet.
                </p>
              ) : (
                <ul
                  className="divide-y divide-line"
                  data-testid="asset-slots"
                  aria-label="Dishes, places and facilities"
                >
                  {detail.slots.map((slot) => (
                    <SlotRow
                      key={`${slot.kind}:${slot.slotId}`}
                      detail={detail}
                      slot={slot}
                    />
                  ))}
                </ul>
              )}
              {packages.length === 0 ? (
                <p
                  className={cn(
                    ROW,
                    "border-t border-line text-body text-ink-muted"
                  )}
                >
                  Never exported.
                </p>
              ) : (
                <ul
                  className="divide-y divide-line border-t border-line"
                  data-testid="asset-exports"
                  aria-label="Exports and publication"
                >
                  {packages.map((p) => (
                    <li key={p.packageId} className={ROW}>
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <Link
                          href={`/admin/publishing/packages/${p.packageId}`}
                          className="text-label text-ink underline decoration-1 underline-offset-4 focus-ring outline-none hover:decoration-2"
                        >
                          {p.profile ?? "Package"}
                        </Link>
                        <span className="text-meta text-ink-muted">
                          Export package · {formatWhen(p.createdAt, tz)}
                        </span>
                      </span>
                      {p.invalidatedAt ? (
                        <StatusChip state="package_invalidated" />
                      ) : p.exportedAt ? (
                        <StatusChip state="package_exported" />
                      ) : (
                        <StatusChip state="package_ready" />
                      )}
                      {p.mode === "internal" ? (
                        <StatusChip state="internal_only" />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CoverageSection>

          <CoverageSection
            title="Review history"
            count={detail.decisions.length || undefined}
          >
            {detail.decisions.length === 0 ? (
              <p className="px-1 text-body text-ink-muted">No decisions yet.</p>
            ) : (
              <History
                label="Review decisions"
                rows={detail.decisions.map((d, i) => ({
                  key: `${d.at}-${i}`,
                  text: `${SLOT_KIND_WORDS[d.kind] ?? d.kind} ${d.slotName}: ${d.action.replace(/_/g, " ")}${d.to && d.to !== d.action ? ` (${d.to.replace(/_/g, " ")})` : ""}${d.selfReview ? " (own photo)" : ""}${d.reason ? `. ${d.reason}` : ""}`,
                  by: d.byName,
                  at: d.at,
                }))}
                tz={tz}
              />
            )}
          </CoverageSection>

          <CoverageSection title="Labels">
            <div className="grid gap-2 rounded-card border border-line bg-surface p-4 text-body">
              {detail.labels.items.length === 0 &&
              detail.labels.places.length === 0 &&
              !detail.labels.note ? (
                <p className="text-ink-muted">No labels.</p>
              ) : null}
              {detail.labels.items.map((i) => (
                <p key={i.itemId + (i.variantName ?? "")}>
                  {i.itemName}
                  {i.variantName ? ` · ${i.variantName}` : ""}
                  {i.sectionName ? (
                    <span className="text-ink-muted"> ({i.sectionName})</span>
                  ) : null}
                </p>
              ))}
              {detail.labels.places.map((p) => (
                <p key={p.subjectId + (p.removedAt ?? "")}>
                  {p.label}
                  {p.removedAt ? (
                    <span className="text-ink-muted"> (removed)</span>
                  ) : null}
                </p>
              ))}
              {detail.labels.note ? (
                <p className="text-ink-muted">Note: {detail.labels.note}</p>
              ) : null}
            </div>
            {detail.labelHistory.length > 0 ? (
              <History
                label="Label changes"
                rows={detail.labelHistory.map((h) => ({
                  key: h.at + h.action,
                  text: h.action.replace(/_/g, " "),
                  by: h.byName,
                  at: h.at,
                }))}
                tz={tz}
              />
            ) : null}
          </CoverageSection>

          {detail.evidence.length > 0 ? (
            <CoverageSection title="Evidence for">
              <ul className="grid gap-1 px-1 text-body">
                {detail.evidence.map((e, i) => (
                  <li key={`${e.kind}-${i}`}>
                    {EVIDENCE_WORDS[e.kind] ?? e.kind}:{" "}
                    {e.name.replace(/_/g, " ")}
                  </li>
                ))}
              </ul>
            </CoverageSection>
          ) : null}

          <CoverageSection
            title="Renditions"
            count={detail.renditions.length || undefined}
          >
            {detail.renditions.length === 0 ? (
              <p className="px-1 text-body text-ink-muted">
                Only the original is stored.
              </p>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
                {detail.renditions.map((r) => (
                  <li key={r.kind} className="grid gap-0.5 px-4 py-2.5">
                    <span className="text-label capitalize">{r.kind}</span>
                    <span className="font-mono text-meta [overflow-wrap:anywhere] text-ink-muted">
                      {[
                        r.mimeType,
                        r.width && r.height ? `${r.width} × ${r.height}` : null,
                        `pipeline ${r.pipelineVersion}`,
                        r.objectKey,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <span className="text-meta text-ink-muted">
                      Made from the unchanged original; carries its review:{" "}
                      {r.approval ? REVIEW_WORDS[r.approval] : "none"}.
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CoverageSection>

          <CoverageSection
            title="Possible duplicates"
            count={detail.duplicates.length || undefined}
          >
            {detail.duplicates.length === 0 ? (
              <p className="px-1 text-body text-ink-muted">
                No other file with the same content.
              </p>
            ) : (
              <ul
                className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface"
                data-testid="asset-duplicates"
              >
                {detail.duplicates.map((d) => (
                  <li key={d.assetId} className={ROW}>
                    <span className="min-w-0 flex-1 text-body">
                      {d.relation === "original"
                        ? "Original of this file"
                        : d.relation === "marked_duplicate"
                          ? "Marked a duplicate of this file"
                          : "Same file"}
                      : {d.venueName}, {d.uploaderName},{" "}
                      {formatWhen(d.createdAt, tz)}
                    </span>
                    <Link
                      href={`/admin/library/compare?a=${a.id}&b=${d.assetId}`}
                      className={buttonVariants({
                        variant: "secondary",
                        size: "sm",
                      })}
                    >
                      Compare
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CoverageSection>

          <CoverageSection title="History">
            {detail.history.length === 0 &&
            detail.removalRequests.length === 0 ? (
              <p className="px-1 text-body text-ink-muted">
                Nothing else recorded.
              </p>
            ) : (
              <History
                label="Withdrawals, tags and removal"
                rows={detail.history.map((h, i) => ({
                  key: `${h.at}-${i}`,
                  text: `${HISTORY_WORDS[h.action] ?? h.action.replace(/_/g, " ")}${h.reason ? `: ${h.reason}` : ""}`,
                  by: h.byName,
                  at: h.at,
                }))}
                tz={tz}
              />
            )}
          </CoverageSection>
        </div>

        <div className="grid min-w-0 gap-4">
          <SideCard title="Original and provenance" id="provenance">
            <MetaList
              items={[
                {
                  label: "Taken by",
                  value: (
                    <>
                      <Link
                        href={`/admin/staff/${a.uploaderId}`}
                        className="font-semibold text-accent-text underline underline-offset-4 focus-ring outline-none"
                      >
                        {a.uploaderName}
                      </Link>
                      {a.uploaderActive ? "" : " (no longer active)"}
                    </>
                  ),
                },
                { label: "Venue at upload", value: a.venueName },
                { label: "Uploaded", value: formatWhen(a.createdAt, tz) },
                {
                  label: "Taken",
                  value: a.capturedAt
                    ? `${formatWhen(a.capturedAt, tz)} (${CAPTURE_SOURCE_WORDS[a.capturedAtSource] ?? a.capturedAtSource})`
                    : "Capture date unknown",
                },
                {
                  label: "Original file",
                  value: (
                    <span className="font-mono [overflow-wrap:anywhere]">
                      {[
                        a.originalFilename,
                        a.mimeType,
                        a.sizeBytes ? formatBytes(a.sizeBytes) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  ),
                },
                {
                  label: "Size",
                  value: (
                    <>
                      {a.width && a.height
                        ? `${a.width} × ${a.height}${orientation ? ` · ${ORIENTATION_WORDS[orientation]}` : ""}`
                        : "Unknown"}
                      {a.durationSeconds
                        ? ` · ${Math.round(a.durationSeconds)} s`
                        : ""}
                    </>
                  ),
                },
                {
                  label: "File fingerprint",
                  value: (
                    <span className="font-mono [overflow-wrap:anywhere]">
                      {a.contentSha256
                        ? a.contentSha256.slice(0, 16)
                        : "Not recorded"}
                    </span>
                  ),
                },
              ]}
            />
            {detail.corrections.length > 0 ? (
              <ul
                className="grid gap-2 border-t border-line pt-3"
                data-testid="asset-corrections"
              >
                {detail.corrections.map((c) => (
                  <li key={c.id} className="text-body">
                    Venue corrected from {c.declaredVenueName ?? "unknown"} to{" "}
                    <strong>{c.correctedVenueName ?? "unknown"}</strong> by{" "}
                    {c.byName ?? "an admin"}, {formatWhen(c.at, tz)}: {c.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </SideCard>

          {removed ? null : (
            <>
              <SideCard title="Tags and collections" id="tags">
                <ReferenceEditor
                  label="Tags"
                  chosen={detail.tags.map((t) => ({ id: t.id, name: t.name }))}
                  options={options.tags}
                  manageHref="/admin/library/tags"
                  manageLabel="Manage tags"
                  onChange={(id, add) =>
                    tagAssetsAction({ assetIds: [a.id], tagId: id, add })
                  }
                />
                <ReferenceEditor
                  label="Collections"
                  chosen={detail.collections.map((c) => ({
                    id: c.id,
                    name: c.name,
                  }))}
                  options={options.collections}
                  manageHref="/admin/library/collections"
                  manageLabel="All collections"
                  onChange={(id, add) =>
                    setCollectionItemsAction({
                      collectionId: id,
                      assetIds: [a.id],
                      add,
                    })
                  }
                />
              </SideCard>
              <OutOfUse detail={detail} options={options} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** One row of a flush list card (v2 ListRow). */
const ROW = "flex min-h-14 flex-wrap items-center gap-3 px-4 py-2.5"

/** A titled card in the side column (handoff "One photo"). */
function SideCard({
  title,
  id,
  children,
}: {
  title: string
  id: string
  children: React.ReactNode
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="grid min-w-0 scroll-mt-4 gap-3 rounded-card border border-line bg-surface p-4"
    >
      <h2 id={`${id}-title`} className="type-heading-sm text-ink">
        {title}
      </h2>
      {children}
    </section>
  )
}

function History({
  label,
  rows,
  tz,
}: {
  label: string
  rows: { key: string; text: string; by?: string | null; at: string }[]
  tz: string
}) {
  return (
    <ol
      aria-label={label}
      className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface"
    >
      {rows.map((r) => (
        <li key={r.key} className="grid gap-0.5 px-4 py-2.5">
          <span className="text-label [overflow-wrap:anywhere] text-ink first-letter:uppercase">
            {r.text}
          </span>
          <span className="text-meta text-ink-muted">
            {r.by ? `${r.by} · ` : ""}
            {formatWhen(r.at, tz)}
          </span>
        </li>
      ))}
    </ol>
  )
}

function SlotRow({ detail, slot }: { detail: AssetDetail; slot: AssetSlot }) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)
  const selectable = canSelectPrimary(detail, slot)

  function select() {
    setError(null)
    startTransition(async () => {
      const result = await selectPrimaryAction({
        assetId: detail.asset.id,
        kind: slot.kind,
        slotId: slot.slotId,
        photoId: slot.photoId,
        itemRevision: slot.itemRevision,
      })
      if (!result.ok) setError(result.error)
      else router.refresh()
    })
  }

  return (
    <li className={ROW}>
      <span className="grid min-w-0 flex-1 basis-48 gap-0.5">
        <span className="text-label [overflow-wrap:anywhere] text-ink">
          {SLOT_KIND_WORDS[slot.kind]}: {slot.name}
          {slot.variantName ? ` · ${slot.variantName}` : ""}
        </span>
        <span className="text-meta text-ink-muted">
          {detail.asset.venueName}
        </span>
        {error ? (
          <span role="alert" className="text-body font-semibold text-warn-fg">
            {error}
          </span>
        ) : null}
      </span>
      <StatusChip state={USAGE_CHIP[slot.state] ?? slot.state} />
      {slot.isPrimary ? (
        <StatusChip tone="positive">Main photo</StatusChip>
      ) : null}
      {selectable ? (
        <Button
          variant="secondary"
          size="sm"
          loading={pending}
          onClick={select}
          aria-label={`Make this the main photo for ${slot.name}`}
        >
          <StarIcon aria-hidden />
          Make main photo
        </Button>
      ) : null}
    </li>
  )
}

/**
 * Take it out of use (handoff "One photo"): withdraw (or restore) and
 * suspend side by side, explained, then the two rarer ways out: correct the
 * venue, and remove permanently. Each asks for a reason first.
 */
function OutOfUse({
  detail,
  options,
}: {
  detail: AssetDetail
  options: AssetDetailOptions
}) {
  const router = useRouter()
  const a = detail.asset
  const [dialog, setDialog] = React.useState<
    "withdraw" | "restore" | "suspend" | "venue" | null
  >(null)
  const [venueId, setVenueId] = React.useState<string | null>(null)
  const [message, setMessage] = React.useState<string | null>(null)

  const done = (text: string) => {
    setMessage(text)
    router.refresh()
  }

  return (
    <SideCard title="Take it out of use" id="out-of-use">
      <p className="text-meta text-ink-muted">
        Withdraw keeps the photo but stops export. Suspend also withdraws every
        approval it holds.
      </p>
      <div className="flex flex-wrap gap-2">
        {detail.withdrawal &&
        detail.corrections.length > 0 ? null : detail.withdrawal ? (
          <Button variant="secondary" onClick={() => setDialog("restore")}>
            <ArrowCounterClockwiseIcon aria-hidden />
            Restore
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => setDialog("withdraw")}>
            Withdraw from use
          </Button>
        )}
        <Button
          variant="danger"
          onClick={() => setDialog("suspend")}
          data-testid="asset-suspend"
        >
          Suspend from use
        </Button>
      </div>
      <p className="flex flex-wrap items-center gap-x-2 text-label">
        <Button variant="link" onClick={() => setDialog("venue")}>
          Correct venue
        </Button>
        <span aria-hidden className="text-ink-muted">
          ·
        </span>
        <Link
          href={`/admin/library/${a.id}/remove`}
          className="inline-flex min-h-10 items-center text-accent-text underline decoration-1 underline-offset-4 focus-ring outline-none hover:decoration-2"
        >
          Remove permanently
        </Link>
      </p>
      {message ? (
        <Notice role="status" tone="positive">
          {message}
        </Notice>
      ) : null}

      <ReasonDialog
        open={dialog === "withdraw"}
        onOpenChange={(o) => setDialog(o ? "withdraw" : null)}
        title="Withdraw this photo from use?"
        description="It stays in the library with its history. It can't be exported or made a main photo, and packages holding it must be rebuilt. Review decisions are not changed."
        label="Why"
        confirmLabel="Withdraw from use"
        pendingLabel="Withdrawing…"
        destructive
        onConfirm={async (reason) => {
          const r = await withdrawAssetAction({ assetId: a.id, reason })
          if (!r.ok) return { ok: false, error: r.error }
          done("Withdrawn from use.")
          return { ok: true }
        }}
      />
      <ReasonDialog
        open={dialog === "restore"}
        onOpenChange={(o) => setDialog(o ? "restore" : null)}
        title="Restore this photo?"
        description="It can be exported and chosen as a main photo again, as its reviews allow."
        label="Why"
        confirmLabel="Restore"
        pendingLabel="Restoring…"
        onConfirm={async (reason) => {
          const r = await restoreAssetAction({ assetId: a.id, reason })
          if (!r.ok) return { ok: false, error: r.error }
          done("Restored.")
          return { ok: true }
        }}
      />
      <ReasonDialog
        open={dialog === "suspend"}
        onOpenChange={(o) => setDialog(o ? "suspend" : null)}
        title="Suspend this photo from use?"
        description="For a photo that no longer shows the venue as it is. Every approval it holds is withdrawn, so each dish, place or facility it filled needs another photo, and it can't be exported or made a main photo. It stays in the library with its history; using it again needs a new review."
        label="Why"
        confirmLabel="Suspend from use"
        pendingLabel="Suspending…"
        destructive
        onConfirm={async (reason) => {
          const r = await suspendAssetAction({ assetId: a.id, reason })
          if (!r.ok) return { ok: false, error: r.error }
          done(
            "Suspended from use. Each dish, place or facility it filled now needs another photo."
          )
          return { ok: true }
        }}
      />
      <ReasonDialog
        open={dialog === "venue"}
        onOpenChange={(o) => setDialog(o ? "venue" : null)}
        title="Correct the venue"
        description={`Recorded at ${a.venueName}. Use this only when the venue was entered by mistake. The original record is kept and the photo is withdrawn from use for good. To use it at the right venue, add it again there.`}
        label="Why"
        confirmLabel="Record correction"
        pendingLabel="Recording…"
        onConfirm={async (reason) => {
          if (!venueId) return { ok: false, error: "Choose the right venue." }
          const r = await correctVenueAction({
            assetId: a.id,
            venueId,
            reason,
          })
          if (!r.ok) return { ok: false, error: r.error }
          done("Venue correction recorded. The photo is withdrawn from use.")
          return { ok: true }
        }}
      >
        <FormField label="Right venue">
          {(c) => (
            <OptionSelect
              id={c.id}
              options={options.venues.filter((v) => v.id !== a.venueId)}
              value={venueId}
              onValueChange={setVenueId}
              placeholder="Choose a venue"
            />
          )}
        </FormField>
      </ReasonDialog>
    </SideCard>
  )
}

/** Add or remove one reference (a tag or a collection) on this asset. */
function ReferenceEditor({
  label,
  chosen,
  options,
  manageHref,
  manageLabel,
  onChange,
}: {
  label: string
  chosen: Option[]
  options: Option[]
  manageHref: string
  manageLabel: string
  onChange: (
    id: string,
    add: boolean
  ) => Promise<{ ok: true } | { ok: false; error: string }>
}) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [picked, setPicked] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const available = options.filter((o) => !chosen.some((c) => c.id === o.id))
  const heading = React.useId()

  function run(id: string, add: boolean) {
    setError(null)
    startTransition(async () => {
      const r = await onChange(id, add)
      if (!r.ok) setError(r.error)
      else {
        setPicked(null)
        router.refresh()
      }
    })
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={heading} className="text-label text-ink">
          {label}
        </h3>
        <Link
          href={manageHref}
          className="text-meta text-accent-text underline underline-offset-4 focus-ring outline-none"
        >
          {manageLabel}
        </Link>
      </div>
      {chosen.length === 0 ? (
        <p className="text-body text-ink-muted">None.</p>
      ) : (
        <PillGroup aria-labelledby={heading}>
          {chosen.map((c) => (
            <FilterPill
              key={c.id}
              removable
              removeLabel="Remove"
              disabled={pending}
              onClick={() => run(c.id, false)}
            >
              {c.name}
            </FilterPill>
          ))}
        </PillGroup>
      )}
      {available.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <FormField label={`Add to ${label.toLowerCase()}`} optional>
            {(c) => (
              <OptionSelect
                id={c.id}
                options={available}
                value={picked}
                onValueChange={setPicked}
                placeholder="Choose…"
              />
            )}
          </FormField>
          <Button
            variant="secondary"
            disabled={!picked}
            loading={pending}
            onClick={() => picked && run(picked, true)}
          >
            Add
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-body font-semibold text-warn-fg">
          {error}
        </p>
      ) : null}
    </div>
  )
}
