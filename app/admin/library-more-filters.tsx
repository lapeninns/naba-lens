"use client"

import * as React from "react"

import type { Option } from "@/components/nabalens"
import { OptionSelect } from "@/components/nabalens/option-select"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  NO_EXTRA_FILTERS,
  ORIENTATION_WORDS,
  ORIENTATIONS,
  REVIEW_STATES,
  REVIEW_WORDS,
  WITHDRAWN_WORDS,
  type LibraryExtraFilters,
  type Orientation,
  type ReviewState,
  type WithdrawnFilter,
} from "@/lib/library/model"

export type LibraryExtraOptions = {
  tags: Option[]
  collections: Option[]
  requests: Option[]
  destinations: Option[]
}

const USE_OPTIONS: Option[] = (["withdrawn", "all"] as const).map((id) => ({
  id,
  name: WITHDRAWN_WORDS[id],
}))
const REVIEW_OPTIONS: Option[] = REVIEW_STATES.map((id) => ({
  id,
  name: REVIEW_WORDS[id],
}))
const ORIENTATION_OPTIONS: Option[] = ORIENTATIONS.map((id) => ({
  id,
  name: ORIENTATION_WORDS[id],
}))

/** How many of the A4 filters are on. */
export function countExtraFilters(value: LibraryExtraFilters): number {
  return (
    (value.withdrawn !== "active" ? 1 : 0) +
    [
      value.review,
      value.capturedFrom,
      value.capturedTo,
      value.orientation,
      value.requestId,
      value.collectionId,
      value.destinationId,
      value.tagId,
    ].filter(Boolean).length
  )
}

/**
 * The Library's A4 filters (spec §8 A4; S2-LIBRARY): use (in use or
 * withdrawn), review state, capture dates, orientation, request, collection,
 * publication destination and tag. Folded under "Use, review and
 * collections" until one is on. Every change navigates (the URL is the
 * filter), like the filters above it.
 */
export function LibraryMoreFilters({
  value,
  options,
  onChange,
}: {
  value: LibraryExtraFilters
  options: LibraryExtraOptions
  onChange: (next: LibraryExtraFilters) => void
}) {
  const count = countExtraFilters(value)
  const set = (patch: Partial<LibraryExtraFilters>) =>
    onChange({ ...value, ...patch })

  return (
    <details
      open={count > 0 || undefined}
      className="rounded-card border border-line bg-surface p-4"
      data-testid="library-more-filters"
    >
      <summary className="min-h-12 cursor-pointer content-center text-body font-bold text-ink">
        Use, review and collections
        {count > 0 ? (
          <span className="ms-2 font-mono text-meta text-ink-muted">
            {count} on
          </span>
        ) : null}
      </summary>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label="In use" optional>
          {(c) => (
            <OptionSelect
              id={c.id}
              aria-describedby={c["aria-describedby"]}
              options={USE_OPTIONS}
              value={value.withdrawn === "active" ? null : value.withdrawn}
              emptyLabel={WITHDRAWN_WORDS.active}
              onValueChange={(v) =>
                set({ withdrawn: (v as WithdrawnFilter | null) ?? "active" })
              }
            />
          )}
        </FormField>
        <FormField label="Review" optional>
          {(c) => (
            <OptionSelect
              id={c.id}
              options={REVIEW_OPTIONS}
              value={value.review}
              emptyLabel="Any review state"
              onValueChange={(v) => set({ review: v as ReviewState | null })}
            />
          )}
        </FormField>
        <FormField label="Orientation" optional>
          {(c) => (
            <OptionSelect
              id={c.id}
              options={ORIENTATION_OPTIONS}
              value={value.orientation}
              emptyLabel="Any orientation"
              onValueChange={(v) =>
                set({ orientation: v as Orientation | null })
              }
            />
          )}
        </FormField>
        <FormField label="Tag" optional>
          {(c) => (
            <OptionSelect
              id={c.id}
              options={options.tags}
              value={value.tagId}
              emptyLabel="Any tag"
              onValueChange={(tagId) => set({ tagId })}
            />
          )}
        </FormField>
        <FormField label="Collection" optional>
          {(c) => (
            <OptionSelect
              id={c.id}
              options={options.collections}
              value={value.collectionId}
              emptyLabel="Any collection"
              onValueChange={(collectionId) => set({ collectionId })}
            />
          )}
        </FormField>
        <FormField label="Request" optional>
          {(c) => (
            <OptionSelect
              id={c.id}
              options={options.requests}
              value={value.requestId}
              emptyLabel="Any request"
              onValueChange={(requestId) => set({ requestId })}
            />
          )}
        </FormField>
        <FormField label="Published to" optional>
          {(c) => (
            <OptionSelect
              id={c.id}
              options={options.destinations}
              value={value.destinationId}
              emptyLabel="Any destination"
              onValueChange={(destinationId) => set({ destinationId })}
            />
          )}
        </FormField>
        <div className="grid grid-cols-2 gap-2">
          <FormField label="Taken from" optional>
            <Input
              type="date"
              value={value.capturedFrom ?? ""}
              max={value.capturedTo ?? undefined}
              onChange={(e) =>
                set({ capturedFrom: e.currentTarget.value || null })
              }
            />
          </FormField>
          <FormField label="Taken to" optional>
            <Input
              type="date"
              value={value.capturedTo ?? ""}
              min={value.capturedFrom ?? undefined}
              onChange={(e) =>
                set({ capturedTo: e.currentTarget.value || null })
              }
            />
          </FormField>
        </div>
      </div>
      <p className="mt-3 text-body text-ink-muted">
        Withdrawn photos are hidden unless you ask for them. A photo whose
        capture time is unknown is left out while a taken date is set.
      </p>
      {count > 0 ? (
        <Button
          type="button"
          variant="link"
          className="mt-2"
          onClick={() => onChange(NO_EXTRA_FILTERS)}
        >
          Clear these filters
        </Button>
      ) : null}
    </details>
  )
}
