"use client"

import * as React from "react"

import {
  loadAreaLabelsAction,
  setAreaLabelAction,
} from "@/app/_labels/area-actions"
import { Notice } from "@/components/nabalens/notice"
import { OptionSelect } from "@/components/nabalens/option-select"
import { StatusChip } from "@/components/nabalens/status-chip"
import { FormField } from "@/components/ui/field"

import { AREA_COPY } from "./copy"

type Place = { subjectId: string; label: string }
type Current = { subjectId: string; state: string; reason: string | null }

/**
 * G-9: the "Venue area" choice beside the dish and drink labels, for a photo
 * that is not a dish or a drink (the bar set-up, the garden, the toilets).
 * The places are the venue's own (B03 venue knowledge). The choice applies
 * to every photo in `assetIds` and is saved straight away, also on photos
 * that arrive later in the same sheet (their asset is reserved later).
 * Staff only; the database checks that each photo is the caller's own.
 */
export function AreaLabelField({
  assetIds,
  waitingCount = 0,
}: {
  /** The reserved photos (images only) the choice applies to. */
  assetIds: readonly string[]
  /** Photos not reserved yet: the choice waits for them. */
  waitingCount?: number
}) {
  const [places, setPlaces] = React.useState<Place[] | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [offered, setOffered] = React.useState(true)
  const [choice, setChoice] = React.useState<string | null>(null)
  const [current, setCurrent] = React.useState<Current | null>(null)
  // What each photo has on the server ("" = no area), as far as we know.
  const saved = React.useRef(new Map<string, string>())
  const [status, setStatus] = React.useState<
    "idle" | "saving" | "saved" | "error"
  >("idle")
  // Requests sent and not answered yet, by photo: the choice they carry.
  const sending = React.useRef(new Map<string, string>())
  const idsKey = [...new Set(assetIds)].join(",")
  const firstIds = React.useRef(idsKey)

  // Load the places once, with the area of the photos known at that point.
  React.useEffect(() => {
    let live = true
    const ids = firstIds.current ? firstIds.current.split(",") : []
    void loadAreaLabelsAction(ids.slice(0, 100))
      .then((result) => {
        if (!live) return
        if (!result.ok) {
          setFailed(true)
          return
        }
        if (!result.offered) {
          setOffered(false)
          return
        }
        setPlaces(
          result.places.map((p) => ({ subjectId: p.subjectId, label: p.label }))
        )
        for (const l of result.labels) saved.current.set(l.assetId, l.subjectId)
        const first = result.labels[0]
        if (first) {
          setChoice(first.subjectId)
          if (ids.length === 1)
            setCurrent({
              subjectId: first.subjectId,
              state: first.state,
              reason: first.reason,
            })
        }
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [])

  // Every reserved photo carries the current choice. One request at a time
  // per photo and choice; the latest choice wins once each answer is in.
  const [round, setRound] = React.useState(0)
  React.useEffect(() => {
    if (!places) return
    const ids = idsKey ? idsKey.split(",") : []
    const want = choice ?? ""
    const todo = ids.filter(
      (id) => (saved.current.get(id) ?? "") !== want && !sending.current.has(id)
    )
    if (todo.length === 0) return
    setStatus("saving")
    for (const id of todo) sending.current.set(id, want)
    void Promise.all(
      todo.map(async (id) => {
        try {
          const result = await setAreaLabelAction(id, want || null)
          if (result.ok) saved.current.set(id, want)
          return result.ok
        } catch {
          return false
        } finally {
          sending.current.delete(id)
        }
      })
    ).then((all) => {
      const done = all.every(Boolean)
      setStatus(done ? "saved" : "error")
      if (done && ids.length === 1)
        setCurrent(
          want ? { subjectId: want, state: "pending", reason: null } : null
        )
      // A choice changed meanwhile: go round again.
      if (done) setRound((n) => n + 1)
    })
  }, [places, choice, idsKey, round])

  if (!offered) return null
  if (failed)
    return (
      <Notice tone="plain" role="none">
        {AREA_COPY.loadFailed}
      </Notice>
    )
  if (!places) return null
  if (places.length === 0)
    return <p className="text-meta text-ink-muted">{AREA_COPY.noPlaces}</p>

  const options = places.map((p) => ({ id: p.subjectId, name: p.label }))
  return (
    <div className="grid gap-2">
      <FormField
        label={AREA_COPY.fieldLabel}
        optional
        description={AREA_COPY.fieldHint}
        error={status === "error" ? AREA_COPY.saveFailed : undefined}
        announce="polite"
      >
        <OptionSelect
          options={options}
          value={choice}
          onValueChange={(value) => setChoice(value)}
          emptyLabel={AREA_COPY.none}
          placeholder={AREA_COPY.none}
        />
      </FormField>
      <p className="text-meta text-ink-muted" aria-live="polite">
        {status === "saving" || (choice && waitingCount > 0)
          ? AREA_COPY.saving
          : status === "saved"
            ? AREA_COPY.saved
            : ""}
      </p>
      {current && current.subjectId === choice ? (
        <div className="grid gap-1">
          <StatusChip
            state={current.state === "pending" ? "submitted" : current.state}
          >
            {AREA_COPY.state[current.state as keyof typeof AREA_COPY.state] ??
              undefined}
          </StatusChip>
          {current.reason ? (
            <p className="text-meta text-ink-muted">{current.reason}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
