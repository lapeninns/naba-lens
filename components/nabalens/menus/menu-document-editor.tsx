"use client"

import * as React from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CaretDownIcon,
  CaretRightIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  MENU_IMPORT_LIMITS,
  type ImportIssue,
  type MenuDocItem,
  type MenuDocSection,
  type MenuDocument,
  type MenuSectionKind,
} from "@/lib/menus/types"
import { cn } from "@/lib/utils"

import { OptionSelect } from "../option-select"
import { labelledFilesCopy, plural, SECTION_KIND_LABEL } from "./copy"
import {
  addItem,
  addSection,
  editorIssues,
  itemMatches,
  locateIssues,
  moveItem,
  moveItemToSection,
  moveSection,
  removeItem,
  removeSection,
  updateItem,
  updateSection,
} from "./editor-ops"
import { ImportIssueList } from "./import-issue-list"

const KINDS: MenuSectionKind[] = ["food", "drinks", "other"]
/** Sections start expanded when the whole menu is at most this many items. */
const EXPAND_ALL_UP_TO = 40

const L = MENU_IMPORT_LIMITS

const textareaClass =
  "min-h-20 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm dark:bg-input/30"

export type MenuDocumentEditorProps = {
  value: MenuDocument
  onChange: (next: MenuDocument) => void
  /** Deterministic key for a NEW item: `section-slug--item-slug`. */
  makeSourceKey: (sectionSlug: string, itemName: string) => string
  /** Slug for a NEW section (existing slugs are never changed). */
  slugify: (value: string) => string
  /** Validation issues (paths such as `sections[2].items[5].name`). */
  issues?: ImportIssue[]
  readOnly?: boolean
  /** Items of this venue that cannot receive new labels. */
  archivedItemIds?: string[]
  /** Labelled photos/videos per item id. */
  labelCounts?: Record<string, number>
  /** Extra per-item controls, e.g. ArchiveItemControl (shown when expanded). */
  renderItemActions?: (item: MenuDocItem) => React.ReactNode
  className?: string
}

/**
 * Controlled editor for a draft menu. Existing itemId/variantId values are
 * carried forward unchanged; only items/variants added here get null ids.
 */
