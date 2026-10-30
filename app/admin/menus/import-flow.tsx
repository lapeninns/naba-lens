"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import {
  ImportIssueList,
  MenuDiffView,
  MenuImportPanel,
  countUnresolved,
} from "@/components/nabalens"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import type { ImportIssue, ReviewDecision } from "@/lib/menus/types"
import type { ImportPreview } from "@/lib/server/menus"

import { createDraftAction } from "./actions"
import { resolveDecisions } from "./review"

type PreviewResponse =
  | { ok: true; preview: ImportPreview }
  | { ok: false; message?: string; issues?: ImportIssue[] }

const PREVIEW_URL = "/api/admin/menus/import-preview"

/**
 * Import a JSON/CSV file: preview through the Route Handler (nothing is
 * written), review the diff against the active menu and any uncertain
 * matches, then create a draft and open it.
 */
export function ImportFlow({
  venueId,
  hasActive,
}: {
  venueId: string
  hasActive: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [rejectedIssues, setRejectedIssues] = React.useState<ImportIssue[]>([])
  const [preview, setPreview] = React.useState<ImportPreview | null>(null)
  const [decisions, setDecisions] = React.useState<
    Record<string, ReviewDecision>
  >({})
  const [creating, setCreating] = React.useState(false)
  const [createError, setCreateError] = React.useState<string | null>(null)
  const request = React.useRef<AbortController | null>(null)

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
        setError("The preview could not be read. Try again.")
      } else if (!result.ok) {
        setError(result.message ?? "The file could not be previewed.")
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
    } catch {
      setCreateError("The draft could not be created. Try again.")
    } finally {
      setCreating(false)
    }
  }

  const itemTotal = preview
    ? preview.document.sections.reduce((n, s) => n + s.items.length, 0)
    : 0
  const unresolved = preview ? countUnresolved(preview.diff, decisions) : 0

  return (
    <div className="grid gap-4">
      <MenuImportPanel
        onPreview={onPreview}
        pending={pending}
        error={error}
        issues={preview ? [] : rejectedIssues}
      />

      {preview && resolved ? (
        <section
          aria-labelledby="import-preview-title"
          className="grid gap-4 rounded-lg border bg-card p-4"
        >
          <div className="grid gap-1">
            <h2 id="import-preview-title" className="text-base font-medium">
              Preview:{" "}
              <span className="break-words">{preview.document.title}</span>
            </h2>
            <p className="text-sm text-muted-foreground">
              {preview.source.label} · {preview.document.sections.length}{" "}
              {preview.document.sections.length === 1 ? "section" : "sections"},{" "}
              {itemTotal} {itemTotal === 1 ? "item" : "items"}.{" "}
              {hasActive
                ? "Compared with the active menu. Nothing has been saved yet."
                : "This venue has no active menu, so every item is new. Nothing has been saved yet."}
            </p>
          </div>
          <ImportIssueList issues={preview.issues} />
          <MenuDiffView
            diff={preview.diff}
            document={preview.document}
            decisions={decisions}
            onDecide={(sourceKey, decision) =>
              setDecisions((prev) => ({ ...prev, [sourceKey]: decision }))
            }
          />
          {resolved.error ? (
            <Alert variant="destructive">
              <AlertDescription>{resolved.error}</AlertDescription>
            </Alert>
          ) : null}
          {unresolved > 0 ? (
            <p className="text-sm text-muted-foreground">
              You can create the draft now and resolve the remaining matches in
              the draft; it cannot be activated until they are resolved.
            </p>
          ) : null}
          {createError ? (
            <Alert variant="destructive">
              <AlertTitle>The draft was not created</AlertTitle>
              <AlertDescription>{createError}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              size="touch"
              onClick={createDraft}
              disabled={creating || !!resolved.error}
              aria-busy={creating || undefined}
            >
              {creating ? "Creating draft…" : "Create draft"}
            </Button>
            <Button
              variant="outline"
              size="touch"
              disabled={creating}
              onClick={() => {
                setPreview(null)
                setDecisions({})
                setCreateError(null)
              }}
            >
              Cancel import
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  )
}
