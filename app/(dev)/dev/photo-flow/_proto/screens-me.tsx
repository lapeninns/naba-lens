"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { CaretRightIcon } from "@phosphor-icons/react"

import { Notice } from "@/components/nabalens/notice"
import { StatusChip } from "@/components/nabalens/status-chip"
import { ThemeSetting } from "@/components/nabalens/theme-setting"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { LinkButton } from "@/components/ui/link-button"

import {
  BASE,
  PhotoImage,
  Screen,
  TabBar,
  TopBar,
  dayWords,
  photosWord,
} from "./bits"
import { folderById } from "./catalogue"
import { PhotoGrid } from "./screens-photos"
import { failed, type PhoneState } from "./store"
import {
  COLLEAGUES,
  COLLEAGUE_POSTS,
  JOBS,
  MANAGER,
  VENUES,
  hasAlbum,
  markRead,
  monthOf,
  notices,
  questionsToDo,
  setWorld,
  venueName,
  type World,
} from "./world"

type Props = { state: PhoneState; world: World }

function RowLink({
  href,
  title,
  detail,
  id,
}: {
  href: string
  title: string
  detail: string
  id?: string
}) {
  return (
    <li>
      <Link
        href={href}
        data-row={id}
        className="flex min-h-14 items-center gap-3 rounded-card bg-surface p-3 shadow-card focus-ring hover:bg-raised"
      >
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-heading">{title}</span>
          <span className="text-meta text-ink-muted">{detail}</span>
        </span>
        <CaretRightIcon
          aria-hidden
          weight="bold"
          className="size-5 flex-none text-ink-muted"
        />
      </Link>
    </li>
  )
}

/* ---------------------------------------------------------------------- me */

export function Me({ state, world }: Props) {
  const unread = notices(world, state, BASE).filter((n) => n.unread).length
  const month = monthOf(world, state)
  const toDo = hasAlbum(world) ? questionsToDo(world).length : 0
  return (
    <Screen>
      <TopBar title="Me">
        <p className="text-body">
          <span className="font-semibold">{world.name}</span>
          <span className="block text-ink-muted">
            {world.job} · {venueName(world)}
          </span>
        </p>
      </TopBar>
      <div className="grid gap-6 px-gutter pt-2">
        <ul className="grid gap-2">
          <RowLink
            id="notices"
            href={`${BASE}/me/notices`}
            title="Notices"
            detail={
              unread > 0
                ? `${unread} new`
                : "Replies from your manager and things asked of you"
            }
          />
          <RowLink
            id="month"
            href={`${BASE}/me/month`}
            title="Your month"
            detail={
              month.target
                ? `${month.posted} of ${month.target} photos posted in ${month.label.split(" ")[0]}`
                : `${photosWord(month.posted)} posted this month`
            }
          />
          <RowLink
            id="questions"
            href={`${BASE}/album/questions`}
            title="Venue questions"
            detail={toDo > 0 ? `${toDo} still to answer` : "All answered"}
          />
        </ul>
        <section aria-labelledby="your-pub" className="grid gap-3">
          <h2 id="your-pub" className="type-section-title">
            Your pub
          </h2>
          <ul className="grid gap-2">
            <RowLink
              id="team"
              href={`${BASE}/me/team`}
              title="The team"
              detail="Colleagues at this pub and what they’ve posted"
            />
          </ul>
        </section>
        <section aria-labelledby="you" className="grid gap-3">
          <h2 id="you" className="type-section-title">
            You
          </h2>
          <ul className="grid gap-2">
            <RowLink
              id="settings"
              href={`${BASE}/me/settings`}
              title="Settings"
              detail="Your name, your job, your pubs, light or dark, sign out"
            />
            <RowLink
              id="help"
              href={`${BASE}/me/help`}
              title="Help"
              detail="How it works, the photo guide, who to ask"
            />
          </ul>
        </section>
      </div>
      <TabBar active="me" state={state} />
    </Screen>
  )
}

/* ----------------------------------------------------------------- notices */

