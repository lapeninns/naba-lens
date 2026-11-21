import { EmptyState } from "@/components/nabalens/empty-state"
import { StatusChip } from "@/components/nabalens/status-chip"
import type {
  ExportProfile,
  PublicationOverview,
} from "@/lib/server/exports/model"

import { ACTION_WORDS, EXPORTS_COPY, londonDate, publicationChip } from "./copy"
import {
  ConfirmRemovedForm,
  DestinationForm,
  ProfileForm,
} from "./publication-forms"

/*
 * The publication parts of A5 (spec §8 A5, §14.2): what needs following up,
 * destinations, what is published, the latest records and (admins) the
 * output sizes. Managers see their venue's, read only (`canRecord` false).
 * Withdrawal pending stays until a person confirms the external copy is gone;
 * nothing here claims a downloaded copy is recalled.
 */

const Card = ({ children }: { children: React.ReactNode }) => (
  <div className="grid gap-3 rounded-card border border-line bg-surface p-4">
    {children}
  </div>
)

function ExternalLink({
  url,
  reference,
}: {
  url: string | null
  reference: string | null
}) {
  if (url)
    return (
      <a
        href={url}
        className="break-all underline underline-offset-4"
        rel="noreferrer noopener"
        target="_blank"
      >
        {url}
      </a>
    )
  return reference ? <span>{reference}</span> : null
}

