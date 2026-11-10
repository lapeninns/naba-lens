"use client"

import * as React from "react"
import { PlusIcon, TrashIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import type { ValueListItem } from "@/lib/knowledge-client/contract"

import { FieldMessage, LABEL, MUTED } from "../amenities/capture/field-parts"

import {
  EVENT_COPY,
  EVENT_LIMITS,
  type EventDraft,
  type EventField,
} from "./event-detail"
import {
  SERVICE_COPY,
  SERVICE_LIMITS,
  type ServiceDraft,
  type ServiceField,
} from "./service-detail"

const INPUT =
  "block min-h-12 w-full min-w-0 rounded-control border border-line-control bg-panel px-3 py-2 text-body-touch text-ink outline-none focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-well aria-invalid:border-negative md:text-body"
const ROW =
  "flex min-h-11 cursor-pointer items-center gap-3 text-body-touch text-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus md:text-body"

const describedBy = (...ids: (string | false | null | undefined)[]) =>
  ids.filter(Boolean).join(" ") || undefined

/**
 * A service's own fields after When (b03-design §6.3, §6.4): how guests
 * order (takeaway) and the subscriptions held (sports), each only where the
 * question uses it.
 */
export function ServiceExtraFields({
  id,
  value,
  onChange,
  channels,
  broadcasters,
  errors,
  disabled,
}: {
  id: string
  value: ServiceDraft
  onChange: (next: ServiceDraft) => void
  channels: boolean
  /** The broadcasters list, or null when the question doesn't ask. */
  broadcasters: readonly ValueListItem[] | null
  errors: Partial<Record<ServiceField, string>>
  disabled?: boolean
}) {
  const set = (patch: Partial<ServiceDraft>) => onChange({ ...value, ...patch })
  return (
    <div className="grid min-w-0 gap-5">
      {channels ? (
        <div
          role="group"
          className="grid min-w-0 gap-2"
          aria-labelledby={`${id}-channels-title`}
          aria-describedby={describedBy(
            `${id}-channels-help`,
            errors.channels && `${id}-channels-error`
          )}
        >
          <p id={`${id}-channels-title`} className={LABEL}>
            {SERVICE_COPY.channels}
          </p>
          <p id={`${id}-channels-help`} className={MUTED}>
            {SERVICE_COPY.channelsHelp}
          </p>
          {value.channels.map((c, i) => (
            <div key={i} className="flex min-w-0 flex-wrap items-end gap-2">
              <div className="grid min-w-0 flex-1 basis-48 gap-1.5">
                <label htmlFor={`${id}-channel${i}`} className={LABEL}>
                  {SERVICE_COPY.channel(i + 1)}
                </label>
                <input
                  id={`${id}-channel${i}`}
                  value={c}
                  maxLength={SERVICE_LIMITS.channel}
                  disabled={disabled}
                  className={INPUT}
                  onChange={(e) =>
                    set({
                      channels: value.channels.map((x, j) =>
                        j === i ? e.currentTarget.value : x
                      ),
                    })
                  }
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={disabled}
                onClick={() => {
                  set({ channels: value.channels.filter((_, j) => j !== i) })
                  requestAnimationFrame(() =>
                    document.getElementById(`${id}-add-channel`)?.focus()
                  )
                }}
              >
                <TrashIcon aria-hidden />
                {SERVICE_COPY.removeChannel(i + 1)}
              </Button>
            </div>
          ))}
          <div>
            <Button
              id={`${id}-add-channel`}
              type="button"
              variant="secondary"
              size="sm"
              disabled={
                disabled || value.channels.length >= SERVICE_LIMITS.channels
              }
              onClick={() => {
                set({ channels: [...value.channels, ""] })
                requestAnimationFrame(() =>
                  document
                    .getElementById(`${id}-channel${value.channels.length}`)
                    ?.focus()
                )
              }}
            >
              <PlusIcon aria-hidden />
              {SERVICE_COPY.addChannel}
            </Button>
          </div>
          <FieldMessage id={`${id}-channels-error`} error={errors.channels} />
        </div>
      ) : null}

      {broadcasters ? (
        broadcasters.length ? (
          <fieldset
            className="grid min-w-0 gap-1"
            disabled={disabled}
            aria-describedby={describedBy(
              errors.broadcasters && `${id}-broadcasters-error`
            )}
          >
            <legend className={LABEL}>{SERVICE_COPY.broadcasters}</legend>
            {broadcasters.map((b) => (
              <label key={b.code} className={ROW}>
                <input
                  type="checkbox"
                  className="size-5 shrink-0 accent-primary"
                  checked={value.broadcasters.includes(b.code)}
                  onChange={(e) =>
                    set({
                      broadcasters: e.currentTarget.checked
                        ? [...value.broadcasters, b.code]
                        : value.broadcasters.filter((c) => c !== b.code),
                    })
                  }
                />
                {b.label}
              </label>
            ))}
            <FieldMessage
              id={`${id}-broadcasters-error`}
              error={errors.broadcasters}
            />
          </fieldset>
        ) : (
          <p className="text-body-touch text-ink md:text-body">
            {SERVICE_COPY.noBroadcasters}
          </p>
        )
      ) : null}
    </div>
  )
}

/**
 * One fixture showing (§5.5): the fixture, its date and optional times. Who
 * committed is the account's, shown read-only.
 */
export function EventFields({
  id,
  value,
  onChange,
  committedBy,
  errors,
  disabled,
}: {
  id: string
  value: EventDraft
  onChange: (next: EventDraft) => void
  /** "You, as venue manager" or "You, as admin". */
  committedBy: string
  errors: Partial<Record<EventField, string>>
  disabled?: boolean
}) {
  const set = (patch: Partial<EventDraft>) => onChange({ ...value, ...patch })
  const overnight =
    value.start &&
    value.end &&
    value.end <= value.start &&
    value.end !== value.start
  return (
    <fieldset className="grid min-w-0 gap-4" disabled={disabled}>
      <legend className="sr-only">{EVENT_COPY.title}</legend>
      <div className="grid min-w-0 gap-1.5">
        <label htmlFor={`${id}-title`} className={LABEL}>
          {EVENT_COPY.title}
        </label>
        <input
          id={`${id}-title`}
          value={value.title}
          placeholder="⟨Fixture⟩"
          maxLength={EVENT_LIMITS.title}
          className={INPUT}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={describedBy(errors.title && `${id}-title-error`)}
          onChange={(e) => set({ title: e.currentTarget.value })}
        />
        <FieldMessage id={`${id}-title-error`} error={errors.title} />
      </div>
      <div className="grid min-w-0 gap-1.5">
        <label htmlFor={`${id}-date`} className={LABEL}>
          {EVENT_COPY.date}
        </label>
        <input
          id={`${id}-date`}
          type="date"
          value={value.localDate}
          className={INPUT}
          aria-invalid={errors.localDate ? true : undefined}
          aria-describedby={describedBy(errors.localDate && `${id}-date-error`)}
          onChange={(e) => set({ localDate: e.currentTarget.value })}
        />
        <FieldMessage id={`${id}-date-error`} error={errors.localDate} />
      </div>
      <div className="grid gap-3 min-[360px]:grid-cols-2">
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor={`${id}-start`} className={LABEL}>
            {EVENT_COPY.from}
          </label>
          <input
            id={`${id}-start`}
            type="time"
            value={value.start}
            className={INPUT}
            aria-invalid={errors.window ? true : undefined}
            aria-describedby={describedBy(
              errors.window && `${id}-window-error`
            )}
            onChange={(e) => set({ start: e.currentTarget.value })}
          />
        </div>
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor={`${id}-end`} className={LABEL}>
            {EVENT_COPY.to}
          </label>
          <input
            id={`${id}-end`}
            type="time"
            value={value.end}
            className={INPUT}
            aria-describedby={describedBy(
              overnight && `${id}-overnight`,
              errors.window && `${id}-window-error`
            )}
            onChange={(e) => set({ end: e.currentTarget.value })}
          />
        </div>
      </div>
      {overnight ? (
        <p id={`${id}-overnight`} className={MUTED}>
          {EVENT_COPY.endsNextDay}
        </p>
      ) : null}
      <FieldMessage id={`${id}-window-error`} error={errors.window} />
      <div className="grid min-w-0 gap-1">
        <p className={LABEL}>{EVENT_COPY.whoCommitted}</p>
        <p className="text-body-touch text-ink md:text-body">{committedBy}</p>
      </div>
    </fieldset>
  )
}
