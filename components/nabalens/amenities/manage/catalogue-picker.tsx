"use client"

import * as React from "react"
import {
  MagnifyingGlassIcon,
  PlusIcon,
  SpinnerGapIcon,
} from "@phosphor-icons/react"

import { StatusChip } from "@/components/nabalens/status-chip"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  EVIDENCE_RULE_LABEL,
  LIMITS,
  UI_TEXT,
  type CatalogueOption,
} from "@/lib/amenities/contract"

/** Case-insensitive match on the question, category or key. */
export function matchesCatalogue(option: CatalogueOption, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [option.question, option.category, option.key].some((text) =>
    text.toLowerCase().includes(q)
  )
}

/** Categories in catalogue order, each with its entries in position order. */
export function groupByCategory(options: CatalogueOption[]) {
  const groups = new Map<string, CatalogueOption[]>()
  for (const option of [...options].sort((a, b) => a.position - b.position)) {
    const list = groups.get(option.category)
    if (list) list.push(option)
    else groups.set(option.category, [option])
  }
  return [...groups.entries()]
}

export type AddOutcome =
  | { ok: true }
  | { ok: false; error: string; fieldError?: string; close?: boolean }

/**
 * The shared catalogue as a searchable, multi-select list. Entries the venue
 * already has active can't be picked again; an archived entry can, and adding
 * it restores the same check with its history.
 */
export function CataloguePicker({
  open,
  onOpenChange,
  options,
  venueName,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  options: CatalogueOption[]
  venueName: string
  onAdd: (keys: string[]) => Promise<AddOutcome>
}) {
  const id = React.useId()
  const [query, setQuery] = React.useState("")
  const [selected, setSelected] = React.useState<string[]>([])
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const groups = groupByCategory(
    options.filter((option) => matchesCatalogue(option, query))
  )

  function close(next: boolean) {
    if (pending) return
    if (!next) {
      setQuery("")
      setSelected([])
      setError(null)
    }
    onOpenChange(next)
  }

  function toggle(key: string, on: boolean) {
    setSelected((keys) => (on ? [...keys, key] : keys.filter((k) => k !== key)))
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (selected.length === 0) {
      setError("Choose at least one question.")
      return
    }
    if (selected.length > LIMITS.maxAddKeys) {
      setError(`Choose up to ${LIMITS.maxAddKeys} questions at a time.`)
      return
    }
    setPending(true)
    setError(null)
    try {
      const outcome = await onAdd(selected)
      if (!outcome.ok && !outcome.close) {
        setError(outcome.fieldError ?? outcome.error)
        return
      }
      setPending(false)
      setQuery("")
      setSelected([])
      onOpenChange(false)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex max-h-[90svh] flex-col sm:max-w-2xl">
        <form
          onSubmit={submit}
          className="flex min-h-0 flex-1 flex-col gap-4"
          noValidate
        >
          <DialogHeader>
            <DialogTitle>{UI_TEXT.addFromCatalogue}</DialogTitle>
            <DialogDescription>
              Choose the questions {venueName} should answer with evidence.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <label
              htmlFor={`${id}-search`}
              className="text-label-touch text-ink md:text-label"
            >
              Search the catalogue
            </label>
            <div className="relative">
              <MagnifyingGlassIcon
                aria-hidden
                className="pointer-events-none absolute start-3 top-1/2 size-[18px] -translate-y-1/2 text-ink-muted"
              />
              <input
                id={`${id}-search`}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
                placeholder="Question, category or key"
                autoComplete="off"
                className="block h-11 w-full min-w-0 rounded-control border border-line-control bg-panel ps-10 pe-3 text-body-touch text-ink outline-none placeholder:text-ink-subtle focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus focus-visible:outline-solid md:text-body"
              />
            </div>
          </div>
          <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
            {groups.length === 0 ? (
              <p
                role="status"
                className="text-body-touch text-ink-muted md:text-body"
              >
                Nothing in the catalogue matches “{query.trim()}”.
              </p>
            ) : (
              <div className="grid gap-5">
                {groups.map(([category, entries]) => (
                  <fieldset key={category} className="grid min-w-0 gap-2">
                    <legend className="mb-1 text-meta-touch font-semibold text-ink-muted uppercase md:text-meta-strong">
                      {category}
                    </legend>
                    {entries.map((option) => (
                      <CatalogueRow
                        key={option.key}
                        id={`${id}-${option.key}`}
                        option={option}
                        checked={selected.includes(option.key)}
                        disabled={pending}
                        onChange={(on) => toggle(option.key, on)}
                      />
                    ))}
                  </fieldset>
                ))}
              </div>
            )}
          </div>
          {error ? (
            <p
              role="alert"
              className="text-body-touch text-negative md:text-body-sm"
            >
              {error}
            </p>
          ) : null}
          <DialogFooter className="items-center">
            <p
              aria-live="polite"
              className="me-auto text-meta-touch text-ink-muted tabular-nums md:text-meta"
            >
              {selected.length} selected
            </p>
            <Button
              type="button"
              variant="secondary"
              size="touch"
              onClick={() => close(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="touch"
              disabled={pending}
              aria-busy={pending || undefined}
            >
              {pending ? (
                <SpinnerGapIcon aria-hidden className="animate-spin" />
              ) : (
                <PlusIcon aria-hidden />
              )}
              {UI_TEXT.addSelected}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CatalogueRow({
  id,
  option,
  checked,
  disabled,
  onChange,
}: {
  id: string
  option: CatalogueOption
  checked: boolean
  disabled: boolean
  onChange: (on: boolean) => void
}) {
  const added = option.existing?.status === "active"
  const archived = option.existing?.status === "archived"
  // The whole row is the label, so the target is the row, not a 20px box.
  return (
    <label
      htmlFor={id}
      className="flex min-h-14 min-w-0 cursor-pointer items-start gap-3 rounded-control border border-line p-3 hover:bg-surface-2 has-disabled:cursor-default has-disabled:hover:bg-transparent"
    >
      <input
        id={id}
        type="checkbox"
        checked={added || checked}
        disabled={added || disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
        aria-labelledby={`${id}-question`}
        aria-describedby={`${id}-meta ${id}-brief`}
        className="mt-1 size-5 shrink-0 accent-accent"
      />
      <span className="grid min-w-0 gap-1">
        <span
          id={`${id}-question`}
          className="text-body-touch font-semibold break-words text-ink md:text-body"
        >
          {option.question}
        </span>
        <span
          id={`${id}-meta`}
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta-touch text-ink-muted md:text-meta"
        >
          <span>Evidence: {EVIDENCE_RULE_LABEL[option.evidenceRule]}</span>
          <span aria-hidden>·</span>
          <code className="break-all">{option.key}</code>
          {added ? (
            <StatusChip tone="closed">Already added</StatusChip>
          ) : archived ? (
            <StatusChip tone="neutral">
              Archived · adding restores it
            </StatusChip>
          ) : null}
        </span>
        <span
          id={`${id}-brief`}
          className="text-body-touch break-words text-ink-muted md:text-body-sm"
        >
          {option.captureBrief}
        </span>
      </span>
    </label>
  )
}