export function Notices({ state, world }: Props) {
  const list = notices(world, state, BASE)
  const unread = list.filter((n) => n.unread)
  const tell = world.tell
  const toggle = (key: keyof World["tell"]) =>
    setWorld({ tell: { ...tell, [key]: !tell[key] } })
  return (
    <Screen>
      <TopBar back={{ href: `${BASE}/me`, label: "Me" }} title="Notices">
        <p className="text-body text-ink-muted" data-notice-summary="">
          {list.length === 0
            ? "No notices. Replies from your manager show here."
            : unread.length === 0
              ? "You’ve read them all."
              : `${unread.length} new. Opening one marks it as read.`}
        </p>
      </TopBar>
      <div className="grid gap-6 px-gutter pt-2">
        <ul className="grid gap-2">
          {list.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                data-notice={item.id}
                data-unread={item.unread ? "" : undefined}
                onClick={() => markRead([item.id])}
                className="flex min-h-16 items-start gap-3 rounded-card bg-surface p-3 shadow-card focus-ring hover:bg-raised"
              >
                <span className="grid min-w-0 flex-1 gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-heading [overflow-wrap:anywhere]">
                      {item.title}
                    </span>
                    {item.unread ? (
                      <StatusChip tone="attention">New</StatusChip>
                    ) : null}
                  </span>
                  <span className="text-body text-ink-muted">
                    {item.detail}
                  </span>
                  <span className="text-meta text-ink-muted">
                    {dayWords(item.at)}
                  </span>
                </span>
                <CaretRightIcon
                  aria-hidden
                  weight="bold"
                  className="mt-1 size-5 flex-none text-ink-muted"
                />
              </Link>
            </li>
          ))}
        </ul>
        {unread.length > 1 ? (
          <Button onClick={() => markRead(list.map((n) => n.id))}>
            Mark all as read
          </Button>
        ) : null}
        <fieldset className="grid gap-2">
          <legend className="mb-1 type-section-title">
            What to tell you about
          </legend>
          <p className="text-body text-ink-muted">
            Notices show here and as a number on Me. Never as pop-ups.
          </p>
          {(
            [
              ["retakes", "When a manager asks for another photo"],
              ["questions", "When a venue question is given to you"],
              ["failed", "When a photo doesn’t upload"],
            ] as const
          ).map(([key, label]) => (
            <Button
              key={key}
              aria-pressed={tell[key]}
              onClick={() => toggle(key)}
              className="w-full justify-start px-4 text-left"
            >
              {label}
            </Button>
          ))}
        </fieldset>
      </div>
      <TabBar active="me" state={state} />
    </Screen>
  )
}

/* ------------------------------------------------------------------- month */

export function YourMonth({ state, world }: Props) {
  const month = monthOf(world, state)
  const didnt = failed(state).length
  const rows: [string, number, string][] = [
    ["Posted", month.posted, "In the Album now"],
    ["With a label", month.labelled, "Easy to find by dish, drink or space"],
    [
      "Another photo requested",
      month.retakes,
      "A manager asked you to try again",
    ],
    ["Didn’t upload", didnt, "Still on this phone; not counted"],
  ]
  return (
    <Screen>
      <TopBar back={{ href: `${BASE}/me`, label: "Me" }} title="Your month">
        <p className="text-body text-ink-muted">
          {month.label} at {venueName(world)}. Only you and your manager see
          this.
        </p>
      </TopBar>
      <div className="grid gap-6 px-gutter pt-2">
        <section
          className="grid gap-3 rounded-card bg-surface p-4 shadow-card"
          data-month=""
        >
          <p className="flex items-baseline gap-2">
            <span className="type-figure font-display">{month.posted}</span>
            <span className="text-body">
              {month.target
                ? `of ${month.target} photos posted`
                : "photos posted this month"}
            </span>
          </p>
          {month.target ? (
            <>
              <div
                role="img"
                aria-label={`${month.posted} of ${month.target} posted`}
                className="flex gap-1"
              >
                {Array.from({ length: month.target }, (_, i) => (
                  <span
                    key={i}
                    className={
                      i < month.posted
                        ? "h-2.5 flex-1 rounded-round bg-ok-fg"
                        : "h-2.5 flex-1 rounded-round bg-surface-2 edge"
                    }
                  />
                ))}
              </div>
              <p className="text-body text-ink-muted">
                {month.toGo === 0
                  ? "Target met. Photos you add now are still posted."
                  : `${month.toGo} to go. Your manager set this target.`}
              </p>
            </>
          ) : (
            <p className="text-body text-ink-muted">
              There’s no target for you this month.
            </p>
          )}
        </section>
        <section aria-labelledby="working" className="grid gap-2">
          <h2 id="working" className="type-section-title">
            How that adds up
          </h2>
          <dl className="grid gap-2">
            {rows.map(([term, count, hint]) => (
              <div
                key={term}
                className="flex items-center gap-3 rounded-card bg-surface p-3 shadow-card"
              >
                <dd className="w-10 flex-none text-center type-figure font-display">
                  {count}
                </dd>
                <dt className="grid min-w-0 gap-0.5">
                  <span className="text-heading">{term}</span>
                  <span className="text-meta text-ink-muted">{hint}</span>
                </dt>
              </div>
            ))}
          </dl>
        </section>
        <LinkButton
          href={`${BASE}/add`}
          variant="primary"
          size="lg"
          className="w-full"
        >
          Add photos
        </LinkButton>
      </div>
      <TabBar active="me" state={state} />
    </Screen>
  )
}

/* ---------------------------------------------------------------- settings */

