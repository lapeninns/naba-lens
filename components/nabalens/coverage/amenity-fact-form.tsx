"use client"

import * as React from "react"
import { CheckIcon, SpinnerGapIcon } from "@phosphor-icons/react"

import { formatDate } from "@/components/nabalens/format"
import { Notice } from "@/components/nabalens/notice"
import { Button } from "@/components/ui/button"
import { DialogFooter } from "@/components/ui/dialog"
import { FieldError } from "@/components/ui/field"

import { CoverageNotice } from "./coverage-notice"
import {
  ASSET_REASON_LABEL,
  COVERAGE_LIMITS,
  PRESENCE_LABEL,
  labelFor,
} from "./copy"
import { EvidenceThumb } from "./evidence-image"
import { ReasonField } from "./reason-dialog"
import type {
  AmenityFactView,
  AmenityPresence,
  CoverageResult,
  EvidenceAsset,
  SetAmenityFactInput,
} from "./types"
import { NETWORK_ERROR, useCoverageAction } from "./use-coverage-action"

export type SetAmenityFactHandler = (
  input: Omit<SetAmenityFactInput, "venueId">
) => Promise<CoverageResult<{ revision: number }>>

const PRESENCE_ORDER: AmenityPresence[] = ["present", "absent", "unknown"]

const PRESENCE_NOTE: Record<AmenityPresence, string> = {
  present: "Recorded as present by you. You can then confirm the item.",
  absent:
    "Recorded as not present. Decide on the item whether it still applies; if it doesn't, mark it not applicable.",
  unknown:
    "While it needs verification, the item can't be confirmed. Staff can still send photos.",
}

const UNCHECKED_PRESENT_NOTE =
  "Present, not checked yet. The item can be confirmed once you have checked it."

function presenceNote(presence: AmenityPresence, checked: boolean): string {
  return presence === "present" && !checked
    ? UNCHECKED_PRESENT_NOTE
    : PRESENCE_NOTE[presence]
}

/** "Facts saved: Present. You can confirm the item now." */
export function factsSavedText(
  presence: AmenityPresence,
  checked: boolean
): string {
  const word = labelFor(PRESENCE_LABEL, presence)
  if (presence === "unknown") return `Facts saved: ${word}.`
  if (!checked) return `Facts saved: ${word}, not checked yet.`
  return presence === "present"
    ? `Facts saved: ${word}. You can confirm the item now.`
    : `Facts saved: ${word}.`
}

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

const MUTED = "text-body-touch text-ink-muted md:text-body-sm"

function draftOf(fact: AmenityFactView): Draft {
  return {
    presence: fact.presence,
    facts: fact.facts ?? "",
    policy: fact.policy ?? "",
    confirm: fact.confirmed,
    assetIds: fact.supportingAssets.map((a) => a.id),
  }
}

function lastConfirmed(fact: AmenityFactView): string {
  if (!fact.confirmed || !fact.confirmedAt) return "Last confirmed: never."
  const who = fact.confirmedBy?.displayName
  return `Last confirmed: ${formatDate(fact.confirmedAt)}${who ? `, by ${who}` : ""}.`
}

/** Present / Not present / Needs verification as one radio group (`nl-seg`). */
function FactChoice({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: AmenityPresence
  onChange: (value: AmenityPresence) => void
  disabled?: boolean
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([])

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0
    if (step === 0) return
    event.preventDefault()
    const next = (index + step + PRESENCE_ORDER.length) % PRESENCE_ORDER.length
    refs.current[next]?.focus()
    onChange(PRESENCE_ORDER[next])
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid w-full grid-cols-2 gap-0.5 rounded-control bg-well p-0.5 md:grid-cols-3"
    >
      {PRESENCE_ORDER.map((option, i) => (
        <button
          key={option}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="button"
          role="radio"
          aria-checked={value === option}
          tabIndex={value === option ? 0 : -1}
          disabled={disabled}
          onClick={() => onChange(option)}
          onKeyDown={(e) => onKeyDown(e, i)}
          className="min-h-11 rounded-[6px] border border-transparent px-2 text-center text-label-touch text-ink-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-60 aria-checked:border-line-control aria-checked:bg-panel aria-checked:text-ink md:min-h-9 md:text-label"
        >
          {labelFor(PRESENCE_LABEL, option)}
        </button>
      ))}
    </div>
  )
}

/**
 * Venue facts for one amenity: present, not present or needs verification,
 * what was checked, policy wording and optional supporting photos. Ticking
 * "I have checked this at the venue" records the viewer as the person who
 * checked it, today; needs verification can never be ticked and keeps the
 * item from being confirmed. Inside the facts dialog, `onCancel` adds Cancel and `onSaved`
 * closes the dialog with the saved text instead of showing it here.
 */
