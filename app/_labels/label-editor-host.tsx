"use client"

import * as React from "react"
import { ArrowClockwiseIcon } from "@phosphor-icons/react"

import { LabelEditorDialog, type CatalogueProp } from "@/components/nabalens"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type {
  LabelEditorAsset,
  SaveLabelsInput,
  SaveLabelsResult,
} from "@/lib/menus/types"

import {
  loadLabelCatalogue,
  loadLabelEditorContext,
  saveLabelBatch,
  type LabelEditorContextResult,
} from "./actions"

export type LabelEditorHostProps = {
  /** 1..LABEL_LIMITS.maxBatchAssets ready asset ids (any venues). */
  assetIds: string[]
  /** Controlled: the host loads when this turns true and resets when false. */
  open: boolean
  /** Called with false once the person is done (saved, skipped or closed). */
  onOpenChange: (open: boolean) => void
  /** After each save that stored at least one file: refresh the gallery. */
  onSaved?: (results: SaveLabelsResult[]) => void
  /** Overrides the editor's default heading. */
  title?: string
}

type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready"
      assets: LabelEditorAsset[]
      missing: string[]
      catalogue: CatalogueProp
    }

const NETWORK =
  "Labels could not be loaded. Check your connection and try again."
const NOTHING_TO_LABEL =
  "These files cannot be labelled right now. They may have been removed or still be processing."
const MENU_FAILED = "The menu could not be loaded. Try again in a moment."

/**
 * The editor context for `ids` as the next phase. `split`: when the files
 * span several venues, load the first venue's files and return the groups.
 */
async function fetchContext(
  ids: string[],
  split: boolean
): Promise<{ phase: Phase; groups?: string[][] }> {
  let result: LabelEditorContextResult
  let groups: string[][] | undefined
  try {
    result = await loadLabelEditorContext(ids)
    const venueGroups = result.ok
      ? undefined
      : result.venueGroups?.filter((g) => g.length > 0)
    if (split && venueGroups && venueGroups.length > 1) {
      groups = venueGroups
      result = await loadLabelEditorContext(venueGroups[0])
    }
  } catch {
    return { phase: { kind: "error", message: NETWORK } }
  }
  if (!result.ok) {
    return { phase: { kind: "error", message: result.message }, groups }
  }
  if (result.assets.length === 0) {
    return { phase: { kind: "error", message: NOTHING_TO_LABEL }, groups }
  }
  return {
    groups,
    phase: {
      kind: "ready",
      assets: result.assets,
      missing: result.missing,
      catalogue: result.catalogue
        ? { state: "ready", catalogue: result.catalogue }
        : { state: "error", message: result.catalogueError ?? MENU_FAILED },
    },
  }
}

/**
 * Loads and saves labels for G's LabelEditorDialog (Server Functions in
 * ./actions). Mount it anywhere that knows asset ids: the staff upload dialog
 * ("Label these files"), and the viewer ("Add/Edit labels") in the portfolio
 * and the admin library.
 *
 * Files from several venues are labelled one venue at a time (each against
 * its own venue's menu): when the person finishes or skips one venue's files,
 * the next venue's files open; the heading says "venue 1 of 2". Ids that are
 * no longer labellable (removed, not ready, not theirs) are left out.
 */
export function LabelEditorHost(props: LabelEditorHostProps) {
  if (!props.open || props.assetIds.length === 0) return null
  // A fresh session per opening: nothing stale survives a close.
  return <HostSession key={props.assetIds.join(",")} {...props} />
}

function HostSession({
  assetIds,
  onOpenChange,
  onSaved,
  title,
}: LabelEditorHostProps) {
  const [groups, setGroups] = React.useState<string[][]>([assetIds])
  const [index, setIndex] = React.useState(0)
  const [phase, setPhase] = React.useState<Phase>({ kind: "loading" })
  // Only the latest request may update state (stale responses are ignored).
  const contextRequest = React.useRef(0)
  const catalogueRequest = React.useRef(0)

  /** Callers show the loading state first (the session starts loading). */
  const load = React.useCallback((ids: string[], split: boolean) => {
    const token = ++contextRequest.current
    catalogueRequest.current++
    void fetchContext(ids, split).then((next) => {
      if (token !== contextRequest.current) return
      if (next.groups) {
        setGroups(next.groups)
        setIndex(0)
      }
      setPhase(next.phase)
    })
  }, [])

  // The session is keyed by the ids and unmounted on close, so this runs once
  // per opening; late responses after a close update nothing.
  React.useEffect(() => {
    load(assetIds, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  const setCatalogue = (catalogue: CatalogueProp) =>
    setPhase((p) => (p.kind === "ready" ? { ...p, catalogue } : p))

  async function retryCatalogue() {
    if (phase.kind !== "ready") return
    const token = ++catalogueRequest.current
    setCatalogue({ state: "loading" })
    let next: CatalogueProp
    try {
      const result = await loadLabelCatalogue(phase.assets[0].venueId)
      next = result.ok
        ? { state: "ready", catalogue: result.catalogue }
        : { state: "error", message: result.message }
    } catch {
      next = { state: "error", message: NETWORK }
    }
    if (token === catalogueRequest.current) setCatalogue(next)
  }

  async function save(inputs: SaveLabelsInput[]) {
    // A rejection (network failure, action error) tells the editor nothing
    // was confirmed; it keeps the person's changes.
    const results = await saveLabelBatch(inputs)
    if (!Array.isArray(results)) throw new Error("No results")
    return results
  }

  /** The current venue's files are done: open the next venue's, or close. */
  function finishGroup() {
    if (index + 1 < groups.length) {
      const next = index + 1
      setIndex(next)
      setPhase({ kind: "loading" })
      load(groups[next], false)
    } else {
      onOpenChange(false)
    }
  }

  const multi = groups.length > 1
  const heading = multi
    ? `${title ?? "Label files"} (venue ${index + 1} of ${groups.length})`
    : title

  if (phase.kind === "ready") {
    return (
      <LabelEditorDialog
        open
        onOpenChange={(next) => {
          if (!next) finishGroup()
        }}
        assets={phase.assets}
        catalogue={phase.catalogue}
        onRetryCatalogue={() => void retryCatalogue()}
        onSave={save}
        onSaved={onSaved}
        title={heading}
      />
    )
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onOpenChange(false)
      }}
    >
      {/* One Close action, in the footer (44px on phones). */}
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{heading ?? "Labels"}</DialogTitle>
          <DialogDescription>
            Optional. Labels help find files later.
          </DialogDescription>
        </DialogHeader>
        {phase.kind === "loading" ? (
          <p role="status" className="text-muted-foreground">
            Loading labels and menu…
          </p>
        ) : (
          <Alert variant="destructive">
            <AlertDescription>{phase.message}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="touch"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          {phase.kind === "error" ? (
            <Button
              type="button"
              size="touch"
              onClick={() => {
                setPhase({ kind: "loading" })
                load(groups[index], !multi)
              }}
            >
              <ArrowClockwiseIcon data-icon="inline-start" aria-hidden />
              Try again
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
