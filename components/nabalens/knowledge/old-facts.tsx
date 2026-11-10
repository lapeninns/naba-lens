import type { LegacyNarrativeItem } from "@/lib/knowledge-client/contract"

import { longDate } from "./copy"

export const OLD_FACTS_COPY = {
  title: (n: number) => `From the old facts list (${n})`,
  line: "Kept as history. This isn't a confirmed answer for this question.",
  presence: {
    present: "Present",
    absent: "Absent",
    unknown: "Not checked",
  } satisfies Record<LegacyNarrativeItem["presence"], string>,
  facts: "Facts",
  policy: "Policy",
  confirmed: (date: string) => `Saved as confirmed in Coverage on ${date}`,
  failed: "The old facts list couldn't be read.",
  /** §9.1: the per-question read (A44) found nothing for this question. */
  empty: "No old facts for this question.",
} as const

/**
 * From the old facts list (B03 UI design §7.2): the legacy facts reviewed for
 * this question (A44: exact, candidate or none, at their current revision) as
 * narrative, collapsed, whatever their mapping. Never a confirmation.
 */
export function OldFactsSection({
  items,
}: {
  /** Null when the list couldn't be read. */
  items: readonly LegacyNarrativeItem[] | null
}) {
  return (
    <details className="grid min-w-0 gap-3 rounded-card bg-surface p-4 shadow-card">
      <summary className="min-h-11 cursor-pointer content-center rounded-control font-display text-section-title-touch text-ink outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid md:text-section-title">
        {OLD_FACTS_COPY.title(items?.length ?? 0)}
      </summary>
      <p className="text-body-touch text-ink md:text-body">
        {OLD_FACTS_COPY.line}
      </p>
      {items === null ? (
        <p className="text-body-touch text-ink md:text-body">
          {OLD_FACTS_COPY.failed}
        </p>
      ) : items.length === 0 ? (
        <p className="text-body-touch text-ink md:text-body">
          {OLD_FACTS_COPY.empty}
        </p>
      ) : (
        <ul className="grid gap-3">
          {items.map((item) => (
            <li
              key={item.legacyKey}
              className="grid gap-1 rounded-control bg-well p-3"
            >
              <p className="text-label-touch [overflow-wrap:anywhere] text-ink md:text-label">
                {item.label || item.legacyKey}:{" "}
                {OLD_FACTS_COPY.presence[item.presence]}
              </p>
              {item.facts ? (
                <p className="text-body-touch [overflow-wrap:anywhere] whitespace-pre-line text-ink md:text-body">
                  <span className="font-semibold">{OLD_FACTS_COPY.facts}:</span>{" "}
                  {item.facts}
                </p>
              ) : null}
              {item.policy ? (
                <p className="text-body-touch [overflow-wrap:anywhere] whitespace-pre-line text-ink md:text-body">
                  <span className="font-semibold">
                    {OLD_FACTS_COPY.policy}:
                  </span>{" "}
                  {item.policy}
                </p>
              ) : null}
              {item.savedAsConfirmedAt ? (
                <p className="text-meta-touch text-ink-muted md:text-meta">
                  {OLD_FACTS_COPY.confirmed(longDate(item.savedAsConfirmedAt))}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}
