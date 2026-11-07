"use client"

import {
  CheckCircleIcon,
  FilmStripIcon,
  ProhibitIcon,
} from "@phosphor-icons/react"

import { UI_TEXT, type SubmittableAsset } from "@/lib/amenities/contract"
import { cn } from "@/lib/utils"

import { EvidenceThumb } from "../../coverage/evidence-image"
import { formatDateTime } from "../../tasks/copy"

export function assetLabel(asset: SubmittableAsset): string {
  return `${asset.kind === "video" ? "Video" : "Photo"} added ${formatDateTime(asset.createdAt)}`
}

function AssetTile({
  asset,
  checked,
  blocked,
  note,
  onToggle,
  disabled,
}: {
  asset: SubmittableAsset
  checked: boolean
  blocked: boolean
  note: string | null
  onToggle: () => void
  disabled: boolean
}) {
  const noteId = `asset-note-${asset.assetId}`
  return (
    <li className="flex min-w-0 flex-col gap-1">
      <label
        className={cn(
          "relative grid cursor-pointer gap-1 rounded-chip p-1 has-checked:bg-accent-soft has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus",
          (blocked || disabled) && !checked && "cursor-not-allowed opacity-60"
        )}
      >
        {asset.kind === "video" && !asset.thumbUrl ? (
          <span className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 rounded-print bg-media-placeholder text-meta text-ink-muted">
            <FilmStripIcon className="size-6" aria-hidden />
            Video
          </span>
        ) : (
          <span className="relative block">
            <EvidenceThumb src={asset.thumbUrl} />
            {asset.kind === "video" ? (
              <span className="absolute bottom-1 left-1 inline-flex items-center gap-1 rounded-round bg-ink/80 px-1.5 py-0.5 text-chip text-paper">
                <FilmStripIcon className="size-3.5" aria-hidden />
                Video
              </span>
            ) : null}
          </span>
        )}
        {checked ? (
          <span className="absolute top-2 right-2 rounded-full bg-background text-primary">
            <CheckCircleIcon weight="fill" className="size-6" aria-hidden />
          </span>
        ) : null}
        <span className="flex min-h-11 items-center gap-2 text-meta-touch md:min-h-0 md:text-meta">
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled || (blocked && !checked)}
            onChange={onToggle}
            aria-label={assetLabel(asset)}
            aria-describedby={note ? noteId : undefined}
            className="size-5 shrink-0 accent-primary md:size-4"
          />
          <span className="min-w-0 break-words">
            {asset.kind === "video" ? "Video" : "Photo"}
            <span className="text-ink-muted">
              {" "}
              · {formatDateTime(asset.createdAt)}
            </span>
          </span>
        </span>
      </label>
      {note ? (
        <p
          id={noteId}
          className="flex items-start gap-1 text-meta-touch break-words text-negative md:text-meta"
        >
          <ProhibitIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {note}
        </p>
      ) : null}
    </li>
  )
}

function AssetGrid({
  label,
  assets,
  ...rest
}: {
  label: string
  assets: SubmittableAsset[]
  selected: readonly string[]
  flagged: ReadonlyMap<string, string>
  full: boolean
  disabled: boolean
  onToggle: (assetId: string) => void
}) {
  return (
    <ul
      aria-label={label}
      className="grid grid-cols-2 gap-2 min-[400px]:grid-cols-3 sm:grid-cols-4 lg:grid-cols-6"
    >
      {assets.map((asset) => {
        const checked = rest.selected.includes(asset.assetId)
        return (
          <AssetTile
            key={asset.assetId}
            asset={asset}
            checked={checked}
            blocked={rest.full || rest.flagged.has(asset.assetId)}
            note={rest.flagged.get(asset.assetId) ?? null}
            disabled={rest.disabled}
            onToggle={() => rest.onToggle(asset.assetId)}
          />
        )
      })}
    </ul>
  )
}

/**
 * The caller's own ready uploads, then (managers and admins) earlier Coverage
 * photos of this amenity at the venue. Flagged assets were refused by the last
 * submit and cannot be ticked again.
 */
export function EvidencePicker({
  assets,
  selected,
  flagged,
  maxSelected,
  disabled,
  onToggle,
}: {
  assets: SubmittableAsset[]
  selected: readonly string[]
  flagged: ReadonlyMap<string, string>
  maxSelected: number
  disabled: boolean
  onToggle: (assetId: string) => void
}) {
  const own = assets.filter((a) => a.source === "own")
  const legacy = assets.filter((a) => a.source === "legacy_coverage")
  const shared = {
    selected,
    flagged,
    full: selected.length >= maxSelected,
    disabled,
    onToggle,
  }
  return (
    <div className="flex flex-col gap-4">
      {own.length > 0 ? (
        <AssetGrid label="Your photos and videos" assets={own} {...shared} />
      ) : null}
      {legacy.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h4 className="text-label-touch text-ink md:text-label">
            {UI_TEXT.legacyMedia}
          </h4>
          <AssetGrid label={UI_TEXT.legacyMedia} assets={legacy} {...shared} />
        </div>
      ) : null}
    </div>
  )
}
