"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowCounterClockwiseIcon,
  DownloadSimpleIcon,
  MapPinIcon,
  StarIcon,
  TrashIcon,
  XCircleIcon,
} from "@phosphor-icons/react"

import { CoverageSection } from "@/components/nabalens/coverage/layout"
import { ReasonDialog } from "@/components/nabalens/coverage/reason-dialog"
import { Notice } from "@/components/nabalens/notice"
import { OptionSelect } from "@/components/nabalens/option-select"
import { StatusChip } from "@/components/nabalens/status-chip"
import type { Option } from "@/components/nabalens/types"
import { Button, buttonVariants } from "@/components/ui/button"
import { FormField } from "@/components/ui/field"
import { Photo } from "@/components/ui/photo"
import {
  CAPTURE_SOURCE_WORDS,
  canSelectPrimary,
  EVIDENCE_WORDS,
  HISTORY_WORDS,
  orientationOf,
  ORIENTATION_WORDS,
  REVIEW_WORDS,
  SLOT_KIND_WORDS,
  USAGE_WORDS,
  type AssetDetail,
  type AssetSlot,
} from "@/lib/library/model"

import {
  correctVenueAction,
  restoreAssetAction,
  selectPrimaryAction,
  setCollectionItemsAction,
  tagAssetsAction,
  withdrawAssetAction,
} from "../actions"
import { formatBytes, formatWhen, reviewTone, usageTone } from "./format"

