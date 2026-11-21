"use client"

import * as React from "react"
import { QuestionIcon, WarningIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import type {
  DiffChange,
  DiffItemRef,
  MenuDiff,
  MenuDocItem,
  MenuDocument,
  ReviewDecision,
  SourceMeta,
  SourceMetaValue,
  UncertainMatch,
} from "@/lib/menus/types"
import { splitChanged } from "@/lib/menus/import"
import { cn } from "@/lib/utils"

import { StatusChip } from "../status-chip"
import { labelledFilesCopy, plural } from "./copy"
import { MenuSectionHead } from "./section-head"

/** Uncertain matches without a decision in `decisions`. */
export function countUnresolved(
  diff: Pick<MenuDiff, "uncertain">,
  decisions?: Record<string, ReviewDecision>
): number {
  return diff.uncertain.filter((u) => !decisions?.[u.sourceKey]).length
}

/** Rows shown in a group before "Show N more …". */
const SHOWN = 5

type MenuDiffViewProps = {
  diff: MenuDiff
  /** The incoming/draft document, to show "after" values of changed fields. */
  document?: MenuDocument
  /** Labelled photos/videos per item id (warns on removed items). */
  labelCounts?: Record<string, number>
  /** Decisions already made, by source key (rows stay listed as decided). */
  decisions?: Record<string, ReviewDecision>
  onDecide?: (sourceKey: string, decision: ReviewDecision) => void
  /** e.g. "the active menu"; what the draft is compared with. */
  baseLabel?: string
  /**
   * False when the venue has no active menu: every item is new, so only the
   * added items are listed.
   */
  hasBase?: boolean
  /** Quiet line next to the heading: the base version and the file. */
  source?: React.ReactNode
  /** Id for the "Needs a decision" group, so a page action can move to it. */
  decisionsId?: string
  /**
   * Keep the heading only as the region's name: the import page names the
   * file and what it is compared with in its own row above.
   */
  hideTitle?: boolean
  readOnly?: boolean
  /**
   * Decisions are briefly unavailable (for example while a draft saves): the
   * choices stay in place but are disabled.
   */
  locked?: boolean
  className?: string
}

/** Uncertain / changed / removed / added between the active menu and a file or draft. */
export function MenuDiffView({
  diff,
  document,
  labelCounts = {},
  decisions,
  onDecide,
  baseLabel = "the active menu",
  hasBase = true,
  source,
  decisionsId,
  hideTitle = false,
  readOnly = false,
  locked = false,
  className,
}: MenuDiffViewProps) {
  const unresolved = countUnresolved(diff, decisions)
  const headingId = React.useId()
  const itemsByKey = React.useMemo(() => {
    const map = new Map<string, MenuDocItem>()
    for (const s of document?.sections ?? [])
      for (const item of s.items) map.set(item.sourceKey, item)
    return map
  }, [document])

  // Spec §8 A3: changed presentations apart from other changes.
  const split = React.useMemo(() => splitChanged(diff), [diff])

  const nothing =
    diff.added.length +
      diff.changed.length +
      diff.removed.length +
      diff.uncertain.length ===
    0

  const chips: {
    key: string
    text: string
    tone: "neutral" | "attention" | "closed"
  }[] = hasBase
    ? [
        {
          key: "uncertain",
          text: `${unresolved} uncertain`,
          tone: unresolved > 0 ? "attention" : "neutral",
        },
        { key: "added", text: `+ ${diff.added.length} added`, tone: "neutral" },
        {
          key: "changed",
          text: `~ ${diff.changed.length} changed`,
          tone: "neutral",
        },
        {
          key: "removed",
          text: `− ${diff.removed.length} removed`,
          tone: "neutral",
        },
        {
          key: "unchanged",
          text: `${diff.unchangedCount} unchanged`,
          tone: "closed",
        },
      ]
    : [{ key: "added", text: `+ ${diff.added.length} added`, tone: "neutral" }]

  return (
    <section
      aria-labelledby={headingId}
      className={cn("grid min-w-0 gap-3", className)}
    >
      {hideTitle ? (
        <h2 id={headingId} className="sr-only">
          Changes from the active menu
        </h2>
      ) : (
        <MenuSectionHead
          id={headingId}
          title="Changes from the active menu"
          count={source}
          className="pb-0"
        />
      )}
      {/* The five counts; uncertain leads, in brass while any is open. */}
      <p className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <span key={chip.key} data-testid={`diff-count-${chip.key}`}>
            <StatusChip tone={chip.tone}>
              {chip.tone === "attention" ? <QuestionIcon aria-hidden /> : null}
              {chip.text}
            </StatusChip>
          </span>
        ))}
      </p>
      {!hasBase ? (
        <p className="px-1 text-body text-ink-muted">
          This venue has no active menu, so every item is new. Nothing has been
          saved yet.
        </p>
      ) : null}

      {nothing ? (
        <p className="px-1 text-body text-ink-muted">
          No differences from {baseLabel}.
        </p>
      ) : null}

      {/* Handoff "Import a menu": what needs a decision and what changed on
          the left, retirements and additions on the right. */}
      <div className="grid items-start gap-4 lg:grid-cols-2 lg:gap-6">
        <div className="grid min-w-0 gap-4">
          {diff.uncertain.length > 0 ? (
            <DiffGroup
              id={decisionsId}
              title="Needs a decision"
              count={
                unresolved === 0
                  ? `${diff.uncertain.length} decided`
                  : `${plural(diff.uncertain.length, "item")} · decide before activating`
              }
            >
              {diff.uncertain.map((u) => (
                <UncertainRow
                  key={u.sourceKey}
                  match={u}
                  decision={decisions?.[u.sourceKey]}
                  onDecide={readOnly ? undefined : onDecide}
                  locked={locked}
                />
              ))}
            </DiffGroup>
          ) : null}

          {split.presentation.length > 0 ? (
            <DiffGroup
              title="Changed presentation"
              count={`${plural(split.presentation.length, "item")} · photos in the album go back for a recheck`}
              rows={split.presentation}
              more={(n) => `Show ${plural(n, "more changed item")}`}
              render={(c) => (
                <ChangedRow
                  key={c.sourceKey}
                  change={c}
                  after={itemsByKey.get(c.sourceKey)}
                />
              )}
            />
          ) : null}

          {split.other.length > 0 ? (
            <DiffGroup
              title="Changed"
              count={`${plural(split.other.length, "item")} · photos are kept`}
              rows={split.other}
              more={(n) => `Show ${plural(n, "more changed item")}`}
              render={(c) => (
                <ChangedRow
                  key={c.sourceKey}
                  change={c}
                  after={itemsByKey.get(c.sourceKey)}
                />
              )}
            />
          ) : null}
        </div>
        <div className="grid min-w-0 gap-4">
          {diff.removed.length > 0 ? (
            <DiffGroup
              title="Proposed retirements"
              count={`${plural(diff.removed.length, "item")} · confirmed when you activate · labels are kept`}
              rows={diff.removed}
              more={(n) => `Show ${plural(n, "more removed item")}`}
              render={(r) => {
                const labelled = labelCounts[r.itemId] ?? 0
                return (
                  <DiffRow
                    key={r.itemId}
                    sign="−"
                    name={r.name}
                    detail={
                      <>
                        From {r.sectionName}. Removed from this version only;
                        the item is not deleted.
                        {labelled > 0 ? (
                          <span className="mt-0.5 flex items-center gap-1.5 text-ink">
                            <WarningIcon
                              className="size-5 shrink-0 text-warn-fg"
                              aria-hidden
                            />
                            {labelledFilesCopy(labelled)} keep this item. Staff
                            cannot add it to new labels while it is off the
                            active menu.
                          </span>
                        ) : null}
                      </>
                    }
                  />
                )
              }}
            />
          ) : null}

          {diff.added.length > 0 ? (
            <DiffGroup
              title="Added"
              count={plural(diff.added.length, "item")}
              rows={diff.added}
              more={(n) => `Show ${plural(n, "more added item")}`}
              render={(a: DiffItemRef) => (
                <DiffRow
                  key={a.sourceKey}
                  sign="+"
                  name={a.name}
                  detail={a.sectionName}
                />
              )}
            />
          ) : null}
        </div>
      </div>
    </section>
  )
}

