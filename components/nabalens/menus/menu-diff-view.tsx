"use client"

import * as React from "react"
import { WarningIcon } from "@phosphor-icons/react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import type {
  DiffChange,
  MenuDiff,
  MenuDocItem,
  MenuDocument,
  ReviewDecision,
  UncertainMatch,
} from "@/lib/menus/types"
import { cn } from "@/lib/utils"

import { labelledFilesCopy } from "./copy"

/** Uncertain matches without a decision in `decisions`. */
export function countUnresolved(
  diff: Pick<MenuDiff, "uncertain">,
  decisions?: Record<string, ReviewDecision>
): number {
  return diff.uncertain.filter((u) => !decisions?.[u.sourceKey]).length
}

type MenuDiffViewProps = {
  diff: MenuDiff
  /** The incoming/draft document, to show "after" values of changed fields. */
  document?: MenuDocument
  /** Labelled photos/videos per item id (warns on removed items). */
  labelCounts?: Record<string, number>
  /** Decisions already made, by source key (rows stay listed as resolved). */
  decisions?: Record<string, ReviewDecision>
  onDecide?: (sourceKey: string, decision: ReviewDecision) => void
  /** e.g. "the active menu"; what the draft is compared with. */
  baseLabel?: string
  readOnly?: boolean
  className?: string
}

/** Added / changed / removed / uncertain between the active menu and a draft. */
export function MenuDiffView({
  diff,
  document,
  labelCounts = {},
  decisions,
  onDecide,
  baseLabel = "the active menu",
  readOnly = false,
  className,
}: MenuDiffViewProps) {
  const unresolved = countUnresolved(diff, decisions)
  const itemsByKey = React.useMemo(() => {
    const map = new Map<string, MenuDocItem>()
    for (const s of document?.sections ?? [])
      for (const item of s.items) map.set(item.sourceKey, item)
    return map
  }, [document])

  const counts = [
    { label: "Added", value: diff.added.length },
    { label: "Changed", value: diff.changed.length },
    { label: "Removed", value: diff.removed.length },
    { label: "Uncertain", value: diff.uncertain.length },
    { label: "Unchanged", value: diff.unchangedCount },
  ]
  const nothing =
    diff.added.length +
      diff.changed.length +
      diff.removed.length +
      diff.uncertain.length ===
    0

  return (
    <section
      aria-label={`Changes compared with ${baseLabel}`}
      className={cn("grid gap-4", className)}
    >
      <dl className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {counts.map((c) => (
          <div
            key={c.label}
            className="rounded-lg border bg-card px-3 py-2"
            data-testid={`diff-count-${c.label.toLowerCase()}`}
          >
            <dt className="text-xs text-muted-foreground">{c.label}</dt>
            <dd className="text-lg font-medium tabular-nums">{c.value}</dd>
          </div>
        ))}
      </dl>

      {diff.uncertain.length > 0 ? (
        <div aria-live="polite">
          {unresolved > 0 ? (
            <Alert variant="warning">
              <WarningIcon aria-hidden />
              <AlertTitle>
                {unresolved === 1
                  ? "1 uncertain match to resolve"
                  : `${unresolved} uncertain matches to resolve`}
              </AlertTitle>
              <AlertDescription>
                Activation is blocked until every uncertain match is resolved.
                Choose whether each one is the same item as an existing one, or
                a new item. Nothing is merged by name automatically.
              </AlertDescription>
            </Alert>
          ) : (
            <p role="status" className="text-sm text-positive">
              All uncertain matches are resolved.
            </p>
          )}
        </div>
      ) : null}

      {nothing ? (
        <p className="text-sm text-muted-foreground">
          No differences from {baseLabel}.
        </p>
      ) : null}

      {diff.uncertain.length > 0 ? (
        <DiffGroup title="Uncertain matches" count={diff.uncertain.length}>
          {diff.uncertain.map((u) => (
            <UncertainRow
              key={u.sourceKey}
              match={u}
              decision={decisions?.[u.sourceKey]}
              onDecide={readOnly ? undefined : onDecide}
            />
          ))}
        </DiffGroup>
      ) : null}

      {diff.added.length > 0 ? (
        <DiffGroup title="Added" count={diff.added.length}>
          {diff.added.map((a) => (
            <li key={a.sourceKey} className="px-3 py-2 text-sm">
              <span className="font-medium">{a.name}</span>{" "}
              <span className="text-muted-foreground">in {a.sectionName}</span>
            </li>
          ))}
        </DiffGroup>
      ) : null}

      {diff.changed.length > 0 ? (
        <DiffGroup title="Changed" count={diff.changed.length}>
          {diff.changed.map((c) => (
            <ChangedRow
              key={c.sourceKey}
              change={c}
              after={itemsByKey.get(c.sourceKey)}
            />
          ))}
        </DiffGroup>
      ) : null}

      {diff.removed.length > 0 ? (
        <DiffGroup
          title="Removed"
          count={diff.removed.length}
          note="Removed from this version only. The items are not deleted."
        >
          {diff.removed.map((r) => {
            const labelled = labelCounts[r.itemId] ?? 0
            return (
              <li key={r.itemId} className="grid gap-0.5 px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{r.name}</span>{" "}
                  <span className="text-muted-foreground">
                    from {r.sectionName}
                  </span>
                </span>
                {labelled > 0 ? (
                  <span className="flex items-center gap-1.5 text-warning">
                    <WarningIcon className="size-4 shrink-0" aria-hidden />
                    {labelledFilesCopy(labelled)} keep this item. Staff cannot
                    add it to new labels while it is off the active menu.
                  </span>
                ) : null}
              </li>
            )
          })}
        </DiffGroup>
      ) : null}
    </section>
  )
}

