"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { ImagesIcon } from "@phosphor-icons/react"

import { Notice } from "@/components/nabalens/notice"
import { VenueBar } from "@/components/nabalens/venue-bar"
import { Button } from "@/components/ui/button"
import { LinkButton } from "@/components/ui/link-button"

import {
  BASE,
  PhotoImage,
  Screen,
  TabBar,
  TopBar,
  UploadLine,
  altOf,
  photosWord,
  takenWords,
} from "./bits"
import { VENUE } from "./catalogue"
import { LabelFlow } from "./label-flow"
import {
  DEMO_BATCH,
  addFiles,
  resetAll,
  retryUpload,
  seedDemo,
  setWeakSignal,
  useOnline,
  type PhoneState,
  type Photo,
} from "./store"

/* ---------------------------------------------------------------- launcher */

/** The dev page that starts the prototype. Not part of the product. */
export function Launcher({ state }: { state: PhoneState }) {
  const router = useRouter()
  return (
    <Screen foot="none">
      <TopBar title="Staff photo workflow">
        <p className="text-body text-ink-muted">
          Prototype, dev only. Everything you do here stays in this browser:
          nothing is sent to a server.
        </p>
      </TopBar>
      <div className="grid gap-6 px-gutter pt-2">
        <section className="grid gap-3 rounded-card bg-surface p-4 shadow-card">
          <h2 className="text-heading">Try the demo</h2>
          <p className="text-body">
            Try a batch of eight photos at {VENUE}. Seven posted and one needs a
            retry.
          </p>
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              seedDemo()
              router.push(`${BASE}/batch/${DEMO_BATCH}`)
            }}
          >
            Start the demo
          </Button>
        </section>

        <section className="grid gap-3 rounded-card bg-surface p-4 shadow-card">
          <h2 className="text-heading">Use your own photos</h2>
          <p className="text-body">
            Choose photos from this device and follow them through. They are
            kept in this browser only.
          </p>
          <Button
            aria-pressed={state.weakSignal}
            onClick={() => setWeakSignal(!state.weakSignal)}
          >
            Weak signal: one photo per batch fails once
          </Button>
          <LinkButton href={`${BASE}/add`}>Open Add photos</LinkButton>
        </section>

        <section className="grid gap-1">
          <h2 className="text-heading">Compare and reset</h2>
          {state.photos.length > 0 ? (
            <Link
              href={`${BASE}/my-photos`}
              className="inline-flex min-h-11 items-center text-label text-accent-text underline underline-offset-3 focus-ring"
            >
              Carry on where you left off ({photosWord(state.photos.length)})
            </Link>
          ) : null}
          <Link
            href="/staff/photos"
            className="inline-flex min-h-11 items-center text-label text-accent-text underline underline-offset-3 focus-ring"
          >
            Open the existing flow (needs sign-in)
          </Link>
          <Button
            variant="danger-quiet"
            className="justify-self-start px-0"
            onClick={() => resetAll()}
          >
            Clear all prototype photos
          </Button>
        </section>
      </div>
    </Screen>
  )
}

/** `/demo`: seed and go straight to the batch, for a one-tap link. */
export function DemoStart() {
  const router = useRouter()
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    seedDemo()
    router.replace(`${BASE}/batch/${DEMO_BATCH}`)
  }, [router])
  return (
    <Screen foot="none">
      <p role="status" className="px-gutter pt-6 text-body">
        Setting up the demo…
      </p>
    </Screen>
  )
}

/* --------------------------------------------------------------------- add */

