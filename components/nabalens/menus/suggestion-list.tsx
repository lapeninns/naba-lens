"use client"

import * as React from "react"
import { ImageIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import type { SuggestionView } from "@/lib/menus/types"
import { cn } from "@/lib/utils"

import { formatDate } from "../format"
import { OptionSelect } from "../option-select"
import type { Option } from "../types"
import type { MenuActionResult } from "./copy"

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
      <p
        className={cn(
          "rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground",
          className
        )}
      >
        No missing-item suggestions.
      </p>
    )
  }
  return (
    <ul
      aria-label="Missing-item suggestions"
      className={cn("divide-y rounded-lg border bg-card", className)}
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
  const [itemId, setItemId] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState<"resolve" | "dismiss" | null>(
    null
  )
  const [error, setError] = React.useState<string | null>(null)
  const [thumbFailed, setThumbFailed] = React.useState(false)

  async function run(kind: "resolve" | "dismiss") {
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
    } catch {
      setError("The suggestion could not be updated. Try again.")
    } finally {
      setPending(null)
    }
  }

  const by = [
    s.createdByName ? `Suggested by ${s.createdByName}` : "Suggested",
    `on ${formatDate(s.createdAt)}`,
  ].join(" ")

  return (
    <li className="grid gap-3 p-3 sm:grid-cols-[4rem_minmax(0,1fr)]">
      <div className="size-16 overflow-hidden rounded-md bg-media-placeholder">
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
          <span className="flex size-full items-center justify-center text-muted-foreground">
            <ImageIcon className="size-6" aria-hidden />
          </span>
        )}
      </div>
      <div className="grid min-w-0 gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium break-words">“{s.suggestedName}”</span>
            {s.status !== "open" ? (
              <span className="inline-flex h-5 items-center rounded-sm bg-muted px-1.5 text-xs font-medium text-muted-foreground">
                {STATUS_LABEL[s.status]}
              </span>
            ) : null}
          </p>
          <p className="text-sm text-muted-foreground">
            {by}
            {s.assetId ? null : " · the file is no longer available"}
          </p>
          {s.status === "resolved" && s.resolvedItemName ? (
            <p className="text-sm">Linked to “{s.resolvedItemName}”</p>
          ) : null}
          {s.resolutionNote ? (
            <p className="text-sm text-muted-foreground">{s.resolutionNote}</p>
          ) : null}
        </div>

        {s.status === "open" ? (
          <div className="grid gap-2">
            {itemOptions.length > 0 ? (
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
            ) : (
              <p className="text-sm text-muted-foreground">
                No active menu items to link to. Add the item to a draft and
                activate it, or dismiss this suggestion.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {itemOptions.length > 0 ? (
                <Button
                  size="touch"
                  onClick={() => run("resolve")}
                  disabled={pending !== null}
                  aria-busy={pending === "resolve" || undefined}
                  aria-label={`Link to item: “${s.suggestedName}”`}
                >
                  {pending === "resolve" ? "Linking…" : "Link to item"}
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="touch"
                onClick={() => run("dismiss")}
                disabled={pending !== null}
                aria-busy={pending === "dismiss" || undefined}
                aria-label={`Dismiss “${s.suggestedName}”`}
              >
                {pending === "dismiss" ? "Dismissing…" : "Dismiss"}
              </Button>
            </div>
            {error ? (
              <p role="alert" className="text-sm text-negative">
                {error}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  )
}
