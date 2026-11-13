"use client"

import * as React from "react"
import {
  FunnelSimpleIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react"

import { Segmented } from "@/app/_media/segmented"
import {
  EMPTY_SEARCH_FILTERS,
  type SearchFilterValue,
  type SearchMode,
} from "@/app/_media/search-params"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  ANSWER_FRESHNESS_STATES,
  ANSWER_USES,
  MENU_DECISION_STATES,
  SEARCH_RIGHTS,
  type SearchFilterKey,
} from "@/lib/server/media/search/types"
import { cn } from "@/lib/utils"

import { OptionSelect } from "../option-select"
import { CountBadge } from "../status-chip"
import {
  ANSWER_FRESHNESS_LABEL,
  ANSWER_USE_LABEL,
  DECISION_LABEL,
  RIGHTS_LABEL,
  SEARCH_COPY,
} from "./search-copy"
import type { SearchMenuOptions, SearchOption } from "./types"

/** The id of a filter's control, for labels, errors and focus. */
export const fieldId = (key: SearchFilterKey) => `search-${key}`
const errorId = (key: SearchFilterKey) => `search-${key}-error`

/** Filters with a control, in the order focus looks for the first error. */
export const CONTROL_ORDER: SearchFilterKey[] = [
  "venue",
  "mediaType",
  "item",
  "rights",
  "variant",
  "destination",
  "menuState",
  "answerFreshness",
  "answerUse",
  "uploadedFrom",
  "uploadedTo",
]

/** The filters behind "More filters". */
const MORE_KEYS: SearchFilterKey[] = [
  "variant",
  "destination",
  "menuState",
  "answerFreshness",
  "answerUse",
  "uploadedFrom",
  "uploadedTo",
]

const RIGHTS_OPTIONS: SearchOption[] = SEARCH_RIGHTS.map((r) => ({
  id: r,
  name: RIGHTS_LABEL[r],
}))
const DECISION_OPTIONS: SearchOption[] = MENU_DECISION_STATES.map((s) => ({
  id: s,
  name: DECISION_LABEL[s],
}))
const ANSWER_OPTIONS: SearchOption[] = ANSWER_FRESHNESS_STATES.map((s) => ({
  id: s,
  name: ANSWER_FRESHNESS_LABEL[s],
}))
const ANSWER_USE_OPTIONS: SearchOption[] = ANSWER_USES.map((u) => ({
  id: u,
  name: ANSWER_USE_LABEL[u],
}))
const MEDIA_OPTIONS = [
  { value: "all", label: SEARCH_COPY.mediaBoth },
  { value: "image", label: SEARCH_COPY.mediaPhotos },
  { value: "video", label: SEARCH_COPY.mediaVideos },
] as const

const FIELD_LABEL = "text-label text-ink"
const HINT = "text-body text-ink-muted"

/** The screen's words for a server field error (dates have their own). */
export function fieldErrorText(key: string, message: string): string {
  if (key === "uploadedTo" && /before/.test(message))
    return SEARCH_COPY.dateOrder
  if (key === "uploadedFrom" || key === "uploadedTo") return SEARCH_COPY.badDate
  return message
}

type SearchFiltersProps = {
  mode: SearchMode
  value: SearchFilterValue
  onChange: (value: SearchFilterValue) => void
  /** Admin only: every venue. */
  venues: SearchOption[]
  /** The chosen (admin) or own (manager) venue's menu, when read. */
  menuOptions: SearchMenuOptions | null
  /** Registered places of use; the control hides while this is empty. */
  destinations: SearchOption[]
  fieldErrors: Partial<Record<string, string>>
  onClear: () => void
}

/**
 * The search filters (B05-06). Every control applies at once, so there is no
 * submit and no blue in the row. Venue (admins), Photo or video, Menu item and
 * Use come first; the rest are behind More filters.
 */
