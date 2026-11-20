"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowRightIcon } from "@phosphor-icons/react"

import { Notice } from "@/components/nabalens/notice"
import { Button } from "@/components/ui/button"
import { LinkButton } from "@/components/ui/link-button"
import { SelectableTile } from "@/components/ui/selectable-tile"

import {
  BASE,
  PhotoImage,
  Screen,
  StageChip,
  TopBar,
  UploadLine,
  altOf,
  photosWord,
  trailWords,
} from "./bits"
import { folderById, folderHref, folderTrail } from "./catalogue"
import { LabelPicker } from "./label-picker"
import {
  retryUpload,
  saveLabel,
  undoLastRun,
  stageOf,
  type LabelRun,
  type PhoneState,
  type Photo,
  type PhotoLabel,
} from "./store"

/*
 * Label a set of photos: tick the ones that show the same thing, choose one
 * label, save, and carry on with the rest. The grid never leaves, so what is
 * still to label and what is already labelled are both in view, and a wrong
 * label is one tap from being changed.
 */

export function LabelFlow({
  state,
  photos,
  title,
  back,
  doneHref,
  doneLabel,
  intro,
}: {
  state: PhoneState
  /** Every photo this screen is about, labelled or not. */
  photos: Photo[]
  title: string
  back: { href: string; label: string }
  doneHref: string
  doneLabel: string
  intro?: string
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [picking, setPicking] = useState(false)
  const noticeRef = useRef<HTMLDivElement | null>(null)
  const justSaved = useRef(false)

  const toLabel = photos.filter((photo) => photo.label === null)
  const labelled = photos.filter((photo) => photo.label !== null)
  const ids = useMemo(() => new Set(photos.map((p) => p.id)), [photos])
  // A selection only holds photos that are still here and may be labelled.
  const chosen = selected
    .map((id) => photos.find((photo) => photo.id === id))
    .filter((photo): photo is Photo => !!photo)

  const run =
    state.lastRun && state.lastRun.photoIds.some((id) => ids.has(id))
      ? state.lastRun
      : null

  useEffect(() => {
    if (!picking && justSaved.current) {
      justSaved.current = false
      noticeRef.current?.focus()
      window.scrollTo({ top: 0 })
    }
  }, [picking])

  const toggle = (id: string, on: boolean) =>
    setSelected((now) =>
      on ? [...now.filter((x) => x !== id), id] : now.filter((x) => x !== id)
    )

  if (picking && chosen.length > 0) {
    return (
      <LabelPicker
        photos={chosen}
        state={state}
        onBack={() => setPicking(false)}
        onSave={(label) => {
          saveLabel(
            chosen.map((photo) => photo.id),
            label
          )
          justSaved.current = true
          setSelected([])
          setPicking(false)
        }}
      />
    )
  }

  const groups = groupByLabel(labelled)
  const allDone = toLabel.length === 0

  return (
    <Screen foot="dock">
      <TopBar back={back} title={title}>
        {!allDone ? (
          <p className="text-body text-ink-muted">
            {intro ??
              "Tick the photos that show the same thing, then choose one label for them."}
          </p>
        ) : null}
      </TopBar>

      <div className="grid gap-6 px-gutter pt-2">
        {run ? (
          <SavedNotice
            ref={noticeRef}
            run={run}
            photos={photos}
            onUndo={() => undoLastRun()}
          />
        ) : null}

        {allDone ? (
          <Notice tone="plain" title="Nothing left to label here">
            Every photo below has a label.
          </Notice>
        ) : (
          <section aria-labelledby="to-label" className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 id="to-label" className="type-section-title">
                To label{" "}
                <span className="font-sans text-label text-ink-muted">
                  {toLabel.length}
                </span>
              </h2>
              {toLabel.length > 1 ? (
                <Button
                  variant="link"
                  size="sm"
                  onClick={() =>
                    setSelected(
                      chosen.length === toLabel.length
                        ? []
                        : toLabel.map((photo) => photo.id)
                    )
                  }
                >
                  {chosen.length === toLabel.length
                    ? "Clear selection"
                    : `Select all ${toLabel.length}`}
                </Button>
              ) : null}
            </div>
            <ul className="grid grid-cols-2 gap-2">
              {toLabel.map((photo, index) => (
                <li key={photo.id} className="grid content-start gap-1.5">
                  <SelectableTile
                    label={`photo ${index + 1} of ${toLabel.length}: ${altOf(photo)}`}
                    checked={selected.includes(photo.id)}
                    onCheckedChange={(on) => toggle(photo.id, on)}
                  >
                    <PhotoImage photo={photo} alt="" eager={index < 4} />
                  </SelectableTile>
                  {photo.upload !== "uploaded" ? (
                    <div className="flex flex-wrap items-center justify-between gap-x-2">
                      <UploadLine photo={photo} />
                      {photo.upload === "failed" ? (
                        <Button
                          variant="row-link"
                          size="sm"
                          className="min-w-11"
                          onClick={() => retryUpload(photo.id)}
                          aria-label={`Retry photo ${index + 1}`}
                        >
                          Retry
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        )}

        {groups.length > 0 ? (
          <section aria-labelledby="labelled" className="grid gap-3">
            <h2 id="labelled" className="type-section-title">
              Labelled{" "}
              <span className="font-sans text-label text-ink-muted">
                {labelled.length}
              </span>
            </h2>
            <ul className="grid gap-3">
              {groups.map((group) => (
                <LabelledGroup
                  key={group.key}
                  group={group}
                  onChange={() => {
                    setSelected(group.photos.map((photo) => photo.id))
                    setPicking(true)
                  }}
                />
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <div
        data-dock=""
        className="fixed inset-x-0 bottom-0 z-dock mx-auto grid w-full max-w-feed gap-2 bg-surface px-gutter pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] shadow-bar"
      >
        <p role="status" className="text-label" data-selected-count="">
          {allDone
            ? "All done here"
            : chosen.length === 0
              ? "No photos selected yet"
              : `${photosWord(chosen.length)} selected`}
        </p>
        {allDone ? (
          <LinkButton
            href={doneHref}
            variant="primary"
            size="lg"
            className="w-full"
          >
            {doneLabel}
          </LinkButton>
        ) : chosen.length > 0 ? (
          <div className="flex items-center gap-3">
            <ul aria-hidden className="flex flex-none items-center -space-x-3">
              {chosen.slice(-3).map((photo) => (
                <li
                  key={photo.id}
                  className="w-12 flex-none rounded-square ring-2 ring-surface"
                >
                  <PhotoImage
                    photo={photo}
                    alt=""
                    ratio="1/1"
                    radius="square"
                  />
                </li>
              ))}
            </ul>
            <Button
              variant="primary"
              size="lg"
              className="min-w-0 flex-1"
              onClick={() => setPicking(true)}
            >
              Choose label
              <ArrowRightIcon aria-hidden weight="bold" />
            </Button>
          </div>
        ) : (
          <p className="text-body text-ink-muted">
            Tap a photo to select it. You can leave and come back: unlabelled
            photos stay in My photos.
          </p>
        )}
      </div>
    </Screen>
  )
}

/* ------------------------------------------------------------ after a save */

function SavedNotice({
  run,
  photos,
  onUndo,
  ref,
}: {
  run: LabelRun
  photos: Photo[]
  onUndo: () => void
  ref: React.Ref<HTMLDivElement>
}) {
  const count = run.photoIds.length
  const folder = folderById(run.label.folderId)
  const notUploaded = photos.filter(
    (photo) => run.photoIds.includes(photo.id) && photo.upload !== "uploaded"
  ).length
  return (
    <Notice
      ref={ref}
      tabIndex={-1}
      tone="positive"
      data-saved-run=""
      title={
        folder
          ? `${photosWord(count)} labelled ${folder.name}`
          : `${photosWord(count)} labelled`
      }
    >
      <div className="grid gap-3">
        <p>
          {notUploaded === 0
            ? `${count} posted to the Album.`
            : `${count - notUploaded} posted. ${notUploaded} still to upload.`}
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {folder && notUploaded < count ? (
            <LinkButton href={folderHref(BASE, folder)} size="sm">
              Open folder
            </LinkButton>
          ) : null}
          <Button
            variant="row-link"
            size="sm"
            className="min-w-11"
            onClick={onUndo}
          >
            Undo
          </Button>
        </div>
      </div>
    </Notice>
  )
}

/* -------------------------------------------------------- labelled so far */

type Group = { key: string; label: PhotoLabel; photos: Photo[] }

function groupByLabel(photos: Photo[]): Group[] {
  const groups = new Map<string, Group>()
  for (const photo of photos) {
    if (!photo.label) continue
    const key = photo.label.folderId
    const group = groups.get(key) ?? { key, label: photo.label, photos: [] }
    group.photos.push(photo)
    groups.set(key, group)
  }
  return [...groups.values()]
}

function LabelledGroup({
  group,
  onChange,
}: {
  group: Group
  onChange: () => void
}) {
  const folder = folderById(group.label.folderId)
  const name = folder?.name ?? "Labelled photos"
  return (
    <li
      data-labelled-group={group.key}
      className="grid gap-3 rounded-card bg-surface p-3 shadow-card"
    >
      <div className="flex items-start gap-3">
        <ul className="flex flex-none items-center -space-x-3">
          {group.photos.slice(0, 3).map((photo) => (
            <li
              key={photo.id}
              className="w-14 flex-none rounded-square ring-2 ring-surface"
            >
              <PhotoImage photo={photo} ratio="1/1" radius="square" />
            </li>
          ))}
        </ul>
        <div className="grid min-w-0 flex-1 gap-1">
          <h3 className="text-heading [overflow-wrap:anywhere]">{name}</h3>
          <p className="text-meta text-ink-muted">
            {photosWord(group.photos.length)}
            {folder
              ? ` · ${trailWords(folderTrail(folder).slice(0, 3))}`
              : null}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <StageSummary photos={group.photos} />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {folder ? (
          <LinkButton href={folderHref(BASE, folder)} size="sm">
            Open folder
          </LinkButton>
        ) : null}
        <Button
          variant="row-link"
          size="sm"
          className="min-w-11"
          onClick={onChange}
          aria-label={`Change label: ${name}`}
        >
          Change label
        </Button>
      </div>
    </li>
  )
}

/** One chip per different status in the group, not one per photo. */
function StageSummary({ photos }: { photos: Photo[] }) {
  const seen = new Set<string>()
  const firsts = photos.filter((photo) => {
    const key = stageOf(photo)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return firsts.map((photo) => <StageChip key={photo.id} photo={photo} />)
}
