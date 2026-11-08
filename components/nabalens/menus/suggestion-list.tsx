"use client"

import * as React from "react"
import { ImageIcon } from "@phosphor-icons/react"

import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import type { SuggestionView } from "@/lib/menus/types"
import { cn } from "@/lib/utils"

import { EmptyState } from "../empty-state"
import { formatDate } from "../format"
import { OptionSelect } from "../option-select"
import { StatusChip } from "../status-chip"
import type { Option } from "../types"
import type { MenuActionResult } from "./copy"
import {
  menuItemTitleClassName,
  menuListClassName,
  menuMetaClassName,
} from "./section-head"

const STATUS_LABEL: Record<SuggestionView["status"], string> = {
  open: "Open",
  resolved: "Resolved",
  dismissed: "Dismissed",
  withdrawn: "Withdrawn",
}

type SuggestionListProps = {
  suggestions: SuggestionView[]
  /** Items of this venue's active menu (name may include the section). */
  itemOptions: Option[]
  onResolve: (suggestionId: string, itemId: string) => Promise<MenuActionResult>
  onDismiss: (suggestionId: string) => Promise<MenuActionResult>
  className?: string
}

/** Missing-item suggestions: link to an existing item, or dismiss. */
export function SuggestionList({
  suggestions,
  itemOptions,
  onResolve,
  onDismiss,
  className,
}: SuggestionListProps) {
  if (suggestions.length === 0) {
    return (
      <EmptyState
        variant="done"
        title="No missing-item suggestions."
        className={cn("py-0", className)}
      />
    )
  }
  return (
    <ul
      aria-label="Missing-item suggestions"
      className={cn(menuListClassName, className)}
    >
      {suggestions.map((s) => (
        <SuggestionRow
          key={s.id}
          suggestion={s}
          itemOptions={itemOptions}
          onResolve={onResolve}
          onDismiss={onDismiss}
        />
      ))}
    </ul>
  )
}

function SuggestionRow({
  suggestion: s,
  itemOptions,
  onResolve,
  onDismiss,
}: {
  suggestion: SuggestionView
  itemOptions: Option[]
  onResolve: SuggestionListProps["onResolve"]
  onDismiss: SuggestionListProps["onDismiss"]
}) {
  const id = React.useId()
  const [picking, setPicking] = React.useState(false)
  const [itemId, setItemId] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState<"resolve" | "dismiss" | null>(
    null
  )
  const [error, setError] = React.useState<string | null>(null)
  const [thumbFailed, setThumbFailed] = React.useState(false)
  const sessionEnded = useSessionEndedCatch()

  async function run(kind: "resolve" | "dismiss") {
    if (kind === "resolve" && !picking) {
      setPicking(true)
      return
    }
    if (kind === "resolve" && !itemId) {
      setError("Choose the menu item this photo or video shows.")
      return
    }
    setPending(kind)
    setError(null)
    try {
      const result =
        kind === "resolve"
          ? await onResolve(s.id, itemId!)
          : await onDismiss(s.id)
      if (!result.ok) setError(result.error)
    } catch (cause) {
      setError(
        sessionEnded(cause) ?? "The suggestion could not be updated. Try again."
      )
    } finally {
      setPending(null)
    }
  }

  const meta = [
    s.createdByName ? `Suggested by ${s.createdByName}` : "Suggested",
    `on ${formatDate(s.createdAt)}`,
  ].join(" ")

  return (
    <li className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3 px-4 py-3">
      <div className="size-14 overflow-hidden rounded-control bg-surface-2">
        {s.assetThumbnailUrl && !thumbFailed ? (
          // Signed private URL: not routed through next/image (see MediaTile).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={s.assetThumbnailUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setThumbFailed(true)}
            className="size-full object-cover"
          />
        ) : (
          <span className="flex size-full items-center justify-center text-ink-muted">
            <ImageIcon className="size-5" aria-hidden />
          </span>
        )}
      </div>
      <div className="grid min-w-0 gap-2">
        <div className="grid min-w-0 gap-0.5">
          <p className="flex flex-wrap items-center gap-2">
            <span className={cn("break-words", menuItemTitleClassName)}>
              “{s.suggestedName}”
            </span>
            {s.status !== "open" ? (
              <StatusChip tone="closed">{STATUS_LABEL[s.status]}</StatusChip>
            ) : null}
          </p>
          <p className={menuMetaClassName}>
            {meta}
            {s.assetId ? null : " · the file is no longer available"}
          </p>
          {s.status === "resolved" && s.resolvedItemName ? (
            <p className="text-body text-ink">
              Linked to “{s.resolvedItemName}”
            </p>
          ) : null}
          {s.resolutionNote ? (
            <p className={menuMetaClassName}>{s.resolutionNote}</p>
          ) : null}
        </div>

        {s.status === "open" ? (
          <div className="grid gap-2">
            {picking && itemOptions.length > 0 ? (
              <Field className="gap-1.5">
                <FieldLabel htmlFor={`${id}-item`}>
                  Menu item for “{s.suggestedName}”
                </FieldLabel>
                <OptionSelect
                  id={`${id}-item`}
                  options={itemOptions}
                  value={itemId}
                  onValueChange={(v) => {
                    setItemId(v)
                    setError(null)
                  }}
                  placeholder="Choose an item"
                  disabled={pending !== null}
                />
              </Field>
            ) : null}
            {itemOptions.length === 0 ? (
              <p className={menuMetaClassName}>
                No active menu items to link to. Add the item to a draft and
                activate it, or dismiss this suggestion.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {itemOptions.length > 0 ? (
                <Button
                  variant={picking ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => run("resolve")}
                  disabled={pending !== null}
                  aria-busy={pending === "resolve" || undefined}
                  aria-label={`Link to an item: “${s.suggestedName}”`}
                >
                  {pending === "resolve" ? "Linking…" : "Link to an item"}
                </Button>
              ) : null}
              {picking ? (
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => {
                    setPicking(false)
                    setItemId(null)
                    setError(null)
                  }}
                  disabled={pending !== null}
                >
                  Cancel
                </Button>
              ) : (
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => run("dismiss")}
                  disabled={pending !== null}
                  aria-busy={pending === "dismiss" || undefined}
                  aria-label={`Dismiss “${s.suggestedName}”`}
                >
                  {pending === "dismiss" ? "Dismissing…" : "Dismiss"}
                </Button>
              )}
            </div>
            {error ? (
              <p role="alert" className="text-body font-bold text-warn-fg">
                {error}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  )
}