export function MenuDocumentEditor({
  value,
  onChange,
  makeSourceKey,
  slugify,
  issues = [],
  readOnly = false,
  archivedItemIds = [],
  labelCounts = {},
  renderItemActions,
  className,
}: MenuDocumentEditorProps) {
  const base = React.useId()
  const ids = React.useMemo(
    () => ({
      title: `${base}-title`,
      search: `${base}-search`,
      addSection: `${base}-add-section`,
      sectionToggle: (slug: string) => `${base}-s-${slug}-toggle`,
      sectionName: (slug: string) => `${base}-s-${slug}-name`,
      sectionUp: (slug: string) => `${base}-s-${slug}-up`,
      sectionDown: (slug: string) => `${base}-s-${slug}-down`,
      addItem: (slug: string) => `${base}-s-${slug}-add`,
      itemToggle: (key: string) => `${base}-i-${key}-toggle`,
      itemName: (key: string) => `${base}-i-${key}-name`,
      itemUp: (key: string) => `${base}-i-${key}-up`,
      itemDown: (key: string) => `${base}-i-${key}-down`,
    }),
    [base]
  )

  const totalItems = value.sections.reduce((n, s) => n + s.items.length, 0)
  const [expandedSections, setExpandedSections] = React.useState<Set<string>>(
    () =>
      new Set(
        totalItems <= EXPAND_ALL_UP_TO ? value.sections.map((s) => s.slug) : []
      )
  )
  const [expandedItems, setExpandedItems] = React.useState<Set<string>>(
    () => new Set()
  )
  const [query, setQuery] = React.useState("")
  const [announcement, setAnnouncement] = React.useState("")
  const pendingFocus = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!pendingFocus.current) return
    const el = document.getElementById(pendingFocus.current)
    pendingFocus.current = null
    if (el instanceof HTMLElement && !el.hasAttribute("disabled")) el.focus()
  })

  const allIssues = React.useMemo(
    () => [...issues, ...editorIssues(value)],
    [issues, value]
  )
  const flagged = React.useMemo(
    () =>
      locateIssues(
        value,
        allIssues.map((i) => i.path)
      ),
    [value, allIssues]
  )
  const archived = React.useMemo(
    () => new Set(archivedItemIds),
    [archivedItemIds]
  )

  const announce = (message: string) => setAnnouncement(message)
  const focusLater = (id: string) => {
    pendingFocus.current = id
  }
  const toggle = (
    set: React.Dispatch<React.SetStateAction<Set<string>>>,
    key: string,
    open?: boolean
  ) =>
    set((prev) => {
      const next = new Set(prev)
      if (open ?? !next.has(key)) next.add(key)
      else next.delete(key)
      return next
    })

  const searching = query.trim().length > 0
  const visible = value.sections.map((section) => ({
    section,
    items: searching
      ? section.items.filter((i) => itemMatches(i, query))
      : section.items,
  }))
  const matchCount = visible.reduce((n, v) => n + v.items.length, 0)

  // ----- section actions ---------------------------------------------------

  function handleAddSection(name: string, kind: MenuSectionKind) {
    const result = addSection(value, name, kind, slugify)
    onChange(result.doc)
    toggle(setExpandedSections, result.slug, true)
    focusLater(ids.sectionName(result.slug))
    announce(`Added section ${name}.`)
  }

  function handleMoveSection(section: MenuDocSection, delta: number) {
    const index = value.sections.indexOf(section)
    const target = index + delta
    onChange(moveSection(value, section.slug, delta))
    const atEdge = target <= 0 || target >= value.sections.length - 1
    focusLater(
      atEdge
        ? ids.sectionToggle(section.slug)
        : delta < 0
          ? ids.sectionUp(section.slug)
          : ids.sectionDown(section.slug)
    )
    announce(`Moved section ${section.name} to position ${target + 1}.`)
  }

  function handleRemoveSection(section: MenuDocSection) {
    const index = value.sections.indexOf(section)
    const neighbour = value.sections[index + 1] ?? value.sections[index - 1]
    onChange(removeSection(value, section.slug))
    focusLater(neighbour ? ids.sectionToggle(neighbour.slug) : ids.addSection)
    announce(
      section.items.length
        ? `Removed section ${section.name} and its ${plural(section.items.length, "item")} from this draft.`
        : `Removed section ${section.name}.`
    )
  }

  // ----- item actions ------------------------------------------------------

  function handleAddItem(section: MenuDocSection, name: string) {
    const result = addItem(value, section.slug, name, makeSourceKey)
    onChange(result.doc)
    announce(`Added ${name} to ${section.name}.`)
  }

  function handleMoveItem(
    section: MenuDocSection,
    item: MenuDocItem,
    delta: number
  ) {
    const index = section.items.indexOf(item)
    const target = index + delta
    onChange(moveItem(value, item.sourceKey, delta))
    const atEdge = target <= 0 || target >= section.items.length - 1
    focusLater(
      atEdge
        ? ids.itemToggle(item.sourceKey)
        : delta < 0
          ? ids.itemUp(item.sourceKey)
          : ids.itemDown(item.sourceKey)
    )
    announce(`Moved ${item.name} to position ${target + 1} in ${section.name}.`)
  }

  function handleMoveToSection(item: MenuDocItem, targetSlug: string) {
    const target = value.sections.find((s) => s.slug === targetSlug)
    if (!target) return
    onChange(moveItemToSection(value, item.sourceKey, targetSlug))
    toggle(setExpandedSections, targetSlug, true)
    focusLater(ids.itemToggle(item.sourceKey))
    announce(`Moved ${item.name} to ${target.name}.`)
  }

  function handleRemoveItem(section: MenuDocSection, item: MenuDocItem) {
    const index = section.items.indexOf(item)
    const neighbour = section.items[index + 1] ?? section.items[index - 1]
    onChange(removeItem(value, item.sourceKey))
    focusLater(
      neighbour
        ? ids.itemToggle(neighbour.sourceKey)
        : ids.addItem(section.slug)
    )
    announce(`Removed ${item.name} from this draft.`)
  }

  return (
    <div className={cn("grid min-w-0 gap-4", className)}>
      {readOnly ? (
        <h2 className="text-lg font-medium">{value.title}</h2>
      ) : (
        <Field className="gap-1.5">
          <FieldLabel htmlFor={ids.title}>Menu title</FieldLabel>
          <Input
            id={ids.title}
            value={value.title}
            maxLength={L.titleMax}
            onChange={(e) =>
              onChange({ ...value, title: e.currentTarget.value })
            }
            aria-invalid={!value.title.trim() || undefined}
            className="h-11 sm:h-9"
          />
        </Field>
      )}

      <ImportIssueList issues={allIssues} />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field className="min-w-0 flex-1 gap-1.5">
          <FieldLabel htmlFor={ids.search}>Search items</FieldLabel>
          <div className="relative">
            <MagnifyingGlassIcon
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id={ids.search}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              placeholder="Name or alias"
              className="h-11 pl-8 sm:h-9"
              aria-describedby={`${base}-search-result`}
            />
          </div>
        </Field>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="touch"
            className="flex-1"
            onClick={() =>
              setExpandedSections(new Set(value.sections.map((s) => s.slug)))
            }
          >
            Expand all
          </Button>
          <Button
            variant="outline"
            size="touch"
            className="flex-1"
            onClick={() => setExpandedSections(new Set())}
          >
            Collapse all
          </Button>
        </div>
      </div>
      <p
        id={`${base}-search-result`}
        aria-live="polite"
        className={cn("text-sm text-muted-foreground", !searching && "sr-only")}
      >
        {searching
          ? `${plural(matchCount, "item")} of ${totalItems} match “${query.trim()}”.`
          : `${plural(value.sections.length, "section")}, ${plural(totalItems, "item")}.`}
      </p>

      {value.sections.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          No sections yet.
          {readOnly ? null : " Add a section, then add items to it."}
        </p>
      ) : (
        <ol aria-label="Sections" className="grid gap-3">
          {visible.map(({ section, items }, index) => {
            if (searching && items.length === 0) return null
            const expanded = searching || expandedSections.has(section.slug)
            return (
              <SectionPanel
                key={section.slug}
                section={section}
                items={items}
                index={index}
                total={value.sections.length}
                sections={value.sections}
                expanded={expanded}
                searching={searching}
                readOnly={readOnly}
                ids={ids}
                flagged={flagged}
                archived={archived}
                labelCounts={labelCounts}
                expandedItems={expandedItems}
                renderItemActions={renderItemActions}
                onToggle={() => toggle(setExpandedSections, section.slug)}
                onToggleItem={(key) => toggle(setExpandedItems, key)}
                onRename={(name) =>
                  onChange(updateSection(value, section.slug, { name }))
                }
                onKind={(kind) =>
                  onChange(updateSection(value, section.slug, { kind }))
                }
                onMove={(delta) => handleMoveSection(section, delta)}
                onRemove={() => handleRemoveSection(section)}
                onAddItem={(name) => handleAddItem(section, name)}
                onItemChange={(item, patch) =>
                  onChange(updateItem(value, item.sourceKey, patch))
                }
                onItemMove={(item, delta) =>
                  handleMoveItem(section, item, delta)
                }
                onItemMoveTo={handleMoveToSection}
                onItemRemove={(item) => handleRemoveItem(section, item)}
              />
            )
          })}
        </ol>
      )}

      {readOnly ? null : (
        <AddSectionForm inputId={ids.addSection} onAdd={handleAddSection} />
      )}

      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  )
}

