"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import {
  ArrowUUpLeftIcon,
  CaretRightIcon,
  ChatTextIcon,
  ImagesIcon,
  MegaphoneIcon,
  QuestionIcon,
  TagIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"

import { Notice } from "@/components/nabalens/notice"
import { VenueBar } from "@/components/nabalens/venue-bar"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { LinkButton } from "@/components/ui/link-button"

import {
  BASE,
  PhotoImage,
  Screen,
  StageChip,
  TabBar,
  TopBar,
  dayWords,
  photosWord,
} from "./bits"
import { folderById } from "./catalogue"
import { failed, folderOf, unlabelled, type PhoneState } from "./store"
import {
  JOBS,
  VENUES,
  feedbackTitle,
  hasAlbum,
  openAsks,
  openRetakes,
  questionsToDo,
  setWorld,
  venueName,
  type World,
} from "./world"

/* ----------------------------------------------------------------- sign in */

/** Email, then the code from the email. The prototype sends nothing. */
export function SignIn({ world }: { world: World }) {
  const router = useRouter()
  const [email, setEmail] = useState(world.email)
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)

  const send = () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("Enter a full email address, like name@example.com.")
      return
    }
    setError(null)
    setSent(true)
  }
  const enter = () => {
    if (code.length !== 6) {
      setError("Enter the 6 numbers from the email.")
      return
    }
    setWorld({ signedIn: true, email: email.trim() })
    router.replace(world.welcomed ? `${BASE}/today` : `${BASE}/welcome`)
  }

  return (
    <Screen foot="none">
      <div className="grid gap-6 px-gutter pt-10">
        <p className="font-display text-title text-accent-text">Naba-Lens</p>
        {!sent ? (
          <form
            className="grid gap-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              send()
            }}
          >
            <h1
              data-screen-title=""
              tabIndex={-1}
              className="type-page-title outline-none"
            >
              Sign in
            </h1>
            <p className="text-body text-ink-muted">
              We’ll email you a link and a code. There’s no password.
            </p>
            <FormField label="Email" error={error ?? undefined}>
              {(control) => (
                <Input
                  {...control}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              )}
            </FormField>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full"
            >
              Send sign-in code
            </Button>
            <p className="text-meta text-ink-muted">
              Accounts are by invitation only.
            </p>
          </form>
        ) : (
          <form
            className="grid gap-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              enter()
            }}
          >
            <h1
              data-screen-title=""
              tabIndex={-1}
              className="type-page-title outline-none"
            >
              Check your email
            </h1>
            <p className="text-body text-ink-muted">
              If <span className="font-semibold text-ink">{email.trim()}</span>{" "}
              has an account, a code is on its way. It works once.
            </p>
            <FormField
              label="Sign-in code"
              description="Prototype: no email is sent. Any 6 numbers work."
              error={error ?? undefined}
            >
              {(control) => (
                <Input
                  {...control}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value.replace(/\D/g, ""))
                  }
                />
              )}
            </FormField>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full"
            >
              Sign in
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                setSent(false)
                setError(null)
              }}
            >
              Use a different email
            </Button>
          </form>
        )}
      </div>
    </Screen>
  )
}

/* ----------------------------------------------------------------- welcome */

/** First sign-in: what happens to a photo, and one question about the job. */
export function Welcome({ world }: { world: World }) {
  const router = useRouter()
  const [job, setJob] = useState(world.job)
  const venue = venueName(world)
  return (
    <Screen foot="none">
      <VenueBar name={venue} role="You’re staff here" />
      <TopBar title="Welcome">
        <p className="text-body text-ink-muted">
          Naba-Lens keeps the photos the team takes at work: dishes, drinks and
          the pub itself.
        </p>
      </TopBar>
      <div className="grid gap-6 px-gutter pt-2">
        <section
          aria-labelledby="how"
          className="grid gap-3 rounded-card bg-surface p-4 shadow-card"
        >
          <h2 id="how" className="text-heading">
            What happens to a photo
          </h2>
          <ol className="grid gap-3 text-body">
            <li>
              <span className="font-semibold">1. You add it.</span> Choose it
              from your phone’s gallery. It is kept on the phone, then uploaded.
            </li>
            <li>
              <span className="font-semibold">2. It is posted.</span> The team
              at {venue} can see it in the Album straight away. Guests can’t.
            </li>
            <li>
              <span className="font-semibold">3. You can label it.</span> Say
              which dish, drink or space it shows, now or later.
            </li>
            <li>
              <span className="font-semibold">4. A manager may reply.</span>{" "}
              They can thank you, ask for another photo, or take one down.
            </li>
          </ol>
        </section>
        <section aria-labelledby="used" className="grid gap-2">
          <h2 id="used" className="text-heading">
            How your photos are used
          </h2>
          <ul className="grid gap-2 text-body text-ink-muted">
            <li>
              Photos you add belong to Lapen Inns and may be used on our
              websites, menus and social media, once a manager has checked them.
            </li>
            <li>
              Your name stays on what you added, for credit. It is not shown to
              guests.
            </li>
          </ul>
        </section>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-heading">
            What do you mainly do at {venue}?
          </legend>
          <p className="text-body text-ink-muted">
            It only decides which dishes and spaces come first when you label.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {JOBS.map((option) => (
              <Button
                key={option}
                aria-pressed={job === option}
                onClick={() => setJob(option)}
                className="w-full px-3"
              >
                {option}
              </Button>
            ))}
          </div>
        </fieldset>
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          onClick={() => {
            setWorld({
              welcomed: true,
              job: job || "A bit of everything",
              name: world.name || "Sam (sample account)",
            })
            router.replace(`${BASE}/today`)
          }}
        >
          I understand, take me in
        </Button>
      </div>
    </Screen>
  )
}

