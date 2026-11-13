// The owner's freshness decision (11 Nov 2026): a rule that counts from the
// day an answer was checked binds only where the form asks for that day. The
// forms this build renders with Checked on and the database's set for the
// decision must be the same, by schema name and version.
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  usesCheckedOn,
  type DetailForm,
} from "@/components/nabalens/knowledge/detail-form"
import {
  CHECKED_ON_FORMS,
  questionForm,
  type QuestionForm,
} from "@/components/nabalens/knowledge/question-form"
import type {
  RegistryQuestion,
  ValueSchemaName,
} from "@/lib/knowledge-client/contract"

const MIGRATIONS = "supabase/migrations"
const SCHEMAS: ValueSchemaName[] = [
  "presence",
  "facility",
  "accessibility",
  "policy",
  "service",
  "schedule_event",
  "connectivity.wifi",
]

/**
 * Whether the capture screen asks Checked on for a form: the detail form it
 * builds (screen.tsx: its schema is the form's kind, for these kinds only),
 * read by the renderer's own usesCheckedOn.
 */
const DETAIL_FORM_KINDS: ReadonlySet<QuestionForm["kind"]> = new Set([
  "facility",
  "accessibility",
  "policy",
  "service",
  "schedule_event",
])
const asksCheckedOn = (form: QuestionForm) =>
  usesCheckedOn(
    DETAIL_FORM_KINDS.has(form.kind)
      ? ({ schema: form.kind } as DetailForm)
      : null
  )

function question(name: ValueSchemaName, version: number): RegistryQuestion {
  return {
    key: "guest_toilets",
    family: "presence",
    subjectType: "venue",
    ownerRole: "venue_manager",
    version: 1,
    latestVersion: 1,
    catalogueVersion: 1,
    ruleVersion: null,
    valueSchema: { name, version },
    guidance: {
      question: "⟨Question⟩",
      captureBrief: "⟨Brief⟩",
      staffHelp: null,
      publicLabel: null,
    },
    evidenceRule: "photo",
    confirmation: "none",
    selfConfirmationAllowed: false,
    sensitivity: "ordinary",
    freshness: { internal: null, public: null },
    publishableFields: [],
    materialFields: ["headline"],
    requiresZones: false,
    lifecycle: "supported",
    supersededBy: null,
    effectiveFrom: null,
    changeKind: "initial",
    changeNote: null,
  }
}

/** The set in the newest migration defining the database's check. */
function databaseForms(): string[] {
  const head = "function private.knowledge_schema_has_checked_on("
  const file = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse()
    .find((f) => readFileSync(join(MIGRATIONS, f), "utf8").includes(head))
  if (!file) throw new Error("No migration defines the Checked on set")
  const sql = readFileSync(join(MIGRATIONS, file), "utf8")
  const body = sql.slice(sql.lastIndexOf(head)).split("$$")[1] ?? ""
  return [...body.matchAll(/'([a-z_.]+@\d+)'/g)].map((m) => m[1]).sort()
}

describe("forms that ask Checked on", () => {
  it("are exactly the rendered forms with Checked on, by schema and version", () => {
    const rendered = SCHEMAS.flatMap((name) =>
      [1, 2, 3]
        .filter((version) =>
          asksCheckedOn(questionForm(question(name, version)))
        )
        .map((version) => `${name}@${version}`)
    )
    expect(rendered.sort()).toEqual([...CHECKED_ON_FORMS].sort())
  })

  it("match the database's set for the freshness decision", () => {
    expect(databaseForms()).toEqual([...CHECKED_ON_FORMS].sort())
  })

  it("leave a later version of a form with Checked on without it", () => {
    expect(questionForm(question("facility", 2))).toEqual({
      kind: "unknown",
      schema: "facility",
      version: 2,
    })
    expect(CHECKED_ON_FORMS.has("facility@2")).toBe(false)
  })
})
