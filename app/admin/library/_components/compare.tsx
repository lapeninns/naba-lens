import Link from "next/link"

import { MetaList } from "@/components/nabalens/meta-list"
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
            className="grid content-start gap-3 rounded-card bg-surface p-3 shadow-card"
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
            <MetaList
              items={[
                { label: "Venue", value: d.asset.venueName },
                { label: "Taken by", value: d.asset.uploaderName },
                {
                  label: "Uploaded",
                  value: formatWhen(d.asset.createdAt, d.asset.timezone),
                },
                {
                  label: "Taken",
                  value: d.asset.capturedAt
                    ? formatWhen(d.asset.capturedAt, d.asset.timezone)
                    : "Unknown",
                },
                {
                  label: "Size",
                  value: `${
                    d.asset.width && d.asset.height
                      ? `${d.asset.width} × ${d.asset.height}`
                      : "Unknown"
                  }${d.asset.sizeBytes ? ` · ${formatBytes(d.asset.sizeBytes)}` : ""}`,
                },
                {
                  label: "Used for",
                  value:
                    d.slots.length === 0
                      ? "Nothing yet"
                      : d.slots
                          .map(
                            (s) =>
                              `${s.name} (${usageWord(s.state)}${s.isPrimary ? ", main photo" : ""})`
                          )
                          .join("; "),
                },
              ]}
            />
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
