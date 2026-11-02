"use client"

import * as React from "react"

import { formatDateTime } from "@/components/nabalens/menus/copy"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"

import { CoverageNotice } from "./coverage-notice"
import {
  ASSET_REASON_LABEL,
  COVERAGE_LIMITS,
  PRESENCE_LABEL,
  labelFor,
} from "./copy"
import { PresenceBadge } from "./coverage-badges"
import { EvidenceThumb } from "./evidence-image"
import { textareaClass } from "./reason-dialog"
import type {
  AmenityFactView,
  AmenityPresence,
  CoverageResult,
  EvidenceAsset,
  SetAmenityFactInput,
} from "./types"
import { useCoverageAction } from "./use-coverage-action"

export type SetAmenityFactHandler = (
  input: Omit<SetAmenityFactInput, "venueId">
) => Promise<CoverageResult<{ revision: number }>>

const PRESENCE_OPTIONS: { value: AmenityPresence; help: string }[] = [
  { value: "present", help: "Checked: the venue has it." },
  { value: "absent", help: "Checked: the venue does not have it." },
  { value: "unknown", help: "Not checked yet. Stays “Needs verification”." },
]

type Draft = {
  presence: AmenityPresence
  facts: string
  policy: string
  confirm: boolean
  assetIds: string[]
}

function sameIds(a: string[], b: string[]) {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join()
}

const PICK_GONE_TEXT =
  "A photo you just picked is no longer available, so nothing was saved. The photos have been reloaded and your new picks unticked. Pick again, then save."

function draftOf(fact: AmenityFactView): Draft {
  return {
    presence: fact.presence,
    facts: fact.facts ?? "",
    policy: fact.policy ?? "",
    confirm: fact.confirmed,
    assetIds: fact.supportingAssets.map((a) => a.id),
  }
}

/**
 * Venue facts for one amenity: present / absent / unknown, what is there,
 * policy wording, who confirmed it and when, and optional supporting photos.
 * Unknown cannot be confirmed and keeps the checklist item in setup.
 */