export function AddScreen({ state }: { state: PhoneState }) {
  const router = useRouter()
  const online = useOnline()
  const input = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const onFiles = async (list: FileList | null) => {
    const files = Array.from(list ?? [])
    if (files.length === 0) return
    setProblem(null)
    setBusy(files.length)
    const result = await addFiles(files)
    setBusy(null)
    if (input.current) input.current.value = ""
    if (result.kept === 0) {
      setProblem(
        result.notKept.length > 0
          ? "This phone couldn’t keep those photos, so none were added. Free some space or close private browsing, then try again."
          : "Those files aren’t photos. Choose photos from your gallery."
      )
      return
    }
    const query = new URLSearchParams()
    if (result.notPhotos.length > 0)
      query.set("left", String(result.notPhotos.length))
    if (result.notKept.length > 0)
      query.set("unkept", String(result.notKept.length))
    const tail = query.size > 0 ? `?${query}` : ""
    router.push(`${BASE}/batch/${result.batchId}${tail}`)
  }

  return (
    <Screen>
      <VenueBar name={VENUE} role="Photos you add go to this pub’s album" />
      <TopBar title="Add photos">
        <p className="text-body text-ink-muted">
          Choose as many as you like in one go. You decide afterwards whether to
          label them now or later.
        </p>
      </TopBar>
      <div className="grid gap-4 px-gutter pt-2">
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          data-gallery-input=""
          onChange={(event) => void onFiles(event.target.files)}
        />
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          loading={busy !== null}
          loadingLabel={
            busy !== null ? `Keeping ${photosWord(busy)} on this phone` : null
          }
          onClick={() => input.current?.click()}
        >
          <ImagesIcon aria-hidden weight="bold" />
          Choose photos from your phone
        </Button>
        {problem ? (
          <Notice tone="attention" title="No photos added">
            {problem}
          </Notice>
        ) : null}
        {!online ? (
          <Notice tone="plain" title="You’re offline">
            You can still add photos. They are kept on this phone and upload
            when you’re back online.
          </Notice>
        ) : null}
        <ol className="grid gap-2 text-body text-ink-muted">
          <li>1. Each photo is kept on this phone first, so none is lost.</li>
          <li>2. Each photo appears in the Album as soon as it uploads.</li>
          <li>3. Label now, or later from My photos.</li>
        </ol>
      </div>
      <TabBar active="add" state={state} />
    </Screen>
  )
}

/* ------------------------------------------------------------ batch review */

function uploadSummary(photos: Photo[]): string {
  const count = (upload: Photo["upload"]) =>
    photos.filter((photo) => photo.upload === upload).length
  const parts = [
    count("uploaded") > 0 ? `${count("uploaded")} posted` : null,
    count("uploading") > 0 ? `${count("uploading")} uploading` : null,
    count("local") > 0 ? `${count("local")} saved on this phone` : null,
    count("failed") > 0 ? `${count("failed")} didn’t upload` : null,
  ].filter(Boolean)
  return parts.join(" · ")
}

