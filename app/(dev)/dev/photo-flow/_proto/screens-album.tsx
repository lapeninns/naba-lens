"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useState } from "react"
import { CameraIcon, CaretRightIcon } from "@phosphor-icons/react"

import { Notice } from "@/components/nabalens/notice"
import { VenueBar } from "@/components/nabalens/venue-bar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SearchField } from "@/components/ui/search-field"
import { LinkButton } from "@/components/ui/link-button"

import {
  BASE,
  PhotoImage,
  Screen,
  TabBar,
  TopBar,
  Trail,
  dayWords,
  photosWord,
} from "./bits"
import {
  GROUPS,
  SHELVES,
  VENUE,
  folderById,
  folderHref,
  groupOf,
  searchFolders,
  type Folder,
  type Shelf,
} from "./catalogue"
import { PhotoGrid } from "./screens-photos"
import {
  COLLEAGUE_POSTS,
  MANAGER,
  colleagueName,
  colleaguePostsIn,
  openAsks,
  openRetakes,
  questionsToDo,
  reportFor,
  sendReport,
  useWorld,
  type ColleaguePost,
} from "./world"
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
  const world = useWorld()
  const [query, setQuery] = useState("")
  if (!world) return null
  const found = query.trim() ? searchFolders(query, 12) : []
  // Everyone's posts at this pub, newest first; yours open your photo page.
  const recent = [
    ...state.photos.filter(({ upload }) => upload === "uploaded"),
    ...COLLEAGUE_POSTS,
  ]
    .sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1))
    .slice(0, 8)
  const toAnswer = questionsToDo(world).length
  return (
    <Screen>
      <VenueBar name={VENUE} />
      <TopBar title="Album" />
      <div className="grid gap-6 px-gutter pt-2">
        <SearchField
          size="sm"
          label="Find a dish, drink or space"
          hideLabel
          placeholder="Find a dish, drink or space"
          value={query}
          onValueChange={setQuery}
          resultCount={
            query.trim()
              ? found.length === 0
                ? "No folders match"
                : `${found.length} ${found.length === 1 ? "folder" : "folders"}`
              : ""
          }
        />
        {query.trim() ? (
          <ul className="grid gap-2" data-album-results="">
            {found.map((folder) => {
              const mine = photosIn(state, folder.id)
              const count = mine.length + colleaguePostsIn(folder.id).length
              return (
                <Row
                  key={folder.id}
                  href={folderHref(BASE, folder)}
                  title={folder.name}
                  detail={`${SHELVES[folder.shelf].name} → ${folder.groupName} · ${count === 0 ? "no photos yet" : photosWord(count)}`}
                  cover={mine[0]}
                />
              )
            })}
          </ul>
        ) : (
          <>
            <ul className="grid gap-2">
              {SHELF_ORDER.map((shelf) => {
                const folders = GROUPS[shelf].flatMap((group) => group.folders)
                const photos = countIn(state, folders)
                return (
                  <Row
                    key={shelf}
                    href={`${BASE}/album/${shelf}`}
                    title={SHELVES[shelf].name}
                    detail={`${folders.length} ${SHELVES[shelf].many} · ${photosWord(photos)} of yours`}
                  />
                )
              })}
              <Row
                href={`${BASE}/album/questions`}
                title="Venue questions"
                detail={
                  toAnswer === 0
                    ? `${world.questions.length} answered`
                    : `${toAnswer} of ${world.questions.length} still to answer`
                }
              />
            </ul>
            <section aria-labelledby="recent-photos" className="grid gap-3">
              <h2 id="recent-photos" className="type-section-title">
                Recent photos
              </h2>
              <PhotoGrid
                photos={recent}
                caption={(photo) => {
                  const who =
                    "by" in photo
                      ? colleagueName((photo as ColleaguePost).by)
                      : "You"
                  const what =
                    folderById(photo.label?.folderId)?.name ?? "No label yet"
                  return `${what} · ${who}`
                }}
                linkTo={(photo) =>
                  "by" in photo
                    ? `${BASE}/album/${photo.label?.folderId}`
                    : `${BASE}/photo/${photo.id}`
                }
              />
            </section>
          </>
        )}
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
  const world = useWorld()
  const params = useSearchParams()
  const [reporting, setReporting] = useState(false)
  const [reason, setReason] = useState<string | null>(null)
  const folder = folderById(folderId)
  if (!folder || !world) return <Missing state={state} what="folder" />
  const photos = photosIn(state, folder.id)
  const theirs = colleaguePostsIn(folder.id)
  const kind = SHELVES[folder.shelf].one
  const added = Number(params.get("added") ?? 0)
  const retake = openRetakes(world, state).find((r) => r.folderId === folder.id)
  const ask = openAsks(world, state).find((a) => a.folderId === folder.id)
  const report = reportFor(world, folder.id)
  const total = photos.length + theirs.length
  return (
    <Screen foot="dock">
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
          {total === 0
            ? `No photos of this ${kind} yet.`
            : `${photosWord(total)} posted${theirs.length > 0 ? ` · ${photos.length} yours` : ""}`}
        </p>
      </TopBar>
      <div className="grid gap-5 px-gutter pt-2">
        {added > 0 ? (
          <Notice
            tone="positive"
            data-added-here=""
            title={`${photosWord(added)} added to ${folder.name}`}
          >
            {added === 1 ? "It is" : "They are"} labelled already and{" "}
            {added === 1 ? "posts" : "post"} as soon as{" "}
            {added === 1 ? "it uploads" : "they upload"}.
          </Notice>
        ) : null}
        {retake ? (
          <Notice
            tone="attention"
            data-retake=""
            title="Another photo requested"
          >
            <p>{retake.feedback.note}</p>
            <p className="mt-1 text-meta text-ink-muted">
              From {MANAGER}, {dayWords(retake.feedback.at)}. Your first photo
              stays in the folder.
            </p>
          </Notice>
        ) : ask ? (
          <Notice
            tone="attention"
            data-ask=""
            title="Your manager asked for this"
          >
            <p>{ask.brief}</p>
            {ask.neededBy ? (
              <p className="mt-1 text-meta text-ink-muted">
                Needed by {dayWords(ask.neededBy)}.
              </p>
            ) : null}
          </Notice>
        ) : null}

        {photos.length > 0 ? (
          <section aria-labelledby="yours" className="grid gap-3">
            <h2 id="yours" className="type-section-title">
              Your photos
            </h2>
            <PhotoGrid photos={photos} justRun={state.lastRun?.id ?? null} />
          </section>
        ) : null}
        {theirs.length > 0 ? (
          <section aria-labelledby="theirs" className="grid gap-3">
            <h2 id="theirs" className="type-section-title">
              From colleagues
            </h2>
            <PhotoGrid
              photos={theirs}
              caption={(photo) =>
                `${colleagueName((photo as ColleaguePost).by)} · ${dayWords(photo.addedAt)}`
              }
              linkTo={(photo) =>
                `${BASE}/me/team/${(photo as ColleaguePost).by}`
              }
            />
          </section>
        ) : null}
        {total === 0 ? (
          <div className="grid aspect-4/3 place-items-center rounded-card border border-dashed border-edge-strong bg-surface-2 text-ink-muted">
            <CameraIcon aria-hidden className="size-8" />
          </div>
        ) : null}

        <section aria-labelledby="changed" className="grid gap-2">
          <h2 id="changed" className="text-heading">
            Has this {kind} changed?
          </h2>
          {report ? (
            <p className="text-body" role="status" data-report-sent="">
              You told your manager: “{report.reason}”. Nothing changes until
              they check it.
            </p>
          ) : (
            <>
              <p className="text-body text-ink-muted">
                Tell your manager if it is no longer served, looks different, or
                is named wrongly.
              </p>
              <Button
                className="justify-self-start"
                onClick={() => setReporting(true)}
              >
                Report a change
              </Button>
            </>
          )}
        </section>
      </div>

      <div
        data-dock=""
        className="fixed inset-x-0 bottom-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom,0px))] z-dock mx-auto w-full max-w-feed bg-surface px-gutter py-3 shadow-bar"
      >
        <LinkButton
          href={`${BASE}/add?for=${encodeURIComponent(folder.id)}`}
          variant="primary"
          size="lg"
          className="w-full"
        >
          Add photos to this folder
        </LinkButton>
      </div>

      <Dialog
        open={reporting}
        onOpenChange={(open) => {
          setReporting(open)
          if (!open) setReason(null)
        }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Report a change</DialogTitle>
            <DialogDescription>
              {folder.name}. Your manager checks it. Nothing in the Album or on
              the menu changes until they do.
            </DialogDescription>
          </DialogHeader>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-label">What has changed?</legend>
            {REASONS[folder.shelf].map((option) => (
              <Button
                key={option}
                aria-pressed={reason === option}
                onClick={() => setReason(option)}
                className="w-full justify-start px-4 text-left"
              >
                {option}
              </Button>
            ))}
          </fieldset>
          <DialogFooter>
            <Button
              variant="primary"
              aria-disabled={reason === null}
              onClick={() => {
                if (!reason) return
                sendReport(folder.id, reason)
                setReporting(false)
              }}
            >
              Send to your manager
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <TabBar active="album" state={state} />
    </Screen>
  )
}

const REASONS: Record<Shelf, string[]> = {
  menu: [
    "It’s no longer served",
    "It looks different now",
    "The name is wrong",
  ],
  drinks: [
    "It’s no longer served",
    "It looks different now",
    "The name is wrong",
  ],
  spaces: [
    "The space isn’t in use",
    "It looks different now",
    "The name is wrong",
  ],
}
