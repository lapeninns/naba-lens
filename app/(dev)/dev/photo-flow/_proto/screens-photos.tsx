"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { ArrowLeftIcon, CaretRightIcon } from "@phosphor-icons/react"

import { Notice } from "@/components/nabalens/notice"
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
import { LinkButton } from "@/components/ui/link-button"

import {
  BASE,
  PhotoImage,
  Screen,
  StageChip,
  TabBar,
  TopBar,
  Trail,
  UploadLine,
  altOf,
  dayWords,
  photosWord,
  takenWords,
  trailWords,
} from "./bits"
import {
  SHELVES,
  VENUE,
  folderHref,
  folderTrail,
  type Folder,
} from "./catalogue"
import { LabelFlow } from "./label-flow"
import { LabelPicker } from "./label-picker"
import { MANAGER, feedbackFor, feedbackTitle, useWorld } from "./world"
import { FailedNotice, Missing } from "./screens-add"
import {
  failed,
  folderOf,
  removePhoto,
  retryUpload,
  saveLabel,
  stageOf,
  undoLastRun,
  unlabelled,
  type PhoneState,
  type Photo,
} from "./store"

/* --------------------------------------------------------------- my photos */

export function MyPhotos({ state }: { state: PhoneState }) {
  const params = useSearchParams()
  const later = Number(params.get("later") ?? 0)
  const removed = params.get("removed") === "1"
  const withoutLabels = unlabelled(state)
  const failedPhotos = failed(state)
  const byFolder = new Map<string, { folder: Folder; photos: Photo[] }>()
  for (const photo of state.photos) {
    const folder = folderOf(photo)
    if (!folder) continue
    const entry = byFolder.get(folder.id) ?? { folder, photos: [] }
    entry.photos.push(photo)
    byFolder.set(folder.id, entry)
  }
  const uploaded = state.photos.filter((p) => p.upload === "uploaded").length

  return (
    <Screen>
      <TopBar title="My photos">
        <p className="text-body text-ink-muted" data-my-summary="">
          {state.photos.length === 0
            ? "Photos you add show here."
            : `${photosWord(state.photos.length)} · ${uploaded} posted`}
        </p>
      </TopBar>

      <div className="grid gap-6 px-gutter pt-2">
        {later > 0 && withoutLabels.length > 0 ? (
          <Notice
            tone="positive"
            data-later-notice=""
            title={`${photosWord(later)} kept in Unlabelled`}
          >
            Nothing else to do now. Label {later === 1 ? "it" : "them"} here
            when you have a minute.
          </Notice>
        ) : null}

        {removed ? (
          <Notice
            tone="plain"
            role="status"
            data-removed-notice=""
            title="Photo removed"
          >
            It is out of the Album and off this phone.
          </Notice>
        ) : null}

        <FailedNotice
          photos={failedPhotos}
          others={state.photos.length - failedPhotos.length}
        />

        <section
          aria-labelledby="unlabelled"
          id="unlabelled-area"
          className="grid gap-3 rounded-card bg-surface p-4 shadow-card"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="unlabelled" className="type-section-title">
              Unlabelled
            </h2>
            <span
              className="text-label text-ink-muted"
              data-unlabelled-count=""
            >
              {photosWord(withoutLabels.length)}
            </span>
          </div>
          {withoutLabels.length > 0 ? (
            <>
              <ul className="grid grid-cols-4 gap-1.5">
                {withoutLabels.slice(0, 8).map((photo) => (
                  <li key={photo.id}>
                    <PhotoImage photo={photo} ratio="1/1" radius="square" />
                  </li>
                ))}
              </ul>
              {withoutLabels.length > 8 ? (
                <p className="text-meta text-ink-muted">
                  and {withoutLabels.length - 8} more
                </p>
              ) : null}
              <p className="text-body text-ink-muted">
                You can label one or several photos at any time.
              </p>
              <LinkButton
                href={`${BASE}/my-photos/unlabelled`}
                variant="primary"
                size="lg"
                className="w-full"
              >
                Label these photos
              </LinkButton>
            </>
          ) : (
            <p className="text-body text-ink-muted">
              Photos with no label appear here.
            </p>
          )}
        </section>

        {byFolder.size > 0 ? (
          <section aria-labelledby="labelled-title" className="grid gap-3">
            <h2 id="labelled-title" className="type-section-title">
              Labelled
            </h2>
            <ul className="grid gap-2">
              {[...byFolder.values()].map(({ folder, photos }) => (
                <li key={folder.id}>
                  <Link
                    href={folderHref(BASE, folder)}
                    className="flex min-h-14 items-center gap-3 rounded-card bg-surface p-3 shadow-card focus-ring hover:bg-raised"
                  >
                    <span className="w-14 flex-none">
                      <PhotoImage
                        photo={photos[0]}
                        alt=""
                        ratio="1/1"
                        radius="square"
                      />
                    </span>
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="text-heading [overflow-wrap:anywhere]">
                        {folder.name}
                      </span>
                      <span className="text-meta text-ink-muted">
                        {photosWord(photos.length)} ·{" "}
                        {trailWords(folderTrail(folder).slice(0, 3))}
                      </span>
                    </span>
                    <CaretRightIcon
                      aria-hidden
                      weight="bold"
                      className="size-5 flex-none text-ink-muted"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      <TabBar active="my-photos" state={state} />
    </Screen>
  )
}

/** A two-column grid of photos, each with its one status and capture date. */
export function PhotoGrid({
  photos,
  justRun,
  caption,
  linkTo,
}: {
  photos: Photo[]
  /** The save whose photos are marked "Labelled just now". */
  justRun?: string | null
  /** Words under the photo in place of its capture date. */
  caption?: (photo: Photo) => string
  /** Where a tile goes, when it is not the person's own photo page. */
  linkTo?: (photo: Photo) => string
}) {
  return (
    <ul className="grid grid-cols-2 gap-x-2 gap-y-4">
      {photos.map((photo, index) => (
        <li
          key={photo.id}
          data-photo={photo.id}
          data-stage={stageOf(photo)}
          className="grid content-start gap-1.5"
        >
          <Link
            href={linkTo ? linkTo(photo) : `${BASE}/photo/${photo.id}`}
            className="block rounded-card focus-ring"
            aria-label={`Open photo: ${altOf(photo)}`}
          >
            <PhotoImage photo={photo} alt="" eager={index < 4} />
          </Link>
          <div className="flex flex-wrap gap-1.5">
            <StageChip photo={photo} />
          </div>
          {justRun && photo.labelRun === justRun ? (
            <p className="text-meta font-semibold" data-just-labelled="">
              Labelled just now
            </p>
          ) : null}
          <p className="text-meta text-ink-muted">
            {caption ? caption(photo) : `Taken: ${takenWords(photo)}`}
          </p>
        </li>
      ))}
    </ul>
  )
}

/* --------------------------------------------------------- unlabelled area */

export function UnlabelledArea({ state }: { state: PhoneState }) {
  // The photos this visit started with stay on the screen once labelled, so
  // the person sees where each one went and can change it.
  const [visit] = useState(() => unlabelled(state).map((photo) => photo.id))
  const photos = state.photos.filter(
    (photo) => photo.label === null || visit.includes(photo.id)
  )
  if (photos.length === 0) {
    return (
      <Screen>
        <TopBar
          back={{ href: `${BASE}/my-photos`, label: "My photos" }}
          title="Unlabelled"
        >
          <p className="text-body text-ink-muted">
            Photos with no label appear here.
          </p>
        </TopBar>
        <TabBar active="my-photos" state={state} />
      </Screen>
    )
  }
  return (
    <LabelFlow
      state={state}
      photos={photos}
      title="Unlabelled"
      back={{ href: `${BASE}/my-photos`, label: "My photos" }}
      doneHref={`${BASE}/my-photos`}
      doneLabel="Back to My photos"
      intro="Tick one photo, or several that show the same thing, then choose a label."
    />
  )
}

/* -------------------------------------------------------------- one photo */

export function PhotoDetail({
  state,
  photoId,
}: {
  state: PhoneState
  photoId: string
}) {
  const router = useRouter()
  const world = useWorld()
  const [picking, setPicking] = useState(false)
  const [removing, setRemoving] = useState(false)
  const noticeRef = useRef<HTMLDivElement | null>(null)
  const saved = useRef(false)
  const photo = state.photos.find((p) => p.id === photoId)

  useEffect(() => {
    if (!picking && saved.current) {
      saved.current = false
      noticeRef.current?.focus()
    }
  }, [picking])

  if (!photo) return <Missing state={state} what="photo" />

  if (picking) {
    return (
      <LabelPicker
        photos={[photo]}
        state={state}
        onBack={() => setPicking(false)}
        onSave={(label) => {
          saveLabel([photo.id], label)
          saved.current = true
          setPicking(false)
        }}
      />
    )
  }

  const folder = folderOf(photo)
  const stage = stageOf(photo)
  const title = folder?.name ?? "Unlabelled photo"
  const said = world ? feedbackFor(world, photo.id) : []
  const takenDown = said.find((item) => item.kind === "remove")
  const justSaved =
    state.lastRun?.photoIds.length === 1 &&
    state.lastRun.photoIds[0] === photo.id

  return (
    <Screen>
      <header className="px-gutter pt-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="-ml-1 inline-flex min-h-11 min-w-11 items-center gap-1.5 rounded-control px-1 text-label text-accent-text focus-ring"
        >
          <ArrowLeftIcon aria-hidden weight="bold" className="size-5" />
          Back
        </button>
      </header>
      <div className="grid gap-4 px-gutter">
        <PhotoImage photo={photo} eager contain className="bg-surface-2" />
        <div className="grid gap-2">
          <h1
            tabIndex={-1}
            data-screen-title=""
            className="type-page-title text-balance outline-none"
          >
            {title}
          </h1>
          <div className="flex flex-wrap gap-1.5">
            <StageChip photo={photo} />
          </div>
        </div>

        {justSaved ? (
          <Notice
            ref={noticeRef}
            tabIndex={-1}
            tone="positive"
            title={folder ? `Labelled ${folder.name}` : "Label saved"}
          >
            <Button
              variant="row-link"
              size="sm"
              className="min-w-11"
              onClick={() => undoLastRun()}
            >
              Undo
            </Button>
          </Notice>
        ) : null}

        {said.length > 0 ? (
          <section aria-labelledby="manager-said" className="grid gap-2">
            <h2 id="manager-said" className="text-heading">
              From your manager
            </h2>
            {said.map((item) => (
              <Notice
                key={item.id}
                data-feedback={item.kind}
                tone={
                  item.kind === "feedback"
                    ? "plain"
                    : item.kind === "remove"
                      ? "negative"
                      : "attention"
                }
                role="note"
                title={feedbackTitle(item.kind)}
              >
                <p>{item.note}</p>
                <p className="mt-1 text-meta text-ink-muted">
                  {MANAGER}, {dayWords(item.at)}
                </p>
                {item.kind === "retake" && folder ? (
                  <LinkButton
                    href={`${BASE}/add?for=${encodeURIComponent(folder.id)}`}
                    size="sm"
                    className="mt-3"
                  >
                    Add another photo of {folder.name}
                  </LinkButton>
                ) : null}
              </Notice>
            ))}
          </section>
        ) : null}

        {stage === "failed" ? (
          <Notice tone="attention" title="This photo didn’t upload">
            <div className="grid gap-3">
              <p>
                It is still on this phone
                {photo.label ? ", with its label" : ""}. Retry sends only this
                photo.
              </p>
              <Button
                size="sm"
                className="justify-self-start"
                onClick={() => retryUpload(photo.id)}
              >
                Retry
              </Button>
            </div>
          </Notice>
        ) : null}

        <dl className="grid gap-3 rounded-card bg-surface p-4 shadow-card">
          <Fact term="Folder">
            {folder ? (
              <Trail
                steps={[
                  { name: "Album", href: `${BASE}/album` },
                  {
                    name: SHELVES[folder.shelf].name,
                    href: `${BASE}/album/${folder.shelf}`,
                  },
                  {
                    name: folder.groupName,
                    href: `${BASE}/album/${folder.shelf}/${folder.groupId}`,
                  },
                  { name: folder.name, href: folderHref(BASE, folder) },
                ]}
              />
            ) : (
              "None yet. It is in My photos → Unlabelled."
            )}
          </Fact>
          <Fact term="Taken">
            <span data-taken="">{takenWords(photo, true)}</span>
            <span className="block text-meta text-ink-muted">
              {photo.takenAt
                ? "Read from the photo file."
                : "The photo file doesn’t say when it was taken."}
            </span>
          </Fact>
          <Fact term="Added">
            {dayWords(photo.addedAt)}, for {VENUE}
          </Fact>
          <Fact term="File">
            <span className="[overflow-wrap:anywhere]">{photo.fileName}</span>
            <UploadLine photo={photo} className="mt-0.5" />
          </Fact>
        </dl>

        {takenDown ? null : (
          <Button
            variant={photo.label ? "secondary" : "primary"}
            size="lg"
            className="w-full"
            onClick={() => setPicking(true)}
          >
            {photo.label ? "Change label" : "Label this photo"}
          </Button>
        )}
        {folder ? (
          <LinkButton href={folderHref(BASE, folder)} className="w-full">
            Open folder
          </LinkButton>
        ) : null}
        <div className="grid gap-1">
          <Button variant="danger-quiet" onClick={() => setRemoving(true)}>
            Remove this photo
          </Button>
          <p className="text-center text-meta text-ink-muted">
            Takes it out of the Album for everyone. Photos already used on a
            website or menu are not affected.
          </p>
        </div>
      </div>

      <Dialog open={removing} onOpenChange={setRemoving}>
        <DialogContent size="sm" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="pr-0">Remove this photo?</DialogTitle>
            <DialogDescription>
              It leaves the Album and this phone. This can’t be undone. The
              original stays in your phone’s gallery.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="secondary" />}>
              Keep it
            </DialogClose>
            <Button
              variant="danger"
              onClick={() => {
                removePhoto(photo.id)
                router.replace(`${BASE}/my-photos?removed=1`)
              }}
            >
              Remove photo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <TabBar active={null} state={state} />
    </Screen>
  )
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-meta text-ink-muted">{term}</dt>
      <dd className="text-body">{children}</dd>
    </div>
  )
}