/*
 * Asset detail (spec §8 A4, §11; S2-LIBRARY): original provenance, renditions,
 * labels and their history, review decisions, the slots it is used for with
 * Select primary, eligibility, evidence links, exports and publication, tags,
 * collections, possible duplicates, withdrawal, removal and venue
 * corrections. Admins only. Feedback is written beside the control (§6.7);
 * the page refreshes after each change.
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

  return (
    <div className="grid gap-6" data-testid="asset-detail">
      <div className="grid gap-4 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] md:items-start">
        {removed ? (
          <Notice tone="negative" role="status">
            Permanently removed {formatWhen(a.deletedAt, tz)}. The record and
            its history are kept.
          </Notice>
        ) : (
          <Photo
            src={`/api/media/${a.id}/${a.mediaType === "video" ? "thumb" : "preview"}`}
            alt={`Photo by ${a.uploaderName} at ${a.venueName}`}
            ratio="4/3"
            radius="card"
            eager
          />
        )}
        <div className="grid min-w-0 gap-3">
          <div className="flex flex-wrap gap-2" data-testid="asset-state">
            {detail.review ? (
              <StatusChip tone={reviewTone(detail.review)}>
                {REVIEW_WORDS[detail.review]}
              </StatusChip>
            ) : null}
            {detail.withdrawal ? (
              <StatusChip tone="closed">Withdrawn from use</StatusChip>
            ) : null}
            {detail.exportEligible ? (
              <StatusChip tone="neutral">Can be exported</StatusChip>
            ) : (
              <StatusChip tone="closed">Not exportable</StatusChip>
            )}
            {a.duplicateOfAssetId ? (
              <StatusChip tone="attention">
                Duplicate of another file
              </StatusChip>
            ) : null}
          </div>
          {detail.withdrawal ? (
            <Notice tone="attention" role="status">
              Withdrawn {formatWhen(detail.withdrawal.withdrawnAt, tz)}
              {detail.withdrawal.byName
                ? ` by ${detail.withdrawal.byName}`
                : ""}
              : {detail.withdrawal.reason}. It is kept, but it can't be exported
              or made a main photo until it is restored.
            </Notice>
          ) : null}
          {removed ? null : <AssetActions detail={detail} options={options} />}
        </div>
      </div>

      <CoverageSection title="Where it's used" id="slots">
        {detail.slots.length === 0 ? (
          <p className="text-body text-ink-muted">
            Not linked to a dish, place or facility yet.
          </p>
        ) : (
          <ul className="grid gap-2" data-testid="asset-slots">
            {detail.slots.map((slot) => (
              <SlotRow
                key={`${slot.kind}:${slot.slotId}`}
                detail={detail}
                slot={slot}
              />
            ))}
          </ul>
        )}
      </CoverageSection>

      <CoverageSection title="Original and provenance" id="provenance">
        <dl className="grid gap-2 rounded-card border border-line bg-surface p-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <Term label="Taken by">
            <Link
              href={`/admin/staff/${a.uploaderId}`}
              className="font-bold text-accent-text underline underline-offset-4"
            >
              {a.uploaderName}
            </Link>
            {a.uploaderActive ? "" : " (no longer active)"}
          </Term>
          <Term label="Venue at upload">{a.venueName}</Term>
          <Term label="Uploaded">{formatWhen(a.createdAt, tz)}</Term>
          <Term label="Taken">
            {a.capturedAt
              ? `${formatWhen(a.capturedAt, tz)} (${CAPTURE_SOURCE_WORDS[a.capturedAtSource] ?? a.capturedAtSource})`
              : "Unknown"}
          </Term>
          <Term label="Original file">
            <span className="font-mono [overflow-wrap:anywhere]">
              {[
                a.originalFilename,
                a.mimeType,
                a.sizeBytes ? formatBytes(a.sizeBytes) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </Term>
          <Term label="Size">
            {a.width && a.height
              ? `${a.width} × ${a.height}${orientation ? ` · ${ORIENTATION_WORDS[orientation]}` : ""}`
              : "Unknown"}
            {a.durationSeconds ? ` · ${Math.round(a.durationSeconds)} s` : ""}
          </Term>
          <Term label="File fingerprint">
            <span className="font-mono [overflow-wrap:anywhere]">
              {a.contentSha256 ? a.contentSha256.slice(0, 16) : "Not recorded"}
            </span>
          </Term>
        </dl>
        {detail.corrections.length > 0 ? (
          <ul className="grid gap-2" data-testid="asset-corrections">
            {detail.corrections.map((c) => (
              <li
                key={c.id}
                className="rounded-card border border-line bg-surface p-3 text-body"
              >
                Venue corrected from {c.declaredVenueName ?? "unknown"} to{" "}
                <strong>{c.correctedVenueName ?? "unknown"}</strong> by{" "}
                {c.byName ?? "an admin"}, {formatWhen(c.at, tz)}: {c.reason}
              </li>
            ))}
          </ul>
        ) : null}
      </CoverageSection>

      <CoverageSection title="Renditions" count={detail.renditions.length}>
        {detail.renditions.length === 0 ? (
          <p className="text-body text-ink-muted">
            Only the original is stored.
          </p>
        ) : (
          <ul className="grid gap-2">
            {detail.renditions.map((r) => (
              <li
                key={r.kind}
                className="grid gap-1 rounded-card border border-line bg-surface p-3"
              >
                <span className="text-body font-bold capitalize">{r.kind}</span>
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
              text: `${h.action.replace(/_/g, " ")}${h.byName ? ` by ${h.byName}` : ""}`,
              at: h.at,
            }))}
            tz={tz}
          />
        ) : null}
      </CoverageSection>

      <CoverageSection title="Review history" count={detail.decisions.length}>
        {detail.decisions.length === 0 ? (
          <p className="text-body text-ink-muted">No decisions yet.</p>
        ) : (
          <History
            label="Review decisions"
            rows={detail.decisions.map((d, i) => ({
              key: `${d.at}-${i}`,
              text: `${SLOT_KIND_WORDS[d.kind] ?? d.kind} ${d.slotName}: ${d.action.replace(/_/g, " ")}${d.to && d.to !== d.action ? ` (${d.to.replace(/_/g, " ")})` : ""}${d.byName ? ` by ${d.byName}` : ""}${d.selfReview ? " (own photo)" : ""}${d.reason ? `. ${d.reason}` : ""}`,
              at: d.at,
            }))}
            tz={tz}
          />
        )}
      </CoverageSection>

      {detail.evidence.length > 0 ? (
        <CoverageSection title="Evidence for">
          <ul className="grid gap-1 text-body">
            {detail.evidence.map((e, i) => (
              <li key={`${e.kind}-${i}`}>
                {EVIDENCE_WORDS[e.kind] ?? e.kind}: {e.name.replace(/_/g, " ")}
              </li>
            ))}
          </ul>
        </CoverageSection>
      ) : null}

      <CoverageSection title="Exports and publication">
        {!detail.exports || detail.exports.packages.length === 0 ? (
          <p className="text-body text-ink-muted">Never exported.</p>
        ) : (
          <ul className="grid gap-2" data-testid="asset-exports">
            {detail.exports.packages.map((p) => (
              <li
                key={p.packageId}
                className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface p-3"
              >
                <Link
                  href={`/admin/publishing/packages/${p.packageId}`}
                  className="font-bold text-accent-text underline underline-offset-4"
                >
                  {p.profile ?? "Package"} · {formatWhen(p.createdAt, tz)}
                </Link>
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
      </CoverageSection>

      <CoverageSection
        title="Possible duplicates"
        count={detail.duplicates.length}
      >
        {detail.duplicates.length === 0 ? (
          <p className="text-body text-ink-muted">
            No other file with the same content.
          </p>
        ) : (
          <ul className="grid gap-2" data-testid="asset-duplicates">
            {detail.duplicates.map((d) => (
              <li
                key={d.assetId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-line bg-surface p-3"
              >
                <span className="text-body">
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
        {detail.history.length === 0 && detail.removalRequests.length === 0 ? (
          <p className="text-body text-ink-muted">Nothing else recorded.</p>
        ) : (
          <History
            label="Withdrawals, tags and removal"
            rows={detail.history.map((h, i) => ({
              key: `${h.at}-${i}`,
              text: `${HISTORY_WORDS[h.action] ?? h.action.replace(/_/g, " ")}${h.byName ? ` by ${h.byName}` : ""}${h.reason ? `: ${h.reason}` : ""}`,
              at: h.at,
            }))}
            tz={tz}
          />
        )}
      </CoverageSection>
    </div>
  )
}

function Term({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <>
      <dt className="text-body text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-body text-ink">{children}</dd>
    </>
  )
}

function History({
  label,
  rows,
  tz,
}: {
  label: string
  rows: { key: string; text: string; at: string }[]
  tz: string
}) {
  return (
    <ol aria-label={label} className="grid gap-1.5">
      {rows.map((r) => (
        <li
          key={r.key}
          className="grid gap-0.5 border-s-2 border-line ps-3 text-body"
        >
          <span className="[overflow-wrap:anywhere]">{r.text}</span>
          <span className="font-mono text-meta text-ink-muted">
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
    <li className="grid gap-2 rounded-card border border-line bg-surface p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="grid min-w-0 gap-1">
        <span className="text-body font-bold [overflow-wrap:anywhere]">
          {SLOT_KIND_WORDS[slot.kind]}: {slot.name}
          {slot.variantName ? ` · ${slot.variantName}` : ""}
        </span>
        <span className="flex flex-wrap gap-2">
          <StatusChip tone={usageTone(slot.state)}>
            {USAGE_WORDS[slot.state] ?? slot.state.replace(/_/g, " ")}
          </StatusChip>
          {slot.isPrimary ? (
            <StatusChip tone="positive">Main photo</StatusChip>
          ) : null}
        </span>
        {error ? (
          <p role="alert" className="text-body font-semibold text-warn-fg">
            {error}
          </p>
        ) : null}
      </div>
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

/** The asset's actions: export, tags, collections, withdraw/restore, venue, removal. */
function AssetActions({
  detail,
  options,
}: {
  detail: AssetDetail
  options: AssetDetailOptions
}) {
  const router = useRouter()
  const a = detail.asset
  const [dialog, setDialog] = React.useState<
    "withdraw" | "restore" | "venue" | null
  >(null)
  const [venueId, setVenueId] = React.useState<string | null>(null)
  const [message, setMessage] = React.useState<string | null>(null)

  const done = (text: string) => {
    setMessage(text)
    router.refresh()
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        {detail.exportEligible ? (
          <Link
            href={`/admin/publishing/new?venue=${a.venueId}&assets=${a.id}`}
            className={buttonVariants({ variant: "primary" })}
          >
            <DownloadSimpleIcon aria-hidden />
            Export this photo
          </Link>
        ) : null}
        <a
          href={`/api/media/${a.id}/download`}
          download
          className={buttonVariants({ variant: "secondary" })}
        >
          <DownloadSimpleIcon aria-hidden />
          Download original
        </a>
        {detail.withdrawal ? (
          <Button variant="secondary" onClick={() => setDialog("restore")}>
            <ArrowCounterClockwiseIcon aria-hidden />
            Restore
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => setDialog("withdraw")}>
            <XCircleIcon aria-hidden />
            Withdraw from use
          </Button>
        )}
        <Button variant="secondary" onClick={() => setDialog("venue")}>
          <MapPinIcon aria-hidden />
          Correct venue
        </Button>
        <Link
          href={`/admin/library/${a.id}/remove`}
          className={buttonVariants({ variant: "danger-quiet" })}
        >
          <TrashIcon aria-hidden />
          Permanently remove…
        </Link>
      </div>
      {message ? (
        <Notice role="status" tone="positive">
          {message}
        </Notice>
      ) : null}
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
        chosen={detail.collections.map((c) => ({ id: c.id, name: c.name }))}
        options={options.collections}
        manageHref="/admin/library/collections"
        manageLabel="All collections"
        onChange={(id, add) =>
          setCollectionItemsAction({ collectionId: id, assetIds: [a.id], add })
        }
      />

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
        open={dialog === "venue"}
        onOpenChange={(o) => setDialog(o ? "venue" : null)}
        title="Correct the venue"
        description={`Recorded at ${a.venueName}. Use this only when the venue was entered by mistake. The original record is kept, the photo is withdrawn from use, and it needs reviewing again at the right venue.`}
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
    </div>
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
    <div className="grid gap-2 rounded-card border border-line bg-surface p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-body font-bold text-ink">{label}</h3>
        <Link
          href={manageHref}
          className="text-body text-accent-text underline underline-offset-4"
        >
          {manageLabel}
        </Link>
      </div>
      {chosen.length === 0 ? (
        <p className="text-body text-ink-muted">None.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {chosen.map((c) => (
            <li key={c.id}>
              <Button
                variant="secondary"
                size="sm"
                disabled={pending}
                onClick={() => run(c.id, false)}
                aria-label={`Remove ${c.name}`}
              >
                {c.name}
                <XCircleIcon aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
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
