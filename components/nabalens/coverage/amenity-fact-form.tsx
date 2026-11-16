"use client"

import { OptionRow } from "@/components/ui/option-row"
import { SegmentedControl } from "@/components/ui/segmented-control"
import * as React from "react"
import { CheckIcon } from "@phosphor-icons/react"

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

const MUTED = "text-body text-ink-muted"

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
  return (
    <SegmentedControl
      label={label}
      // Three long labels: one column on a phone.
      stack="phone"
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      options={PRESENCE_ORDER.map((option) => ({
        value: option,
        label: labelFor(PRESENCE_LABEL, option),
      }))}
    />
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
      variant="primary"
      type="submit"
      loading={action.pending}
      loadingLabel="Saving…"
    >
      <CheckIcon aria-hidden />
      Save facts
    </Button>
  )

  return (
    <form onSubmit={save} className="grid gap-4" noValidate>
      {notice?.tone === "error" ? (
        <Notice
          tone="negative"
          role="alert"
          title={
            notice.text === NETWORK_ERROR
              ? "We couldn't confirm the facts were saved"
              : "We couldn't save the facts"
          }
        >
          {notice.text === NETWORK_ERROR
            ? "Check your connection, then try again or refresh to see if they were. Nothing is saved twice."
            : notice.text}
        </Notice>
      ) : (
        <CoverageNotice notice={notice} onDismiss={action.dismiss} />
      )}
      <div className="grid gap-1.5">
        <span id={`${ids}-fact`} className="text-label text-ink">
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
          <legend className="mb-1 text-label text-ink">
            Supporting photos{" "}
            <span className="font-normal text-ink-muted">(optional)</span>
          </legend>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {photos.map((photo, index) => {
              const checked = draft.assetIds.includes(photo.id)
              const reason = refused[photo.id]
              return (
                <li key={photo.id}>
                  <label className="grid cursor-pointer gap-1.5 rounded-control bg-surface-2 p-1.5 focus-ring-within has-checked:bg-accent-soft has-checked:ring-selected">
                    <EvidenceThumb
                      src={photo.available ? photo.thumbnailUrl : null}
                    />
                    <span className="flex items-center gap-1.5 text-meta">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAsset(photo.id)}
                        className="size-6 accent-select"
                      />
                      Photo {index + 1}
                    </span>
                    {reason ? (
                      <span className="text-meta font-semibold text-warn-fg">
                        Not added: {reason}
                      </span>
                    ) : !photo.available ? (
                      <span className="text-meta text-ink-muted">
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
      <OptionRow
        type="checkbox"
        checked={draft.confirm}
        onCheckedChange={(checked) => set("confirm", checked)}
        disabled={action.pending || draft.presence === "unknown"}
        label="I have checked this at the venue"
        hint={
          draft.presence === "unknown"
            ? "Needs verification can't be checked. Choose Present or Not present first."
            : "Records you as the person who checked it, with today’s date."
        }
      />
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