export function Settings({ state, world }: Props) {
  const router = useRouter()
  const [name, setName] = useState(world.name)
  const [saved, setSaved] = useState(false)
  const [target, setTarget] = useState<number | null>(null)
  const [leaving, setLeaving] = useState(false)
  const unsent = state.photos.filter((p) => p.upload !== "uploaded").length
  const other = VENUES.map((venue, index) => ({ venue, index })).filter(
    ({ index }) => index !== world.venue
  )
  return (
    <Screen>
      <TopBar back={{ href: `${BASE}/me`, label: "Me" }} title="Settings" />
      <div className="grid gap-8 px-gutter pt-2">
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (name.trim().length < 2) return
            setWorld({ name: name.trim() })
            setSaved(true)
          }}
        >
          <h2 className="type-section-title">You</h2>
          <FormField
            label="Your name"
            description="Shown beside the photos you add. Guests never see it."
            error={
              name.trim().length < 2
                ? "Enter the name colleagues know you by."
                : undefined
            }
          >
            {(control) => (
              <Input
                {...control}
                autoComplete="name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  setSaved(false)
                }}
              />
            )}
          </FormField>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-label">What you mainly do</legend>
            <div className="grid grid-cols-2 gap-2">
              {JOBS.map((job) => (
                <Button
                  key={job}
                  aria-pressed={world.job === job}
                  onClick={() => setWorld({ job })}
                  className="w-full px-3"
                >
                  {job}
                </Button>
              ))}
            </div>
          </fieldset>
          <Button type="submit" className="justify-self-start">
            Save name
          </Button>
          {saved ? (
            <p
              role="status"
              className="text-label text-ok-fg"
              data-name-saved=""
            >
              Name saved.
            </p>
          ) : null}
        </form>

        <section aria-labelledby="pubs" className="grid gap-3">
          <h2 id="pubs" className="type-section-title">
            Your pubs
          </h2>
          <p className="text-body" data-working-at="">
            Working at <span className="font-semibold">{venueName(world)}</span>{" "}
            · {VENUES[world.venue].role}
          </p>
          {other.map(({ venue, index }) => (
            <Button key={venue.name} onClick={() => setTarget(index)}>
              Work at {venue.name}
            </Button>
          ))}
        </section>

        <ThemeSetting />

        <section aria-labelledby="home-screen" className="grid gap-2">
          <h2 id="home-screen" className="type-section-title">
            Add to your home screen
          </h2>
          <p className="text-body text-ink-muted">
            Open Naba-Lens like an app. On iPhone, in Safari: tap Share, then
            Add to Home Screen, then Add. On Android, in Chrome: tap the menu,
            then Add to Home screen.
          </p>
        </section>

        <Button variant="danger" onClick={() => setLeaving(true)}>
          Sign out
        </Button>
      </div>

      <Dialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
      >
        <DialogContent size="sm" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="pr-0">
              Work at {target !== null ? VENUES[target].name : ""}?
            </DialogTitle>
            <DialogDescription>
              Photos you add from now go to that pub’s album. Photos you already
              added stay at {venueName(world)}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="secondary" />}>
              Stay here
            </DialogClose>
            <Button
              variant="primary"
              onClick={() => {
                if (target === null) return
                setWorld({ venue: target, switched: true })
                setTarget(null)
                router.push(`${BASE}/today`)
              }}
            >
              Change pub
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={leaving} onOpenChange={setLeaving}>
        <DialogContent size="sm" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="pr-0">Sign out?</DialogTitle>
            <DialogDescription>
              {unsent > 0
                ? `${photosWord(unsent)} ${unsent === 1 ? "hasn’t" : "haven’t"} uploaded yet. ${unsent === 1 ? "It stays" : "They stay"} on this phone and upload when you sign in again.`
                : "Everything you added has uploaded. Nothing is lost."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="secondary" />}>
              Stay signed in
            </DialogClose>
            <Button
              variant="danger"
              onClick={() => {
                setWorld({ signedIn: false })
                router.replace(`${BASE}/sign-in`)
              }}
            >
              Sign out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <TabBar active="me" state={state} />
    </Screen>
  )
}

/* -------------------------------------------------------------------- help */

const EVERY_SHOT = [
  "Plain background. Nothing else on the table.",
  "The dish fills most of the frame.",
  "Hold your phone sideways.",
  "Wipe the rim; add the garnish last.",
  "Shoot straight after plating, before it goes out.",
  "No flash.",
]

