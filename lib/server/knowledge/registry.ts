import "server-only"

import {
  QUESTION_LIFECYCLES,
  type KnowledgeResult,
  type QuestionLifecycle,
  type QuestionView,
} from "@/lib/knowledge/contract"
import type { MediaActor } from "@/lib/server/media/types"

import {
  knowledgeFailure,
  knowledgeInvalid,
  knowledgeRpcFailure,
} from "./errors"
import { knowledgeRpc } from "./rpc"
import { isObject } from "./validate"

// The question registry (B03-01): what each question asks and the rules it is
// answered under, by version. Read-only; versions are added by migration.

const KEY = /^[a-z0-9_]{1,40}$/

const QUESTION_NOT_FOUND = knowledgeFailure(
  "not_found",
  "This question could not be found."
)

/** One question version, the latest unless `version` is given. */
export async function getKnowledgeQuestion(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ question: QuestionView }>> {
  if (!isObject(input) || typeof input.key !== "string" || !KEY.test(input.key))
    return QUESTION_NOT_FOUND
  const version = input.version ?? null
  if (
    version !== null &&
    (typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1 ||
      version > 100000)
  )
    return knowledgeInvalid({ version: "Choose a version." })
  const { data, error } = await knowledgeRpc(actor.db, "knowledge_question", {
    p_key: input.key,
    p_version: version,
  })
  if (error) return knowledgeRpcFailure(error, "knowledge question")
  return { ok: true, question: data }
}

/** Admins: every question with its latest version, optionally by lifecycle. */
export async function listQuestionRegistry(
  actor: MediaActor,
  input: unknown
): Promise<KnowledgeResult<{ questions: QuestionView[] }>> {
  const raw = isObject(input) ? (input.lifecycle ?? null) : null
  if (
    raw !== null &&
    (!Array.isArray(raw) ||
      raw.length === 0 ||
      !raw.every((v) => QUESTION_LIFECYCLES.includes(v as QuestionLifecycle)))
  )
    return knowledgeInvalid({ lifecycle: "Choose a lifecycle." })
  const { data, error } = await knowledgeRpc(actor.db, "knowledge_registry", {
    p_lifecycle: raw as QuestionLifecycle[] | null,
  })
  if (error) return knowledgeRpcFailure(error, "knowledge registry")
  return { ok: true, questions: data.items }
}
