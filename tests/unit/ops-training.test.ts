// B10-05b training cards: every module from b10-design §7.3, links that
// resolve, in-app wording only through the guidance registry, and no
// external-destination content.
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { GUIDANCE_LINES } from "@/components/nabalens/guide/screen-guidance"
import { GUIDE_SUBJECT_TIPS } from "@/lib/guide/dish-guide"
import { OWNER_ROLES } from "@/lib/ops/metrics"
import { TRAINING_MODULES, WALKTHROUGH_STEPS } from "@/lib/ops/training"
import {
  headingAnchor,
  renderTrainingCard,
  renderTrainingIndex,
} from "@/scripts/ops/training-docs"

const root = join(__dirname, "..", "..")

describe("B10-05b training modules", () => {
  it("has T1 to T6 once each, with a practical task and a trainer role", () => {
    expect(TRAINING_MODULES.map((m) => m.id)).toEqual([
      "T1",
      "T2",
      "T3",
      "T4",
      "T5",
      "T6",
    ])
    for (const m of TRAINING_MODULES) {
      expect(m.practicalTask.trim(), m.id).not.toBe("")
      expect(OWNER_ROLES, m.id).toContain(m.trainerRole)
      expect(m.covers.length, m.id).toBeGreaterThan(0)
    }
  })

  it("points only at guide headings, guidance lines, tips and operations docs that exist", () => {
    for (const m of TRAINING_MODULES) {
      for (const g of m.guides) {
        const text = readFileSync(join(root, g.file), "utf8")
        expect(text, `${m.id} ${g.heading}`).toMatch(
          new RegExp(
            `^#{2,3} ${g.heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
            "m"
          )
        )
      }
      for (const id of m.guidanceIds)
        expect(
          GUIDANCE_LINES.some((l) => l.id === id),
          `${m.id} ${id}`
        ).toBe(true)
      for (const title of m.photoTips)
        expect(
          GUIDE_SUBJECT_TIPS.some((t) => t.title === title),
          `${m.id} ${title}`
        ).toBe(true)
      for (const doc of m.operations)
        expect(existsSync(join(root, doc)), `${m.id} ${doc}`).toBe(true)
    }
  })

  it("keeps drinks guidance text only, for bar staff", () => {
    const bar = TRAINING_MODULES.find((m) => m.id === "T3")!
    expect(bar.photoTips).toEqual(["Drinks"])
    expect(
      TRAINING_MODULES.filter((m) => m.photoTips.includes("Drinks")).map(
        (m) => m.id
      )
    ).toEqual(["T3"])
  })

  it("teaches no external destination", () => {
    const text = [
      renderTrainingIndex(),
      ...TRAINING_MODULES.map(renderTrainingCard),
    ]
      .join("\n")
      .replace(
        /Websites, NabaPresence and other external destinations are out of scope[^\n]*/,
        ""
      )
    expect(text).not.toMatch(/nabapresence|website|MCP|publication adapter/i)
  })

  it("fits the walkthrough into 15 minutes", () => {
    expect(WALKTHROUGH_STEPS.reduce((n, s) => n + s.minutes, 0)).toBe(15)
  })

  it("makes GitHub heading anchors", () => {
    expect(headingAnchor("Home: monthly photos and venue tasks")).toBe(
      "home-monthly-photos-and-venue-tasks"
    )
    expect(headingAnchor("Add labels (optional)")).toBe("add-labels-optional")
  })
})
