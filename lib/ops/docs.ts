/**
 * Renders the operations documents from the registries, so the documents can
 * never disagree with the code (T-B10-02). scripts/ops/write-docs.ts writes
 * them; a unit test compares the committed files with these strings.
 */

import { unavailablePairs } from "./knowledge-status"
import {
  BASELINE_RELEASED,
  METRIC_FAMILIES,
  METRICS,
  metricAvailability,
  type MetricDefinition,
  type SourceBatch,
} from "./metrics"
import { RUNBOOKS, type RunbookDefinition } from "./runbooks"
import { ONE_WAY_SETTINGS, SWITCHES, switchById } from "./switches"

const GENERATED =
  "<!-- Generated from lib/ops by scripts/ops/write-docs.ts. Do not edit by hand. -->"

const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, " ")

const FAMILY_TITLES: Record<(typeof METRIC_FAMILIES)[number], string> = {
  jobs: "Jobs",
  uploads: "Uploads and finalisation",
  knowledge: "Knowledge",
  review: "Review age",
  delivery: "Delivery and withdrawals",
  ai: "AI (only where a B09 job is enabled)",
  adoption: "Adoption",
}

function thresholdText(metric: MetricDefinition) {
  return metric.threshold ? metric.threshold.text : "Information only"
}

function fromText(metric: MetricDefinition) {
  const parts: string[] = [metric.availableFrom]
  for (const p of metric.partial ?? []) parts.push(`${p.from} (${p.scope})`)
  for (const b of metric.alsoNeeds ?? []) parts.push(`also ${b}`)
  return parts.join("; ")
}

export function renderMetricsDoc(
  released: readonly SourceBatch[] = BASELINE_RELEASED
): string {
  const lines = [
    GENERATED,
    "",
    "# Operational metrics",
    "",
    "The B10-01 dashboard catalogue. Each metric names its source, the release that provides it, a proposed threshold (owner to confirm, OD-B10-1) and the accountable role. A metric whose source is not released reads Not available, never 0; a log-only metric reads Not measured until a log source exists.",
    "",
    `There are ${METRICS.length} metrics.`,
    "",
  ]
  for (const family of METRIC_FAMILIES) {
    lines.push(`## ${FAMILY_TITLES[family]}`, "")
    lines.push(
      "| ID | Metric | Definition | Headline value | Source | From | Threshold | Owner | Runbooks |",
      "|---|---|---|---|---|---|---|---|---|"
    )
    for (const m of METRICS.filter((x) => x.family === family))
      lines.push(
        `| ${m.id} | ${cell(m.title)} | ${cell(m.definition)} | ${cell(m.headline)} (${m.unit}, ${cell(m.window)}) | ${cell(m.source.ref)} | ${cell(fromText(m))} | ${cell(thresholdText(m))} | ${m.owners.join(", ")} | ${m.runbooks.join(", ") || "none"} |`
      )
    lines.push("")
  }
  lines.push(
    `## Availability at the production baseline (${released.join(", ")})`,
    "",
    "| ID | Status | Still missing | Owner inputs |",
    "|---|---|---|---|"
  )
  for (const m of METRICS) {
    const a = metricAvailability(m, released)
    lines.push(
      `| ${m.id} | ${a.status} | ${a.missing.join(", ") || "none"} | ${(m.ownerInputs ?? []).join(", ") || "none"} |`
    )
  }
  lines.push(
    "",
    "## Closed status table for M-KN-1",
    "",
    "The unavailable (reason, detail) pairs the internal reader accepts. Any other pair is a contract breach.",
    "",
    ...unavailablePairs().map((pair) => `- \`${pair}\``),
    ""
  )
  return lines.join("\n")
}

const switchText = (rb: RunbookDefinition) =>
  rb.switches.length
    ? rb.switches
        .map((id) => `${id} (${switchById(id)?.title ?? "unknown"})`)
        .join(", ")
    : "none"

