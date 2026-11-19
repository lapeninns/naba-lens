"use client"

import { useActionState, useState, useTransition } from "react"

import { Notice } from "@/components/nabalens/notice"
import { Button } from "@/components/ui/button"
import { fieldControlVariants } from "@/components/ui/field-control"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionRow } from "@/components/ui/option-row"
import { RadioGroup } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import {
  OPERATING_STATUSES,
  TIMEZONES,
  type AdminVenue,
  type ArchiveImpact,
  type OperatingStatus,
  type ReviewerCandidate,
  type ReviewerResponsibility,
  type ScopeImpact,
  type TemplatePreview,
  type VenueReviewer,
} from "@/lib/admin/venues"

import {
  applyTemplateAction,
  archiveImpactAction,
  createVenueAction,
  saveVenueAction,
  scopeImpactAction,
  setReviewerAction,
  setScopeAction,
  setStatusAction,
  templatePreviewAction,
  type FormState,
} from "./actions"

/*
 * Venue forms (spec §8 A2). Each form says what happened in place, beside
 * what was changed (DESIGN.md §6.7: no toasts) and keeps what the admin
 * chose. Changes that narrow what a venue collects or close it show their
 * impact first and need a reason (AC29).
 */

const SELECT = fieldControlVariants()
const IDLE: FormState = { status: "idle" }
const BOX = "grid gap-4 rounded-card border border-line bg-surface p-4"

function Result({ state, saved }: { state: FormState; saved: string }) {
  if (state.status === "error")
    return (
      <Notice tone="negative" role="alert">
        {state.message}
      </Notice>
    )
  if (state.status === "saved")
    return (
      <Notice tone="positive" role="status">
        {state.message ?? (state.changed ? saved : "Nothing changed.")}
      </Notice>
    )
  return null
}

const fieldErrors = (state: FormState) =>
  state.status === "error" ? (state.fieldErrors ?? {}) : {}

// ---- name and location -----------------------------------------------------

export function VenueDetailsForm({ venue }: { venue?: AdminVenue }) {
  const [state, action, pending] = useActionState(
    venue ? saveVenueAction : createVenueAction,
    IDLE
  )
  const errors = fieldErrors(state)
  const zones =
    venue && !TIMEZONES.includes(venue.timezone)
      ? [venue.timezone, ...TIMEZONES]
      : TIMEZONES
  return (
    <form action={action} className="grid gap-4" noValidate>
      {venue ? (
        <>
          <input type="hidden" name="venueId" value={venue.id} />
          <input type="hidden" name="revision" value={venue.revision} />
        </>
      ) : null}
      <FormField label="Name" error={errors.name}>
        <Input
          name="name"
          defaultValue={venue?.name ?? ""}
          maxLength={120}
          autoComplete="off"
          data-testid="venue-name"
        />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Town or village" optional error={errors.locality}>
          <Input
            name="locality"
            defaultValue={venue?.locality ?? ""}
            maxLength={120}
            data-testid="venue-locality"
          />
        </FormField>
        <FormField
          label="Timezone"
          description="Dates and quiet hours are read in this time. Every Lapen Inns pub today uses Europe/London."
          error={errors.timezone}
        >
          <select
            name="timezone"
            defaultValue={venue?.timezone ?? "Europe/London"}
            className={SELECT}
            data-testid="venue-timezone"
          >
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </FormField>
      </div>
      <FormField label="Address" optional error={errors.address}>
        <Textarea
          name="address"
          rows={2}
          maxLength={300}
          defaultValue={venue?.address ?? ""}
          data-testid="venue-address"
        />
      </FormField>
      {venue ? (
        <FormField
          label="Why are you changing this?"
          optional
          description="Kept in Activity with the old and new values."
          error={errors.reason}
        >
          <Textarea name="reason" rows={2} maxLength={500} />
        </FormField>
      ) : null}
      <Result state={state} saved="Saved. The change is in Activity." />
      <div>
        <Button
          type="submit"
          variant="primary"
          loading={pending}
          data-testid="venue-save"
        >
          {venue ? "Save details" : "Add the venue"}
        </Button>
      </div>
    </form>
  )
}

