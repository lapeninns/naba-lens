"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  ArrowClockwiseIcon,
  DotsThreeIcon,
  WarningIcon,
} from "@phosphor-icons/react"

import {
  ACTIVE_MEANING_COPY,
  ActivateMenuDialog,
  ArchiveItemControl,
  DiscardDraftDialog,
  LABELS_KEPT_COPY,
  MenuDiffView,
  MenuDocumentEditor,
  MenuVersionStatusBadge,
  ProvenanceCard,
  RetireMenuDialog,
  activationBlockers,
  editorIssues,
  plural,
  possessive,
  type MenuActionResult,
} from "@/components/nabalens"
import { Notice } from "@/components/nabalens/notice"
import { OfflineNotice, useOnline } from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
  createDraftFromActiveAction,
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

type Message = { tone: "positive" | "negative"; text: string }

const READ_ONLY_NOTE: Record<
  Exclude<MenuVersionDetail["status"], "draft">,
  string
> = {
  active: "Active versions are read-only. Start a draft to change items.",
  retired: `No longer used for new labels. ${LABELS_KEPT_COPY}`,
  discarded: "Kept for history. It was never active, so no labels use it.",
}

const countItems = (doc: MenuDocument) =>
  doc.sections.reduce((n, s) => n + s.items.length, 0)

/** "Your changes to 2 items in Breads aren't saved yet." */
function unsavedCopy(local: MenuDocument, saved: MenuDocument): string {
  const before = new Map<string, string>()
  for (const s of saved.sections)
    for (const item of s.items)
      before.set(item.sourceKey, JSON.stringify([s.slug, item]))
  const sections = new Set<string>()
  let items = 0
  for (const s of local.sections)
    for (const item of s.items) {
      if (before.get(item.sourceKey) === JSON.stringify([s.slug, item]))
        continue
      items += 1
      sections.add(s.name.trim() || "Untitled section")
    }
  const savedKeys = new Set(
    local.sections.flatMap((s) => s.items.map((i) => i.sourceKey))
  )
  for (const s of saved.sections)
    for (const item of s.items)
      if (!savedKeys.has(item.sourceKey)) {
        items += 1
        sections.add(s.name.trim() || "Untitled section")
      }
  if (items === 0) return "Your changes aren't saved yet."
  const where = sections.size === 1 ? ` in ${[...sections][0]}` : ""
  return `Your changes to ${plural(items, "item")}${where} aren't saved yet.`
}

/** "Cheese Naan and 1 other item need a decision. …" */
function needsDecisionCopy(names: string[]): string {
  if (names.length === 1)
    return `${names[0]} needs a decision. Activation stays unavailable until it is decided.`
  const others = names.length - 1
  return `${names[0]} and ${plural(others, "other item")} need a decision. Activation stays unavailable until each is decided.`
}