export function FailedNotice({
  photos,
  others,
}: {
  photos: Photo[]
  /** How many of the same set are safe, for the reassuring line. */
  others: number
}) {
  if (photos.length === 0) return null
  return (
    <Notice
      tone="attention"
      data-failed-notice=""
      title={
        photos.length === 1
          ? "1 photo didn’t upload"
          : `${photos.length} photos didn’t upload`
      }
    >
      <div className="grid gap-3">
        <p>
          {others > 0
            ? `The other ${others} ${others === 1 ? "is" : "are"} safe. `
            : ""}
          {photos.length === 1 ? "It is" : "They are"} still on this phone, with
          any label you gave. Retry sends only that photo, so nothing is added
          twice.
        </p>
        <ul className="grid gap-2">
          {photos.map((photo) => (
            <li key={photo.id} className="flex items-center gap-3">
              <span className="w-14 flex-none">
                <PhotoImage photo={photo} ratio="1/1" radius="square" />
              </span>
              <span className="min-w-0 flex-1 text-meta [overflow-wrap:anywhere]">
                {photo.fileName}
              </span>
              <Button
                size="sm"
                onClick={() => retryUpload(photo.id)}
                aria-label={`Retry ${photo.fileName}`}
              >
                Retry
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </Notice>
  )
}

export function BatchReview({
  state,
  batchId,
}: {
  state: PhoneState
  batchId: string
}) {
  const params = useSearchParams()
  const left = Number(params.get("left") ?? 0)
  const unkept = Number(params.get("unkept") ?? 0)
  const photos = state.photos.filter((photo) => photo.batchId === batchId)
  if (photos.length === 0) return <Missing state={state} what="batch" />

  const toLabel = photos.filter((photo) => photo.label === null).length
  const failedPhotos = photos.filter((photo) => photo.upload === "failed")
  const started = toLabel < photos.length

  return (
    <Screen foot="dock">
      <TopBar title={`${photosWord(photos.length)} added`}>
        <p className="text-body text-ink-muted">For {VENUE}</p>
        <p role="status" className="text-label" data-upload-summary="">
          {uploadSummary(photos)}
        </p>
      </TopBar>

      <div className="grid gap-4 px-gutter pt-2">
        {left > 0 ? (
          <Notice tone="plain">
            {left === 1
              ? "1 file wasn’t a photo"
              : `${left} files weren’t photos`}{" "}
            and {left === 1 ? "was" : "were"} left out.
          </Notice>
        ) : null}
        {unkept > 0 ? (
          <Notice
            tone="attention"
            title={
              unkept === 1
                ? "1 photo wasn’t added"
                : `${unkept} photos weren’t added`
            }
          >
            This phone couldn’t keep {unkept === 1 ? "it" : "them"}, so{" "}
            {unkept === 1 ? "it isn’t" : "they aren’t"} in this list. Choose{" "}
            {unkept === 1 ? "it" : "them"} again from Add photos.
          </Notice>
        ) : null}
        <FailedNotice
          photos={failedPhotos}
          others={photos.length - failedPhotos.length}
        />
        <ul
          className="grid grid-cols-2 gap-x-2 gap-y-3"
          aria-label="Photos added"
        >
          {photos.map((photo, index) => (
            <li key={photo.id} className="grid content-start gap-1.5">
              <Link
                href={`${BASE}/photo/${photo.id}`}
                className="block rounded-card focus-ring"
                aria-label={`Photo ${index + 1}: ${altOf(photo)}`}
              >
                <PhotoImage photo={photo} alt="" eager={index < 4} />
              </Link>
              <UploadLine photo={photo} />
              {photo.upload === "uploaded" ? (
                <LinkButton
                  href={`${BASE}/photo/${photo.id}`}
                  variant="row-link"
                  size="sm"
                  className="justify-self-start"
                >
                  View photo in Album
                </LinkButton>
              ) : null}
              <span className="text-meta text-ink-muted">
                Taken: {takenWords(photo)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div
        data-dock=""
        className="fixed inset-x-0 bottom-0 z-dock mx-auto grid w-full max-w-feed gap-3 bg-surface px-gutter pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] shadow-bar"
      >
        {toLabel === 0 ? (
          <>
            <p className="text-body">Every photo here is labelled.</p>
            <LinkButton
              href={`${BASE}/batch/${batchId}/label`}
              variant="primary"
              size="lg"
              className="w-full"
            >
              See the labels
            </LinkButton>
          </>
        ) : (
          <>
            <p className="text-body">
              <span className="font-semibold">Label now</span> to say what each
              photo shows. <span className="font-semibold">Label later</span>{" "}
              keeps {toLabel === 1 ? "it" : "them"} in My photos → Unlabelled.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <LinkButton
                href={`${BASE}/my-photos?later=${toLabel}`}
                size="lg"
                className="w-full px-3"
              >
                Label later
              </LinkButton>
              <LinkButton
                href={`${BASE}/batch/${batchId}/label`}
                variant="primary"
                size="lg"
                className="w-full px-3"
              >
                {started ? "Carry on labelling" : "Label now"}
              </LinkButton>
            </div>
          </>
        )}
      </div>
    </Screen>
  )
}

export function BatchLabel({
  state,
  batchId,
}: {
  state: PhoneState
  batchId: string
}) {
  const photos = state.photos.filter((photo) => photo.batchId === batchId)
  if (photos.length === 0) return <Missing state={state} what="batch" />
  return (
    <LabelFlow
      state={state}
      photos={photos}
      title="Label photos"
      back={{ href: `${BASE}/batch/${batchId}`, label: "Photos added" }}
      doneHref={`${BASE}/my-photos`}
      doneLabel="Go to My photos"
    />
  )
}

export function Missing({
  state,
  what,
}: {
  state: PhoneState
  what: "batch" | "photo" | "folder" | "page"
}) {
  return (
    <Screen>
      <TopBar title={`This ${what} isn’t here`}>
        <p className="text-body text-ink-muted">
          It may have been cleared from this browser. Your other photos are in
          My photos.
        </p>
      </TopBar>
      <div className="px-gutter pt-2">
        <LinkButton href={`${BASE}/my-photos`}>Open My photos</LinkButton>
      </div>
      <TabBar active={null} state={state} />
    </Screen>
  )
}
