"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { WarningIcon } from "@phosphor-icons/react"

import {
  ActivateMenuDialog,
  ArchiveItemControl,
  DiscardDraftDialog,
  MenuDiffView,
  MenuDocumentEditor,
  RetireMenuDialog,
  editorIssues,
  type MenuActionResult,
} from "@/components/nabalens"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  makeSourceKey,
  slugify,
  validateMenuDocument,
} from "@/lib/menus/import"
import type {
  MenuDiff,
  MenuDocItem,
  MenuDocument,
  MenuVersionDetail,
  ReviewDecision,
} from "@/lib/menus/types"

import {
  activateVersionAction,
  discardDraftAction,
  retireVersionAction,
  saveDraftAction,
  setItemArchivedAction,
} from "./actions"
import {
  blockingErrors,
  decideInDraft,
  reviewCount,
  sameDocument,
} from "./review"

type Local = {
  document: MenuDocument
  /** The saved revision these edits started from (sent as expectedRevision). */
  baseRevision: number
}

type Notice = { tone: "success" | "error"; text: string }

/**
 * Draft editing and version lifecycle. Unsaved edits live only here; a save
 * sends the revision the edits were based on, so a draft saved elsewhere in
 * the meantime is reported as a conflict and the local copy is kept until
 * the admin chooses "Reload latest".
 */
