// What the capture form is for one question, from its registry version
// (B03 UI design §2.1). This build only renders forms it has implemented:
// a schema or version it doesn't know gets a notice and Reload, never a
// guess, so an older form can't send into a newer question.

import type {
  QuestionFeature,
  QuestionLifecycle,
  RegistryQuestion,
  ValueSchemaName,
} from "@/lib/knowledge-client/contract"

export type QuestionForm =
  /** Today's B01 form (no registry yet, or a schema it already covers). */
  | { kind: "b01" }
  /** The B01 form plus the facility detail and Checked on (B03-b). */
  | { kind: "facility" }
  /** The B01 form plus what was checked, the version's features, and Checked on. */
  | { kind: "accessibility"; features: QuestionFeature[] }
  /** The policy editor (statements) or observation form (staff), B03-c. */
  | { kind: "policy"; requiresZones: boolean }
  /** A schema or version this build has no form for. */
  | { kind: "unknown"; schema: string; version: number }
  /** The question isn't asked any more (registry lifecycle). */
  | {
      kind: "not_asked"
      lifecycle: Exclude<QuestionLifecycle, "supported" | "presence_only">
      supersededBy: string[]
    }

/** Schemas whose form this build renders, as `name@version`. */
const B01_FORMS: ReadonlySet<string> = new Set([
  "presence@1",
  "connectivity.wifi@1",
])

const ASKED: ReadonlySet<QuestionLifecycle> = new Set([
  "supported",
  "presence_only",
])

export function questionForm(question: RegistryQuestion | null): QuestionForm {
  // No registry (before the migration) or a failed read: the B01 form, which
  // the server still checks against the version in force when it's sent.
  if (!question) return { kind: "b01" }
  if (!ASKED.has(question.lifecycle))
    return {
      kind: "not_asked",
      lifecycle: question.lifecycle as Extract<
        QuestionForm,
        { kind: "not_asked" }
      >["lifecycle"],
      supersededBy: question.supersededBy ?? [],
    }
  const { name, version } = question.valueSchema
  if (B01_FORMS.has(`${name}@${version}`)) return { kind: "b01" }
  if (name === "facility" && version === 1) return { kind: "facility" }
  if (name === "accessibility" && version === 1)
    return { kind: "accessibility", features: question.features ?? [] }
  if (name === "policy" && version === 1)
    return { kind: "policy", requiresZones: question.requiresZones === true }
  return { kind: "unknown", schema: name as ValueSchemaName, version }
}

export const QUESTION_FORM_COPY = {
  unknown:
    "This question has a newer form than this screen knows. Reload to get it.",
  unknownAnswer: "This answer has details this screen can't show.",
  notAsked: "This question isn't asked any more. Its earlier answers are kept.",
  reload: "Reload",
} as const