function DiffGroup({
  title,
  count,
  note,
  children,
}: {
  title: string
  count: number
  note?: string
  children: React.ReactNode
}) {
  const id = React.useId()
  return (
    <section aria-labelledby={id} className="grid gap-1.5">
      <h3 id={id} className="text-sm font-medium">
        {title} <span className="text-muted-foreground">({count})</span>
      </h3>
      {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      <ul className="max-h-[32rem] divide-y overflow-y-auto rounded-lg border bg-card">
        {children}
      </ul>
    </section>
  )
}

const FIELD_LABEL: Record<string, string> = {
  name: "Name",
  description: "Description",
  aliases: "Aliases",
  section: "Section",
  sectionName: "Section",
  variants: "Variants",
}

function show(value: string | string[] | null | undefined): string {
  if (value == null) return "—"
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—"
  return value === "" ? "—" : value
}

function ChangedRow({
  change,
  after,
}: {
  change: DiffChange
  after: MenuDocItem | undefined
}) {
  const afterValue = (field: string): string | string[] | null | undefined => {
    switch (field) {
      case "name":
        return change.name
      case "section":
      case "sectionName":
        return change.sectionName
      case "description":
        return after?.description
      case "aliases":
        return after?.aliases
      case "variants":
        return after?.variants.map((v) => v.name)
      default:
        return undefined
    }
  }
  const beforeValue = (field: string) =>
    field === "section"
      ? change.before.sectionName
      : (change.before as Record<string, string | string[] | null | undefined>)[
          field
        ]

  return (
    <li className="grid gap-1 px-3 py-2 text-sm">
      <span>
        <span className="font-medium">{change.name}</span>{" "}
        <span className="text-muted-foreground">in {change.sectionName}</span>
      </span>
      <ul className="grid gap-0.5">
        {change.fields.map((field) => {
          const before = beforeValue(field)
          const next = afterValue(field)
          return (
            <li key={field} className="min-w-0 break-words">
              <span className="text-muted-foreground">
                {FIELD_LABEL[field] ?? field}:
              </span>{" "}
              {before !== undefined || next !== undefined ? (
                <>
                  <del className="text-muted-foreground">{show(before)}</del>
                  <span aria-hidden> → </span>
                  <span className="sr-only"> changed to </span>
                  <ins className="no-underline">{show(next)}</ins>
                </>
              ) : (
                "changed"
              )}
            </li>
          )
        })}
      </ul>
    </li>
  )
}

const NEW = "__new__"

function UncertainRow({
  match,
  decision,
  onDecide,
}: {
  match: UncertainMatch
  decision: ReviewDecision | undefined
  onDecide?: (sourceKey: string, decision: ReviewDecision) => void
}) {
  const id = React.useId()
  const initial =
    decision?.kind === "same"
      ? decision.itemId
      : decision?.kind === "new"
        ? NEW
        : null
  const [choice, setChoice] = React.useState<string | null>(initial)
  const resolvedLabel =
    decision?.kind === "new"
      ? "Resolved: treated as a new item"
      : decision?.kind === "same"
        ? `Resolved: same item as “${
            match.candidates.find((c) => c.itemId === decision.itemId)?.name ??
            "an existing item"
          }”`
        : null

  return (
    <li className="px-3 py-3 text-sm">
      <fieldset className="grid gap-2" disabled={!onDecide}>
        <legend className="mb-1">
          <span className="font-medium">{match.name}</span>{" "}
          <span className="text-muted-foreground">in {match.sectionName}</span>
        </legend>
        <p className="text-muted-foreground">{match.reason}</p>
        <div className="grid gap-1">
          {match.candidates.map((c) => (
            <label
              key={c.itemId}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-muted/50 sm:min-h-9"
            >
              <input
                type="radio"
                name={`${id}-choice`}
                value={c.itemId}
                checked={choice === c.itemId}
                onChange={() => setChoice(c.itemId)}
                className="size-4 accent-primary"
              />
              <span>
                Same item as “{c.name}”{" "}
                <span className="text-muted-foreground">({c.sectionName})</span>
              </span>
            </label>
          ))}
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-muted/50 sm:min-h-9">
            <input
              type="radio"
              name={`${id}-choice`}
              value={NEW}
              checked={choice === NEW}
              onChange={() => setChoice(NEW)}
              className="size-4 accent-primary"
            />
            <span>Treat as new item</span>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {onDecide ? (
            <Button
              variant="outline"
              size="touch"
              disabled={choice == null}
              onClick={() => {
                if (choice == null) return
                onDecide(
                  match.sourceKey,
                  choice === NEW
                    ? { kind: "new" }
                    : { kind: "same", itemId: choice }
                )
              }}
              aria-label={`${decision ? "Update decision" : "Confirm decision"} for ${match.name}`}
            >
              {decision ? "Update decision" : "Confirm decision"}
            </Button>
          ) : null}
          {resolvedLabel ? (
            <span className="text-positive">{resolvedLabel}</span>
          ) : (
            <span className="text-warning">Not resolved</span>
          )}
        </div>
      </fieldset>
    </li>
  )
}
