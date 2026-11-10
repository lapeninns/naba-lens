import { EvidenceTile } from "@/components/nabalens/amenities/evidence-tile"
import { CoverageSection } from "@/components/nabalens/coverage"
import { formatDate, formatTime } from "@/components/nabalens/format"
import { StatusChip } from "@/components/nabalens/status-chip"
import {
  ANSWER_LABEL,
  EVIDENCE_RULE_LABEL,
  REOPEN_PRESETS,
  REOPEN_PRESET_LABEL,
  type AssigneeOption,
  type CheckEventView,
  type PersonRef,
  type ReopenPreset,
  type SubmissionView,
} from "@/lib/amenities/contract"

export function whenText(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "Unknown date"
  return `${formatDate(iso)}, ${formatTime(date)}`
}

function nameOf(person: PersonRef | null) {
  return person?.displayName ?? "A former team member"
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="text-meta-touch text-ink-muted md:text-meta">{term}</dt>
      <dd className="text-body-touch break-words whitespace-pre-line text-ink md:text-body">
        {children}
      </dd>
    </div>
  )
}

function SubmissionCard({ submission }: { submission: SubmissionView }) {
  const by = nameOf(submission.submittedBy)
  const titleId = `submission-${submission.id}`
  return (
    <li>
      <article
        aria-labelledby={titleId}
        className="grid min-w-0 gap-3 rounded-control border border-line p-3 md:p-4"
      >
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3
            id={titleId}
            className="text-body-touch font-semibold text-ink md:text-body"
          >
            {ANSWER_LABEL[submission.answer]}
          </h3>
          {submission.isCurrent ? (
            <StatusChip tone="positive">Current answer</StatusChip>
          ) : null}
          <p className="text-meta-touch text-ink-muted md:text-meta">
            Sent by {by} · {whenText(submission.submittedAt)}
          </p>
        </header>
        <dl className="grid gap-3">
          {submission.finding ? (
            <Fact term="Finding">{submission.finding}</Fact>
          ) : null}
          {submission.limitations ? (
            <Fact term="Limitations">{submission.limitations}</Fact>
          ) : null}
          {submission.reason ? (
            <Fact term="Reason">{submission.reason}</Fact>
          ) : null}
          <Fact term="Evidence rule then">
            {EVIDENCE_RULE_LABEL[submission.evidenceRule]} · catalogue version{" "}
            {submission.templateVersion}
          </Fact>
        </dl>
        {submission.wifi ? (
          <section
            aria-label="Wi-Fi test (internal)"
            className="grid gap-2 rounded-control bg-well p-3"
          >
            <p className="text-meta-touch font-semibold text-ink md:text-meta-strong">
              Wi-Fi test (internal, never shown to guests)
            </p>
            <dl className="grid gap-2 sm:grid-cols-2">
              <Fact term="Test spot">{submission.wifi.testSpot}</Fact>
              <Fact term="Tested on">
                {formatDate(`${submission.wifi.testedOn}T12:00:00Z`)}
              </Fact>
              <Fact term="Download">{submission.wifi.downloadMbps} Mbps</Fact>
              <Fact term="Upload">{submission.wifi.uploadMbps} Mbps</Fact>
            </dl>
          </section>
        ) : null}
        {submission.evidence.length > 0 ? (
          <ul
            aria-label="Evidence"
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
          >
            {submission.evidence.map((item, index) => (
              <li key={item.assetId} className="min-w-0">
                <EvidenceTile
                  item={item}
                  label={`${item.kind === "video" ? "Video" : "Photo"} ${index + 1} from ${by}`}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-meta-touch text-ink-muted md:text-meta">
            No evidence attached.
          </p>
        )}
      </article>
    </li>
  )
}

export function SubmissionHistory({
  submissions,
}: {
  submissions: SubmissionView[]
}) {
  return (
    <CoverageSection
      id="amenity-submissions"
      title="Submissions"
      count={submissions.length || undefined}
    >
      {submissions.length === 0 ? (
        <p className="text-body-touch text-ink-muted md:text-body-sm">
          Nothing submitted yet.
        </p>
      ) : (
        <ul className="grid gap-3">
          {submissions.map((submission) => (
            <SubmissionCard key={submission.id} submission={submission} />
          ))}
        </ul>
      )}
    </CoverageSection>
  )
}

function isPreset(value: unknown): value is ReopenPreset {
  return (
    typeof value === "string" &&
    (REOPEN_PRESETS as readonly string[]).includes(value)
  )
}

/** Who recorded a history event and when; the time is the change's own. */
export function eventByline(event: CheckEventView): string {
  const when = whenText(event.at)
  return event.actor
    ? `Recorded by ${nameOf(event.actor)} · ${when}`
    : `Recorded · ${when}`
}

/** One history line, from the event kind and its detail. */
export function eventText(
  event: CheckEventView,
  people: ReadonlyMap<string, string>
): string {
  const detail = event.detail
  switch (event.kind) {
    case "added":
      return detail.source === "enable"
        ? "Added when Amenities were enabled"
        : "Added from the catalogue"
    case "assigned": {
      const id = typeof detail.assigneeId === "string" ? detail.assigneeId : ""
      const name = people.get(id)
      return name ? `Assigned to ${name}` : "Assigned"
    }
    case "unassigned":
      return detail.cause === "assignee_left"
        ? "Unassigned: the assignee left the venue or changed role"
        : "Unassigned"
    case "notes_updated":
      return "Notes updated"
    case "submitted": {
      const answer = detail.answer
      return typeof answer === "string" && answer in ANSWER_LABEL
        ? `Submitted: ${ANSWER_LABEL[answer as keyof typeof ANSWER_LABEL]}`
        : "Submitted"
    }
    case "reopened":
      return isPreset(detail.preset)
        ? `Reopened: ${REOPEN_PRESET_LABEL[detail.preset]}`
        : "Reopened"
    case "evidence_lost":
      return "Evidence deleted: needs recheck"
    case "archived":
      return "Archived"
    case "restored":
      return "Restored"
    default:
      return "Changed"
  }
}

export function EventHistory({
  events,
  people,
}: {
  events: CheckEventView[]
  people: ReadonlyMap<string, string>
}) {
  return (
    <CoverageSection id="amenity-events" title="History">
      {events.length === 0 ? (
        <p className="text-body-touch text-ink-muted md:text-body-sm">
          No history yet.
        </p>
      ) : (
        <ol className="grid min-w-0">
          {events.map((event) => (
            <li
              key={event.id}
              className="grid min-w-0 gap-0.5 border-b border-line py-2.5 last:border-b-0"
            >
              <p className="text-body-touch break-words text-ink md:text-body-sm">
                {eventText(event, people)}
              </p>
              {event.reason ? (
                <p className="text-body-touch break-words text-ink-muted md:text-body-sm">
                  “{event.reason}”
                </p>
              ) : null}
              <p className="text-meta-touch text-ink-muted md:text-meta">
                {eventByline(event)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </CoverageSection>
  )
}

/** Names known on the page, for history lines that only carry an id. */
export function peopleIndex(
  options: AssigneeOption[],
  extra: (PersonRef | null)[]
): Map<string, string> {
  const map = new Map<string, string>()
  for (const p of extra) if (p?.displayName) map.set(p.id, p.displayName)
  for (const o of options) map.set(o.id, o.displayName)
  return map
}
