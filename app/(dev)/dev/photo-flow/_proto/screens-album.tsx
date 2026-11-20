"use client"

import Link from "next/link"
import { CameraIcon, CaretRightIcon } from "@phosphor-icons/react"

import { VenueBar } from "@/components/nabalens/venue-bar"
import { LinkButton } from "@/components/ui/link-button"

import {
  BASE,
  PhotoImage,
  Screen,
  TabBar,
  TopBar,
  Trail,
  photosWord,
} from "./bits"
import {
  GROUPS,
  SHELVES,
  VENUE,
  folderById,
  folderHref,
  groupOf,
  type Folder,
  type Shelf,
} from "./catalogue"
import { PhotoGrid } from "./screens-photos"
import { Missing } from "./screens-add"
import { photosIn, type PhoneState, type Photo } from "./store"

/*
 * Album: the same three steps for a dish, a drink and a space.
 *   Album → Menu | Drinks | Spaces → a group → a folder of photos.
 * A folder shows every photo labelled with it, each with its one status.
 */

const SHELF_ORDER: Shelf[] = ["menu", "drinks", "spaces"]

function isShelf(value: string): value is Shelf {
  return value === "menu" || value === "drinks" || value === "spaces"
}

function countIn(state: PhoneState, folders: Folder[]): number {
  const ids = new Set(folders.map((folder) => folder.id))
  return state.photos.filter(
    (photo) =>
      photo.upload === "uploaded" &&
      photo.label &&
      ids.has(photo.label.folderId)
  ).length
}