// ---- reviewers ---------------------------------------------------------------

export function ReviewerForm({
  venueId,
  responsibility,
  current,
  candidates,
}: {
  venueId: string
  responsibility: ReviewerResponsibility
  current: VenueReviewer | null
  candidates: ReviewerCandidate[]
}) {
  const [state, action, pending] = useActionState(setReviewerAction, IDLE)
  const errors = fieldErrors(state)
  const label = responsibility === "main" ? "Main reviewer" : "Backup reviewer"
  const listed =
    current && !candidates.some((c) => c.profileId === current.profileId)
      ? [
          {
            profileId: current.profileId,
            name: `${current.name} (no longer reviews here)`,
            role: "manager" as const,
          },
          ...candidates,
        ]
      : candidates
  return (
    <form
      action={action}
      className={BOX}
      noValidate
      data-testid={`reviewer-${responsibility}`}
    >
      <input type="hidden" name="venueId" value={venueId} />
      <input type="hidden" name="responsibility" value={responsibility} />
      <input type="hidden" name="revision" value={current?.revision ?? 0} />
      <FormField
        label={label}
        description={
          responsibility === "main"
            ? "Reviews this venue's photos first."
            : "Reviews when the main reviewer is away."
        }
      >
        <select
          name="profileId"
          defaultValue={current?.profileId ?? ""}
          className={SELECT}
        >
          <option value="">Nobody named</option>
          {listed.map((c) => (
            <option key={c.profileId} value={c.profileId}>
              {c.name}
            </option>
          ))}
        </select>
      </FormField>
      {current && !current.eligible ? (
        <Notice tone="attention">
          {current.name} no longer reviews at this venue. Name someone who does.
        </Notice>
      ) : null}
      <FormField label="Reason" optional error={errors.reason}>
        <Input name="reason" maxLength={500} />
      </FormField>
      <Result state={state} saved="Saved. The change is in Activity." />
      <div>
        <Button type="submit" variant="secondary" loading={pending}>
          Save {label.toLowerCase()}
        </Button>
      </div>
    </form>
  )
}

// ---- operating status --------------------------------------------------------

export function StatusForm({ venue }: { venue: AdminVenue }) {
  const [state, action, pending] = useActionState(setStatusAction, IDLE)
  const [choice, setChoice] = useState<OperatingStatus>(venue.operatingStatus)
  const [impact, setImpact] = useState<ArchiveImpact | null>(null)
  const [impactError, setImpactError] = useState<string | null>(null)
  const [loading, startLoading] = useTransition()
  const errors = fieldErrors(state)
  const archiving =
    choice === "permanently_closed" &&
    venue.operatingStatus !== "permanently_closed"

  function choose(next: OperatingStatus) {
    setChoice(next)
    setImpact(null)
    setImpactError(null)
    if (
      next === "permanently_closed" &&
      venue.operatingStatus !== "permanently_closed"
    )
      startLoading(async () => {
        const r = await archiveImpactAction(venue.id)
        if (r.ok) setImpact(r.value)
        else setImpactError(r.message)
      })
  }

  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="venueId" value={venue.id} />
      <input type="hidden" name="revision" value={venue.revision} />
      <input type="hidden" name="status" value={choice} />
      <div className="grid gap-2">
        <p id={`status-${venue.id}`} className="text-label text-ink">
          Operating status
        </p>
        <RadioGroup
          aria-labelledby={`status-${venue.id}`}
          value={choice}
          onValueChange={(v) => choose(String(v) as OperatingStatus)}
          className="grid gap-2"
        >
          {OPERATING_STATUSES.map((s) => (
            <OptionRow
              key={s.value}
              type="radio"
              value={s.value}
              label={s.label}
              hint={s.hint}
            />
          ))}
        </RadioGroup>
      </div>
      {archiving ? (
        <div aria-live="polite" className="grid gap-2">
          {loading ? (
            <p className="text-body text-ink-muted">Checking what changes…</p>
          ) : impactError ? (
            <Notice tone="negative" role="alert">
              {impactError}
            </Notice>
          ) : impact ? (
            <Notice tone="attention" title="Archiving this venue">
              <ul className="list-disc pl-5" data-testid="archive-impact">
                <li>
                  {impact.members} {impact.members === 1 ? "person" : "people"}{" "}
                  can no longer open it
                  {impact.onlyVenue > 0
                    ? `; for ${impact.onlyVenue} it is their only venue, so they lose access until moved`
                    : ""}
                  .
                </li>
                <li>
                  {impact.photos} {impact.photos === 1 ? "photo" : "photos"} and
                  every decision stay in the library and Activity.
                </li>
                {impact.scheduledMenus > 0 ? (
                  <li>
                    {impact.scheduledMenus} scheduled{" "}
                    {impact.scheduledMenus === 1 ? "menu" : "menus"} will not
                    start.
                  </li>
                ) : null}
                {impact.destinations > 0 ? (
                  <li>
                    {impact.destinations} publishing{" "}
                    {impact.destinations === 1
                      ? "destination stays"
                      : "destinations stay"}{" "}
                    listed: withdraw what is published there yourself.
                  </li>
                ) : null}
              </ul>
            </Notice>
          ) : null}
        </div>
      ) : null}
      <FormField
        label="Why is the status changing?"
        error={errors.reason}
        description="Kept in Activity."
      >
        <Textarea name="reason" rows={2} maxLength={500} />
      </FormField>
      <Result
        state={state}
        saved="Status changed. The change is in Activity."
      />
      <div>
        <Button
          type="submit"
          variant="secondary"
          loading={pending}
          disabled={choice === venue.operatingStatus || (archiving && !impact)}
          data-testid="venue-status-save"
        >
          {archiving ? "Archive the venue" : "Change status"}
        </Button>
      </div>
    </form>
  )
}

