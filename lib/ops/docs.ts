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
import { RUNBOOKS } from "./runbooks"

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

export function renderRunbookIndex(): string {
  const lines = [
    GENERATED,
    "",
    "# Runbooks",
    "",
    "The B10-02 runbook index. Each runbook has the fields plan §19 requires and one recovery drill, run only on an owned isolated stack. A drill that has not run reads not_exercised; one that waits names what it needs. Write a full runbook from RB-00-template.md.",
    "",
    "| ID | Situation | Triggers | Operator | Narrowest switch | Drill readiness | Waiting for | Drill status |",
    "|---|---|---|---|---|---|---|---|",
  ]
  for (const rb of RUNBOOKS)
    lines.push(
      `| ${rb.id} | ${cell(rb.title)} | ${cell([...rb.triggerMetrics, ...rb.otherTriggers].join(", "))} | ${rb.operatorRole} | ${cell(rb.narrowestSwitch)} | ${rb.drill.readiness} | ${rb.drill.waitingFor.join(", ") || "none"} | ${rb.drill.status} |`
    )
  lines.push("")
  for (const rb of RUNBOOKS) {
    lines.push(
      `## ${rb.id} ${rb.title}`,
      "",
      `- First checks: ${rb.firstChecks}`,
      `- Steps: ${rb.steps}`,
      `- Data implications: ${rb.dataImplications}`,
      `- Pending delivery: ${rb.pendingDelivery}`,
      `- Readback that proves recovery: ${rb.readbackProof}`,
      `- Drill: ${rb.drill.description}`,
      `- Evidence: \`${rb.evidencePath}\``,
      ""
    )
  }
  return lines.join("\n")
}