function Row({
  href,
  title,
  detail,
  cover,
}: {
  href: string
  title: string
  detail: string
  cover?: Photo
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex min-h-16 items-center gap-3 rounded-card bg-surface p-3 shadow-card focus-ring hover:bg-raised"
      >
        {cover ? (
          <span className="w-14 flex-none">
            <PhotoImage photo={cover} alt="" ratio="1/1" radius="square" />
          </span>
        ) : null}
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-heading [overflow-wrap:anywhere]">{title}</span>
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

export function AlbumHome({ state }: { state: PhoneState }) {
  const posted = state.photos.filter(({ upload }) => upload === "uploaded")
  // The folders this person labelled into most recently, newest first.
  const recent: Folder[] = []
  for (const photo of posted) {
    if (photo.label?.type !== "folder") continue
    const folder = folderById(photo.label.folderId)
    if (folder && !recent.includes(folder)) recent.push(folder)
  }
  return (
    <Screen>
      <VenueBar name={VENUE} />
      <TopBar title="Album" />
      <div className="grid gap-6 px-gutter pt-2">
        <ul className="grid gap-2">
          {SHELF_ORDER.map((shelf) => {
            const folders = GROUPS[shelf].flatMap((group) => group.folders)
            const photos = countIn(state, folders)
            return (
              <Row
                key={shelf}
                href={`${BASE}/album/${shelf}`}
                title={SHELVES[shelf].name}
                detail={`${folders.length} ${SHELVES[shelf].many} · ${photosWord(photos)}`}
              />
            )
          })}
        </ul>
        <section aria-labelledby="recent-photos" className="grid gap-3">
          <h2 id="recent-photos" className="type-section-title">
            Recent photos
          </h2>
          {posted.length > 0 ? (
            <PhotoGrid photos={posted} />
          ) : (
            <p className="text-body text-ink-muted">No photos posted yet.</p>
          )}
        </section>
        {recent.length > 0 ? (
          <section aria-labelledby="recent-folders" className="grid gap-3">
            <h2 id="recent-folders" className="type-section-title">
              Folders with your photos
            </h2>
            <ul className="grid gap-2">
              {recent.slice(0, 6).map((folder) => {
                const photos = photosIn(state, folder.id)
                return (
                  <Row
                    key={folder.id}
                    href={folderHref(BASE, folder)}
                    title={folder.name}
                    detail={`${photosWord(photos.length)} · ${SHELVES[folder.shelf].name} → ${folder.groupName}`}
                    cover={photos[0]}
                  />
                )
              })}
            </ul>
          </section>
        ) : null}
      </div>
      <TabBar active="album" state={state} />
    </Screen>
  )
}

export function AlbumShelf({
  state,
  shelf,
}: {
  state: PhoneState
  shelf: string
}) {
  if (!isShelf(shelf)) return <Missing state={state} what="folder" />
  return (
    <Screen>
      <div className="px-gutter pt-3">
        <Trail
          steps={[
            { name: "Album", href: `${BASE}/album` },
            { name: SHELVES[shelf].name },
          ]}
        />
      </div>
      <TopBar title={SHELVES[shelf].name} />
      <ul className="grid gap-2 px-gutter pt-2">
        {GROUPS[shelf].map((group) => {
          const photos = countIn(state, group.folders)
          const noun =
            group.folders.length === 1
              ? SHELVES[shelf].one
              : SHELVES[shelf].many
          return (
            <Row
              key={group.id}
              href={`${BASE}/album/${shelf}/${group.id}`}
              title={group.name}
              detail={`${group.folders.length} ${noun} · ${photosWord(photos)}`}
            />
          )
        })}
      </ul>
      <TabBar active="album" state={state} />
    </Screen>
  )
}

export function AlbumGroup({
  state,
  shelf,
  groupId,
}: {
  state: PhoneState
  shelf: string
  groupId: string
}) {
  const group = isShelf(shelf) ? groupOf(shelf, groupId) : null
  if (!group || !isShelf(shelf)) return <Missing state={state} what="folder" />
  // Folders that already hold photos come first: that is what people come
  // here to find. The rest keep the menu's own order.
  const filled = group.folders.filter((f) => photosIn(state, f.id).length > 0)
  const empty = group.folders.filter((f) => photosIn(state, f.id).length === 0)
  return (
    <Screen>
      <div className="px-gutter pt-3">
        <Trail
          steps={[
            { name: "Album", href: `${BASE}/album` },
            { name: SHELVES[shelf].name, href: `${BASE}/album/${shelf}` },
            { name: group.name },
          ]}
        />
      </div>
      <TopBar title={group.name} />
      <div className="grid gap-6 px-gutter pt-2">
        {filled.length > 0 ? (
          <section aria-labelledby="with-photos" className="grid gap-3">
            <h2 id="with-photos" className="type-section-title">
              With photos{" "}
              <span className="font-sans text-label text-ink-muted">
                {filled.length}
              </span>
            </h2>
            <ul className="grid grid-cols-2 gap-x-2 gap-y-4">
              {filled.map((folder) => (
                <FolderTile key={folder.id} folder={folder} state={state} />
              ))}
            </ul>
          </section>
        ) : null}
        {empty.length > 0 ? (
          <section aria-labelledby="no-photos" className="grid gap-3">
            <h2 id="no-photos" className="type-section-title">
              No photos yet{" "}
              <span className="font-sans text-label text-ink-muted">
                {empty.length}
              </span>
            </h2>
            <ul className="grid gap-2">
              {empty.map((folder) => (
                <Row
                  key={folder.id}
                  href={folderHref(BASE, folder)}
                  title={folder.name}
                  detail="No photos yet"
                />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      <TabBar active="album" state={state} />
    </Screen>
  )
}

function FolderTile({ folder, state }: { folder: Folder; state: PhoneState }) {
  const photos = photosIn(state, folder.id)
  return (
    <li>
      <Link
        href={folderHref(BASE, folder)}
        data-folder={folder.id}
        className="grid gap-1.5 rounded-card focus-ring"
      >
        <PhotoImage photo={photos[0]} alt="" />
        <span className="text-heading [overflow-wrap:anywhere]">
          {folder.name}
        </span>
        <span className="text-meta text-ink-muted">
          {photosWord(photos.length)}
        </span>
      </Link>
    </li>
  )
}

export function AlbumFolder({
  state,
  folderId,
}: {
  state: PhoneState
  folderId: string
}) {
  const folder = folderById(folderId)
  if (!folder) return <Missing state={state} what="folder" />
  const photos = photosIn(state, folder.id)
  const kind = SHELVES[folder.shelf].one
  return (
    <Screen>
      <div className="px-gutter pt-3">
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
            { name: folder.name },
          ]}
        />
      </div>
      <TopBar title={folder.name}>
        <p className="text-body text-ink-muted" data-folder-summary="">
          {photos.length === 0
            ? `No photos of this ${kind} yet.`
            : `${photosWord(photos.length)} posted`}
        </p>
      </TopBar>
      <div className="grid gap-5 px-gutter pt-2">
        {photos.length > 0 ? (
          <PhotoGrid photos={photos} justRun={state.lastRun?.id ?? null} />
        ) : (
          <div className="grid aspect-4/3 place-items-center rounded-card border border-dashed border-edge-strong bg-surface-2 text-ink-muted">
            <CameraIcon aria-hidden className="size-8" />
          </div>
        )}
        <LinkButton href={`${BASE}/add`} className="w-full">
          Add photos
        </LinkButton>
      </div>
      <TabBar active="album" state={state} />
    </Screen>
  )
}