export function SearchFilters({
  mode,
  value,
  onChange,
  venues,
  menuOptions,
  destinations,
  fieldErrors,
  onClear,
}: SearchFiltersProps) {
  const v = { ...EMPTY_SEARCH_FILTERS, ...value }
  const set = (patch: Partial<SearchFilterValue>) =>
    onChange({ ...v, ...patch })
  const admin = mode === "admin"

  const menuState = admin
    ? !v.venue
      ? "no-venue"
      : menuOptions?.venueId === v.venue
        ? "ready"
        : "loading"
    : menuOptions
      ? "ready"
      : "loading"
  const menu = menuState === "ready" ? menuOptions : null
  const selectedItem = menu?.items.find((i) => i.id === v.item) ?? null
  const menuHint =
    menuState === "no-venue"
      ? SEARCH_COPY.chooseVenueHint
      : menuState === "loading" && admin
        ? SEARCH_COPY.menuLoading
        : null

  const showDestination = v.rights === "in_force" && destinations.length > 0
  // Answer freshness runs only with a venue (§11.2): a manager's is implicit.
  const showAnswer = !admin || Boolean(v.venue)
  const moreCount = MORE_KEYS.filter((k) => {
    if (k === "destination") return showDestination && v.destination
    if (k === "answerUse") return false
    if (k === "answerFreshness") return showAnswer && v.answerFreshness
    return Boolean(v[k])
  }).length
  const moreHasError = MORE_KEYS.some((k) => fieldErrors[k])
  const [open, setOpen] = React.useState(moreCount > 0 || moreHasError)
  // New field errors behind More filters open it (once per answer).
  const [seenErrors, setSeenErrors] = React.useState(fieldErrors)
  if (fieldErrors !== seenErrors) {
    setSeenErrors(fieldErrors)
    if (moreHasError) setOpen(true)
  }
  const active = Object.entries(v).some(
    ([k, x]) => x && (admin || k !== "venue")
  )

  const err = (key: SearchFilterKey) =>
    fieldErrors[key] ? fieldErrorText(key, fieldErrors[key]!) : null
  const describe = (key: SearchFilterKey, extra?: string | null) =>
    [err(key) ? errorId(key) : null, extra].filter(Boolean).join(" ") ||
    undefined

  return (
    <form
      role="search"
      aria-label={SEARCH_COPY.filtersLabel}
      className="flex min-w-0 flex-col gap-3"
      onSubmit={(e) => e.preventDefault()}
    >
      <div className="grid min-w-0 gap-x-3 gap-y-4 md:grid-cols-2 lg:grid-cols-4">
        {admin ? (
          <Field
            label={SEARCH_COPY.venue}
            htmlFor={fieldId("venue")}
            error={err("venue")}
            errorId={errorId("venue")}
          >
            <OptionSelect
              id={fieldId("venue")}
              options={venues}
              value={v.venue}
              emptyLabel={SEARCH_COPY.anyVenue}
              invalid={Boolean(err("venue"))}
              aria-describedby={describe("venue")}
              // Menu items and options belong to one venue's menu.
              onValueChange={(venue) =>
                set({
                  venue,
                  item: null,
                  variant: null,
                  ...(venue ? {} : { answerFreshness: null, answerUse: null }),
                })
              }
            />
          </Field>
        ) : null}
        <fieldset className="grid min-w-0 content-start gap-1.5">
          <legend
            id={`${fieldId("mediaType")}-legend`}
            className={cn(FIELD_LABEL, "mb-1.5")}
          >
            {SEARCH_COPY.mediaType}
          </legend>
          <Segmented
            id={fieldId("mediaType")}
            name={fieldId("mediaType")}
            aria-labelledby={`${fieldId("mediaType")}-legend`}
            aria-describedby={describe("mediaType")}
            options={[...MEDIA_OPTIONS]}
            value={(v.mediaType as "image" | "video" | null) ?? "all"}
            onValueChange={(next) =>
              set({ mediaType: next === "all" ? null : next })
            }
          />
          <FieldError id={errorId("mediaType")} text={err("mediaType")} />
        </fieldset>
        <div className="grid min-w-0 content-start gap-1.5">
          <MenuItemFilter
            items={menu?.items ?? []}
            selected={selectedItem}
            selectedId={v.item}
            disabled={menuState !== "ready"}
            placeholder={
              menuState === "no-venue"
                ? SEARCH_COPY.chooseVenueFirst
                : SEARCH_COPY.anyItem
            }
            invalid={Boolean(err("item"))}
            describedBy={describe(
              "item",
              menuHint ? `${fieldId("item")}-hint` : null
            )}
            onSelect={(item) => set({ item, variant: null })}
          />
          {menuHint ? (
            <p id={`${fieldId("item")}-hint`} className={HINT}>
              {menuHint}
            </p>
          ) : null}
          <FieldError id={errorId("item")} text={err("item")} />
        </div>
        <Field
          label={SEARCH_COPY.rights}
          htmlFor={fieldId("rights")}
          error={err("rights")}
          errorId={errorId("rights")}
        >
          <OptionSelect
            id={fieldId("rights")}
            options={RIGHTS_OPTIONS}
            value={v.rights}
            emptyLabel={SEARCH_COPY.anyRights}
            invalid={Boolean(err("rights"))}
            aria-describedby={describe("rights")}
            onValueChange={(rights) =>
              set({
                rights,
                destination: rights === "in_force" ? v.destination : null,
              })
            }
          />
        </Field>
      </div>

      <div className="flex min-w-0 flex-wrap gap-2 *:flex-1 sm:*:flex-none">
        <Button
          type="button"
          variant="secondary"
          size="touch"
          aria-expanded={open}
          aria-controls={`${fieldId("variant")}-more`}
          onClick={() => setOpen((o) => !o)}
        >
          <FunnelSimpleIcon aria-hidden />
          {open ? SEARCH_COPY.fewerFilters : SEARCH_COPY.moreFilters}
          <CountBadge count={moreCount} label={SEARCH_COPY.moreOn} />
        </Button>
        {active ? (
          <Button
            type="button"
            variant="secondary"
            size="touch"
            onClick={onClear}
          >
            <XIcon aria-hidden />
            {SEARCH_COPY.clearFilters}
          </Button>
        ) : null}
      </div>

      <div
        id={`${fieldId("variant")}-more`}
        hidden={!open}
        className="grid min-w-0 gap-4 rounded-card bg-surface p-4 shadow-card md:grid-cols-2 lg:grid-cols-3"
      >
        {selectedItem && selectedItem.variants.length > 0 ? (
          <Field
            label={SEARCH_COPY.variant}
            htmlFor={fieldId("variant")}
            error={err("variant")}
            errorId={errorId("variant")}
          >
            <OptionSelect
              id={fieldId("variant")}
              options={selectedItem.variants}
              value={v.variant}
              emptyLabel={SEARCH_COPY.anyVariant}
              invalid={Boolean(err("variant"))}
              aria-describedby={describe("variant")}
              onValueChange={(variant) => set({ variant })}
            />
          </Field>
        ) : null}
        {showDestination ? (
          <Field
            label={SEARCH_COPY.destination}
            htmlFor={fieldId("destination")}
            error={err("destination")}
            errorId={errorId("destination")}
          >
            <OptionSelect
              id={fieldId("destination")}
              options={destinations}
              value={v.destination}
              emptyLabel={SEARCH_COPY.anyDestination}
              invalid={Boolean(err("destination"))}
              aria-describedby={describe("destination")}
              onValueChange={(destination) => set({ destination })}
            />
          </Field>
        ) : null}
        <Field
          label={SEARCH_COPY.menuState}
          htmlFor={fieldId("menuState")}
          error={err("menuState")}
          errorId={errorId("menuState")}
        >
          <OptionSelect
            id={fieldId("menuState")}
            options={DECISION_OPTIONS}
            value={v.menuState}
            emptyLabel={SEARCH_COPY.anyDecision}
            invalid={Boolean(err("menuState"))}
            aria-describedby={describe("menuState")}
            onValueChange={(menuState) => set({ menuState })}
          />
        </Field>
        {showAnswer ? (
          <div className="grid min-w-0 content-start gap-3">
            <Field
              label={SEARCH_COPY.answerFreshness}
              htmlFor={fieldId("answerFreshness")}
              error={err("answerFreshness")}
              errorId={errorId("answerFreshness")}
            >
              <OptionSelect
                id={fieldId("answerFreshness")}
                options={ANSWER_OPTIONS}
                value={v.answerFreshness}
                emptyLabel={SEARCH_COPY.anyAnswerFreshness}
                invalid={Boolean(err("answerFreshness"))}
                aria-describedby={describe(
                  "answerFreshness",
                  `${fieldId("answerFreshness")}-hint`
                )}
                onValueChange={(answerFreshness) =>
                  set({
                    answerFreshness,
                    answerUse: answerFreshness ? v.answerUse : null,
                  })
                }
              />
            </Field>
            <p id={`${fieldId("answerFreshness")}-hint`} className={HINT}>
              {SEARCH_COPY.answerFreshnessHint}
            </p>
            {v.answerFreshness ? (
              <Field
                label={SEARCH_COPY.answerUse}
                htmlFor={fieldId("answerUse")}
                error={err("answerUse")}
                errorId={errorId("answerUse")}
              >
                <OptionSelect
                  id={fieldId("answerUse")}
                  options={ANSWER_USE_OPTIONS}
                  value={v.answerUse ?? "internal"}
                  emptyLabel={ANSWER_USE_LABEL.internal}
                  invalid={Boolean(err("answerUse"))}
                  aria-describedby={describe("answerUse")}
                  onValueChange={(answerUse) =>
                    set({
                      answerUse: answerUse === "internal" ? null : answerUse,
                    })
                  }
                />
              </Field>
            ) : null}
          </div>
        ) : null}
        <fieldset
          aria-describedby={`${fieldId("uploadedFrom")}-hint`}
          className="grid min-w-0 content-start gap-1.5 md:col-span-2 lg:col-span-1"
        >
          <legend className={cn(FIELD_LABEL, "mb-1.5")}>
            {SEARCH_COPY.uploaded}
          </legend>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            {(["uploadedFrom", "uploadedTo"] as const).map((key) => (
              <Field
                key={key}
                label={
                  key === "uploadedFrom"
                    ? SEARCH_COPY.uploadedFrom
                    : SEARCH_COPY.uploadedTo
                }
                htmlFor={fieldId(key)}
                error={err(key)}
                errorId={errorId(key)}
              >
                <Input
                  id={fieldId(key)}
                  type="date"
                  value={v[key] ?? ""}
                  min={
                    key === "uploadedTo"
                      ? (v.uploadedFrom ?? undefined)
                      : undefined
                  }
                  max={
                    key === "uploadedFrom"
                      ? (v.uploadedTo ?? undefined)
                      : undefined
                  }
                  aria-invalid={err(key) ? true : undefined}
                  aria-describedby={describe(key)}
                  onChange={(e) =>
                    set({ [key]: e.currentTarget.value || null })
                  }
                />
              </Field>
            ))}
          </div>
          <p id={`${fieldId("uploadedFrom")}-hint`} className={HINT}>
            {SEARCH_COPY.datesHint}
          </p>
        </fieldset>
      </div>
    </form>
  )
}

