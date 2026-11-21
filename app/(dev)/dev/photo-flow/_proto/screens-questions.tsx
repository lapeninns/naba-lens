"use client"

import Link from "next/link"
import { useId, useRef, useState } from "react"
import { CaretRightIcon } from "@phosphor-icons/react"

import { Notice } from "@/components/nabalens/notice"
import { StatusChip } from "@/components/nabalens/status-chip"
import { Button } from "@/components/ui/button"
import { LinkButton } from "@/components/ui/link-button"
import { SelectableTile } from "@/components/ui/selectable-tile"
import { Textarea } from "@/components/ui/textarea"

import {
  BASE,
  PhotoImage,
  Screen,
  TabBar,
  TopBar,
  Trail,
  altOf,
  dayWords,
  photosWord,
} from "./bits"
import { Missing } from "./screens-add"
import { type PhoneState } from "./store"
import {
  ANSWER_WORDS,
  MANAGER,
  saveDraft,
  sendAnswer,
  venueName,
  type AnswerValue,
  type Question,
  type World,
} from "./world"

type Props = { state: PhoneState; world: World }

/*
 * Venue questions: facts about the pub that only someone on site can check
 * (the real app's amenity checks). A list in Album, and one screen per
 * question: choose an answer, say what you found, attach a photo you have
 * already added, send. The dock says what sending will do before you do it.
 */

function stateChip(q: Question) {
  if (q.answer)
    return (
      <StatusChip tone="positive">{ANSWER_WORDS[q.answer.value]}</StatusChip>
    )
  if (q.draft)
    return <StatusChip tone="attention">Started, not sent</StatusChip>
  return <StatusChip tone="neutral">Not answered</StatusChip>
}

export function QuestionsList({ state, world }: Props) {
  const open = [...world.questions.filter((q) => !q.answer)].sort(
    (a, b) => Number(b.forYou) - Number(a.forYou)
  )
  const done = world.questions.filter((q) => q.answer)
  const row = (q: Question) => (
    <li key={q.id}>
      <Link
        href={`${BASE}/question/${q.id}`}
        data-question={q.id}
        className="flex min-h-16 items-start gap-3 rounded-card bg-surface p-3 shadow-card focus-ring hover:bg-raised"
      >
        <span className="grid min-w-0 flex-1 gap-1.5">
          <span className="text-heading">{q.text}</span>
          <span className="flex flex-wrap items-center gap-1.5">
            {stateChip(q)}
            {q.forYou && !q.answer ? (
              <span className="text-meta font-semibold">Given to you</span>
            ) : null}
            <span className="text-meta text-ink-muted">{q.group}</span>
          </span>
        </span>
        <CaretRightIcon
          aria-hidden
          weight="bold"
          className="mt-1 size-5 flex-none text-ink-muted"
        />
      </Link>
    </li>
  )
  return (
    <Screen>
      <div className="px-gutter pt-3">
        <Trail
          steps={[
            { name: "Album", href: `${BASE}/album` },
            { name: "Venue questions" },
          ]}
        />
      </div>
      <TopBar title="Venue questions">
        <p className="text-body text-ink-muted">
          Things guests ask about {venueName(world)}. Anyone on shift can answer
          one. {open.length} of {world.questions.length} still to answer.
        </p>
      </TopBar>
      <div className="grid gap-6 px-gutter pt-2">
        {open.length > 0 ? (
          <section aria-labelledby="to-answer" className="grid gap-3">
            <h2 id="to-answer" className="type-section-title">
              To answer
            </h2>
            <ul className="grid gap-2">{open.map(row)}</ul>
          </section>
        ) : null}
        {done.length > 0 ? (
          <section aria-labelledby="answered" className="grid gap-3">
            <h2 id="answered" className="type-section-title">
              Answered
            </h2>
            <ul className="grid gap-2">{done.map(row)}</ul>
          </section>
        ) : null}
      </div>
      <TabBar active="album" state={state} />
    </Screen>
  )
}