type Ids = {
  sectionToggle: (slug: string) => string
  sectionName: (slug: string) => string
  sectionUp: (slug: string) => string
  sectionDown: (slug: string) => string
  addItem: (slug: string) => string
  itemToggle: (key: string) => string
  itemName: (key: string) => string
  itemUp: (key: string) => string
  itemDown: (key: string) => string
}

type ItemPatch = Partial<
  Pick<MenuDocItem, "name" | "description" | "aliases" | "variants">
>

function SectionPanel({
  section,
  items,
  index,
  total,
  sections,
  expanded,
  searching,
  readOnly,
  ids,
  flagged,
  archived,
  labelCounts,
  expandedItems,
  renderItemActions,
  onToggle,
  onToggleItem,
  onRename,
  onKind,
  onMove,
  onRemove,
  onAddItem,
  onItemChange,
  onItemMove,
  onItemMoveTo,
  onItemRemove,
}: {
  section: MenuDocSection
  items: MenuDocItem[]
  index: number
  total: number
  sections: MenuDocSection[]
  expanded: boolean
  searching: boolean
  readOnly: boolean
  ids: Ids
  flagged: { items: Set<string>; sections: Set<string> }
  archived: Set<string>
  labelCounts: Record<string, number>
  expandedItems: Set<string>
  renderItemActions?: (item: MenuDocItem) => React.ReactNode
  onToggle: () => void
  onToggleItem: (key: string) => void
  onRename: (name: string) => void
  onKind: (kind: MenuSectionKind) => void
  onMove: (delta: number) => void
  onRemove: () => void
  onAddItem: (name: string) => void
  onItemChange: (item: MenuDocItem, patch: ItemPatch) => void
  onItemMove: (item: MenuDocItem, delta: number) => void
  onItemMoveTo: (item: MenuDocItem, slug: string) => void
  onItemRemove: (item: MenuDocItem) => void
}) {
  const panelId = `${ids.sectionToggle(section.slug)}-panel`
  const [confirmRemove, setConfirmRemove] = React.useState(false)
  const reviewCount = section.items.filter((i) => i.review).length
  const sectionLabel = section.name.trim() || "Untitled section"
  const hasErrors =
    flagged.sections.has(section.slug) ||
    section.items.some((i) => flagged.items.has(i.sourceKey))

  return (
    <li className="min-w-0 rounded-lg border bg-card">
      <div className="flex items-center gap-1 p-1">
        <h3 className="min-w-0 flex-1">
          <button
            type="button"
            id={ids.sectionToggle(section.slug)}
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={onToggle}
            className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-9"
          >
            {expanded ? (
              <CaretDownIcon className="size-4 shrink-0" aria-hidden />
            ) : (
              <CaretRightIcon className="size-4 shrink-0" aria-hidden />
            )}
            <span className="min-w-0 truncate font-medium">{sectionLabel}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {SECTION_KIND_LABEL[section.kind]} ·{" "}
              {searching
                ? `${items.length} of ${section.items.length}`
                : plural(section.items.length, "item")}
            </span>
            {reviewCount > 0 ? (
              <Flag tone="warning">{reviewCount} to review</Flag>
            ) : null}
            {hasErrors ? <Flag tone="error">Has errors</Flag> : null}
          </button>
        </h3>
        {readOnly ? null : (
          <>
            <IconButton
              id={ids.sectionUp(section.slug)}
              label={`Move section ${sectionLabel} up`}
              disabled={index === 0}
              onClick={() => onMove(-1)}
            >
              <ArrowUpIcon aria-hidden />
            </IconButton>
            <IconButton
              id={ids.sectionDown(section.slug)}
              label={`Move section ${sectionLabel} down`}
              disabled={index === total - 1}
              onClick={() => onMove(1)}
            >
              <ArrowDownIcon aria-hidden />
            </IconButton>
            <IconButton
              label={`Remove section ${sectionLabel}`}
              onClick={() =>
                section.items.length > 0 ? setConfirmRemove(true) : onRemove()
              }
            >
              <TrashIcon aria-hidden />
            </IconButton>
          </>
        )}
      </div>

      {confirmRemove ? (
        <div
          role="group"
          aria-label={`Confirm removing section ${sectionLabel}`}
          className="mx-2 mb-2 grid gap-2 rounded-md border border-negative/30 bg-negative-surface p-3 text-sm"
        >
          <p>
            Remove “{sectionLabel}” and its{" "}
            {plural(section.items.length, "item")} from this draft? Items are
            not deleted from the catalogue, and existing labels are kept.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              size="touch"
              onClick={() => {
                setConfirmRemove(false)
                onRemove()
              }}
            >
              Remove section
            </Button>
            <Button
              variant="outline"
              size="touch"
              autoFocus
              onClick={() => setConfirmRemove(false)}
            >
              Keep section
            </Button>
          </div>
        </div>
      ) : null}

      {expanded ? (
        <div id={panelId} className="grid gap-3 border-t p-3">
          {readOnly ? null : (
            <FieldSet className="gap-3">
              <FieldLegend variant="label" className="sr-only">
                Section details for {sectionLabel}
              </FieldLegend>
              <Field className="gap-1.5">
                <FieldLabel htmlFor={ids.sectionName(section.slug)}>
                  Section name
                </FieldLabel>
                <Input
                  id={ids.sectionName(section.slug)}
                  value={section.name}
                  maxLength={L.sectionNameMax}
                  onChange={(e) => onRename(e.currentTarget.value)}
                  aria-invalid={!section.name.trim() || undefined}
                  className="h-11 sm:h-9"
                />
              </Field>
              <fieldset className="grid gap-1">
                <legend className="mb-1 text-sm font-medium">Kind</legend>
                <div className="flex flex-wrap gap-x-4">
                  {KINDS.map((kind) => (
                    <label
                      key={kind}
                      className="flex min-h-11 items-center gap-2 text-sm sm:min-h-8"
                    >
                      <input
                        type="radio"
                        name={`${ids.sectionName(section.slug)}-kind`}
                        value={kind}
                        checked={section.kind === kind}
                        onChange={() => onKind(kind)}
                        className="size-4 accent-primary"
                      />
                      {SECTION_KIND_LABEL[kind]}
                    </label>
                  ))}
                </div>
              </fieldset>
            </FieldSet>
          )}

          {items.length > 0 ? (
            <ul
              aria-label={`Items in ${sectionLabel}`}
              className="divide-y rounded-md border"
            >
              {items.map((item) => (
                <ItemRow
                  key={item.sourceKey}
                  item={item}
                  index={section.items.indexOf(item)}
                  total={section.items.length}
                  section={section}
                  sections={sections}
                  readOnly={readOnly}
                  ids={ids}
                  expanded={expandedItems.has(item.sourceKey)}
                  hasErrors={flagged.items.has(item.sourceKey)}
                  isArchived={item.itemId ? archived.has(item.itemId) : false}
                  labelCount={item.itemId ? (labelCounts[item.itemId] ?? 0) : 0}
                  renderItemActions={renderItemActions}
                  onToggle={() => onToggleItem(item.sourceKey)}
                  onChange={(patch) => onItemChange(item, patch)}
                  onMove={(delta) => onItemMove(item, delta)}
                  onMoveTo={(slug) => onItemMoveTo(item, slug)}
                  onRemove={() => onItemRemove(item)}
                />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No items in this section.
            </p>
          )}

          {readOnly ? null : (
            <AddInlineForm
              inputId={ids.addItem(section.slug)}
              label={`New item in ${sectionLabel}`}
              placeholder="Item name"
              buttonLabel="Add item"
              maxLength={L.nameMax}
              onAdd={onAddItem}
            />
          )}
        </div>
      ) : null}
    </li>
  )
}

function ItemRow({
  item,
  index,
  total,
  section,
  sections,
  readOnly,
  ids,
  expanded,
  hasErrors,
  isArchived,
  labelCount,
  renderItemActions,
  onToggle,
  onChange,
  onMove,
  onMoveTo,
  onRemove,
}: {
  item: MenuDocItem
  index: number
  total: number
  section: MenuDocSection
  sections: MenuDocSection[]
  readOnly: boolean
  ids: Ids
  expanded: boolean
  hasErrors: boolean
  isArchived: boolean
  labelCount: number
  renderItemActions?: (item: MenuDocItem) => React.ReactNode
  onToggle: () => void
  onChange: (patch: ItemPatch) => void
  onMove: (delta: number) => void
  onMoveTo: (slug: string) => void
  onRemove: () => void
}) {
  const key = item.sourceKey
  const panelId = `${ids.itemToggle(key)}-panel`
  const name = item.name.trim() || "Untitled item"
  const variants = item.variants.map((v) => v.name).filter(Boolean)

  return (
    <li className="min-w-0">
      <button
        type="button"
        id={ids.itemToggle(key)}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex min-h-11 w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-left text-sm outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        <span className="min-w-0 font-medium break-words">{name}</span>
        {variants.length > 0 ? (
          <span className="min-w-0 text-xs break-words text-muted-foreground">
            {variants.join(" · ")}
          </span>
        ) : null}
        {item.itemId === null ? <Flag tone="info">New</Flag> : null}
        {isArchived ? <Flag tone="muted">Archived</Flag> : null}
        {labelCount > 0 ? (
          <Flag tone="muted">{labelledFilesCopy(labelCount)}</Flag>
        ) : null}
        {item.review ? <Flag tone="warning">Needs review</Flag> : null}
        {hasErrors ? <Flag tone="error">Has errors</Flag> : null}
      </button>

      {expanded ? (
        <div id={panelId} className="grid gap-3 border-t bg-muted/20 px-3 py-3">
          {item.review ? (
            <p className="rounded-md border border-warning/40 bg-warning-surface px-3 py-2 text-sm">
              Needs review: {item.review.reason}
            </p>
          ) : null}
          {isArchived ? (
            <p className="text-sm text-muted-foreground">
              Archived: staff cannot add it to new labels. Existing labels are
              kept.
            </p>
          ) : null}
          {readOnly ? (
            <dl className="grid gap-1 text-sm sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-x-4">
              <dt className="text-muted-foreground">Description</dt>
              <dd className="whitespace-pre-line">{item.description || "—"}</dd>
              <dt className="text-muted-foreground">Aliases</dt>
              <dd>{item.aliases.join(", ") || "—"}</dd>
              <dt className="text-muted-foreground">Variants</dt>
              <dd>{variants.join(", ") || "—"}</dd>
              <dt className="text-muted-foreground">Source key</dt>
              <dd className="font-mono text-xs break-all">{key}</dd>
            </dl>
          ) : (
            <FieldSet className="gap-3">
              <FieldLegend variant="label" className="sr-only">
                Edit {name}
              </FieldLegend>
              <Field className="gap-1.5">
                <FieldLabel htmlFor={ids.itemName(key)}>Item name</FieldLabel>
                <Input
                  id={ids.itemName(key)}
                  value={item.name}
                  maxLength={L.nameMax}
                  onChange={(e) => onChange({ name: e.currentTarget.value })}
                  aria-invalid={!item.name.trim() || undefined}
                  className="h-11 sm:h-9"
                />
              </Field>
              <Field className="gap-1.5">
                <FieldLabel htmlFor={`${ids.itemName(key)}-description`}>
                  Description (optional)
                </FieldLabel>
                <textarea
                  id={`${ids.itemName(key)}-description`}
                  value={item.description ?? ""}
                  maxLength={L.descriptionMax}
                  onChange={(e) =>
                    onChange({ description: e.currentTarget.value || null })
                  }
                  className={textareaClass}
                />
              </Field>
              <StringListEditor
                idBase={`${ids.itemName(key)}-alias`}
                legend="Aliases"
                hint="Other names staff may search for."
                itemLabel="Alias"
                ownerName={name}
                values={item.aliases}
                maxLength={L.aliasMax}
                maxCount={L.maxAliases}
                onRename={(i, v) =>
                  onChange({
                    aliases: item.aliases.map((a, j) => (j === i ? v : a)),
                  })
                }
                onRemove={(i) =>
                  onChange({ aliases: item.aliases.filter((_, j) => j !== i) })
                }
                onAdd={(v) => onChange({ aliases: [...item.aliases, v] })}
              />
              <StringListEditor
                idBase={`${ids.itemName(key)}-variant`}
                legend="Variants"
                hint="Only options the menu actually lists, e.g. Veg or Chicken."
                itemLabel="Variant"
                ownerName={name}
                values={item.variants.map((v) => v.name)}
                maxLength={L.variantNameMax}
                maxCount={L.maxVariantsPerItem}
                onRename={(i, v) =>
                  onChange({
                    // Renaming keeps the variantId (same variant, new name).
                    variants: item.variants.map((x, j) =>
                      j === i ? { ...x, name: v } : x
                    ),
                  })
                }
                onRemove={(i) =>
                  onChange({
                    variants: item.variants.filter((_, j) => j !== i),
                  })
                }
                onAdd={(v) =>
                  onChange({
                    variants: [...item.variants, { variantId: null, name: v }],
                  })
                }
              />
              {sections.length > 1 ? (
                <Field className="gap-1.5">
                  <FieldLabel htmlFor={`${ids.itemName(key)}-section`}>
                    Section
                  </FieldLabel>
                  <OptionSelect
                    id={`${ids.itemName(key)}-section`}
                    options={sections.map((s) => ({
                      id: s.slug,
                      name: s.name.trim() || "Untitled section",
                    }))}
                    value={section.slug}
                    onValueChange={(slug) => {
                      if (slug && slug !== section.slug) onMoveTo(slug)
                    }}
                  />
                </Field>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Source key <span className="font-mono break-all">{key}</span>
                {labelCount > 0
                  ? `. Removing it from this draft keeps its ${labelledFilesCopy(labelCount)}.`
                  : null}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  id={ids.itemUp(key)}
                  variant="outline"
                  size="touch"
                  disabled={index === 0}
                  onClick={() => onMove(-1)}
                  aria-label={`Move ${name} up`}
                >
                  <ArrowUpIcon data-icon="inline-start" aria-hidden />
                  Up
                </Button>
                <Button
                  id={ids.itemDown(key)}
                  variant="outline"
                  size="touch"
                  disabled={index === total - 1}
                  onClick={() => onMove(1)}
                  aria-label={`Move ${name} down`}
                >
                  <ArrowDownIcon data-icon="inline-start" aria-hidden />
                  Down
                </Button>
                <Button
                  variant="destructive"
                  size="touch"
                  onClick={onRemove}
                  aria-label={`Remove ${name}`}
                >
                  <TrashIcon data-icon="inline-start" aria-hidden />
                  Remove
                </Button>
              </div>
            </FieldSet>
          )}
          {renderItemActions ? renderItemActions(item) : null}
        </div>
      ) : null}
    </li>
  )
}

function StringListEditor({
  idBase,
  legend,
  hint,
  itemLabel,
  ownerName,
  values,
  maxLength,
  maxCount,
  onRename,
  onRemove,
  onAdd,
}: {
  idBase: string
  legend: string
  hint: string
  itemLabel: string
  ownerName: string
  values: string[]
  maxLength: number
  maxCount: number
  onRename: (index: number, value: string) => void
  onRemove: (index: number) => void
  onAdd: (value: string) => void
}) {
  const pendingFocus = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!pendingFocus.current) return
    document.getElementById(pendingFocus.current)?.focus()
    pendingFocus.current = null
  })

  return (
    <fieldset className="grid min-w-0 gap-2">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      <p className="-mt-1 text-xs text-muted-foreground">{hint}</p>
      {values.length > 0 ? (
        <ul className="grid gap-1.5">
          {values.map((v, i) => (
            <li key={i} className="flex min-w-0 items-center gap-1">
              <Input
                id={`${idBase}-${i}`}
                value={v}
                maxLength={maxLength}
                onChange={(e) => onRename(i, e.currentTarget.value)}
                aria-label={`${itemLabel} ${i + 1} of ${ownerName}`}
                aria-invalid={!v.trim() || undefined}
                className="h-11 sm:h-9"
              />
              <IconButton
                label={`Remove ${itemLabel.toLowerCase()} ${v.trim() || i + 1}`}
                onClick={() => {
                  pendingFocus.current =
                    values.length > 1
                      ? `${idBase}-${Math.min(i, values.length - 2)}`
                      : `${idBase}-new`
                  onRemove(i)
                }}
              >
                <XIcon aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : null}
      {values.length < maxCount ? (
        <AddInlineForm
          inputId={`${idBase}-new`}
          label={`New ${itemLabel.toLowerCase()} for ${ownerName}`}
          placeholder={`${itemLabel} name`}
          buttonLabel={`Add ${itemLabel.toLowerCase()}`}
          maxLength={maxLength}
          onAdd={onAdd}
          compact
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          Up to {maxCount} {legend.toLowerCase()}.
        </p>
      )}
    </fieldset>
  )
}

/** Name input + Add button. Enter submits; the input stays focused. */
function AddInlineForm({
  inputId,
  label,
  placeholder,
  buttonLabel,
  maxLength,
  onAdd,
  compact = false,
}: {
  inputId: string
  label: string
  placeholder: string
  buttonLabel: string
  maxLength: number
  onAdd: (value: string) => void
  compact?: boolean
}) {
  const [draft, setDraft] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  function submit() {
    const name = draft.trim()
    if (!name) {
      setError("Enter a name first.")
      document.getElementById(inputId)?.focus()
      return
    }
    setError(null)
    setDraft("")
    onAdd(name)
    document.getElementById(inputId)?.focus()
  }

  return (
    <div className="grid gap-1">
      <div className="flex min-w-0 items-center gap-2">
        <Input
          id={inputId}
          value={draft}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-label={label}
          aria-invalid={!!error || undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          onChange={(e) => {
            setDraft(e.currentTarget.value)
            if (error) setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              submit()
            }
          }}
          className="h-11 sm:h-9"
        />
        <Button
          variant={compact ? "outline" : "secondary"}
          size="touch"
          onClick={submit}
          aria-label={`${buttonLabel}: ${label}`}
        >
          <PlusIcon data-icon="inline-start" aria-hidden />
          {buttonLabel}
        </Button>
      </div>
      {error ? (
        <p id={`${inputId}-error`} className="text-sm text-negative">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function AddSectionForm({
  inputId,
  onAdd,
}: {
  inputId: string
  onAdd: (name: string, kind: MenuSectionKind) => void
}) {
  const [kind, setKind] = React.useState<MenuSectionKind>("food")
  return (
    <FieldSet className="gap-2 rounded-lg border border-dashed p-3">
      <FieldLegend variant="label">Add a section</FieldLegend>
      <div className="flex flex-wrap gap-x-4">
        {KINDS.map((k) => (
          <label
            key={k}
            className="flex min-h-11 items-center gap-2 text-sm sm:min-h-8"
          >
            <input
              type="radio"
              name={`${inputId}-kind`}
              value={k}
              checked={kind === k}
              onChange={() => setKind(k)}
              className="size-4 accent-primary"
            />
            {SECTION_KIND_LABEL[k]}
          </label>
        ))}
      </div>
      <AddInlineForm
        inputId={inputId}
        label="New section name"
        placeholder="Section name, e.g. Starters"
        buttonLabel="Add section"
        maxLength={L.sectionNameMax}
        onAdd={(name) => onAdd(name, kind)}
      />
    </FieldSet>
  )
}

function IconButton({
  id,
  label,
  disabled,
  onClick,
  children,
}: {
  id?: string
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      id={id}
      variant="ghost"
      size="icon-lg"
      className="size-11 shrink-0 sm:size-9"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

const FLAG_TONE = {
  info: "bg-info-surface text-info",
  warning: "bg-warning-surface text-foreground",
  error: "bg-negative-surface text-negative",
  muted: "bg-muted text-muted-foreground",
} as const

function Flag({
  tone,
  children,
}: {
  tone: keyof typeof FLAG_TONE
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 text-xs font-medium",
        FLAG_TONE[tone]
      )}
    >
      {children}
    </span>
  )
}