// ---- collection scope (AC29) ---------------------------------------------------

export function ScopeForm({
  venueId,
  applicable,
  decided,
  revision,
  reason,
}: {
  venueId: string
  applicable: boolean
  decided: boolean
  revision: number
  reason: string | null
}) {
  const [state, action, pending] = useActionState(setScopeAction, IDLE)
  const [impact, setImpact] = useState<ScopeImpact | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [loading, startLoading] = useTransition()
  const errors = fieldErrors(state)
  const next = !applicable

  function preview() {
    setPreviewError(null)
    startLoading(async () => {
      const r = await scopeImpactAction(venueId, next)
      if (r.ok) setImpact(r.value)
      else setPreviewError(r.message)
    })
  }

  return (
    <div className={BOX} data-testid="scope-accommodation">
      <div className="grid gap-1">
        <p className="text-label text-ink">Accommodation</p>
        <p className="text-body text-ink-muted">
          {applicable
            ? "This venue has bedrooms: bedroom photos and facts are collected."
            : "No accommodation: no bedroom photos or facts are asked for."}
          {decided
            ? ""
            : " (Not decided yet; the default is no accommodation.)"}
        </p>
        {reason ? (
          <p className="text-meta text-ink-muted">Last reason: {reason}</p>
        ) : null}
      </div>
      {state.status === "saved" ? (
        <Result state={state} saved="Saved. The change is in Activity." />
      ) : impact ? (
        <form action={action} className="grid gap-4" noValidate>
          <input type="hidden" name="venueId" value={venueId} />
          <input type="hidden" name="revision" value={revision} />
          <input type="hidden" name="applicable" value={String(next)} />
          <Notice tone="attention" title="What changes">
            <p data-testid="scope-impact">
              {next
                ? "Bedroom requirements will apply here."
                : "Bedroom requirements will stop applying here."}{" "}
              {impact.slotsAdded === 0 && impact.slotsRemoved === 0
                ? `The album keeps its ${impact.slotsBefore} slots (${impact.coveredBefore} with a photo): no bedroom requirements exist yet.`
                : `${impact.slotsAdded} slots added, ${impact.slotsRemoved} removed.`}
              {impact.roomPlaces > 0
                ? ` ${impact.roomPlaces} listed ${impact.roomPlaces === 1 ? "room stays" : "rooms stay"} as places.`
                : ""}
            </p>
          </Notice>
          <FormField
            label="Why is this changing?"
            error={errors.reason}
            description="Required: a change of scope is kept in Activity."
          >
            <Textarea name="reason" rows={2} maxLength={500} />
          </FormField>
          {state.status === "error" ? <Result state={state} saved="" /> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="secondary" loading={pending}>
              {next ? "Turn accommodation on" : "Turn accommodation off"}
            </Button>
            <Button
              type="button"
              variant="quiet"
              onClick={() => setImpact(null)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="grid gap-2">
          {previewError ? (
            <Notice tone="negative" role="alert">
              {previewError}
            </Notice>
          ) : null}
          <div>
            <Button
              type="button"
              variant="secondary"
              loading={loading}
              onClick={preview}
              data-testid="scope-preview"
            >
              {next ? "Preview turning it on" : "Preview turning it off"}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- templates (AC23) ----------------------------------------------------------

export function TemplateForm({
  venueId,
  otherVenues,
}: {
  venueId: string
  otherVenues: { id: string; name: string }[]
}) {
  const [state, action, pending] = useActionState(applyTemplateAction, IDLE)
  const [source, setSource] = useState("")
  const [preview, setPreview] = useState<TemplatePreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [loading, startLoading] = useTransition()
  const errors = fieldErrors(state)

  function load() {
    setPreviewError(null)
    startLoading(async () => {
      const r = await templatePreviewAction(venueId, source || null)
      if (r.ok) setPreview(r.value)
      else setPreviewError(r.message)
    })
  }

  const empty =
    preview && preview.questions.length === 0 && preview.places.length === 0

  return (
    <div className={BOX} data-testid="venue-template">
      <p className="text-body text-ink-muted">
        Adds what to collect as new, unanswered requirements. Answers, facts,
        review decisions and photos are never copied from another venue.
      </p>
      <FormField label="Copy from">
        <select
          value={source}
          onChange={(e) => {
            setSource(e.target.value)
            setPreview(null)
          }}
          className={SELECT}
          data-testid="template-source"
        >
          <option value="">The group catalogue (core questions)</option>
          {otherVenues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}: its questions and spaces
            </option>
          ))}
        </select>
      </FormField>
      {previewError ? (
        <Notice tone="negative" role="alert">
          {previewError}
        </Notice>
      ) : null}
      {state.status === "saved" ? (
        <Result state={state} saved="" />
      ) : preview ? (
        empty ? (
          <Notice tone="plain">
            Nothing to add: this venue already has all of it.
          </Notice>
        ) : (
          <form action={action} className="grid gap-4" noValidate>
            <input type="hidden" name="venueId" value={venueId} />
            <input type="hidden" name="sourceVenueId" value={source} />
            <div className="grid gap-2" data-testid="template-preview">
              {preview.questions.length ? (
                <details>
                  <summary className="cursor-pointer text-label text-ink">
                    {preview.questions.length} facility{" "}
                    {preview.questions.length === 1 ? "question" : "questions"}
                  </summary>
                  <ul className="mt-2 list-disc pl-5 text-body text-ink-muted">
                    {preview.questions.map((q) => (
                      <li key={q.key}>{q.label}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {preview.places.length ? (
                <details>
                  <summary className="cursor-pointer text-label text-ink">
                    {preview.places.length}{" "}
                    {preview.places.length === 1 ? "space" : "spaces"}
                  </summary>
                  <ul className="mt-2 list-disc pl-5 text-body text-ink-muted">
                    {preview.places.map((p) => (
                      <li key={`${p.kind}:${p.label}`}>{p.label}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
            <FormField label="Why are you adding these?" error={errors.reason}>
              <Input name="reason" maxLength={500} />
            </FormField>
            {state.status === "error" ? (
              <Result state={state} saved="" />
            ) : null}
            <div>
              <Button
                type="submit"
                variant="secondary"
                loading={pending}
                data-testid="template-apply"
              >
                Add as requirements to check
              </Button>
            </div>
          </form>
        )
      ) : (
        <div>
          <Button
            type="button"
            variant="secondary"
            loading={loading}
            onClick={load}
            data-testid="template-preview-button"
          >
            Preview what would be added
          </Button>
        </div>
      )}
    </div>
  )
}
