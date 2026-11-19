"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowCounterClockwiseIcon,
  DownloadSimpleIcon,
  MapPinIcon,
  ProhibitIcon,
  StarIcon,
  TrashIcon,
  XCircleIcon,
} from "@phosphor-icons/react"

import { CoverageSection } from "@/components/nabalens/coverage/layout"
import { MetaList } from "@/components/nabalens/meta-list"
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
              <StatusChip state={REVIEW_CHIP[detail.review]} />
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
              : {detail.withdrawal.reason}.{" "}
              {detail.corrections.length > 0
                ? // S3-R6 (V19): a corrected photo is never restored at the
                  // venue it was wrongly recorded at.
                  "It was recorded at the wrong venue, so it stays withdrawn: it can't be exported or made a main photo. To use it at the right venue, add it again there."
                : "It is kept, but it can't be exported or made a main photo until it is restored."}
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
        <div className="rounded-card bg-surface p-4 shadow-card">
          <MetaList
            items={[
              {
                label: "Taken by",
                value: (
                  <>
                    <Link
                      href={`/admin/staff/${a.uploaderId}`}
                      className="font-semibold text-accent-text underline underline-offset-4"
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
                value: (
                  <>
                    {a.capturedAt
                      ? `${formatWhen(a.capturedAt, tz)} (${CAPTURE_SOURCE_WORDS[a.capturedAtSource] ?? a.capturedAtSource})`
                      : "Unknown"}
                  </>
                ),
              },
              {
                label: "Original file",
                value: (
                  <>
                    <span className="font-mono [overflow-wrap:anywhere]">
                      {[
                        a.originalFilename,
                        a.mimeType,
                        a.sizeBytes ? formatBytes(a.sizeBytes) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </>
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
                  <>
                    <span className="font-mono [overflow-wrap:anywhere]">
                      {a.contentSha256
                        ? a.contentSha256.slice(0, 16)
                        : "Not recorded"}
                    </span>
                  </>
                ),
              },
            ]}
          />
        </div>
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
                <span className="text-body font-semibold capitalize">
                  {r.kind}
                </span>
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
                  className="font-semibold text-accent-text underline underline-offset-4"
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
        <span className="text-body font-semibold [overflow-wrap:anywhere]">
          {SLOT_KIND_WORDS[slot.kind]}: {slot.name}
          {slot.variantName ? ` · ${slot.variantName}` : ""}
        </span>
        <span className="flex flex-wrap gap-2">
          <StatusChip state={USAGE_CHIP[slot.state] ?? slot.state} />
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
    "withdraw" | "restore" | "suspend" | "venue" | null
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
        {detail.withdrawal &&
        detail.corrections.length > 0 ? null : detail.withdrawal ? (
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
        <Button
          variant="secondary"
          onClick={() => setDialog("suspend")}
          data-testid="asset-suspend"
        >
          <ProhibitIcon aria-hidden />
          Suspend from use
        </Button>
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
        <h3 className="text-body font-semibold text-ink">{label}</h3>
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