export function VersionEditor({
  version,
  diff,
  active,
  reviewBase,
}: {
  version: MenuVersionDetail
  diff: MenuDiff | null
  active: { id: string; title: string } | null
  reviewBase: MenuDocument | null
}) {
  const router = useRouter()
  const isDraft = version.status === "draft"
  const [localState, setLocalState] = React.useState<Local | null>(null)
  /** After a save: the revision whose re-rendered props replace the edits. */
  const [awaiting, setAwaiting] = React.useState<number | null>(null)
  const [decisions, setDecisions] = React.useState<
    Record<string, ReviewDecision>
  >({})
  const [saving, setSaving] = React.useState(false)
  const [notice, setNotice] = React.useState<Notice | null>(null)
  const [conflict, setConflict] = React.useState<string | null>(null)
  const [dialog, setDialog] = React.useState<
    "activate" | "retire" | "discard" | null
  >(null)

  // Once the page re-renders with the saved revision, the server document
  // (with ids of new items and variants) replaces the local copy.
  const caughtUp = awaiting !== null && version.revision >= awaiting
  const local = caughtUp ? null : localState
  const document = local?.document ?? version.document
  const dirty =
    local !== null && !sameDocument(local.document, version.document)
  // New items get ids only on save: no edits until the saved draft is shown.
  const refreshing = awaiting !== null && !caughtUp

  React.useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])

  const errors = React.useMemo(
    () =>
      isDraft
        ? blockingErrors([
            ...validateMenuDocument(document),
            ...editorIssues(document),
          ])
        : [],
    [isDraft, document]
  )
  const validationIssues = React.useMemo(
    () => (isDraft ? blockingErrors(validateMenuDocument(document)) : []),
    [isDraft, document]
  )
  const archived = React.useMemo(
    () => new Set(version.archivedItemIds),
    [version.archivedItemIds]
  )

  function edit(next: MenuDocument) {
    setAwaiting(null)
    setNotice(null)
    setLocalState({
      document: next,
      baseRevision: local?.baseRevision ?? version.revision,
    })
  }

  function decide(sourceKey: string, decision: ReviewDecision) {
    try {
      edit(
        decideInDraft(
          document,
          version.document,
          sourceKey,
          decision,
          reviewBase
        )
      )
      setDecisions((prev) => ({ ...prev, [sourceKey]: decision }))
    } catch (error) {
      setNotice({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "That decision could not be applied.",
      })
    }
  }

  async function save() {
    if (!local || saving) return
    setSaving(true)
    setNotice(null)
    try {
      const result = await saveDraftAction({
        versionId: version.id,
        expectedRevision: local.baseRevision,
        document: local.document,
      })
      if (!result.ok) {
        if (result.conflict) setConflict(result.error)
        else setNotice({ tone: "error", text: result.error })
        return
      }
      setConflict(null)
      setDecisions({})
      setLocalState({ document: local.document, baseRevision: result.revision })
      setAwaiting(result.revision)
      setNotice({
        tone: "success",
        text: `Draft saved (revision ${result.revision}).`,
      })
    } catch {
      setNotice({
        tone: "error",
        text: "The draft could not be saved. Your changes are still here; try again.",
      })
    } finally {
      setSaving(false)
    }
  }

  function reloadLatest() {
    setLocalState(null)
    setAwaiting(null)
    setDecisions({})
    setConflict(null)
    setNotice(null)
    router.refresh()
  }

  const wrap = async (
    run: () => Promise<{ ok: true } | { ok: false; error: string }>
  ): Promise<MenuActionResult> => {
    const result = await run()
    return result.ok ? { ok: true } : { ok: false, error: result.error }
  }

  const renderItemActions = (item: MenuDocItem) => {
    const itemId = item.itemId
    if (!itemId) return null
    return (
      <ArchiveItemControl
        itemName={item.name}
        archived={archived.has(itemId)}
        labelCount={version.labelCounts[itemId] ?? 0}
        onSetArchived={(next) =>
          wrap(() => setItemArchivedAction(itemId, next))
        }
      />
    )
  }

  const unresolved = reviewCount(document)

  return (
    <div className="grid gap-6">
      {diff ? (
        <section aria-labelledby="diff-title" className="grid gap-3">
          <h2 id="diff-title" className="text-lg font-medium">
            Changes compared with the active menu
          </h2>
          {isDraft && dirty ? (
            <p className="text-sm text-muted-foreground">
              Shows the last saved draft. Save to update it.
            </p>
          ) : null}
          <MenuDiffView
            diff={diff}
            document={version.document}
            labelCounts={version.labelCounts}
            decisions={decisions}
            onDecide={isDraft ? decide : undefined}
            readOnly={!isDraft}
          />
        </section>
      ) : isDraft ? (
        <p className="text-sm text-muted-foreground">
          This venue has no active menu, so there is nothing to compare with.
        </p>
      ) : null}

      <section aria-labelledby="editor-title" className="grid gap-3">
        <h2 id="editor-title" className="sr-only">
          {isDraft ? "Edit draft" : "Menu items"}
        </h2>

        {isDraft ? (
          <div className="sticky top-0 z-10 -mx-1 flex flex-col gap-2 rounded-lg border bg-background/95 p-2 backdrop-blur sm:flex-row sm:items-center">
            <p aria-live="polite" className="min-w-0 flex-1 text-sm">
              {saving
                ? "Saving…"
                : refreshing
                  ? "Saved. Loading the saved draft…"
                  : dirty
                    ? "Unsaved changes"
                    : `Saved · revision ${version.revision}`}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="touch"
                onClick={save}
                disabled={!dirty || saving || conflict !== null}
                aria-busy={saving || undefined}
              >
                {saving ? "Saving…" : "Save draft"}
              </Button>
              <Button
                variant="outline"
                size="touch"
                onClick={() => setDialog("activate")}
              >
                Activate…
              </Button>
              <Button
                variant="outline"
                size="touch"
                onClick={() => setDialog("discard")}
              >
                Discard draft…
              </Button>
            </div>
          </div>
        ) : version.status === "active" ? (
          <div className="flex">
            <Button
              variant="outline"
              size="touch"
              onClick={() => setDialog("retire")}
            >
              Retire menu…
            </Button>
          </div>
        ) : null}

        {conflict ? (
          <Alert variant="warning" role="alert">
            <WarningIcon aria-hidden />
            <AlertTitle>This draft changed elsewhere</AlertTitle>
            <AlertDescription className="grid gap-2">
              <span>
                {conflict} Your edits are still on this page. Reload latest
                replaces them with the saved draft.
              </span>
              <span className="flex flex-wrap gap-2">
                <Button size="touch" onClick={reloadLatest}>
                  Reload latest
                </Button>
                <Button
                  variant="outline"
                  size="touch"
                  onClick={() => setConflict(null)}
                >
                  Keep my copy for now
                </Button>
              </span>
            </AlertDescription>
          </Alert>
        ) : null}

        {notice ? (
          <Alert
            variant={notice.tone === "error" ? "destructive" : "default"}
            role="status"
          >
            <AlertDescription>{notice.text}</AlertDescription>
          </Alert>
        ) : null}

        <MenuDocumentEditor
          key={version.id}
          value={document}
          onChange={edit}
          makeSourceKey={makeSourceKey}
          slugify={slugify}
          issues={validationIssues}
          readOnly={!isDraft || saving || refreshing}
          archivedItemIds={version.archivedItemIds}
          labelCounts={version.labelCounts}
          renderItemActions={renderItemActions}
        />
      </section>

      {isDraft ? (
        <>
          <ActivateMenuDialog
            open={dialog === "activate"}
            onOpenChange={(open) => setDialog(open ? "activate" : null)}
            versionTitle={document.title}
            currentActiveTitle={active?.title ?? null}
            unresolvedCount={unresolved}
            errorCount={errors.length}
            itemCount={document.sections.reduce(
              (n, s) => n + s.items.length,
              0
            )}
            hasUnsavedChanges={dirty || saving}
            onConfirm={() =>
              wrap(() =>
                activateVersionAction({
                  versionId: version.id,
                  expectedRevision: version.revision,
                })
              )
            }
          />
          <DiscardDraftDialog
            open={dialog === "discard"}
            onOpenChange={(open) => setDialog(open ? "discard" : null)}
            versionTitle={version.title}
            onConfirm={() => wrap(() => discardDraftAction(version.id))}
          />
        </>
      ) : null}
      {version.status === "active" ? (
        <RetireMenuDialog
          open={dialog === "retire"}
          onOpenChange={(open) => setDialog(open ? "retire" : null)}
          versionTitle={version.title}
          onConfirm={() => wrap(() => retireVersionAction(version.id))}
        />
      ) : null}
    </div>
  )
}