const OPTIONS: [AnswerValue, string][] = [
  ["yes", "True for guests today."],
  ["no", "Not true today."],
  ["na", "The question doesn’t fit this pub."],
  ["unknown", "You tried and couldn’t find out."],
]

export function QuestionScreen({ state, world, id }: Props & { id: string }) {
  const q = world.questions.find((item) => item.id === id)
  const [value, setValue] = useState<AnswerValue | null>(
    q?.draft?.value ?? null
  )
  const [found, setFound] = useState(q?.draft?.found ?? "")
  const [picked, setPicked] = useState<string[]>([])
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<"draft" | "sent" | null>(null)
  const resultRef = useRef<HTMLDivElement | null>(null)
  const group = useId()
  const foundId = useId()

  if (!q) return <Missing state={state} what="page" />
  const mine = state.photos.filter((p) => p.upload === "uploaded").slice(0, 6)
  const showForm = !q.answer || editing

  const send = () => {
    if (!value) return setError("Choose an answer first.")
    if (value === "yes" && q.needsPhoto && picked.length === 0)
      return setError("A Yes needs a photo. Tick one below, or add one first.")
    if (value !== "yes" && found.trim().length < 3)
      return setError("Say in a few words what you found.")
    setError(null)
    sendAnswer(q.id, { value, found: found.trim(), photoIds: picked })
    setEditing(false)
    setNote("sent")
    window.scrollTo({ top: 0 })
    requestAnimationFrame(() => resultRef.current?.focus())
  }

  return (
    <Screen foot={showForm ? "dock" : "tabs"}>
      <TopBar
        back={{ href: `${BASE}/album/questions`, label: "Venue questions" }}
        title={q.text}
      >
        <p className="text-body text-ink-muted">
          {q.group} · {venueName(world)}
        </p>
      </TopBar>
      <div className="grid gap-5 px-gutter pt-2">
        {note === "sent" && q.answer ? (
          <Notice
            ref={resultRef}
            tabIndex={-1}
            tone="positive"
            data-answer-sent=""
            title={`Answer sent: ${ANSWER_WORDS[q.answer.value]}`}
          >
            <div className="grid gap-3">
              <p>
                {MANAGER} confirms it before guests see it. You don’t need to do
                anything else.
              </p>
              <LinkButton
                href={`${BASE}/today`}
                size="sm"
                className="justify-self-start"
              >
                Back to Today
              </LinkButton>
            </div>
          </Notice>
        ) : null}
        {note === "draft" ? (
          <Notice
            tone="plain"
            role="status"
            data-draft-saved=""
            title="Saved for later"
          >
            Not sent yet. It stays on Today under Needs you until you send it.
          </Notice>
        ) : null}

        <section aria-labelledby="what" className="grid gap-1">
          <h2 id="what" className="text-heading">
            What to check
          </h2>
          <p className="text-body">{q.brief}</p>
          <p className="text-meta text-ink-muted">
            {q.needsPhoto
              ? "A Yes needs a photo. No photo is needed for the other answers."
              : "No photo is needed."}
          </p>
        </section>

        {q.answer && !editing ? (
          <section
            aria-labelledby="current"
            className="grid gap-2 rounded-card bg-surface p-4 shadow-card"
            data-current-answer=""
          >
            <h2 id="current" className="text-meta text-ink-muted">
              Current answer
            </h2>
            <p className="font-display text-title">
              {ANSWER_WORDS[q.answer.value]}
            </p>
            {q.answer.found ? (
              <p className="text-body">{q.answer.found}</p>
            ) : null}
            <p className="text-meta text-ink-muted">
              {q.answeredBy ? `From ${q.answeredBy}` : "From you"} ·{" "}
              {dayWords(q.answer.at)}
              {q.answer.photoIds.length > 0
                ? ` · ${photosWord(q.answer.photoIds.length)} attached`
                : ""}
            </p>
            <Button
              className="mt-1 justify-self-start"
              onClick={() => {
                setEditing(true)
                setValue(null)
                setFound("")
                setPicked([])
                setNote(null)
              }}
            >
              It’s different now
            </Button>
          </section>
        ) : null}

        {showForm ? (
          <>
            <fieldset
              className="grid gap-2"
              aria-describedby={error ? `${group}-e` : undefined}
            >
              <legend className="mb-1 text-heading">Your answer</legend>
              {OPTIONS.map(([option, hint]) => (
                <label
                  key={option}
                  className={
                    value === option
                      ? "flex min-h-14 cursor-pointer items-center gap-3 rounded-control bg-accent-soft px-4 py-2 edge-selected focus-ring-within"
                      : "flex min-h-14 cursor-pointer items-center gap-3 rounded-control bg-surface px-4 py-2 edge-strong focus-ring-within"
                  }
                >
                  <input
                    type="radio"
                    name={group}
                    value={option}
                    checked={value === option}
                    onChange={() => {
                      setValue(option)
                      setError(null)
                    }}
                    className="size-5 flex-none accent-(--select) outline-none"
                  />
                  <span className="grid gap-0.5">
                    <span className="text-heading">{ANSWER_WORDS[option]}</span>
                    <span className="text-meta text-ink-muted">{hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="grid gap-1.5">
              <label htmlFor={foundId} className="text-label">
                What you found
              </label>
              <Textarea
                id={foundId}
                rows={3}
                value={found}
                onChange={(event) => setFound(event.target.value)}
              />
              <p className="text-meta text-ink-muted">
                What a guest would find, in plain words. Needed unless the
                answer is Yes.
              </p>
            </div>

            <section aria-labelledby="evidence" className="grid gap-2">
              <h2 id="evidence" className="text-heading">
                Photo{" "}
                <span className="text-meta font-medium text-ink-muted">
                  {q.needsPhoto ? "needed for Yes" : "optional"}
                </span>
              </h2>
              {mine.length > 0 ? (
                <ul className="grid grid-cols-3 gap-2">
                  {mine.map((photo, index) => (
                    <li key={photo.id}>
                      <SelectableTile
                        label={`photo ${index + 1}: ${altOf(photo)}`}
                        checked={picked.includes(photo.id)}
                        onCheckedChange={(on) =>
                          setPicked((now) =>
                            on
                              ? [...now, photo.id]
                              : now.filter((x) => x !== photo.id)
                          )
                        }
                      >
                        <PhotoImage photo={photo} alt="" ratio="1/1" />
                      </SelectableTile>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-body text-ink-muted">
                  You haven’t added any photos yet.
                </p>
              )}
              <p className="text-meta text-ink-muted">
                Your six newest photos. To use a new one, add it first, then
                come back: your answer is kept.
              </p>
            </section>
          </>
        ) : null}
      </div>

      {showForm ? (
        <div
          data-dock=""
          className="fixed inset-x-0 bottom-0 z-dock mx-auto grid w-full max-w-feed gap-2 bg-surface px-gutter pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] shadow-bar"
        >
          {error ? (
            <p
              id={`${group}-e`}
              role="alert"
              className="text-label text-signal"
              data-answer-error=""
            >
              {error}
            </p>
          ) : (
            <p className="text-body text-ink-muted">
              {value
                ? `Sends “${ANSWER_WORDS[value]}” to ${MANAGER}, who confirms it.`
                : "Choose an answer. Your manager confirms it before guests see it."}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Button
              size="lg"
              className="w-full px-3"
              onClick={() => {
                saveDraft(q.id, { value, found })
                setNote("draft")
                window.scrollTo({ top: 0 })
              }}
            >
              Save for later
            </Button>
            <Button
              variant="primary"
              size="lg"
              className="w-full px-3"
              onClick={send}
            >
              Send answer
            </Button>
          </div>
        </div>
      ) : (
        <TabBar active="album" state={state} />
      )}
    </Screen>
  )
}
