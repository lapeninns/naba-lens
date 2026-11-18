import Link from "next/link"

import { StatusChip } from "@/components/nabalens/status-chip"
import { buttonVariants } from "@/components/ui/button"
import { Photo } from "@/components/ui/photo"
import { REVIEW_CHIP, usageWord, type AssetDetail } from "@/lib/library/model"

import { formatBytes, formatWhen } from "./format"

/*
 * Compare suspected duplicates side by side (spec §8 A4, §12.4; AC21;
 * S2-LIBRARY). Advisory only: similar is not the same, and a better angle is
 * kept. The same file (SHA-256) is said plainly.
 */
export function CompareView({ a, b }: { a: AssetDetail; b: AssetDetail }) {
  const sameFile =
    a.asset.contentSha256 !== null &&
    a.asset.contentSha256 === b.asset.contentSha256
  return (
    <div className="grid gap-4">
      <p className="text-body" data-testid="compare-verdict">
        {sameFile
          ? "These are the same file (identical content). A duplicate adds no coverage or contribution credit."
          : "These are different files. Compare them before choosing; a similar photo may be a better angle."}
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {[a, b].map((d) => (
          <section
            key={d.asset.id}
            aria-label={`Photo by ${d.asset.uploaderName}`}
            className="grid content-start gap-3 rounded-card border border-line bg-surface p-3"
          >
            {d.asset.deletedAt ? (
              <p className="text-body text-ink-muted">Removed.</p>
            ) : (
              <Photo
                src={`/api/media/${d.asset.id}/${d.asset.mediaType === "video" ? "thumb" : "preview"}`}
                alt={`Photo by ${d.asset.uploaderName} at ${d.asset.venueName}`}
                ratio="4/3"
              />
            )}
            <div className="flex flex-wrap gap-2">
              {d.review ? <StatusChip state={REVIEW_CHIP[d.review]} /> : null}
              {d.withdrawal ? (
                <StatusChip tone="closed">Withdrawn from use</StatusChip>
              ) : null}
            </div>
            <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-1.5 text-body">
              <dt className="text-ink-muted">Venue</dt>
              <dd>{d.asset.venueName}</dd>
              <dt className="text-ink-muted">Taken by</dt>
              <dd>{d.asset.uploaderName}</dd>
              <dt className="text-ink-muted">Uploaded</dt>
              <dd>{formatWhen(d.asset.createdAt, d.asset.timezone)}</dd>
              <dt className="text-ink-muted">Taken</dt>
              <dd>
                {d.asset.capturedAt
                  ? formatWhen(d.asset.capturedAt, d.asset.timezone)
                  : "Unknown"}
              </dd>
              <dt className="text-ink-muted">Size</dt>
              <dd>
                {d.asset.width && d.asset.height
                  ? `${d.asset.width} × ${d.asset.height}`
                  : "Unknown"}
                {d.asset.sizeBytes
                  ? ` · ${formatBytes(d.asset.sizeBytes)}`
                  : ""}
              </dd>
              <dt className="text-ink-muted">Used for</dt>
              <dd>
                {d.slots.length === 0
                  ? "Nothing yet"
                  : d.slots
                      .map(
                        (s) =>
                          `${s.name} (${usageWord(s.state)}${s.isPrimary ? ", main photo" : ""})`
                      )
                      .join("; ")}
              </dd>
            </dl>
            <Link
              href={`/admin/library/${d.asset.id}`}
              className={buttonVariants({ variant: "secondary" })}
            >
              Open details
            </Link>
          </section>
        ))}
      </div>
    </div>
  )
}
