import "server-only"

import type { FindingSentCopy } from "@/components/nabalens/amenities/capture/finding-sent-notice"
import { draftWins, RECHECK_COPY } from "@/components/nabalens/knowledge/copy"
import type { WorkingSlot } from "@/lib/knowledge-client/contract"
import { knowledgeServices } from "@/lib/knowledge-client/services"
import type { MediaActor } from "@/lib/server/media/types"

/**
 * Home's sent notice for a finding that answers an open recheck (B03 UI
 * design §6.2): "Recheck sent. It stays open…" only when the finding awaits
 * confirmation and the person's own read of this check's rechecks says one
 * is still open. A refused, failed or empty read claims nothing, and a
 * "Saved for later" notice (a newer draft) never gains it: nothing was sent.
 */
export async function withRecheckSent(
  actor: MediaActor,
  slot: Pick<WorkingSlot, "checkId" | "myLatest" | "myDraft">,
  copy: FindingSentCopy
): Promise<FindingSentCopy> {
  if (draftWins(slot) || slot.myLatest?.state !== "awaiting_confirmation")
    return copy
  try {
    const read = await knowledgeServices.getCheckRechecks(actor, {
      checkId: slot.checkId,
    })
    return read.ok && read.count > 0
      ? { ...copy, recheck: RECHECK_COPY.sentOpen }
      : copy
  } catch {
    return copy
  }
}