export function AmenityFactForm({
  fact,
  candidates,
  onSave,
  onStale,
}: {
  fact: AmenityFactView
  /** Accepted photos of this venue that may support the record. */
  candidates: EvidenceAsset[]
  onSave: SetAmenityFactHandler
  onStale?: () => void
}) {
  const ids = React.useId()
  const action = useCoverageAction(onStale)
  // Unsaved edits survive refreshes; only a new saved revision resets them.
  const savedKey = `${fact.templateKey}:${fact.revision ?? "new"}`
  const [seed, setSeed] = React.useState(savedKey)
  const [draft, setDraft] = React.useState(() => draftOf(fact))
  const [errors, setErrors] = React.useState<Partial<Record<string, string>>>(
    {}
  )
  /** Photos the last save refused: asset id to the reason shown on its tile. */
  const [refused, setRefused] = React.useState<Record<string, string>>({})
  if (seed !== savedKey) {
    setSeed(savedKey)
    setDraft(draftOf(fact))
    setErrors({})
    setRefused({})
  }

  const photos = React.useMemo(() => {
    const byId = new Map<string, EvidenceAsset>()
    for (const asset of [...fact.supportingAssets, ...candidates]) {
      if (!byId.has(asset.id)) byId.set(asset.id, asset)
    }
    return [...byId.values()]
  }, [fact.supportingAssets, candidates])

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => {
      const next = { ...current, [key]: value }
      if (next.presence === "unknown") next.confirm = false
      return next
    })
  }

  function toggleAsset(id: string) {
    setDraft((current) => ({
      ...current,
      assetIds: current.assetIds.includes(id)
        ? current.assetIds.filter((a) => a !== id)
        : [...current.assetIds, id],
    }))
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    const found: Record<string, string> = {}
    if (draft.facts.trim().length > COVERAGE_LIMITS.factsMax)
      found.facts = `Use up to ${COVERAGE_LIMITS.factsMax} characters.`
    if (draft.policy.trim().length > COVERAGE_LIMITS.factsMax)
      found.policy = `Use up to ${COVERAGE_LIMITS.factsMax} characters.`
    if (draft.assetIds.length > COVERAGE_LIMITS.factAssetsMax)
      found.supportingAssetIds = `Choose up to ${COVERAGE_LIMITS.factAssetsMax} photos.`
    setErrors(found)
    setRefused({})
    if (Object.keys(found).length > 0) return
    const confirm = draft.confirm && draft.presence !== "unknown"
    const linkedIds = fact.supportingAssets.map((a) => a.id)
    // The database checks only photos added since the last save, so a photo
    // refusal is always about one of these, never a linked photo.
    const added = draft.assetIds.filter((id) => !linkedIds.includes(id))
    const photosChanged = !sameIds(draft.assetIds, linkedIds)
    const result = await action.run(
      () =>
        onSave({
          templateKey: fact.templateKey,
          expectedRevision: fact.revision,
          presence: draft.presence,
          facts: draft.facts.trim() || null,
          policy: draft.policy.trim() || null,
          confirm,
          supportingAssetIds: photosChanged ? draft.assetIds : null,
        }),
      confirm
        ? `Saved and confirmed: ${labelFor(PRESENCE_LABEL, draft.presence).toLowerCase()}.`
        : draft.presence === "unknown"
          ? "Saved. It still needs verification."
          : "Saved, not confirmed yet."
    )
    if (result.ok) return
    if ("fieldErrors" in result && result.fieldErrors) {
      setErrors(result.fieldErrors)
    }
    const untick = (ids: string[]) =>
      setDraft((current) => ({
        ...current,
        assetIds: current.assetIds.filter((id) => !ids.includes(id)),
      }))
    if (result.code === "asset_ineligible") {
      // The services name a photo only when exactly one was sent, so a single
      // new pick next to linked photos is named here instead.
      const reasons: Record<string, string> = result.assetErrors?.length
        ? Object.fromEntries(
            result.assetErrors.map((e) => [
              e.assetId,
              labelFor(ASSET_REASON_LABEL, e.reason),
            ])
          )
        : added.length === 1
          ? { [added[0]]: result.message }
          : {}
      setRefused(reasons)
      untick(Object.keys(reasons))
    } else if (result.code === "not_found" && added.length > 0) {
      // The reload drops the deleted photo from the list, so the new picks are
      // unticked rather than named: an invisible tick would fail every save.
      untick(added)
      action.setNotice({ tone: "warning", text: PICK_GONE_TEXT })
    }
  }

  return (
    <section aria-labelledby={`${ids}-title`} className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={`${ids}-title`} className="text-lg font-medium">
          Amenity facts
        </h2>
        <PresenceBadge presence={fact.presence} />
      </div>
      <p className="text-sm text-muted-foreground">
        {fact.confirmed && fact.confirmedAt
          ? `Confirmed by ${fact.confirmedBy?.displayName ?? "a manager"} on ${formatDateTime(fact.confirmedAt)}.`
          : "Not confirmed yet."}{" "}
        Photos support this record; they never establish accessibility or
        dog-friendly claims on their own.
      </p>
      <CoverageNotice notice={action.notice} onDismiss={action.dismiss} />
      <form onSubmit={save} className="grid gap-4" noValidate>
        <fieldset className="grid gap-1" disabled={action.pending}>
          <legend className="mb-1 text-sm font-medium">Is it present?</legend>
          {PRESENCE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex min-h-11 cursor-pointer items-start gap-2 rounded-md px-2 py-2 hover:bg-muted/50 sm:min-h-9"
            >
              <input
                type="radio"
                name={`${ids}-presence`}
                value={option.value}
                checked={draft.presence === option.value}
                onChange={() => set("presence", option.value)}
                className="mt-0.5 size-4 accent-primary"
              />
              <span className="grid">
                <span className="text-sm font-medium">
                  {labelFor(PRESENCE_LABEL, option.value)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {option.help}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <Field className="gap-1.5">
          <FieldLabel htmlFor={`${ids}-facts`}>
            What is there (optional)
          </FieldLabel>
          <textarea
            id={`${ids}-facts`}
            value={draft.facts}
            onChange={(e) => set("facts", e.currentTarget.value)}
            maxLength={COVERAGE_LIMITS.factsMax}
            rows={3}
            aria-invalid={!!errors.facts || undefined}
            aria-describedby={`${ids}-facts-help`}
            className={textareaClass}
            disabled={action.pending}
          />
          <FieldDescription id={`${ids}-facts-help`}>
            What you checked, for example “Step-free route from the car park
            through the side door”.
          </FieldDescription>
          {errors.facts ? <FieldError>{errors.facts}</FieldError> : null}
        </Field>
        <Field className="gap-1.5">
          <FieldLabel htmlFor={`${ids}-policy`}>Policy (optional)</FieldLabel>
          <textarea
            id={`${ids}-policy`}
            value={draft.policy}
            onChange={(e) => set("policy", e.currentTarget.value)}
            maxLength={COVERAGE_LIMITS.factsMax}
            rows={2}
            aria-invalid={!!errors.policy || undefined}
            aria-describedby={`${ids}-policy-help`}
            className={textareaClass}
            disabled={action.pending}
          />
          <FieldDescription id={`${ids}-policy-help`}>
            House rules, for example “Dogs welcome in the bar, not the
            restaurant”.
          </FieldDescription>
          {errors.policy ? <FieldError>{errors.policy}</FieldError> : null}
        </Field>
        {photos.length > 0 ? (
          <fieldset className="grid gap-2" disabled={action.pending}>
            <legend className="mb-1 text-sm font-medium">
              Supporting photos (optional)
            </legend>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {photos.map((photo, index) => {
                const checked = draft.assetIds.includes(photo.id)
                const reason = refused[photo.id]
                return (
                  <li key={photo.id}>
                    <label className="grid cursor-pointer gap-1 rounded-md p-1 has-checked:bg-primary/10 has-focus-visible:ring-3 has-focus-visible:ring-ring/50">
                      <EvidenceThumb
                        src={photo.available ? photo.thumbnailUrl : null}
                      />
                      <span className="flex items-center gap-1.5 text-xs">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAsset(photo.id)}
                          className="size-4 accent-primary"
                        />
                        Photo {index + 1}
                      </span>
                      {reason ? (
                        <span className="text-xs text-negative">
                          Not added: {reason}
                        </span>
                      ) : !photo.available ? (
                        <span className="text-xs text-muted-foreground">
                          Not available
                        </span>
                      ) : null}
                    </label>
                  </li>
                )
              })}
            </ul>
            {photos.some((p) => !p.available) ? (
              <p className="text-sm text-muted-foreground">
                “Not available” photos were deleted or taken by someone who has
                left. They stay linked until you untick them.
              </p>
            ) : null}
            {errors.supportingAssetIds ? (
              <FieldError>{errors.supportingAssetIds}</FieldError>
            ) : null}
          </fieldset>
        ) : null}
        <label className="flex min-h-11 cursor-pointer items-start gap-2 sm:min-h-9">
          <input
            type="checkbox"
            checked={draft.confirm}
            onChange={(e) => set("confirm", e.currentTarget.checked)}
            disabled={action.pending || draft.presence === "unknown"}
            aria-describedby={`${ids}-confirm-help`}
            className="mt-0.5 size-4 accent-primary"
          />
          <span className="grid">
            <span className="text-sm font-medium">
              I have checked this at the venue
            </span>
            <span
              id={`${ids}-confirm-help`}
              className="text-sm text-muted-foreground"
            >
              {draft.presence === "unknown"
                ? "Unknown cannot be confirmed. Choose present or not present first."
                : "Records you as the person who confirmed it, with today’s date."}
            </span>
          </span>
        </label>
        <div>
          <Button
            type="submit"
            size="touch"
            disabled={action.pending}
            aria-busy={action.pending || undefined}
          >
            {action.pending
              ? "Saving…"
              : draft.confirm && draft.presence !== "unknown"
                ? "Save and confirm"
                : "Save facts"}
          </Button>
        </div>
      </form>
    </section>
  )
}
