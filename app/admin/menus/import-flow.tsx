"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ArrowClockwiseIcon } from "@phosphor-icons/react"

import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import {
  ImportIssueList,
  MenuDiffView,
  MenuImportPanel,
  countUnresolved,
  plural,
  possessive,
} from "@/components/nabalens"
import { Notice } from "@/components/nabalens/notice"
import { useOnline } from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { Button } from "@/components/ui/button"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"
import type { ImportIssue, ReviewDecision } from "@/lib/menus/types"
import type { ImportPreview } from "@/lib/server/menus"

import { ADMIN_BOUNDARY_COPY } from "../_components/admin-copy"
import { createDraftAction } from "./actions"
import { resolveDecisions } from "./review"

type PreviewResponse =
  | { ok: true; preview: ImportPreview }
  | { ok: false; message?: string; issues?: ImportIssue[] }

const PREVIEW_URL = "/api/admin/menus/import-preview"

const CREATE_FAILED =
  "The draft could not be created. Your decisions are still here; try again."

const SKELETON_ROWS = [
  ["60%", "35%"],
  ["52%", "30%"],
  ["66%", "40%"],
  ["48%", "28%"],
]

/**
 * Import a JSON/CSV file: preview through the Route Handler (nothing is
 * written), review the diff against the active menu and any uncertain
 * matches, then create a draft and open it.
 */