export function renderRunbookIndex(): string {
  const lines = [
    GENERATED,
    "",
    "# Runbooks",
    "",
    "The B10-02 runbook index. Each runbook has the fields plan §19 requires and one recovery drill, run only on an owned isolated stack. A drill that has not run reads not_exercised; queued means it is requested from the coordinator; one that waits names what it needs. No drill is passed until an owned-stack run is recorded. Start with [RB-17 Incident triage](RB-17.md). Switches: [switch catalogue](../switches.md).",
    "",
    "Runbooks marked out_of_scope serve external destinations (websites, NabaPresence), which the owner scope correction of 11 Nov 2026 removed from the current goal. They are kept for the record and are not complete.",
    "",
    "| ID | Situation | Triggers | Operator | Scope | Drill readiness | Waiting for | Drill status |",
    "|---|---|---|---|---|---|---|---|",
  ]
  for (const rb of RUNBOOKS)
    lines.push(
      `| [${rb.id}](${rb.id}.md) | ${cell(rb.title)} | ${cell([...rb.triggerMetrics, ...rb.otherTriggers].join(", "))} | ${rb.operatorRole} | ${rb.scope} | ${rb.drill.readiness} | ${rb.drill.waitingFor.join(", ") || "none"} | ${rb.drill.status} |`
    )
  lines.push("")
  return lines.join("\n")
}

export function renderRunbook(rb: RunbookDefinition): string {
  const lines = [
    GENERATED,
    "",
    `# ${rb.id} ${rb.title}`,
    "",
    `Scope: ${rb.scope === "internal" ? "NabaLens internal" : "out of scope (external destination; owner scope correction, 11 Nov 2026). Kept for the record, not complete"}. Back to the [index](README.md).`,
    "",
    "| Field | Content |",
    "|---|---|",
    `| Trigger | ${cell([...rb.triggerMetrics, ...rb.otherTriggers].join(", "))} |`,
    `| Operator role | ${rb.operatorRole} |`,
    `| First checks | ${cell(rb.firstChecks)} |`,
    `| Steps | ${cell(rb.steps)} |`,
    `| Narrowest switch | ${cell(rb.narrowestSwitch)} |`,
    `| Switches in the catalogue | ${cell(switchText(rb))} |`,
    `| Data implications | ${cell(rb.dataImplications)} |`,
    `| Pending delivery | ${cell(rb.pendingDelivery)} |`,
    `| Readback that proves recovery | ${cell(rb.readbackProof)} |`,
    "",
    "## Checks without a database",
    "",
  ]
  if (rb.checks.length)
    for (const c of rb.checks)
      lines.push(`- ${c.kind}: \`${c.ref}\`: ${c.proves}`)
  else lines.push("- None. The claims need a database; see the drill.")
  lines.push(
    "",
    "## Drill",
    "",
    `- Description: ${rb.drill.description}`,
    `- Readiness: ${rb.drill.readiness}${rb.drill.waitingFor.length ? ` (waiting for ${rb.drill.waitingFor.join(", ")})` : ""}`,
    `- Status: ${rb.drill.status}`,
    "- Environment: an owned isolated stack only, never production or a shared database.",
    `- Evidence: \`${rb.evidencePath}\``,
    ""
  )
  return lines.join("\n")
}

export function renderSwitchCatalogue(): string {
  const lines = [
    GENERATED,
    "",
    "# Switch catalogue",
    "",
    "B10-02b. Every NabaLens disable switch, its scope, and what keeps running while it is off. Use the narrowest one that stops harm. A switch marked owner-gated changes production configuration (an environment variable, a schedule or reviewed SQL) and needs the owner's sign-off (X1) first. External destinations are out of scope and have no switch here.",
    "",
    "| ID | Switch | Scope | Mechanism | Owner-gated | Used by |",
    "|---|---|---|---|---|---|",
  ]
  for (const s of SWITCHES) {
    const usedBy = RUNBOOKS.filter((rb) => rb.switches.includes(s.id))
      .map((rb) => rb.id)
      .join(", ")
    lines.push(
      `| ${s.id} | ${cell(s.title)} | ${s.scope} | ${s.mechanism} | ${s.ownerGated ? "yes" : "no"} | ${usedBy || "none"} |`
    )
  }
  lines.push("")
  for (const s of SWITCHES)
    lines.push(
      `## ${s.id} ${s.title}`,
      "",
      `- Turn off: ${s.howToTurnOff}`,
      `- Stops: ${s.stops}`,
      `- Keeps running: ${s.keepsRunning}`,
      `- Restore: ${s.restore}`,
      `- Operator: ${s.operatorRole}. Source: \`${s.source.file}\``,
      ""
    )
  lines.push("## One-way settings (not switches)", "")
  for (const o of ONE_WAY_SETTINGS) lines.push(`- ${o.title}: ${o.why}`)
  lines.push("")
  return lines.join("\n")
}
