"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { OptionSelect } from "@/components/nabalens/option-select"
import { Notice } from "@/components/nabalens/notice"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionRow } from "@/components/ui/option-row"
import { packageHref, type ExportArea } from "@/lib/server/exports/hrefs"
import type {
  ExportProfile,
  PublicationDestination,
} from "@/lib/server/exports/model"

import {
  rebuildPackageAction,
  recordPublicationAction,
  saveDestinationAction,
  setProfileAction,
} from "../actions"
import { EXPORTS_COPY } from "./copy"

/*
 * The small forms on the Publishing screens. Each keeps what the person typed
 * when the server refuses (DESIGN.md §6.7) and shows the reason beside the
 * button; there are no toasts. Every request carries one key per intent, so
 * a retry after a lost answer replays rather than repeats.
 */

const newKey = () =>
  `pub-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now())}`

function Failure({ message }: { message: string | null }) {
  return message ? (
    <Notice tone="negative" role="alert">
      {message}
    </Notice>
  ) : null
}

export function RebuildButton({
  area,
  packageId,
  primary,
}: {
  area: ExportArea
  packageId: string
  primary: boolean
}) {
  const router = useRouter()
  const key = useRef(newKey())
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  return (
    <div className="grid gap-2">
      <Button
        type="button"
        variant={primary ? "primary" : "secondary"}
        aria-busy={pending || undefined}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null)
            const r = await rebuildPackageAction({
              requestKey: key.current,
              packageId,
            })
            if (!r.ok) return setError(r.message)
            router.push(packageHref(area, r.packageId))
          })
        }
      >
        {EXPORTS_COPY.rebuild}
      </Button>
      <Failure message={error} />
    </div>
  )
}

/** Record that one photo is published at a destination (admins). */
export function RecordPublishedForm({
  assetId,
  packageId,
  destinations,
  today,
}: {
  assetId: string
  packageId: string
  destinations: PublicationDestination[]
  today: string
}) {
  const router = useRouter()
  const usable = destinations.filter((d) => d.active)
  const [destination, setDestination] = useState<string | null>(
    usable.length === 1 ? usable[0]!.id : null
  )
  const [url, setUrl] = useState("")
  const [ref, setRef] = useState("")
  const [on, setOn] = useState(today)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [pending, start] = useTransition()
  const key = useRef(newKey())
  if (usable.length === 0) {
    return (
      <p className="text-meta text-ink-muted">
        Add a destination on the Publishing page to record where this is used.
      </p>
    )
  }
  if (done) {
    return (
      <p role="status" className="text-body text-ink">
        Recorded as Published.
      </p>
    )
  }
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          setError(null)
          const r = await recordPublicationAction({
            requestKey: key.current,
            destinationId: destination,
            assetId,
            action: "published",
            occurredOn: on,
            externalUrl: url,
            externalRef: ref,
            packageId,
          })
          if (!r.ok) {
            key.current = newKey()
            return setError(r.message)
          }
          setDone(true)
          router.refresh()
        })
      }}
    >
      <FormField label="Where">
        {(control) => (
          <OptionSelect
            id={control.id}
            aria-describedby={control["aria-describedby"]}
            options={usable.map((d) => ({
              id: d.id,
              name: d.venueName ? `${d.label} (${d.venueName})` : d.label,
            }))}
            value={destination}
            onValueChange={setDestination}
            placeholder="Choose a destination"
          />
        )}
      </FormField>
      <FormField
        label="Page address"
        optional
        description="Or give a reference below."
      >
        <Input
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </FormField>
      <FormField
        label="Reference"
        optional
        description="For example a post title."
      >
        <Input
          value={ref}
          maxLength={200}
          onChange={(e) => setRef(e.target.value)}
        />
      </FormField>
      <FormField label="Date it went up">
        <Input
          type="date"
          value={on}
          max={today}
          onChange={(e) => setOn(e.target.value)}
        />
      </FormField>
      <Failure message={error} />
      <Button
        type="submit"
        variant="secondary"
        disabled={pending || !destination}
        aria-busy={pending || undefined}
      >
        Record as Published
      </Button>
    </form>
  )
}

/** Confirm a Withdrawal pending (or failed) photo is gone from a destination. */
export function ConfirmRemovedForm({
  destinationId,
  assetId,
  today,
}: {
  destinationId: string
  assetId: string
  today: string
}) {
  const router = useRouter()
  const [on, setOn] = useState(today)
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const key = useRef(newKey())
  return (
    <form
      className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          setError(null)
          const r = await recordPublicationAction({
            requestKey: key.current,
            destinationId,
            assetId,
            action: "withdrawn",
            occurredOn: on,
            note,
          })
          if (!r.ok) {
            key.current = newKey()
            return setError(r.message)
          }
          router.refresh()
        })
      }}
    >
      <FormField label="Taken down on">
        <Input
          type="date"
          value={on}
          max={today}
          onChange={(e) => setOn(e.target.value)}
        />
      </FormField>
      <FormField label={EXPORTS_COPY.removedNote} optional>
        <Input
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
        />
      </FormField>
      <Button
        type="submit"
        variant="secondary"
        disabled={pending}
        aria-busy={pending || undefined}
      >
        {EXPORTS_COPY.confirmRemoved}
      </Button>
      <div className="sm:col-span-3">
        <Failure message={error} />
      </div>
    </form>
  )
}