export function ImportFlow({
  venueId,
  venueName,
  activeTitle,
  onClose,
}: {
  venueId: string
  venueName: string
  /** Title of the venue's active version, or null when it has none. */
  activeTitle: string | null
  onClose: () => void
}) {
  const router = useRouter()
  const online = useOnline()
  const hasActive = activeTitle !== null
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [rejectedIssues, setRejectedIssues] = React.useState<ImportIssue[]>([])
  const [preview, setPreview] = React.useState<ImportPreview | null>(null)
  const [decisions, setDecisions] = React.useState<
    Record<string, ReviewDecision>
  >({})
  const [creating, setCreating] = React.useState(false)
  const [createError, setCreateError] = React.useState<string | null>(null)
  const sessionEnded = useSessionEndedCatch()
  const request = React.useRef<AbortController | null>(null)
  const titleId = React.useId()

  React.useEffect(() => () => request.current?.abort(), [])

  const resolved = React.useMemo(
    () =>
      preview
        ? resolveDecisions(preview.document, decisions, preview.reviewBase)
        : null,
    [preview, decisions]
  )

  async function onPreview(file: File) {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setPending(true)
    setError(null)
    setRejectedIssues([])
    setPreview(null)
    setDecisions({})
    setCreateError(null)
    const body = new FormData()
    body.set("venueId", venueId)
    body.set("file", file)
    try {
      const response = await fetch(PREVIEW_URL, {
        method: "POST",
        body,
        signal: controller.signal,
      })
      const result = (await response
        .json()
        .catch(() => null)) as PreviewResponse | null
      if (!result) {
        setError("The file could not be compared. Try again.")
      } else if (!result.ok) {
        setError(result.message ?? "The file could not be compared.")
        setRejectedIssues(result.issues ?? [])
      } else {
        setPreview(result.preview)
      }
    } catch (cause) {
      if (controller.signal.aborted) return
      void cause
      setError(
        "The file could not be sent. Check your connection and try again."
      )
    } finally {
      if (request.current === controller) {
        request.current = null
        setPending(false)
      }
    }
  }

  async function createDraft() {
    if (!preview || !resolved || resolved.error) return
    setCreating(true)
    setCreateError(null)
    try {
      const result = await createDraftAction({
        venueId,
        title: resolved.document.title,
        source: preview.source,
        document: resolved.document,
        basedOnVersionId: preview.baseVersionId,
      })
      if (!result.ok) {
        setCreateError(result.error)
        return
      }
      router.push(`/admin/menus/versions/${result.versionId}`)
    } catch (cause) {
      setCreateError(sessionEnded(cause) ?? CREATE_FAILED)
    } finally {
      setCreating(false)
    }
  }

  const itemTotal = preview
    ? preview.document.sections.reduce((n, s) => n + s.items.length, 0)
    : 0
  const unresolved = preview ? countUnresolved(preview.diff, decisions) : 0

  return (
    // Handoff "Import a menu": a detail page of {Venue} menus. Its back link
    // is drawn by VenueMenusView, which closes the import.
    <section aria-labelledby={titleId} className="grid gap-6">
      <PageHeader
        venueScope
        scope={venueName}
        titleId={titleId}
        title="Import a menu"
        className="pb-0 md:pb-0"
        summary={
          <>
            <p>
              Compares a file with {possessive(venueName)} active menu. Items
              match only by their source key. Nothing is saved until you create
              the draft.
            </p>
            {preview ? null : (
              <p>
                <a
                  href="/admin/menus/csv-template"
                  download
                  className="rounded-square font-semibold text-ink underline decoration-1 underline-offset-4 focus-ring outline-none hover:decoration-2"
                >
                  Download the CSV template
                </a>{" "}
                with every column (venue, menu, section, item, item_id,
                variants, active dates).
              </p>
            )}
          </>
        }
      />

      {createError ? (
        <Notice
          tone="negative"
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={createDraft}
              disabled={creating || !online}
            >
              <ArrowClockwiseIcon aria-hidden />
              {ADMIN_BOUNDARY_COPY.retry}
            </Button>
          }
        >
          <p>{CREATE_FAILED}</p>
          {createError !== CREATE_FAILED ? (
            <p className="mt-1 text-ink-muted">{createError}</p>
          ) : null}
        </Notice>
      ) : null}

      <MenuImportPanel
        onPreview={onPreview}
        pending={pending}
        error={error}
        issues={preview ? [] : rejectedIssues}
        disabled={creating}
        compared={
          preview
            ? [
                `${plural(preview.document.sections.length, "section")}, ${plural(itemTotal, "item")}`,
                activeTitle ? `compared with ${activeTitle}` : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : undefined
        }
      />

      {!preview && !pending && !error ? (
        <Notice>
          Prices, dietary and spice values in a file are kept as source details
          for reference only. Staff never see them, and they are never treated
          as facts.
        </Notice>
      ) : null}

      {pending ? (
        <SkeletonRegion
          label="Comparing with the active menu…"
          className="grid gap-5"
        >
          {SKELETON_ROWS.map(([title, meta], index) => (
            <div key={index} className="grid gap-2">
              <Skeleton shape="line" style={{ width: title }} />
              <Skeleton shape="line" style={{ width: meta }} />
            </div>
          ))}
        </SkeletonRegion>
      ) : null}

      {preview && resolved ? (
        <>
          {preview.duplicate ? (
            <Notice tone="attention" title="This file was already imported">
              {preview.duplicate.status === "active"
                ? "It is the active menu. Creating a draft from it again changes nothing on its own."
                : "It is already an open draft. Create draft opens that draft instead of a copy."}
            </Notice>
          ) : null}
          {preview.activeDates?.activeFrom ? (
            <Notice>
              The file says this menu runs from {preview.activeDates.activeFrom}
              {preview.activeDates.activeTo
                ? ` to ${preview.activeDates.activeTo}`
                : ""}
              . Choose the activation time when you activate the draft.
            </Notice>
          ) : null}
          <ImportIssueList issues={preview.issues} />
          <MenuDiffView
            diff={preview.diff}
            document={preview.document}
            decisions={decisions}
            hasBase={hasActive}
            hideTitle
            onDecide={(sourceKey, decision) =>
              setDecisions((prev) => ({ ...prev, [sourceKey]: decision }))
            }
          />
          {unresolved > 0 ? (
            <Notice>
              {unresolved === 1
                ? "The uncertain item can wait for the draft, but the draft can't be activated until it is decided."
                : "Uncertain items can wait for the draft, but the draft can't be activated until each is decided."}
            </Notice>
          ) : null}
          {resolved.error ? (
            <Notice tone="negative">{resolved.error}</Notice>
          ) : null}
        </>
      ) : null}

      {/* Create draft is the page's one bottle button, then Cancel. */}
      <div className="flex flex-col gap-2 md:flex-row">
        {preview && resolved ? (
          <Button
            variant="primary"
            onClick={createDraft}
            disabled={creating || !online || !!resolved.error}
            aria-busy={creating || undefined}
          >
            {creating ? "Creating draft…" : "Create draft"}
          </Button>
        ) : null}
        <Button
          variant="quiet"
          disabled={creating}
          onClick={() => {
            request.current?.abort()
            onClose()
          }}
        >
          Cancel
        </Button>
      </div>
    </section>
  )
}