/**
 * One group of the diff (handoff "Import a menu"): its name with a quiet
 * count on the right, then a row card. Every group is open; a long one shows
 * its first rows and a "Show N more" link.
 */
function DiffGroup<T>({
  id,
  title,
  count,
  children,
  rows,
  render,
  more,
}: {
  id?: string
  title: string
  count: React.ReactNode
  children?: React.ReactNode
  rows?: T[]
  render?: (row: T) => React.ReactNode
  more?: (hidden: number) => string
}) {
  const titleId = React.useId()
  const [all, setAll] = React.useState(false)
  const shown = rows ? (all ? rows : rows.slice(0, SHOWN)) : []
  const hidden = rows ? rows.length - shown.length : 0
  return (
    <section
      id={id}
      tabIndex={id ? -1 : undefined}
      aria-labelledby={titleId}
      className="grid min-w-0 gap-2 rounded-card focus-ring outline-none"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-1">
        <h3 id={titleId} className="type-heading-sm text-ink">
          {title}
        </h3>
        <span className="text-meta text-ink-muted md:ml-auto">{count}</span>
      </div>
      <div className="overflow-hidden rounded-card bg-surface edge">
        <ul className="divide-y divide-line">
          {children}
          {render ? shown.map(render) : null}
        </ul>
        {hidden > 0 && more ? (
          <div className="border-t border-line px-4 py-2">
            <Button variant="link" onClick={() => setAll(true)}>
              {more(hidden)}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function DiffRow({
  sign,
  name,
  detail,
  actions,
  group,
}: {
  sign: string
  name: React.ReactNode
  detail?: React.ReactNode
  actions?: React.ReactNode
  /** Render the row as a named, optionally disabled, group of choices. */
  group?: { label: string; disabled: boolean }
}) {
  const layout =
    // Choices sit under the words (handoff "Needs a decision"): the groups
    // share the page in two columns, too narrow for a row of buttons beside.
    "grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2"
  const content = (
    <>
      <span
        aria-hidden
        className="flex size-7 items-center justify-center rounded-round bg-surface-2 font-mono text-mono font-bold text-ink"
      >
        {sign}
      </span>
      <div className="min-w-0">
        <p className="font-bold break-words text-ink">{name}</p>
        {detail ? (
          <div className="text-body break-words text-ink-muted">{detail}</div>
        ) : null}
      </div>
      {actions ? (
        <div className="col-start-2 flex flex-wrap gap-2">{actions}</div>
      ) : null}
    </>
  )
  if (!group) return <li className={cn(layout, "px-4 py-3")}>{content}</li>
  return (
    <li className="px-4 py-3">
      <fieldset
        aria-label={group.label}
        disabled={group.disabled}
        className={cn(layout, "min-w-0")}
      >
        {content}
      </fieldset>
    </li>
  )
}

const FIELD_LABEL: Record<string, string> = {
  name: "Name",
  description: "Description",
  aliases: "Aliases",
  variants: "Variants",
}

function show(value: string | string[] | null | undefined): string {
  if (value == null) return "—"
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—"
  return value === "" ? "—" : value
}

function metaText(value: SourceMetaValue | undefined): string {
  if (value == null || value === "") return "—"
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—"
  return String(value)
}

/** Source detail keys whose value differs, as [key, before, after]. */
function changedMeta(
  before: SourceMeta | undefined,
  after: SourceMeta | undefined
): [string, string, string][] {
  if (!before || !after) return []
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...keys]
    .map((key): [string, string, string] => [
      key,
      metaText(before[key]),
      metaText(after[key]),
    ])
    .filter(([, b, a]) => b !== a)
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
    (change.before as Record<string, string | string[] | null | undefined>)[
      field
    ]

  return (
    <DiffRow
      sign="~"
      name={change.name}
      detail={
        <ul className="grid gap-0.5">
          {change.fields.map((field) => {
            if (field === "section" || field === "sectionName")
              return (
                <li key={field}>
                  Moved from {show(change.before.sectionName)} to{" "}
                  {change.sectionName}
                </li>
              )
            if (field === "meta") {
              const metaChanges = changedMeta(
                change.before.meta,
                after?.sourceMeta
              )
              if (metaChanges.length === 0)
                return (
                  <li key={field}>
                    Source details changed · kept for reference only
                  </li>
                )
              return metaChanges.map(([key, before, next]) => (
                <li key={`meta-${key}`}>
                  Source {key.replaceAll("_", " ")} <del>{before}</del>
                  <span className="sr-only"> changed to </span>{" "}
                  <ins className="text-ink no-underline">{next}</ins> · kept for
                  reference only
                </li>
              ))
            }
            return (
              <li key={field}>
                {FIELD_LABEL[field] ?? field}{" "}
                <del>{show(beforeValue(field))}</del>
                <span className="sr-only"> changed to </span>{" "}
                <ins className="text-ink no-underline">
                  {show(afterValue(field))}
                </ins>
              </li>
            )
          })}
        </ul>
      }
    />
  )
}

function UncertainRow({
  match,
  decision,
  onDecide,
  locked,
}: {
  match: UncertainMatch
  decision: ReviewDecision | undefined
  onDecide?: (sourceKey: string, decision: ReviewDecision) => void
  locked: boolean
}) {
  const [changing, setChanging] = React.useState(false)
  const chosen =
    decision?.kind === "same"
      ? match.candidates.find((c) => c.itemId === decision.itemId)
      : undefined
  const group = {
    label: `${match.name} in ${match.sectionName}`,
    disabled: locked || !onDecide,
  }
  const editable = !!onDecide || locked

  if (decision && !changing) {
    return (
      <DiffRow
        group={group}
        sign={decision.kind === "same" ? "=" : "+"}
        name={match.name}
        detail={
          decision.kind === "same"
            ? `Same item as ${chosen?.name ?? "an existing item"}${
                chosen ? ` (${chosen.sectionName})` : ""
              }. Labels stay with it.`
            : `Treated as a new item in ${match.sectionName}.`
        }
        actions={
          editable ? (
            <Button
              variant="quiet"
              size="sm"
              onClick={() => setChanging(true)}
              aria-label={`Change the decision for ${match.name}`}
            >
              Change
            </Button>
          ) : null
        }
      />
    )
  }

  const decide = (next: ReviewDecision) => {
    setChanging(false)
    onDecide?.(match.sourceKey, next)
  }

  return (
    <DiffRow
      group={group}
      sign="?"
      name={
        <>
          {match.name}{" "}
          <span className="font-normal text-ink-muted">
            in {match.sectionName}
          </span>
        </>
      }
      detail={match.reason}
      actions={
        editable ? (
          <>
            {match.candidates.map((c) => (
              <Button
                key={c.itemId}
                variant="secondary"
                size="sm"
                className="whitespace-normal"
                onClick={() => decide({ kind: "same", itemId: c.itemId })}
              >
                Same item as {c.name} ({c.sectionName})
              </Button>
            ))}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => decide({ kind: "new" })}
              aria-label={`Treat as new item: ${match.name}`}
            >
              Treat as new item
            </Button>
          </>
        ) : null
      }
    />
  )
}
