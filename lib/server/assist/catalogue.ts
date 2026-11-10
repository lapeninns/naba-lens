import type {
  AssistJobDefinition,
  AssistJobKey,
  AssistJobLimits,
} from "./types"
import { ASSIST_JOB_KEYS } from "./types"

const imageJobLimits: AssistJobLimits = {
  maxInputBytes: 1024 * 1024,
  maxImages: 1,
  maxOutputTokens: 400,
  timeoutMs: 20_000,
  maxRetries: 1,
}

/**
 * The finite job catalogue (B09-01). Version 1 of each job; none is signed off,
 * so every job runs only on the fixture provider until the owner signs off.
 * Changing a job means adding a new version, never editing one in place.
 */
export const ASSIST_JOBS: readonly AssistJobDefinition[] = [
  {
    key: "label_suggest",
    version: 1,
    schemaVersion: "label_suggest@1",
    promptVersion: "label_suggest.prompt@1",
    purpose:
      "Suggest up to three items from the venue's active menu, and a content type, for one photo.",
    decisionPoint:
      "The person picks or ignores the suggested items in the label editor and presses Save.",
    domainCommand: "save_media_labels / stage_media_labels as the person",
    prohibitedInferences: [
      "ingredients",
      "allergens",
      "dietary suitability",
      "portion",
      "price",
      "availability",
      "where or when the photo was taken",
      "who is in the photo",
      "whether the photo is good enough for menu use",
      "any item not on the venue's active menu",
    ],
    requesters: ["staff", "manager"],
    limits: imageJobLimits,
    signedOffBy: null,
  },
  {
    key: "menu_import_draft",
    version: 1,
    schemaVersion: "menu_import_draft@1",
    promptVersion: "menu_import_draft.prompt@1",
    purpose:
      "Draft sections, items, variants and printed price text from an operator document.",
    decisionPoint:
      "The admin reviews each entry beside its page, then imports the kept file through the normal menu import.",
    domainCommand:
      "the B04-05 import path (snapshot, dry run, per-line decisions)",
    prohibitedInferences: [
      "dietary or allergen labels",
      "the NabaLens identity of any item",
      "prices that are not printed",
      "availability or schedules that are not printed",
      "sections or items that are not in the document",
      "who any named person is",
    ],
    requesters: ["admin"],
    limits: {
      maxInputBytes: 10 * 1024 * 1024,
      maxImages: 20,
      maxOutputTokens: 16_000,
      timeoutMs: 120_000,
      maxRetries: 1,
    },
    signedOffBy: null,
  },
  {
    key: "evidence_describe",
    version: 1,
    schemaVersion: "evidence_describe@1",
    promptVersion: "evidence_describe.prompt@1",
    purpose:
      "List neutral, visible features of one of the person's own evidence photos.",
    decisionPoint:
      "The person may insert some observations into their own note, edit them, and send the finding themselves.",
    domainCommand: "knowledge_submit as the person",
    prohibitedInferences: [
      "the answer value",
      "any measurement",
      "a venue-wide accessibility claim",
      "any policy",
      "opening times or fees",
      "names of people",
      "text from screens, documents or credentials",
    ],
    requesters: ["staff", "manager"],
    limits: imageJobLimits,
    signedOffBy: null,
  },
  {
    key: "missing_field_prompts",
    version: 1,
    schemaVersion: "missing_field_prompts@1",
    promptVersion: "missing_field_prompts.prompt@1",
    purpose:
      "Point at structured fields the person's own note seems to mention.",
    decisionPoint: "The person fills in the field themselves.",
    domainCommand: "knowledge_submit as the person",
    prohibitedInferences: ["the value of any field", "any confirmation"],
    requesters: ["staff", "manager"],
    limits: {
      maxInputBytes: 4 * 1024,
      maxImages: 0,
      maxOutputTokens: 300,
      timeoutMs: 10_000,
      maxRetries: 1,
    },
    signedOffBy: null,
  },
]

export const FIXTURE_PROVIDER_ID = "fixture"

export function isAssistJobKey(value: unknown): value is AssistJobKey {
  return (
    typeof value === "string" &&
    (ASSIST_JOB_KEYS as readonly string[]).includes(value)
  )
}

export type JobLookup =
  | { ok: true; job: AssistJobDefinition }
  | { ok: false; reason: "assist_job_unknown" }

export function getAssistJob(key: unknown, version: number): JobLookup {
  const job = ASSIST_JOBS.find((j) => j.key === key && j.version === version)
  return job ? { ok: true, job } : { ok: false, reason: "assist_job_unknown" }
}

/** A version without owner sign-off may run only on the offline fixture provider. */
export function mayRunOn(
  job: AssistJobDefinition,
  providerId: string
): boolean {
  return providerId === FIXTURE_PROVIDER_ID || job.signedOffBy !== null
}
