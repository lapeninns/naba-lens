"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { PlusIcon } from "@phosphor-icons/react"

import {
  CoverageNotice,
  ReasonDialog,
  type Notice,
} from "@/components/nabalens/coverage"
import type { ReasonOutcome } from "@/components/nabalens/coverage/reason-dialog"
import { useRequestIds } from "@/components/nabalens/coverage/use-request-id"
import { formatDate } from "@/components/nabalens/format"
import { OptionSelect } from "@/components/nabalens/option-select"
import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import { Button } from "@/components/ui/button"
import type {
  KnowledgeResult,
  Place,
  PlaceKind,
} from "@/lib/knowledge-client/contract"

import { FieldMessage, LABEL, MUTED } from "../amenities/capture/field-parts"

export type PlaceHandlers = {
  add: (input: {
    venueId: string
    kind: PlaceKind
    label: string
    idempotencyKey: string
  }) => Promise<KnowledgeResult<{ subjectId: string; replayed: boolean }>>
  retire: (input: {
    subjectId: string
    reason: string
    idempotencyKey: string
  }) => Promise<KnowledgeResult<{ subjectId: string; replayed: boolean }>>
}

const KINDS: { kind: PlaceKind; one: string; many: string }[] = [
  { kind: "entrance", one: "Entrance", many: "Entrances" },
  { kind: "route", one: "Route", many: "Routes" },
  { kind: "area", one: "Area", many: "Areas" },
  { kind: "room", one: "Room", many: "Rooms" },
  { kind: "facility_point", one: "Facility", many: "Facilities" },
]

export const PLACES_COPY = {
  intro: (venue: string) =>
    `Entrances, routes, rooms and areas staff can choose when they answer. List places ${venue} has; don't add places it doesn't have.`,
  empty:
    "No places listed yet. Add the entrances first: the step-free question needs them.",
  addTitle: "Add a place",
  kind: "Kind",
  name: "Name",
  nameHelp: "Up to 80 characters, as staff would say it.",
  add: "Add place",
  adding: "Adding…",
  added: (label: string) => `Added ${label}.`,
  exists: (label: string) => `${label} is already listed.`,
  retire: "Retire",
  retireTitle: (label: string) => `Retire ${label}?`,
  retireBody:
    "Staff can't choose it any more. Answers that already name it keep it in their history.",
  retireLabel: "Why?",
  retireConfirm: "Retire place",
  retiring: "Retiring…",
  retired: (label: string) => `Retired ${label}.`,
  retiredGroup: (n: number) => `Retired (${n})`,
  network:
    "We couldn't confirm this was saved. Try again; nothing is saved twice.",
} as const

const placeRowId = (subjectId: string) => `place-${subjectId}`

/**
 * The venue's places (B03 UI design §3.6), for its manager or an admin. Each
 * write carries a request key per intent, so a retry replays. A place that
 * is already listed is shown and focused instead of added twice.
 */