/** Add a destination, or change one's name, address and switch (admins). */
export function DestinationForm({
  venues,
  destination,
}: {
  venues: { id: string; name: string }[]
  destination?: PublicationDestination
}) {
  const router = useRouter()
  const [venue, setVenue] = useState<string | null>(
    destination?.venueId ?? null
  )
  const [label, setLabel] = useState(destination?.label ?? "")
  const [url, setUrl] = useState(destination?.url ?? "")
  const [active, setActive] = useState(destination?.active ?? true)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const editing = Boolean(destination)
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          setError(null)
          const r = await saveDestinationAction({
            destinationId: destination?.id ?? null,
            venueId: venue,
            label,
            url,
            active,
            revision: destination?.revision ?? null,
          })
          if (!r.ok) return setError(r.message)
          if (!editing) {
            setLabel("")
            setUrl("")
          }
          router.refresh()
        })
      }}
    >
      {editing ? null : (
        <FormField label="Venue" description="Or every venue.">
          {(control) => (
            <OptionSelect
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              options={venues}
              value={venue}
              onValueChange={setVenue}
              emptyLabel="Every venue"
            />
          )}
        </FormField>
      )}
      <FormField
        label="Name"
        description="For example: The Bell website, gallery page."
      >
        <Input
          value={label}
          maxLength={120}
          onChange={(e) => setLabel(e.target.value)}
        />
      </FormField>
      <FormField label="Address" optional>
        <Input
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </FormField>
      <OptionRow
        type="checkbox"
        size="sm"
        label="In use"
        hint="Switched off, it takes no new Published records; removals can still be confirmed."
        checked={active}
        onCheckedChange={(v) => setActive(v === true)}
      />
      <Failure message={error} />
      <Button
        type="submit"
        variant="secondary"
        disabled={pending || !label.trim()}
        aria-busy={pending || undefined}
      >
        {editing ? "Save destination" : "Add destination"}
      </Button>
    </form>
  )
}

/** Change one output size preset (admins). */
export function ProfileForm({ profile }: { profile: ExportProfile }) {
  const router = useRouter()
  const [label, setLabel] = useState(profile.label)
  const [format, setFormat] = useState<string | null>(profile.format)
  const [w, setW] = useState(profile.maxWidth?.toString() ?? "")
  const [h, setH] = useState(profile.maxHeight?.toString() ?? "")
  const [q, setQ] = useState(profile.quality?.toString() ?? "")
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, start] = useTransition()
  const original = profile.key === "original"
  const sized = profile.key === "website" || profile.key === "social"
  const digits = (v: string) => v.replace(/\D/g, "")
  return (
    // A column, not a grid: a short card (Original) beside a tall one keeps
    // its rows at their own height and its Save button at the foot.
    <form
      className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          setError(null)
          setSaved(false)
          const r = await setProfileAction({
            key: profile.key,
            label,
            format,
            maxWidth: sized ? w : null,
            maxHeight: sized ? h : null,
            quality: original ? null : q,
            revision: profile.revision,
          })
          if (!r.ok) return setError(r.message)
          setSaved(true)
          router.refresh()
        })
      }}
    >
      <h3 className="text-label text-ink">{profile.label}</h3>
      <FormField label="Name">
        <Input
          value={label}
          maxLength={60}
          onChange={(e) => setLabel(e.target.value)}
        />
      </FormField>
      {original ? (
        <p className="text-meta text-ink-muted">
          The unchanged file. Only its name can change.
        </p>
      ) : (
        <>
          <FormField label="Format">
            {(control) => (
              <OptionSelect
                id={control.id}
                options={[
                  { id: "webp", name: "WebP" },
                  { id: "jpeg", name: "JPEG" },
                ]}
                value={format}
                onValueChange={setFormat}
              />
            )}
          </FormField>
          {sized ? (
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Width">
                <Input
                  inputMode="numeric"
                  value={w}
                  onChange={(e) => setW(digits(e.target.value))}
                />
              </FormField>
              <FormField label="Height">
                <Input
                  inputMode="numeric"
                  value={h}
                  onChange={(e) => setH(digits(e.target.value))}
                />
              </FormField>
            </div>
          ) : (
            <p className="text-meta text-ink-muted">
              The size is chosen for each package.
            </p>
          )}
          <FormField label="Quality" description="40 to 100">
            <Input
              inputMode="numeric"
              value={q}
              onChange={(e) => setQ(digits(e.target.value))}
            />
          </FormField>
        </>
      )}
      <Failure message={error} />
      {saved ? (
        <p role="status" className="text-meta text-ink">
          Saved.
        </p>
      ) : null}
      <Button
        type="submit"
        variant="secondary"
        size="sm"
        className="mt-auto"
        disabled={pending}
        aria-busy={pending || undefined}
      >
        Save {profile.label}
      </Button>
    </form>
  )
}