/**
 * A menu version (A15): the draft editor and its lifecycle, or a read-only
 * version. Unsaved edits live only here; a save sends the revision the edits
 * were based on, so a draft saved elsewhere in the meantime is reported as a
 * conflict and the local copy is kept until the admin reloads.
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
  const online = useOnline()
  const isDraft = version.status === "draft"
  const [localState, setLocalState] = React.useState<Local | null>(null)
  /** After a save: the revision whose re-rendered props replace the edits. */
  const [awaiting, setAwaiting] = React.useState<number | null>(null)
  const [decisions, setDecisions] = React.useState<
    Record<string, ReviewDecision>
  >({})
  const [saving, setSaving] = React.useState(false)
  const [message, setMessage] = React.useState<Message | null>(null)
  const [conflict, setConflict] = React.useState(false)
  const [dialog, setDialog] = React.useState<
    "activate" | "retire" | "discard" | null
  >(null)
  const [leaving, setLeaving] = React.useState<string | null>(null)
  const [starting, setStarting] = React.useState(false)
  const decisionsId = React.useId()
  const editorId = React.useId()

  // Once the page re-renders with the saved revision, the server document
  // (with ids of new items and variants) replaces the local copy.
  const caughtUp = awaiting !== null && version.revision >= awaiting
  const local = caughtUp ? null : localState
  const document = local?.document ?? version.document
  const dirty =
    local !== null && !sameDocument(local.document, version.document)
  // New items get ids only on save: no edits until the saved draft is shown.
  const refreshing = awaiting !== null && !caughtUp
  const readOnly = !isDraft || saving || refreshing

  React.useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])

  // In-app links don't fire beforeunload; ask before leaving unsaved edits.
  React.useEffect(() => {
    if (!dirty) return
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return
      const link = (event.target as Element | null)?.closest?.("a[href]")
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank")
        return
      const url = new URL(link.href, window.location.href)
      if (url.origin !== window.location.origin) return
      if (url.pathname === window.location.pathname && url.hash) return
      event.preventDefault()
      setLeaving(url.pathname + url.search + url.hash)
    }
    window.document.addEventListener("click", onClick, true)
    return () => window.document.removeEventListener("click", onClick, true)
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
    if (readOnly) return
    setAwaiting(null)
    setMessage(null)
    setLocalState({
      document: next,
      baseRevision: local?.baseRevision ?? version.revision,
    })
  }

  function decide(sourceKey: string, decision: ReviewDecision) {
    if (readOnly) return
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
      setMessage({
        tone: "negative",
        text:
          error instanceof Error
            ? error.message
            : "That decision could not be applied.",
      })
    }
  }

  async function save() {
    if (!local || saving || refreshing) return
    setSaving(true)
    setMessage(null)
    try {
      const result = await saveDraftAction({
        versionId: version.id,
        expectedRevision: local.baseRevision,
        document: local.document,
      })
      if (!result.ok) {
        if (result.conflict) setConflict(true)
        else setMessage({ tone: "negative", text: result.error })
        return
      }
      setConflict(false)
      setDecisions({})
      setLocalState({ document: local.document, baseRevision: result.revision })
      setAwaiting(result.revision)
      setMessage({
        tone: "positive",
        text: `Saved. ${plural(countItems(local.document), "item")} in ${plural(local.document.sections.length, "section")}.`,
      })
    } catch {
      setMessage({
        tone: "negative",
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
    setConflict(false)
    setMessage(null)
    router.refresh()
  }

  async function startDraft() {
    setStarting(true)
    setMessage(null)
    try {
      const result = await createDraftFromActiveAction(version.venueId)
      if (!result.ok) {
        setMessage({ tone: "negative", text: result.error })
        return
      }
      router.push(`/admin/menus/versions/${result.versionId}`)
    } catch {
      setMessage({
        tone: "negative",
        text: "The draft could not be created. Try again.",
      })
    } finally {
      setStarting(false)
    }
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

  const venue = version.venueName
  const title = version.title
  const unresolved = reviewCount(document)
  const undecided = document.sections.flatMap((s) =>
    s.items.filter((i) => i.review).map((i) => i.name)
  )
  const itemCount = countItems(document)
  const blockers = activationBlockers({
    unresolvedCount: 0,
    errorCount: errors.length,
    itemCount,
    hasUnsavedChanges: dirty || saving,
  })

  function review() {
    const target =
      window.document.getElementById(decisionsId) ??
      window.document.getElementById(editorId)
    target?.focus()
  }

  const more = (label: string, onSelect: () => void) => (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="quiet"
            size="icon"
            className="max-md:flex-none!"
            aria-label={`More actions for ${title}`}
          />
        }
      >
        <DotsThreeIcon weight="bold" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem variant="destructive" onClick={onSelect}>
          {label}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const actions = isDraft ? (
    <>
      <Button
        variant="secondary"
        size="touch"
        onClick={save}
        disabled={!dirty || saving || refreshing || conflict || !online}
        aria-busy={saving || undefined}
      >
        {saving ? "Saving…" : "Save"}
      </Button>
      {unresolved > 0 ? (
        <Button size="touch" onClick={review}>
          <WarningIcon aria-hidden />
          {`Review ${plural(unresolved, "item")}`}
        </Button>
      ) : (
        <Button
          size="touch"
          onClick={() => setDialog("activate")}
          disabled={!online}
        >
          Activate for labelling
        </Button>
      )}
      {more("Discard draft", () => setDialog("discard"))}
    </>
  ) : version.status === "active" ? (
    <>
      <Button
        variant="secondary"
        size="touch"
        onClick={startDraft}
        disabled={starting || !online}
        aria-busy={starting || undefined}
      >
        {starting ? "Creating draft…" : "Start a draft from this version"}
      </Button>
      {more("Retire", () => setDialog("retire"))}
    </>
  ) : null

  const coverageCopy = `Nothing carries over automatically. ${possessive(venue)} coverage will show "Menu changed — review coverage" until its manager decides what still applies.`

  return (
    <>
      <PageHeader
        venueScope
        scope={[venue, "All months"]}
        title={title}
        summary={
          <p>
            <MenuVersionStatusBadge status={version.status} />{" "}
            {ACTIVE_MEANING_COPY}
          </p>
        }
        actions={actions}
      />

      <div className="grid gap-6 md:gap-8">
        <OfflineNotice />
        {conflict ? (
          <Notice
            tone="attention"
            role="alert"
            title="Someone else saved first"
            action={
              <Button variant="secondary" size="sm" onClick={reloadLatest}>
                <ArrowClockwiseIcon aria-hidden />
                Reload
              </Button>
            }
          >
            Someone else saved this draft after you opened it. Reload to see the
            latest. Your changes are still here until you do.
          </Notice>
        ) : null}
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

        <div className="grid items-start gap-6 md:gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="grid min-w-0 gap-8">
            <section
              id={editorId}
              tabIndex={-1}
              aria-labelledby={`${editorId}-title`}
              className="grid min-w-0 gap-3 rounded-panel outline-none"
            >
              <h2 id={`${editorId}-title`} className="sr-only">
                {isDraft ? "Edit draft" : "Menu items"}
              </h2>
              {isDraft ? (
                <p
                  aria-live="polite"
                  className="text-meta-touch text-ink-muted md:text-meta"
                >
                  {saving
                    ? "Saving…"
                    : refreshing
                      ? "Saved. Loading the saved draft…"
                      : dirty
                        ? "Unsaved changes"
                        : `Saved · revision ${version.revision}`}
                </p>
              ) : null}
              <MenuDocumentEditor
                key={version.id}
                value={document}
                onChange={edit}
                makeSourceKey={makeSourceKey}
                slugify={slugify}
                issues={validationIssues}
                readOnly={readOnly}
                showTitle={false}
                archivedItemIds={version.archivedItemIds}
                labelCounts={version.labelCounts}
                renderItemActions={renderItemActions}
              />
            </section>

            {diff ? (
              <div className="grid gap-2">
                {isDraft && dirty ? (
                  <p className="text-meta-touch text-ink-muted md:text-meta">
                    Shows the last saved draft. Save to update it.
                  </p>
                ) : null}
                <MenuDiffView
                  diff={diff}
                  document={version.document}
                  labelCounts={version.labelCounts}
                  decisions={decisions}
                  onDecide={readOnly ? undefined : decide}
                  readOnly={readOnly}
                  locked={isDraft && (saving || refreshing)}
                  decisionsId={decisionsId}
                  source={
                    <>
                      {active ? `${active.title} · ` : null}
                      {version.source.label ? (
                        <span className="font-mono">
                          {version.source.label}
                        </span>
                      ) : null}
                    </>
                  }
                />
              </div>
            ) : isDraft ? (
              <p className="text-body-touch text-ink-muted md:text-body-sm">
                This venue has no active menu, so there is nothing to compare
                with.
              </p>
            ) : null}
          </div>

          <aside
            aria-label="About this version"
            className="grid min-w-0 gap-4 lg:sticky lg:top-6"
          >
            {isDraft ? (
              <section
                aria-labelledby={`${editorId}-before`}
                className="grid gap-3 rounded-panel border border-line bg-panel p-4 md:p-5"
              >
                <h2
                  id={`${editorId}-before`}
                  className="text-section-title-touch text-ink md:text-section-title"
                >
                  {unresolved === 0 && blockers.length === 0
                    ? "Ready to activate"
                    : "Before you activate"}
                </h2>
                {unresolved > 0 ? (
                  <Notice
                    tone="attention"
                    title={
                      unresolved === 1
                        ? "1 item needs a decision"
                        : `${unresolved} items need a decision`
                    }
                  >
                    {needsDecisionCopy(undecided)}
                  </Notice>
                ) : null}
                {blockers.length > 0 ? (
                  <ul className="grid list-disc gap-0.5 pl-5 text-body-touch text-ink md:text-body-sm">
                    {blockers.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                ) : null}
                <p className="text-body-touch text-ink-muted md:text-body-sm">
                  {unresolved === 0 && blockers.length === 0
                    ? "Every item is decided. "
                    : null}
                  {active
                    ? `Activating retires ${active.title}. ${LABELS_KEPT_COPY}`
                    : `This becomes ${possessive(venue)} first active menu.`}
                </p>
                <p className="text-body-touch text-ink-muted md:text-body-sm">
                  {active
                    ? coverageCopy
                    : "Nothing carries over automatically."}
                </p>
              </section>
            ) : null}
            <ProvenanceCard
              version={version}
              note={
                version.status === "draft"
                  ? undefined
                  : READ_ONLY_NOTE[version.status]
              }
            />
          </aside>
        </div>
      </div>

      {isDraft ? (
        <>
          <ActivateMenuDialog
            open={dialog === "activate"}
            onOpenChange={(open) => setDialog(open ? "activate" : null)}
            versionTitle={document.title}
            currentActiveTitle={active?.title ?? null}
            venueName={venue}
            unresolvedCount={unresolved}
            errorCount={errors.length}
            itemCount={itemCount}
            hasUnsavedChanges={dirty || saving}
            onConfirm={async () => {
              const result = await wrap(() =>
                activateVersionAction({
                  versionId: version.id,
                  expectedRevision: version.revision,
                })
              )
              if (result.ok)
                setMessage({
                  tone: "positive",
                  text: `${document.title} is active for labelling at ${venue}.${
                    active
                      ? ` ${active.title} is retired; existing labels are kept.`
                      : ""
                  }`,
                })
              return result
            }}
          />
          <DiscardDraftDialog
            open={dialog === "discard"}
            onOpenChange={(open) => setDialog(open ? "discard" : null)}
            versionTitle={title}
            venueName={venue}
            activeTitle={active?.title ?? null}
            decisionCount={Object.keys(decisions).length}
            imported={version.source.kind !== "manual"}
            onConfirm={() => wrap(() => discardDraftAction(version.id))}
          />
          <AlertDialog
            open={leaving !== null}
            onOpenChange={(open) => {
              if (!open) setLeaving(null)
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
                <AlertDialogDescription>
                  {local ? unsavedCopy(local.document, version.document) : null}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel size="touch">Keep editing</AlertDialogCancel>
                <Button
                  variant="danger"
                  size="touch"
                  onClick={() => {
                    const href = leaving
                    setLeaving(null)
                    setLocalState(null)
                    if (href) router.push(href)
                  }}
                >
                  Discard changes
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : null}
      {version.status === "active" ? (
        <RetireMenuDialog
          open={dialog === "retire"}
          onOpenChange={(open) => setDialog(open ? "retire" : null)}
          versionTitle={title}
          venueName={venue}
          onConfirm={() => wrap(() => retireVersionAction(version.id))}
        />
      ) : null}
    </>
  )
}
