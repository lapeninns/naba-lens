// Renders the B10-05b training cards and walkthrough from lib/ops/training.ts.
// In-app wording comes from the guidance registry and the photo guide, so a
// card can never disagree with the app. docs-format.ts formats and writes them.
import {
  GUIDANCE_LINES,
  GUIDANCE_SCREENS,
  GUIDANCE_TITLE,
} from "../../components/nabalens/guide/screen-guidance"
import { GUIDE_SAFETY, GUIDE_SUBJECT_TIPS } from "../../lib/guide/dish-guide"
import {
  TRAINING_MODULES,
  TRAINING_STATUS,
  WALKTHROUGH_STEPS,
  type GuideRef,
  type TrainingModule,
} from "../../lib/ops/training"

const GENERATED =
  "<!-- Generated from lib/ops/training.ts by scripts/ops/write-docs.ts. Do not edit by hand. -->"

/** GitHub's heading anchor. */
export const headingAnchor = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .replace(/ /g, "-")

const guideLink = (g: GuideRef) =>
  `[${g.heading}](../../${g.file.replace(/^docs\//, "")}#${headingAnchor(g.heading)})`

export function renderTrainingCard(m: TrainingModule): string {
  const lines = [
    GENERATED,
    "",
    `# ${m.id} ${m.title}`,
    "",
    `Status: ${TRAINING_STATUS}`,
    "",
    `- Audience: ${m.audience}`,
    `- Runs it: ${m.trainerRole}`,
    `- Length: 15 minutes in the shift ([walkthrough](README.md#walkthrough))`,
    `- Practical task: ${m.practicalTask}`,
    "",
    "## Covers",
    "",
    ...m.covers.map((c) => `- ${c}`),
    "",
    "## Read with",
    "",
    ...m.guides.map((g) => `- ${guideLink(g)}`),
    ...m.operations.map(
      (o) =>
        `- [${o.replace(/^docs\/operations\//, "")}](../${o.replace(/^docs\/operations\//, "")})`
    ),
    "",
  ]
  const guidance = m.guidanceIds.map((id) => {
    const line = GUIDANCE_LINES.find((l) => l.id === id)
    if (!line) throw new Error(`${m.id}: unknown guidance line ${id}`)
    return line
  })
  if (guidance.length) {
    lines.push("## What the app says", "")
    for (const g of guidance)
      lines.push(
        `- ${g.text}${g.wording === "awaiting_sign_off" ? " (wording waiting for owner sign-off)" : ""}`
      )
    lines.push("")
  }
  if (m.photoTips.length) {
    lines.push("## Photo tips (optional, from the photo guide)", "")
    for (const title of m.photoTips) {
      const tip = GUIDE_SUBJECT_TIPS.find((t) => t.title === title)
      if (!tip) throw new Error(`${m.id}: unknown photo tip ${title}`)
      lines.push(`- ${tip.title}: ${tip.text}`)
    }
    lines.push(`- ${GUIDE_SAFETY}`, "")
  }
  if (m.notCovered.length)
    lines.push("## Not covered", "", ...m.notCovered.map((n) => `- ${n}`), "")
  return lines.join("\n")
}

export function renderTrainingIndex(): string {
  const lines = [
    GENERATED,
    "",
    "# Training",
    "",
    `B10-05b role cards and the in-shift walkthrough. ${TRAINING_STATUS}`,
    "",
    "Websites, NabaPresence and other external destinations are out of scope (owner scope correction, 11 Nov 2026) and are not taught.",
    "",
    "In-app lines: [guidance inventory](guidance.md).",
    "",
    "| Module | Audience | Practical task |",
    "|---|---|---|",
    ...TRAINING_MODULES.map(
      (m) =>
        `| [${m.id} ${m.title}](${m.id}.md) | ${m.audience} | ${m.practicalTask} |`
    ),
    "",
    "## Walkthrough",
    "",
    `Fifteen minutes (OD-B10-7 default), the same shape for every module:`,
    "",
    ...WALKTHROUGH_STEPS.map(
      (s, i) => `${i + 1}. (${s.minutes} min) ${s.step}`
    ),
    "",
    "## Friction log (B10-05d)",
    "",
    "Classify each hesitation before the wave exits: **release blocker** (stops a task, misleads about state, loses input or discloses data) or **later improvement**. Record the screen, the role kind and the evidence type, never a name.",
    "",
  ]
  return lines.join("\n")
}

const SCREEN_ROUTES: Record<(typeof GUIDANCE_SCREENS)[number], string> = {
  "staff-home": "/staff/tasks (Home)",
  "staff-capture": "/staff/tasks/amenities/{checkId} (question capture)",
  "manager-review": "/manager/review (Review)",
}

export function renderGuidanceInventory(): string {
  const lines = [
    GENERATED.replace(
      "lib/ops/training.ts",
      "components/nabalens/guide/screen-guidance.ts"
    ),
    "",
    "# In-app guidance inventory",
    "",
    `B10-05a. Each line is existing wording, quoted exactly from its source. The panel (title: "${GUIDANCE_TITLE}", new wording) shows only when NABALENS_SCREEN_GUIDANCE=on (SW-15, default off), which waits for the product owner's approval of this page and the owner's approval of the configuration change. Lines marked awaiting_sign_off never show: their source wording still waits for sign-off.`,
    "",
    "Screens were chosen from the shipped B01/B02 staff and manager journeys. No observation log or e2e finding about hesitation exists yet (no real use has been observed); B10-05d adds lines from the friction log after the first sessions.",
    "",
    "| ID | Screen | Module | Line | Source | Wording |",
    "|---|---|---|---|---|---|",
  ]
  for (const l of GUIDANCE_LINES)
    lines.push(
      `| ${l.id} | ${SCREEN_ROUTES[l.screen]} | ${l.module} | ${l.text.replace(/\|/g, "\\|")} | ${l.source.kind === "copy" ? `\`${l.source.ref}\`` : `quote, \`${l.source.file}\``} | ${l.wording} |`
    )
  lines.push("")
  return lines.join("\n")
}

export const TRAINING_DOCS: [string, () => string][] = [
  ["docs/operations/training/README.md", renderTrainingIndex],
  ["docs/operations/training/guidance.md", renderGuidanceInventory],
  ...TRAINING_MODULES.map((m): [string, () => string] => [
    `docs/operations/training/${m.id}.md`,
    () => renderTrainingCard(m),
  ]),
]
