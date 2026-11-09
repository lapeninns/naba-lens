"use server"

import { revalidatePath } from "next/cache"

import type { KnowledgeResult } from "@/lib/knowledge-client/contract"
import { knowledgeServices as k } from "@/lib/knowledge-client/services"
import { getAmenityActor } from "@/lib/server/amenities"
import type { MediaActor } from "@/lib/server/media/types"

// Server Functions are reachable by direct POST, so every argument is
// untrusted: each action re-authorises the caller (fresh profile read), the
// knowledge service validates the input, and the database re-checks venue,
// role and slot revision in the same transaction. Expected failures are
// returned as values, never thrown (Next hides thrown messages in production).

type Service<T> = (
  actor: MediaActor,
  input: unknown
) => Promise<KnowledgeResult<T>>

/** Every screen that shows a venue question or its answer. */
function refreshKnowledge() {
  revalidatePath("/staff", "layout")
  revalidatePath("/manager", "layout")
  revalidatePath("/admin/coverage", "layout")
}

async function read<T>(service: Service<T>, input: unknown) {
  const auth = await getAmenityActor()
  if (!auth.ok) return auth
  return service(auth.actor, input)
}

async function write<T>(service: Service<T>, input: unknown) {
  const auth = await getAmenityActor()
  if (!auth.ok) return auth
  const result = await service(auth.actor, input)
  if (result.ok) refreshKnowledge()
  return result
}

// ---- Contributing ------------------------------------------------------------------

export async function submitKnowledgeFindingAction(input: unknown) {
  return write(k.submitKnowledgeFinding, input)
}

/** Drafts are private to their author: no other screen changes. */
export async function saveKnowledgeDraftAction(input: unknown) {
  return read(k.saveDraft, input)
}

export async function discardKnowledgeDraftAction(input: unknown) {
  return read(k.discardDraft, input)
}

export async function listMyFindingsAction(input: unknown) {
  return read(k.listMyFindings, input)
}

export async function dismissClosedAssignmentAction(input: unknown) {
  return write(k.dismissClosedAssignment, input)
}

// ---- Deciding (managers and admins) ------------------------------------------------

export async function decideFindingAction(input: unknown) {
  return write(k.decide, input)
}

export async function resolveConflictAction(input: unknown) {
  return write(k.resolveConflict, input)
}
