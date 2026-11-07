"use client"

import * as React from "react"

import { LabelEditorDialog } from "@/components/nabalens"
import { Notice } from "@/components/nabalens/notice"
import type { AddLabelPreset } from "@/components/nabalens/shell/add-context"
import type { UploadDraftEditorProps } from "@/components/nabalens/upload-label-drafts"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { EMPTY_LABEL_SUMMARY } from "@/lib/menus/types"

import {
  loadUploadLabelContext,
  type UploadLabelContext as Context,
} from "./upload-label-api"

export function UploadLabelEditor({
  items,
  onClose,
  onQueue,
  preset,
  presetAssetIds,
}: UploadDraftEditorProps & {
  preset: AddLabelPreset | null
  presetAssetIds: readonly string[]
}) {
  const [context, setContext] = React.useState<Context | null>(null)
  const [attempt, setAttempt] = React.useState(0)
  React.useEffect(() => {
    const controller = new AbortController()
    void loadUploadLabelContext(controller.signal)
      .catch((): Context => ({
        ok: false,
        message: "The menu could not be loaded. Try again.",
      }))
      .then((result) => {
        if (!controller.signal.aborted) setContext(result)
      })
    return () => {
      controller.abort()
    }
  }, [attempt])

  function retry() {
    setContext(null)
    setAttempt((value) => value + 1)
  }

  if (context?.ok) {
    const { catalogue, focus } = context
    return (
      <LabelEditorDialog
        open
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
        title="Label your uploads"
        cancelLabel="Back to uploads"
        catalogue={{ state: "ready", catalogue }}
        onRetryCatalogue={retry}
        focus={focus}
        preset={preset}
        presetAssetIds={presetAssetIds}
        assets={items.map((item) => ({
          id: item.id,
          venueId: catalogue.venueId,
          venueName: catalogue.venueName,
          originalFilename: item.file.name,
          mediaType: item.kind,
          thumbnailUrl: null,
          labels: EMPTY_LABEL_SUMMARY,
        }))}
        uploadDraft={{
          files: new Map(items.map((item) => [item.id, item.file])),
          onQueue: (inputs) => onQueue(catalogue.venueId, inputs),
        }}
      />
    )
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Label your uploads</DialogTitle>
          <DialogDescription>
            Uploads continue while you label.
          </DialogDescription>
        </DialogHeader>
        {context ? (
          <Notice tone="negative">{context.message}</Notice>
        ) : (
          <p role="status">Loading menu…</p>
        )}
        <DialogFooter>
          <Button variant="secondary" size="touch" onClick={onClose}>
            Back to uploads
          </Button>
          {context && (
            <Button size="touch" onClick={retry}>
              Try again
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