export function AmenityFactForm({
  fact,
  candidates,
  onSave,
  onStale,
  onSaved,
  onCancel,
}: {
  fact: AmenityFactView
  /** Accepted photos of this venue that may support the record. */
  candidates: EvidenceAsset[]
  onSave: SetAmenityFactHandler
  onStale?: () => void
  onSaved?: (text: string) => void
  onCancel?: () => void
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
    const presence = draft.presence
    const confirm = draft.confirm && presence !== "unknown"
    const linkedIds = fact.supportingAssets.map((a) => a.id)
    // The database checks only photos added since the last save, so a photo
    // refusal is always about one of these, never a linked photo.
    const added = draft.assetIds.filter((id) => !linkedIds.includes(id))
    const photosChanged = !sameIds(draft.assetIds, linkedIds)
    const saved = factsSavedText(presence, confirm)
    const result = await action.run(
      () =>
        onSave({
          templateKey: fact.templateKey,
          expectedRevision: fact.revision,
          presence,
          facts: draft.facts.trim() || null,
          policy: draft.policy.trim() || null,
          confirm,
          supportingAssetIds: photosChanged ? draft.assetIds : null,
        }),
      saved
    )
    if (result.ok) {
      if (onSaved) {
        action.dismiss()
        onSaved(saved)
      }
      return
    }
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

  const notice = action.notice
  const submit = (
    <Button
      type="submit"
      size="touch"
      disabled={action.pending}
      aria-busy={action.pending || undefined}
    >
      {action.pending ? (
        <SpinnerGapIcon aria-hidden className="animate-spin" />
      ) : (
        <CheckIcon aria-hidden />
      )}
      {action.pending ? "Saving…" : "Save facts"}
    </Button>
  )

  return (
    <form onSubmit={save} className="grid gap-4" noValidate>
      {notice?.tone === "error" ? (
        <Notice tone="negative" role="alert" title="We couldn't save the facts">
          {notice.text === NETWORK_ERROR
            ? "Check your connection and try again. Nothing is saved twice."
            : notice.text}
        </Notice>
      ) : (
        <CoverageNotice notice={notice} onDismiss={action.dismiss} />
      )}
      <div className="grid gap-1.5">
        <span
          id={`${ids}-fact`}
          className="text-label-touch text-ink md:text-label"
        >
          Fact
        </span>
        <FactChoice
          label={fact.title}
          value={draft.presence}
          onChange={(value) => set("presence", value)}
          disabled={action.pending}
        />
      </div>
      <ReasonField
        id={`${ids}-facts`}
        label="What you checked"
        required={false}
        value={draft.facts}
        onChange={(value) => set("facts", value)}
        maxLength={COVERAGE_LIMITS.factsMax}
        help="Saved with the facts. Admins can see it."
        error={errors.facts}
        disabled={action.pending}
      />
      <ReasonField
        id={`${ids}-policy`}
        label="Policy"
        required={false}
        value={draft.policy}
        onChange={(value) => set("policy", value)}
        maxLength={COVERAGE_LIMITS.factsMax}
        help="House rules, for example “Dogs welcome in the bar, not the restaurant”."
        error={errors.policy}
        disabled={action.pending}
      />
      {photos.length > 0 ? (
        <fieldset className="grid gap-2" disabled={action.pending}>
          <legend className="mb-1 text-label-touch text-ink md:text-label">
            Supporting photos{" "}
            <span className="font-normal text-ink-muted">(optional)</span>
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
                    <span className="flex items-center gap-1.5 text-meta-touch md:text-meta">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAsset(photo.id)}
                        className="size-4 accent-primary"
                      />
                      Photo {index + 1}
                    </span>
                    {reason ? (
                      <span className="text-meta-touch text-negative md:text-meta">
                        Not added: {reason}
                      </span>
                    ) : !photo.available ? (
                      <span className="text-meta-touch text-ink-muted md:text-meta">
                        Not available
                      </span>
                    ) : null}
                  </label>
                </li>
              )
            })}
          </ul>
          {photos.some((p) => !p.available) ? (
            <p className={MUTED}>
              “Not available” photos were deleted or taken by someone who has
              left. They stay linked until you untick them.
            </p>
          ) : null}
          {errors.supportingAssetIds ? (
            <FieldError>{errors.supportingAssetIds}</FieldError>
          ) : null}
        </fieldset>
      ) : null}
      <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-control px-2 py-2 hover:bg-fill-hover has-disabled:cursor-not-allowed has-disabled:hover:bg-transparent">
        <input
          type="checkbox"
          checked={draft.confirm}
          onChange={(e) => set("confirm", e.currentTarget.checked)}
          disabled={action.pending || draft.presence === "unknown"}
          aria-describedby={`${ids}-confirm-help`}
          className="mt-0.5 size-4 shrink-0 accent-primary"
        />
        <span className="grid min-w-0 gap-0.5">
          <span className="text-label-touch text-ink md:text-label">
            I have checked this at the venue
          </span>
          <span
            id={`${ids}-confirm-help`}
            className="text-meta-touch text-ink-muted md:text-meta"
          >
            {draft.presence === "unknown"
              ? "Needs verification can't be checked. Choose Present or Not present first."
              : "Records you as the person who checked it, with today’s date."}
          </span>
        </span>
      </label>
      <p className={MUTED}>{presenceNote(draft.presence, draft.confirm)}</p>
      <p className={MUTED}>
        A photo never proves a claim. Record what you have checked yourself.{" "}
        {lastConfirmed(fact)}
      </p>
      {onCancel ? (
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            size="touch"
            onClick={onCancel}
            disabled={action.pending}
          >
            Cancel
          </Button>
          {submit}
        </DialogFooter>
      ) : (
        <div>{submit}</div>
      )}
    </form>
  )
}