function FieldError({ id, text }: { id: string; text: string | null }) {
  if (!text) return null
  return (
    <p
      id={id}
      className="flex items-start gap-1.5 text-body font-bold text-warn-fg"
    >
      <WarningCircleIcon aria-hidden className="mt-0.5 size-5 shrink-0" />
      {text}
    </p>
  )
}

function Field({
  label,
  htmlFor,
  error,
  errorId: errId,
  className,
  children,
}: {
  label: string
  htmlFor: string
  error: string | null
  errorId: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("grid min-w-0 content-start gap-1.5", className)}>
      <label htmlFor={htmlFor} className={FIELD_LABEL}>
        {label}
      </label>
      {children}
      <FieldError id={errId} text={error} />
    </div>
  )
}

type MenuItemChoice = SearchMenuOptions["items"][number]

const normalise = (text: string) =>
  text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
const MAX_SHOWN = 50

/**
 * Searchable single choice of a menu item (ARIA combobox with an inline
 * listbox, as in the library filters): type to narrow, ArrowUp/Down to move,
 * Enter to choose, Escape to close or clear the text.
 */
function MenuItemFilter({
  items,
  selected,
  selectedId,
  disabled,
  placeholder,
  invalid,
  describedBy,
  onSelect,
}: {
  items: MenuItemChoice[]
  selected: MenuItemChoice | null
  selectedId: string | null
  disabled: boolean
  placeholder: string
  invalid: boolean
  describedBy?: string
  onSelect: (itemId: string | null) => void
}) {
  const inputId = fieldId("item")
  const listId = `${inputId}-list`
  const [text, setText] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const [active, setActive] = React.useState(-1)

  const hits = React.useMemo(() => {
    const words = normalise(text).split(/\s+/).filter(Boolean)
    if (words.length === 0) return items
    return items.filter((item) => {
      const haystack = normalise(
        [
          item.name,
          item.sectionName ?? "",
          ...item.variants.map((x) => x.name),
        ].join(" ")
      )
      return words.every((w) => haystack.includes(w))
    })
  }, [items, text])
  const shown = hits.slice(0, MAX_SHOWN)
  const optionId = (i: number) => `${inputId}-opt-${i}`

  function choose(item: MenuItemChoice) {
    onSelect(item.id)
    setText("")
    setOpen(false)
    setActive(-1)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        setActive(event.key === "ArrowDown" ? 0 : shown.length - 1)
        return
      }
      if (shown.length === 0) return
      setActive((a) =>
        event.key === "ArrowDown"
          ? (a + 1) % shown.length
          : a <= 0
            ? shown.length - 1
            : a - 1
      )
    } else if (event.key === "Enter") {
      event.preventDefault()
      if (open && shown[active]) choose(shown[active])
    } else if (event.key === "Escape") {
      if (open || text) {
        event.preventDefault()
        setOpen(false)
        setText("")
        setActive(-1)
      }
    }
  }

  const editing = open || text !== ""
  const shownValue = editing
    ? text
    : selected
      ? selected.name
      : selectedId
        ? SEARCH_COPY.itemNotOnMenu
        : ""

  return (
    <>
      <label htmlFor={inputId} className={FIELD_LABEL}>
        {SEARCH_COPY.item}
      </label>
      <div className="relative flex min-w-0 gap-2">
        <Input
          id={inputId}
          type="text"
          role="combobox"
          autoComplete="off"
          placeholder={placeholder}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={
            open && shown[active] ? optionId(active) : undefined
          }
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          value={shownValue}
          onChange={(e) => {
            setText(e.currentTarget.value)
            setOpen(true)
            setActive(-1)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setOpen(false)
            setText("")
            setActive(-1)
          }}
          className="min-w-0 flex-1"
        />
        {selectedId && !disabled ? (
          <Button
            type="button"
            variant="quiet"
            size="icon"
            aria-label={SEARCH_COPY.clearItem}
            onClick={() => onSelect(null)}
            className="self-center"
          >
            <XIcon aria-hidden />
          </Button>
        ) : null}
      </div>
      <ul
        id={listId}
        role="listbox"
        aria-label={SEARCH_COPY.itemsLabel}
        hidden={!open}
        className="max-h-72 overflow-y-auto rounded-card bg-surface p-1 shadow-float"
      >
        {open && shown.length === 0 ? (
          <li
            role="presentation"
            className="px-3 py-2 text-body text-ink-muted"
          >
            {SEARCH_COPY.noItemsMatch}
          </li>
        ) : null}
        {open
          ? shown.map((item, i) => (
              <li
                key={item.id}
                id={optionId(i)}
                role="option"
                aria-selected={item.id === selectedId}
                // Keep focus in the box so blur does not close the list first.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(item)}
                className={cn(
                  "flex min-h-11 cursor-pointer flex-col justify-center rounded-control px-3 py-1.5 text-body [overflow-wrap:anywhere]",
                  item.id === selectedId && "bg-accent-soft",
                  i === active && "bg-surface-2 text-ink"
                )}
              >
                <span className="font-bold">{item.name}</span>
                {item.sectionName ? (
                  <span className="text-meta text-ink-muted">
                    {item.sectionName}
                  </span>
                ) : null}
              </li>
            ))
          : null}
        {open && hits.length > MAX_SHOWN ? (
          <li
            role="presentation"
            className="px-3 py-2 text-body text-ink-muted"
          >
            {SEARCH_COPY.keepTyping(hits.length)}
          </li>
        ) : null}
      </ul>
    </>
  )
}