export function Help({ state, world }: Props) {
  return (
    <Screen>
      <TopBar back={{ href: `${BASE}/me`, label: "Me" }} title="Help" />
      <div className="grid gap-8 px-gutter pt-2">
        <ul className="grid gap-2">
          <RowLink
            href={`${BASE}/welcome`}
            title="How Naba-Lens works"
            detail="What happens to a photo, and how photos are used"
          />
        </ul>
        <section aria-labelledby="guide" className="grid gap-3">
          <h2 id="guide" className="type-section-title">
            Photographing a dish
          </h2>
          <ul className="grid list-disc gap-1.5 pl-5 text-body">
            {EVERY_SHOT.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <Notice tone="attention" title="Only when it’s safe">
            Never while carrying hot food or using a knife.
          </Notice>
        </section>
        <section aria-labelledby="cant" className="grid gap-2">
          <h2 id="cant" className="type-section-title">
            If a photo won’t add
          </h2>
          <ul className="grid list-disc gap-1.5 pl-5 text-body">
            <li>
              Allow Naba-Lens to see your photos in your phone’s settings.
            </li>
            <li>JPEG, PNG, WebP and HEIC photos work. Screenshots are fine.</li>
            <li>
              If it says Didn’t upload, the photo is still on this phone. Open
              My photos and tap Retry.
            </li>
          </ul>
        </section>
        <section aria-labelledby="ask" className="grid gap-2">
          <h2 id="ask" className="type-section-title">
            Who to ask
          </h2>
          <p className="text-body">
            <span className="font-semibold">{MANAGER}</span> manages photos at{" "}
            {venueName(world)}. Ask them in person about a photo or your
            account.
          </p>
          <p className="text-body text-ink-muted">
            If a dish or space has changed, open its folder in Album and use
            Report a change. It reaches them without a conversation.
          </p>
        </section>
      </div>
      <TabBar active="me" state={state} />
    </Screen>
  )
}

/* -------------------------------------------------------------------- team */

export function Team({ state, world }: Props) {
  if (!hasAlbum(world))
    return <NoAlbum state={state} world={world} title="The team" />
  return (
    <Screen>
      <TopBar back={{ href: `${BASE}/me`, label: "Me" }} title="The team">
        <p className="text-body text-ink-muted">
          People at {venueName(world)}, A to Z.
        </p>
      </TopBar>
      <ul className="grid gap-2 px-gutter pt-2">
        {COLLEAGUES.map((person) => {
          const posts = COLLEAGUE_POSTS.filter((p) => p.by === person.id)
          return (
            <li key={person.id}>
              <Link
                href={`${BASE}/me/team/${person.id}`}
                className="flex min-h-16 items-center gap-3 rounded-card bg-surface p-3 shadow-card focus-ring hover:bg-raised"
              >
                {posts[0] ? (
                  <span className="w-14 flex-none">
                    <PhotoImage
                      photo={posts[0]}
                      alt=""
                      ratio="1/1"
                      radius="square"
                    />
                  </span>
                ) : null}
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="text-heading">{person.name}</span>
                  <span className="text-meta text-ink-muted">
                    {person.job} · {photosWord(posts.length)}
                  </span>
                </span>
                <CaretRightIcon
                  aria-hidden
                  weight="bold"
                  className="size-5 flex-none text-ink-muted"
                />
              </Link>
            </li>
          )
        })}
      </ul>
      <TabBar active="me" state={state} />
    </Screen>
  )
}

export function Person({ state, world, id }: Props & { id: string }) {
  const person = COLLEAGUES.find((c) => c.id === id)
  const posts = COLLEAGUE_POSTS.filter((p) => p.by === id)
  return (
    <Screen>
      <TopBar
        back={{ href: `${BASE}/me/team`, label: "The team" }}
        title={person?.name ?? "This person isn’t here"}
      >
        <p className="text-body text-ink-muted">
          {person
            ? `${person.job} · ${venueName(world)} · ${photosWord(posts.length)}`
            : "They may have left, or the link is old."}
        </p>
      </TopBar>
      <div className="grid gap-4 px-gutter pt-2">
        {posts.length > 0 ? (
          <PhotoGrid
            photos={posts}
            caption={(photo) => folderById(photo.label?.folderId)?.name ?? ""}
            linkTo={(photo) => `${BASE}/album/${photo.label?.folderId}`}
          />
        ) : person ? (
          <p className="text-body text-ink-muted">
            Nothing posted yet. Photos show here as soon as they’re added.
          </p>
        ) : null}
      </div>
      <TabBar active="me" state={state} />
    </Screen>
  )
}

/** A venue the prototype has no sample album for. */
export function NoAlbum({ state, world, title }: Props & { title: string }) {
  return (
    <Screen>
      <TopBar title={title}>
        <p className="text-body text-ink-muted">{venueName(world)}</p>
      </TopBar>
      <div className="grid gap-3 px-gutter pt-2">
        <Notice tone="plain" title="Nothing to show for this pub">
          The prototype only carries The Old Crown’s album. Go back to it in Me
          → Settings → Your pubs.
        </Notice>
        <LinkButton href={`${BASE}/me/settings`}>Open Settings</LinkButton>
      </div>
      <TabBar active={null} state={state} />
    </Screen>
  )
}
