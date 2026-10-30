"use server"

import {
  LABEL_LIMITS,
  type LabelCatalogue,
  type LabelEditorAsset,
  type SaveLabelsInput,
  type SaveLabelsResult,
} from "@/lib/menus/types"
import {
  getAssetLabelContext,
  getLabellingCatalogue,
  saveAssetLabels,
} from "@/lib/server/labels"
import { redactError } from "@/lib/server/log/redact"
import { getMediaActor } from "@/lib/server/media/context"

// Label editor Server Functions for both roles. Each one authorises the caller
// itself (fresh profile read); lib/server/labels and the database re-check the
// asset, owner and venue. Expected failures are returned, never thrown: Next
// replaces thrown messages in production.

export type LabelEditorContextResult =
  | {
      ok: true
      /** Readable, ready assets of ONE venue, in request order. */
      assets: LabelEditorAsset[]
      /** Requested ids that are unknown, not ready, removed or not the caller's. */
      missing: string[]
      /** The assets' venue catalogue; null when none of the ids is labellable or it failed. */
      catalogue: LabelCatalogue | null
      /** Why the catalogue is null although assets were found (retry with loadLabelCatalogue). */
      catalogueError?: string
    }
  | {
      ok: false
      message: string
      status?: number
      /**
       * Set when the assets belong to more than one venue: the readable ids
       * grouped by venue (request order). Load each group separately.
       */
      venueGroups?: string[][]
    }

const MIXED_VENUES =
  "These files are from different venues. Each venue's files are labelled separately, with that venue's menu."

/** The label editor's assets (one venue) and that venue's active catalogue. */
export async function loadLabelEditorContext(
  assetIds: string[]
): Promise<LabelEditorContextResult> {
  const auth = await getMediaActor()
  if (!auth.ok) return { ok: false, message: auth.message, status: auth.status }
  const context = await getAssetLabelContext(auth.actor, assetIds)
  if (!context.ok)
    return { ok: false, message: context.message, status: context.status }

  const groups = new Map<string, string[]>()
  for (const asset of context.assets) {
    groups.set(asset.venueId, [...(groups.get(asset.venueId) ?? []), asset.id])
  }
  if (groups.size > 1) {
    return {
      ok: false,
      status: 400,
      message: MIXED_VENUES,
      venueGroups: [...groups.values()],
    }
  }
  if (context.assets.length === 0) {
    return { ok: true, assets: [], missing: context.missing, catalogue: null }
  }

  const found = await getLabellingCatalogue(
    auth.actor,
    context.assets[0].venueId
  )
  return found.ok
    ? {
        ok: true,
        assets: context.assets,
        missing: context.missing,
        catalogue: found.catalogue,
      }
    : {
        ok: true,
        assets: context.assets,
        missing: context.missing,
        catalogue: null,
        catalogueError:
          found.status === 404
            ? "The menu for this venue is not available to you."
            : "The menu could not be loaded. Try again in a moment.",
      }
}

/** Reload one venue's catalogue (after an error, or when the menu changed). */
export async function loadLabelCatalogue(
  venueId: string
): Promise<
  { ok: true; catalogue: LabelCatalogue } | { ok: false; message: string }
> {
  const auth = await getMediaActor()
  if (!auth.ok) return { ok: false, message: auth.message }
  const found = await getLabellingCatalogue(auth.actor, venueId)
  if (found.ok) return { ok: true, catalogue: found.catalogue }
  return {
    ok: false,
    message:
      found.status === 404
        ? "The menu for this venue is not available to you."
        : "The menu could not be loaded. Try again in a moment.",
  }
}

function idOf(input: unknown): string {
  return input &&
    typeof input === "object" &&
    typeof (input as { assetId?: unknown }).assetId === "string"
    ? (input as { assetId: string }).assetId
    : ""
}

/**
 * Saves a batch (≤ LABEL_LIMITS.maxBatchAssets) one asset at a time, after a
 * single authorisation. Always one result per input, in input order; a
 * failure of one asset never stops the others.
 */
export async function saveLabelBatch(
  inputs: SaveLabelsInput[]
): Promise<SaveLabelsResult[]> {
  const list: unknown[] = Array.isArray(inputs) ? inputs : []
  const fail = (
    code: "invalid" | "forbidden" | "unavailable",
    message: string
  ): SaveLabelsResult[] =>
    list.map((input) => ({ ok: false, assetId: idOf(input), code, message }))

  if (list.length > LABEL_LIMITS.maxBatchAssets) {
    return fail(
      "invalid",
      `Save at most ${LABEL_LIMITS.maxBatchAssets} files at a time.`
    )
  }
  if (list.length === 0) return []

  const auth = await getMediaActor()
  if (!auth.ok) {
    return fail(auth.status === 503 ? "unavailable" : "forbidden", auth.message)
  }

  const results: SaveLabelsResult[] = []
  for (const input of list) {
    try {
      results.push(await saveAssetLabels(auth.actor, input as SaveLabelsInput))
    } catch (error) {
      console.error("[labels] save failed", { error: redactError(error) })
      results.push({
        ok: false,
        assetId: idOf(input),
        code: "unavailable",
        message: "Labels could not be saved right now. Try again in a moment.",
      })
    }
  }
  return results
}
