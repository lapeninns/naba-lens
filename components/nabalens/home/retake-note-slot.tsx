"use client"

import Link from "next/link"
import { CameraIcon } from "@phosphor-icons/react"

import { useAdd } from "@/components/nabalens/shell/add-context"
import { StatusChip } from "@/components/nabalens/status-chip"
import { replacementHref } from "@/components/nabalens/tasks/needs-another-photo-list"
import {
  ReviewReason,
  submissionTitle,
} from "@/components/nabalens/tasks/submission-list"
import {
  action,
  cardClass,
  titleClass,
  TopRow,
} from "@/components/nabalens/tasks/todo-list"

import type { RetakeNote } from "./goals-home-model"

// TEMP copy (G-1): G-5 moves these into the copy files.
const COPY = {
  heading: "Needs another photo",
  asked: "A reviewer asked for another photo",
  reshoot: "Reshoot",
  reshootOf: (what: string) => `Reshoot ${what}`,
} as const

const dishName = (note: Extract<RetakeNote, { kind: "menu" }>) =>
  note.request.variantName
    ? `${note.request.itemName} (${note.request.variantName})`
    : note.request.itemName

/**
 * The retake note slot on goal-led Home (G-1 boundary; G-3 owns what goes
 * in it: the server read, Later, and when a note clears). It takes the open
 * notes as props. Each card names the dish or photo and the reviewer's
 * reason, never the reviewer, and has no date. `primaryKey` is the note whose
 * Reshoot is Home's one main action (decision 12).
 */
export function RetakeNoteSlot({
  notes,
  primaryKey = null,
  canSubmit,
  tasksPath,
  portfolioPath,
}: {
  notes: readonly RetakeNote[]
  primaryKey?: string | null
  /** The person can send photos now (venue and team set). */
  canSubmit: boolean
  tasksPath: string
  /** Me, where a menu note lives when Add isn't available. */
  portfolioPath: string
}) {
  const openAdd = useAdd()
  if (notes.length === 0) return null
  return (
    <section aria-labelledby="retake-notes-heading" className="grid gap-gutter">
      <h2
        id="retake-notes-heading"
        className="px-1 pt-2 type-section-title [overflow-wrap:anywhere] text-ink"
      >
        {COPY.heading}
      </h2>
      <ul className="grid gap-gutter">
        {notes.map((note) => {
          const primary = note.key === primaryKey
          if (note.kind === "menu") {
            const dish = dishName(note)
            const preset = {
              itemId: note.request.itemId,
              variantId: note.request.variantId,
              itemName: note.request.itemName,
              variantName: note.request.variantName,
            }
            return (
              <li key={note.key} className={cardClass(primary, "warn")}>
                <TopRow
                  kicker={<>For: {dish}</>}
                  chip={<StatusChip state="needs_another_photo" />}
                />
                <h3 className={titleClass(primary)}>{COPY.asked}</h3>
                <ReviewReason reason={note.request.reason} />
                {openAdd ? (
                  <button
                    type="button"
                    aria-label={COPY.reshootOf(dish)}
                    // openAdd clicks the camera input inside this handler.
                    onClick={() =>
                      openAdd({ source: "camera", imagesOnly: true, preset })
                    }
                    className={action(primary)}
                  >
                    <CameraIcon data-icon="inline-start" aria-hidden />
                    {COPY.reshoot}
                  </button>
                ) : (
                  <Link
                    href={`${portfolioPath}#better-heading`}
                    aria-label={COPY.reshootOf(dish)}
                    className={action(primary)}
                  >
                    <CameraIcon data-icon="inline-start" aria-hidden />
                    {COPY.reshoot}
                  </Link>
                )}
              </li>
            )
          }
          const title = submissionTitle(note.submission)
          return (
            <li key={note.key} className={cardClass(primary, "warn")}>
              <TopRow
                kicker={<>For: {title}</>}
                chip={<StatusChip state="needs_another_photo" />}
              />
              <h3 className={titleClass(primary)}>{COPY.asked}</h3>
              <ReviewReason reason={note.submission.decision?.reason ?? null} />
              {canSubmit ? (
                <Link
                  href={replacementHref(tasksPath, note.submission)}
                  aria-label={COPY.reshootOf(title)}
                  className={action(primary)}
                >
                  <CameraIcon data-icon="inline-start" aria-hidden />
                  {COPY.reshoot}
                </Link>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