export function PlacesManager({
  venueId,
  venueName,
  places,
  handlers,
}: {
  venueId: string
  venueName: string
  places: Place[]
  handlers: PlaceHandlers
}) {
  const router = useRouter()
  const ids = React.useId()
  const keys = useRequestIds()
  const sessionEnded = useSessionEndedCatch()
  const [notice, setNotice] = React.useState<Notice | null>(null)
  const [kind, setKind] = React.useState<PlaceKind | null>(null)
  const [label, setLabel] = React.useState("")
  const [errors, setErrors] = React.useState<{ kind?: string; label?: string }>(
    {}
  )
  const [pending, setPending] = React.useState(false)
  const [retiring, setRetiring] = React.useState<Place | null>(null)
  // The place last opened for retiring: the dialog clears `retiring` as it
  // closes, before it asks where focus goes.
  const lastRetiring = React.useRef<Place | null>(null)
  const active = places.filter((p) => p.active)
  const retired = places.filter((p) => !p.active)

  function focusLater(id: string) {
    requestAnimationFrame(() => document.getElementById(id)?.focus())
  }

  async function add(event: React.FormEvent) {
    event.preventDefault()
    const name = label.trim()
    const next: typeof errors = {}
    if (!kind) next.kind = "Choose what kind of place this is."
    if (!name || Array.from(name).length > 80)
      next.label = "Enter a name of up to 80 characters."
    setErrors(next)
    if (next.kind || next.label) {
      focusLater(next.kind ? `${ids}-kind` : `${ids}-label`)
      return
    }
    const payload = { venueId, kind: kind!, label: name }
    setPending(true)
    setNotice(null)
    try {
      const result = await handlers.add({
        ...payload,
        idempotencyKey: keys.requestIdFor("place-add", payload),
      })
      if (result.ok) {
        keys.settle("place-add")
        setLabel("")
        setNotice({ tone: "success", text: PLACES_COPY.added(name) })
        router.refresh()
        return
      }
      keys.settle("place-add")
      if (result.code === "state_conflict" && result.subjectId) {
        setNotice({ tone: "warning", text: PLACES_COPY.exists(name) })
        focusLater(placeRowId(result.subjectId))
        return
      }
      setErrors({
        kind: result.fieldErrors?.kind,
        label: result.fieldErrors?.label,
      })
      setNotice({ tone: "error", text: result.message })
    } catch (cause) {
      // The key stays: Add again replays rather than adding twice.
      setNotice({
        tone: "error",
        text: sessionEnded(cause) ?? PLACES_COPY.network,
      })
    } finally {
      setPending(false)
    }
  }

  async function retire(place: Place, reason: string): Promise<ReasonOutcome> {
    const payload = { subjectId: place.subjectId, reason }
    const scope = `place-retire:${place.subjectId}`
    try {
      const result = await handlers.retire({
        ...payload,
        idempotencyKey: keys.requestIdFor(scope, payload),
      })
      if (!result.ok) {
        keys.settle(scope)
        return {
          ok: false,
          error: result.message,
          fieldError: result.fieldErrors?.reason,
        }
      }
      keys.settle(scope)
      setNotice({ tone: "success", text: PLACES_COPY.retired(place.label) })
      router.refresh()
      return { ok: true }
    } catch (cause) {
      return { ok: false, error: sessionEnded(cause) ?? PLACES_COPY.network }
    }
  }

  /** After a retire the row's button goes: the next row's, else the heading. */
  function afterRetire(): HTMLElement | null {
    const retired = lastRetiring.current
    if (!retired) return null
    const group = active.filter((p) => p.kind === retired.kind)
    const at = group.findIndex((p) => p.subjectId === retired.subjectId)
    const next = group[at + 1] ?? group[at - 1]
    return (
      (next &&
        document.getElementById(`${placeRowId(next.subjectId)}-retire`)) ||
      document.getElementById(`${ids}-${retired.kind}`)
    )
  }

  return (
    <div className="grid min-w-0 gap-6">
      <p className="max-w-(--size-reading) text-body-touch text-ink md:text-body">
        {PLACES_COPY.intro(venueName)}
      </p>
      <CoverageNotice notice={notice} onDismiss={() => setNotice(null)} />

      {active.length === 0 ? (
        <p className="text-body-touch text-ink-muted md:text-body">
          {PLACES_COPY.empty}
        </p>
      ) : (
        KINDS.map(({ kind: k, many }) => {
          const rows = active.filter((p) => p.kind === k)
          if (rows.length === 0) return null
          return (
            <section
              key={k}
              aria-labelledby={`${ids}-${k}`}
              className="grid min-w-0 gap-2"
            >
              <h2
                id={`${ids}-${k}`}
                tabIndex={-1}
                className="font-display text-section-title text-ink outline-none"
              >
                {many}
              </h2>
              <ul className="grid min-w-0 gap-2">
                {rows.map((place) => (
                  <li
                    key={place.subjectId}
                    id={placeRowId(place.subjectId)}
                    tabIndex={-1}
                    className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-card bg-surface p-3 shadow-card outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
                  >
                    <div className="grid min-w-0 gap-0.5">
                      <span className="text-body-touch font-semibold [overflow-wrap:anywhere] text-ink md:text-body">
                        {place.label}
                      </span>
                      {place.addedOn ? (
                        <span className={MUTED}>
                          Added on {formatDate(place.addedOn)}
                          {place.addedBy ? ` by ${place.addedBy}` : ""}
                        </span>
                      ) : null}
                    </div>
                    <Button
                      id={`${placeRowId(place.subjectId)}-retire`}
                      type="button"
                      variant="secondary"
                      size="sm"
                      aria-label={`${PLACES_COPY.retire} ${place.label}`}
                      onClick={() => {
                        lastRetiring.current = place
                        setRetiring(place)
                      }}
                    >
                      {PLACES_COPY.retire}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )
        })
      )}

      <form
        onSubmit={add}
        noValidate
        aria-labelledby={`${ids}-add`}
        className="grid max-w-md min-w-0 gap-3"
      >
        <h2
          id={`${ids}-add`}
          className="font-display text-section-title text-ink"
        >
          {PLACES_COPY.addTitle}
        </h2>
        <div className="grid gap-1.5">
          <label htmlFor={`${ids}-kind`} className={LABEL}>
            {PLACES_COPY.kind}
          </label>
          <OptionSelect
            id={`${ids}-kind`}
            options={KINDS.map((k) => ({ id: k.kind, name: k.one }))}
            value={kind}
            onValueChange={(v) => setKind(v as PlaceKind | null)}
            placeholder="Choose a kind…"
            invalid={!!errors.kind}
            disabled={pending}
            aria-describedby={errors.kind ? `${ids}-kind-error` : undefined}
          />
          <FieldMessage id={`${ids}-kind-error`} error={errors.kind} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={`${ids}-label`} className={LABEL}>
            {PLACES_COPY.name}
          </label>
          <input
            id={`${ids}-label`}
            value={label}
            maxLength={80}
            disabled={pending}
            aria-invalid={errors.label ? true : undefined}
            aria-describedby={
              errors.label
                ? `${ids}-label-help ${ids}-label-error`
                : `${ids}-label-help`
            }
            onChange={(e) => setLabel(e.currentTarget.value)}
            className="block min-h-12 w-full min-w-0 rounded-control border border-line-control bg-panel px-3 py-2 text-body-touch text-ink outline-none focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus focus-visible:outline-solid aria-invalid:border-negative md:text-body"
          />
          <p id={`${ids}-label-help`} className={MUTED}>
            {PLACES_COPY.nameHelp}
          </p>
          <FieldMessage id={`${ids}-label-error`} error={errors.label} />
        </div>
        <div>
          <Button
            type="submit"
            size="touch"
            aria-busy={pending || undefined}
            aria-disabled={pending || undefined}
          >
            <PlusIcon aria-hidden />
            {pending ? PLACES_COPY.adding : PLACES_COPY.add}
          </Button>
        </div>
      </form>

      {retired.length > 0 ? (
        <details className="grid gap-2">
          <summary className="min-h-11 cursor-pointer content-center text-body-touch font-semibold text-ink md:text-body">
            {PLACES_COPY.retiredGroup(retired.length)}
          </summary>
          <ul className="grid gap-2 pt-2">
            {retired.map((place) => (
              <li
                key={place.subjectId}
                className="grid gap-0.5 rounded-card bg-well p-3"
              >
                <span className="text-body-touch [overflow-wrap:anywhere] text-ink md:text-body">
                  {place.label}
                </span>
                {place.retiredOn ? (
                  <span className={MUTED}>
                    Retired on {formatDate(place.retiredOn)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <ReasonDialog
        open={retiring !== null}
        onOpenChange={(open) => {
          if (!open) setRetiring(null)
        }}
        title={retiring ? PLACES_COPY.retireTitle(retiring.label) : ""}
        description={PLACES_COPY.retireBody}
        label={PLACES_COPY.retireLabel}
        confirmLabel={PLACES_COPY.retireConfirm}
        pendingLabel={PLACES_COPY.retiring}
        destructive
        onConfirm={(reason) =>
          retiring ? retire(retiring, reason) : Promise.resolve({ ok: true })
        }
        reportFocus={afterRetire}
        reportFocusOnSuccess
      />
    </div>
  )
}