/* ------------------------------------------------------------------- today */

function NeedRow({
  href,
  icon: Icon,
  title,
  detail,
  action,
  id,
}: {
  href: string
  icon: typeof TagIcon
  title: string
  detail: string
  /** What tapping does, in words, so nobody has to guess. */
  action: string
  id: string
}) {
  return (
    <li>
      <Link
        href={href}
        data-need={id}
        className="flex min-h-16 items-start gap-3 rounded-card bg-surface p-3 shadow-card focus-ring hover:bg-raised"
      >
        <Icon
          aria-hidden
          weight="bold"
          className="mt-0.5 size-5 flex-none text-warn-fg"
        />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-heading [overflow-wrap:anywhere]">{title}</span>
          <span className="text-body text-ink-muted">{detail}</span>
          <span className="text-label text-accent-text">{action}</span>
        </span>
        <CaretRightIcon
          aria-hidden
          weight="bold"
          className="mt-1 size-5 flex-none text-ink-muted"
        />
      </Link>
    </li>
  )
}

export function Today({ state, world }: { state: PhoneState; world: World }) {
  const venue = venueName(world)
  const album = hasAlbum(world)
  const retakes = album ? openRetakes(world, state) : []
  const asks = album ? openAsks(world, state) : []
  const didnt = failed(state)
  const loose = unlabelled(state).filter((p) => p.upload === "uploaded")
  const questions = album ? questionsToDo(world).filter((q) => q.forYou) : []
  const needs =
    retakes.length + asks.length + questions.length + (didnt.length ? 1 : 0)
  const recent = [...state.photos]
    .sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1))
    .slice(0, 4)
  const today = state.photos.filter(
    (p) => new Date(p.addedAt).toDateString() === new Date().toDateString()
  ).length

  return (
    <Screen>
      <VenueBar name={venue} role="You’re staff here" />
      <TopBar title="Today">
        <p className="text-body text-ink-muted" data-today-summary="">
          {needs === 0
            ? "Nothing is waiting for you."
            : needs === 1
              ? "1 thing needs you."
              : `${needs} things need you.`}
        </p>
      </TopBar>
      <div className="grid gap-6 px-gutter pt-2">
        {world.switched ? (
          <Notice
            tone="positive"
            title={`You’re now working at ${venue}`}
            data-switched=""
          >
            <div className="grid gap-2">
              <p>Photos you add from now go to this pub’s album.</p>
              {!album ? (
                <p>
                  The prototype only carries The Old Crown’s album, so this pub
                  has nothing to show.
                </p>
              ) : null}
              <Button
                variant="row-link"
                size="sm"
                className="min-w-11 justify-self-start"
                onClick={() => setWorld({ switched: false })}
              >
                Dismiss
              </Button>
            </div>
          </Notice>
        ) : null}

        {needs > 0 ? (
          <section aria-labelledby="needs-you" className="grid gap-3">
            <h2 id="needs-you" className="type-section-title">
              Needs you
            </h2>
            <ul className="grid gap-2">
              {didnt.length > 0 ? (
                <NeedRow
                  id="failed"
                  href={`${BASE}/my-photos`}
                  icon={WarningCircleIcon}
                  title={
                    didnt.length === 1
                      ? "1 photo didn’t upload"
                      : `${didnt.length} photos didn’t upload`
                  }
                  detail="Still on this phone. Nothing is sent twice."
                  action="Open My photos to retry"
                />
              ) : null}
              {retakes.map(({ feedback, folderId }) => (
                <NeedRow
                  key={feedback.id}
                  id={feedback.id}
                  href={`${BASE}/album/${folderId}`}
                  icon={ArrowUUpLeftIcon}
                  title={`${feedbackTitle("retake")}: ${folderById(folderId)?.name}`}
                  detail={feedback.note}
                  action="See the note, then add a photo"
                />
              ))}
              {asks.map((ask) => (
                <NeedRow
                  key={ask.id}
                  id={ask.id}
                  href={`${BASE}/album/${ask.folderId}`}
                  icon={MegaphoneIcon}
                  title={`Asked for: ${folderById(ask.folderId)?.name}`}
                  detail={`${ask.brief}${ask.neededBy ? ` Needed by ${dayWords(ask.neededBy)}.` : ""}`}
                  action="Open its folder"
                />
              ))}
              {questions.map((q) => (
                <NeedRow
                  key={q.id}
                  id={q.id}
                  href={`${BASE}/question/${q.id}`}
                  icon={QuestionIcon}
                  title={q.text}
                  detail={
                    q.draft
                      ? "You started this. It isn’t sent yet."
                      : "A question about the pub, given to you."
                  }
                  action={q.draft ? "Finish your answer" : "Answer it"}
                />
              ))}
            </ul>
          </section>
        ) : null}

        <section
          aria-labelledby="add-today"
          className="grid gap-3 rounded-card bg-surface p-4 shadow-card"
        >
          <h2 id="add-today" className="text-heading">
            {state.photos.length === 0
              ? "Add your first photos"
              : today > 0
                ? "Got more from today?"
                : "Got photos from today?"}
          </h2>
          <p className="text-body text-ink-muted">
            {today > 0
              ? `You’ve added ${photosWord(today)} today.`
              : "Dishes, drinks and corners of the pub you took on shift."}
          </p>
          <LinkButton
            href={`${BASE}/add`}
            variant="primary"
            size="lg"
            className="w-full"
          >
            <ImagesIcon aria-hidden weight="bold" />
            Add photos
          </LinkButton>
        </section>

        {loose.length > 0 ? (
          <Link
            href={`${BASE}/my-photos/unlabelled`}
            data-need="unlabelled"
            className="flex min-h-14 items-center gap-3 rounded-card bg-surface p-3 shadow-card focus-ring hover:bg-raised"
          >
            <TagIcon
              aria-hidden
              weight="bold"
              className="size-5 flex-none text-ink-muted"
            />
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="text-heading">
                {photosWord(loose.length)} without a label
              </span>
              <span className="text-meta text-ink-muted">
                Posted already. A label helps people find them.
              </span>
            </span>
            <CaretRightIcon
              aria-hidden
              weight="bold"
              className="size-5 flex-none text-ink-muted"
            />
          </Link>
        ) : null}

        <section aria-labelledby="recent" className="grid gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="recent" className="type-section-title">
              Your recent photos
            </h2>
            <Link
              href={`${BASE}/my-photos`}
              className="inline-flex min-h-11 min-w-11 items-center text-label text-accent-text underline underline-offset-3 focus-ring"
            >
              See all
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="text-body text-ink-muted">
              Photos you add at {VENUES[world.venue].name} will show here.
            </p>
          ) : (
            <ul className="grid gap-2">
              {recent.map((photo) => {
                const said = world.feedback.find((f) => f.photoId === photo.id)
                return (
                  <li key={photo.id}>
                    <Link
                      href={`${BASE}/photo/${photo.id}`}
                      className="flex min-h-14 items-center gap-3 rounded-card bg-surface p-2 shadow-card focus-ring hover:bg-raised"
                    >
                      <span className="w-14 flex-none">
                        <PhotoImage photo={photo} ratio="1/1" radius="square" />
                      </span>
                      <span className="grid min-w-0 flex-1 gap-1">
                        <span className="text-heading [overflow-wrap:anywhere]">
                          {folderOf(photo)?.name ?? "No label yet"}
                        </span>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <StageChip photo={photo} />
                          {said ? (
                            <span className="flex items-center gap-1 text-meta text-ink-muted">
                              <ChatTextIcon aria-hidden className="size-4" />
                              Manager replied
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
      <TabBar active="today" state={state} />
    </Screen>
  )
}
