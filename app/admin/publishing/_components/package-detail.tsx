import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/ssr"

import { Notice } from "@/components/nabalens/notice"
import { StatusChip } from "@/components/nabalens/status-chip"
import { buttonVariants } from "@/components/ui/button"
import { downloadHref, type ExportArea } from "@/lib/server/exports/hrefs"
import {
  RESTRICTION_WORDS,
  type ExportPackageDetail,
  type PublicationDestination,
} from "@/lib/server/exports/model"
import { cn } from "@/lib/utils"

import {
  CATEGORY_WORDS,
  DOWNLOAD_NOTICES,
  EXPORTS_COPY,
  londonDate,
  PACKAGE_CHIP,
  publicationChip,
  staleChip,
} from "./copy"
import { RebuildButton, RecordPublishedForm } from "./publication-forms"

/*
 * One export package (spec §14.1, §8 A5). What is wrong comes first
 * (DESIGN.md §11 rule 3): a package with a photo withdrawn or changed since can't be
 * downloaded and offers Rebuild (AC32). The main button is Download ZIP; the
 * browser saves the file and stays here. Each photo shows its publication
 * state; an admin can record where it is published (AC31: Exported is not
 * Published until a person records it).
 */
export function PackageDetail({
  area,
  pkg,
  notice,
  destinations,
  today,
}: {
  area: ExportArea
  pkg: ExportPackageDetail
  /** ?download= outcome from the download route. */
  notice: string | null
  /** Admins: the destinations they can record against. Null for managers. */
  destinations: PublicationDestination[] | null
  today: string
}) {
  const blocked = pkg.state === "invalidated" || pkg.state === "needs_rebuild"
  const stale = new Set(pkg.staleAssets)
  return (
    <div className="grid gap-6">
      {notice && DOWNLOAD_NOTICES[notice] ? (
        <Notice tone="attention" role="alert">
          {DOWNLOAD_NOTICES[notice]}
        </Notice>
      ) : null}

      <section className="grid gap-3 rounded-card border border-line bg-surface p-4">
        <div className="flex flex-wrap gap-1.5">
          <StatusChip state={PACKAGE_CHIP[pkg.state]} />
          {pkg.mode === "internal" ? (
            <StatusChip state="internal_only" />
          ) : null}
        </div>
        <p className="text-body text-ink">
          {EXPORTS_COPY.items(pkg.itemCount)} · {pkg.profile.label}
          {pkg.profile.maxWidth && pkg.profile.maxHeight
            ? ` (fits ${pkg.profile.maxWidth} × ${pkg.profile.maxHeight})`
            : ""}
        </p>
        {pkg.note ? <p className="text-body text-ink">{pkg.note}</p> : null}
        <p className="text-meta text-ink-muted">
          {EXPORTS_COPY.madeBy(pkg.createdBy, londonDate(pkg.createdAt))}
          {pkg.rebuiltFrom ? ` · ${EXPORTS_COPY.rebuilt}` : ""}
        </p>
        {blocked ? (
          <>
            <p className="text-body text-ink">
              {pkg.staleAssets.length === 1
                ? "1 photo in this package was withdrawn or changed after it was made, so the package can't be downloaded."
                : `${pkg.staleAssets.length} photos in this package were withdrawn or changed after it was made, so the package can't be downloaded.`}
            </p>
            {pkg.staleAssets.length < pkg.itemCount ? (
              <RebuildButton area={area} packageId={pkg.id} primary />
            ) : (
              <p className="text-body text-ink">
                No photo in it can be downloaded now. Make a new package
                instead.
              </p>
            )}
          </>
        ) : (
          <a
            href={downloadHref(area, pkg.id)}
            className={cn(
              buttonVariants({ variant: "primary", size: "lg" }),
              "w-full sm:w-auto"
            )}
            download
          >
            <DownloadSimpleIcon aria-hidden weight="bold" />
            {EXPORTS_COPY.download}
          </a>
        )}
        <p className="text-meta text-ink-muted">{EXPORTS_COPY.readMe(area)}</p>
      </section>

      <section aria-labelledby="package-photos" className="grid gap-3">
        <h2 id="package-photos" className="type-section-title text-ink">
          Photos
        </h2>
        <ul className="grid gap-3">
          {pkg.items.map((item) => (
            <li
              key={`${item.position}`}
              className="grid gap-3 rounded-card border border-line bg-surface p-3 sm:grid-cols-[88px_minmax(0,1fr)]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL behind an authorised route */}
              <img
                src={`/api/exports/thumb/${item.assetId}`}
                alt=""
                width={88}
                height={88}
                loading="lazy"
                className="size-22 rounded-control bg-surface-2 object-cover"
              />
              <div className="grid min-w-0 gap-1.5">
                <p className="text-label break-words text-ink">
                  {item.subjectLabel}
                </p>
                <p className="text-meta break-all text-ink-muted">
                  {CATEGORY_WORDS[item.category]} · {item.filenameStem}
                </p>
                {item.altText ? (
                  <p className="text-body text-ink">Alt text: {item.altText}</p>
                ) : null}
                {item.useRestrictions.length > 0 ? (
                  <ul className="text-meta text-ink">
                    {item.useRestrictions.map((r) => (
                      <li key={r}>{RESTRICTION_WORDS[r] ?? r}</li>
                    ))}
                  </ul>
                ) : null}
                <div className="flex flex-wrap gap-1.5">
                  {stale.has(item.assetId) || !item.eligible ? (
                    <StatusChip state={staleChip(item.staleReason)} />
                  ) : null}
                  <StatusChip state={publicationChip(item.publication.state)} />
                </div>
                {item.publication.destinations.length > 0 ? (
                  <ul className="grid gap-1 text-meta text-ink">
                    {item.publication.destinations.map((d) => (
                      <li key={d.destinationId}>
                        {d.label}:{" "}
                        <StatusChip state={publicationChip(d.state)} />
                        {d.externalUrl ? (
                          <>
                            {" "}
                            <a
                              href={d.externalUrl}
                              className="underline underline-offset-4"
                              rel="noreferrer noopener"
                              target="_blank"
                            >
                              Open page
                            </a>
                          </>
                        ) : d.externalRef ? (
                          ` ${d.externalRef}`
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {destinations &&
                pkg.mode === "public" &&
                item.eligible &&
                !stale.has(item.assetId) ? (
                  <details className="rounded-control border border-line p-3">
                    <summary className="cursor-pointer text-label text-ink focus-ring">
                      Record where it&apos;s published
                    </summary>
                    <div className="mt-3">
                      <RecordPublishedForm
                        assetId={item.assetId}
                        packageId={pkg.id}
                        destinations={destinations.filter(
                          (d) =>
                            d.venueId === null || d.venueId === item.venueId
                        )}
                        today={today}
                      />
                    </div>
                  </details>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {pkg.downloads.length > 0 ? (
        <section aria-labelledby="package-downloads" className="grid gap-2">
          <h2 id="package-downloads" className="type-section-title text-ink">
            Downloads
          </h2>
          <ul className="grid gap-1 text-body text-ink">
            {pkg.downloads.map((d) => (
              <li key={d.id}>
                {londonDate(d.startedAt)} · {d.downloadedBy ?? "Someone"} ·{" "}
                {d.completedAt
                  ? `Exported, ${EXPORTS_COPY.items(d.fileCount ?? 0)}`
                  : d.failedAt
                    ? "Didn't finish"
                    : "Started"}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