export function PublicationPanels(
  props:
    | {
        part: "outstanding"
        overview: PublicationOverview | null
        today: string
      }
    | {
        part: "rest"
        overview: PublicationOverview | null
        venues?: { id: string; name: string }[]
        profiles?: ExportProfile[]
        today: string
        /**
         * One section of the rest, for a page that folds each into its own
         * disclosure (the manager's Exports, second handoff). Omit for all.
         */
        only?: "destinations" | "published" | "recent"
        /** Leave out the section's own heading (the disclosure names it). */
        bare?: boolean
      }
) {
  const { overview, today } = props
  if (!overview) return null
  const canRecord = overview.canRecord

  if (props.part === "outstanding") {
    return (
      <section aria-labelledby="outstanding" className="grid gap-3">
        <h2 id="outstanding" className="type-section-title text-ink">
          {EXPORTS_COPY.outstandingTitle}
        </h2>
        {overview.outstanding.length === 0 ? (
          <EmptyState
            variant="done"
            title={EXPORTS_COPY.noOutstanding}
            inline
          />
        ) : (
          <>
            <p className="text-body text-ink">
              {EXPORTS_COPY.outstandingIntro}
            </p>
            <ul className="grid gap-3">
              {overview.outstanding.map((o) => (
                <li key={`${o.destinationId}/${o.assetId}`}>
                  <Card>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip state={publicationChip(o.state)} />
                      <span className="text-label text-ink">
                        {o.subjectLabel}
                      </span>
                    </div>
                    <p className="text-body text-ink">
                      {o.destinationLabel}
                      {o.venueName ? ` · ${o.venueName}` : ""}
                    </p>
                    <p className="text-meta text-ink-muted">
                      <ExternalLink
                        url={o.externalUrl}
                        reference={o.externalRef}
                      />
                      {o.externalUrl || o.externalRef ? " · " : ""}
                      {EXPORTS_COPY.since(londonDate(o.since))}
                    </p>
                    {canRecord ? (
                      <ConfirmRemovedForm
                        destinationId={o.destinationId}
                        assetId={o.assetId}
                        today={today}
                      />
                    ) : null}
                  </Card>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    )
  }

  const show = (part: "destinations" | "published" | "recent") =>
    !props.only || props.only === part
  const heading = (id: string, words: string) =>
    props.bare ? null : (
      <h2 id={id} className="type-section-title text-ink">
        {words}
      </h2>
    )

  return (
    <>
      {show("destinations") ? (
        <section
          aria-labelledby={props.bare ? undefined : "destinations"}
          aria-label={props.bare ? EXPORTS_COPY.destinationsTitle : undefined}
          className="grid gap-3"
        >
          {heading("destinations", EXPORTS_COPY.destinationsTitle)}
          <p className="text-body text-ink-muted">
            {EXPORTS_COPY.destinationsIntro}
          </p>
          {overview.destinations.length === 0 ? (
            <EmptyState
              variant="done"
              title={EXPORTS_COPY.noDestinations}
              inline
            />
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {overview.destinations.map((d) => (
                <li key={d.id}>
                  <Card>
                    <p className="text-label break-words text-ink">{d.label}</p>
                    <p className="text-meta text-ink-muted">
                      {d.venueName ?? "Every venue"}
                      {d.active ? "" : " · Switched off"}
                    </p>
                    {d.url ? (
                      <p className="text-meta">
                        <ExternalLink url={d.url} reference={null} />
                      </p>
                    ) : null}
                    <p className="font-mono text-mono font-semibold text-ink tabular-nums">
                      {d.published} published · {d.pending} pending · {d.failed}{" "}
                      failed
                    </p>
                    {d.lastPublishedOn ? (
                      <p className="text-meta text-ink-muted">
                        Last published {londonDate(d.lastPublishedOn)}
                      </p>
                    ) : null}
                    {canRecord && props.venues ? (
                      <details className="rounded-control border border-line p-3">
                        <summary className="cursor-pointer text-label text-ink focus-ring">
                          Change
                        </summary>
                        <div className="mt-3">
                          <DestinationForm
                            venues={props.venues}
                            destination={d}
                          />
                        </div>
                      </details>
                    ) : null}
                  </Card>
                </li>
              ))}
            </ul>
          )}
          {canRecord && props.venues ? (
            <details className="rounded-card border border-line bg-surface p-4">
              <summary className="cursor-pointer text-label text-ink focus-ring">
                Add a destination
              </summary>
              <div className="mt-3">
                <DestinationForm venues={props.venues} />
              </div>
            </details>
          ) : null}
        </section>
      ) : null}

      {show("published") ? (
        <section
          aria-labelledby={props.bare ? undefined : "published"}
          aria-label={props.bare ? EXPORTS_COPY.publishedTitle : undefined}
          className="grid gap-3"
        >
          {heading("published", EXPORTS_COPY.publishedTitle)}
          {overview.published.length === 0 ? (
            <EmptyState
              variant="done"
              title={EXPORTS_COPY.noPublished}
              inline
            />
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
              {overview.published.map((p) => (
                <li
                  key={`${p.destinationId}/${p.assetId}`}
                  className="grid gap-1 px-4 py-3"
                >
                  <span className="text-label text-ink">{p.subjectLabel}</span>
                  <span className="text-meta text-ink-muted">
                    {p.destinationLabel}
                    {p.venueName ? ` · ${p.venueName}` : ""} ·{" "}
                    {londonDate(p.occurredOn)}
                  </span>
                  <span className="text-meta">
                    <ExternalLink
                      url={p.externalUrl}
                      reference={p.externalRef}
                    />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {show("recent") && overview.recent.length > 0 ? (
        <section
          aria-labelledby={props.bare ? undefined : "recent"}
          aria-label={props.bare ? EXPORTS_COPY.recentTitle : undefined}
          className="grid gap-3"
        >
          {heading("recent", EXPORTS_COPY.recentTitle)}
          <ul className="grid gap-1 text-body text-ink">
            {overview.recent.map((r) => (
              <li key={r.id}>
                {londonDate(r.occurredOn)} · {ACTION_WORDS[r.action]} ·{" "}
                {r.subjectLabel} · {r.destinationLabel}
                {r.recordedBy ? ` · recorded by ${r.recordedBy}` : ""}
                {r.note ? ` · ${r.note}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!props.only &&
      canRecord &&
      props.profiles &&
      props.profiles.length > 0 ? (
        <section aria-labelledby="profiles" className="grid gap-3">
          <h2 id="profiles" className="type-section-title text-ink">
            {EXPORTS_COPY.profilesTitle}
          </h2>
          <p className="text-body text-ink-muted">
            {EXPORTS_COPY.profilesIntro}
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {props.profiles.map((p) => (
              <ProfileForm key={`${p.key}-${p.revision}`} profile={p} />
            ))}
          </div>
        </section>
      ) : null}
    </>
  )
}
