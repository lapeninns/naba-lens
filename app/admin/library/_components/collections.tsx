"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  DotsThreeIcon,
  DownloadSimpleIcon,
  FolderSimpleIcon,
  PlusIcon,
  XCircleIcon,
} from "@phosphor-icons/react"

import { Row, RowList } from "@/components/nabalens/common-room/row"
import { EmptyState } from "@/components/nabalens/empty-state"
import { Notice } from "@/components/nabalens/notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { StatusChip } from "@/components/nabalens/status-chip"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Photo } from "@/components/ui/photo"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import type { LibraryCollection, LibraryTag } from "@/lib/library/model"
import { cn } from "@/lib/utils"

import {
  saveCollectionAction,
  saveTagAction,
  setCollectionItemsAction,
} from "../actions"
import { formatWhen } from "./format"

/*
 * Collections and controlled tags (spec §8 A4, §11; S2-LIBRARY). A
 * collection gathers photos for a campaign by reference: removing a photo
 * from it never deletes the photo. Tags are an admin-kept vocabulary; a
 * retired tag stays on photos but can't be added.
 */

/** Add a tag (second handoff): one row, the name field and Add tag. */
function AddTagForm() {
  const router = useRouter()
  const [name, setName] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  return (
    <form
      className="grid gap-3 rounded-card border border-line bg-surface p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        startTransition(async () => {
          const r = await saveTagAction({ name })
          if (!r.ok) setError(r.error)
          else {
            setName("")
            router.refresh()
          }
        })
      }}
    >
      <FormField
        label="New tag"
        description="Up to 40 characters"
        error={error}
      >
        <Input
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.currentTarget.value)}
        />
      </FormField>
      <div>
        <Button type="submit" variant="primary" loading={pending}>
          <PlusIcon aria-hidden />
          Add tag
        </Button>
      </div>
    </form>
  )
}

/**
 * New collection (second handoff, decision 5): the list is the page, so the
 * create form opens in a Dialog from the title-row button.
 */
export function NewCollectionButton() {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const [purpose, setPurpose] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  function reset() {
    setName("")
    setPurpose("")
    setError(null)
  }

  return (
    <>
      <Button
        variant="primary"
        onClick={() => setOpen(true)}
        data-testid="collection-new"
      >
        <PlusIcon aria-hidden data-icon="inline-start" />
        New collection
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (pending) return
          if (!next) reset()
          setOpen(next)
        }}
      >
        <DialogContent>
          <form
            className="grid gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              setError(null)
              startTransition(async () => {
                const r = await saveCollectionAction({
                  name,
                  purpose: purpose || null,
                })
                if (!r.ok) setError(r.error)
                else {
                  reset()
                  setOpen(false)
                  router.refresh()
                }
              })
            }}
          >
            <DialogHeader>
              <DialogTitle>New collection</DialogTitle>
              <DialogDescription>
                A collection points at photos; it never copies or deletes them.
              </DialogDescription>
            </DialogHeader>
            <FormField label="Name" error={error}>
              <Input
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.currentTarget.value)}
              />
            </FormField>
            <FormField label="What it is for" optional>
              <Textarea
                value={purpose}
                maxLength={500}
                rows={2}
                onChange={(e) => setPurpose(e.currentTarget.value)}
              />
            </FormField>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={pending}>
                Add collection
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** "12 photos · The Old Crown 8 · The Bell 4"; past two venues, a count. */
function collectionLine(c: LibraryCollection) {
  const photos = `${c.assetCount} ${c.assetCount === 1 ? "photo" : "photos"}`
  if (c.venues.length === 0) return photos
  const shown = c.venues.slice(0, 2).map((v) => `${v.venueName} ${v.count}`)
  const rest = c.venues.length - shown.length
  return [
    photos,
    ...shown,
    ...(rest > 0 ? [`${rest} more ${rest === 1 ? "venue" : "venues"}`] : []),
  ].join(" · ")
}

export function CollectionsView({
  collections,
  showArchived,
}: {
  collections: LibraryCollection[]
  showArchived: boolean
}) {
  return (
    <div className="grid gap-6">
      {collections.length === 0 ? (
        <EmptyState
          title={
            showArchived ? "No collections yet." : "No open collections yet."
          }
          description={
            <p>
              Start one with New collection, then add photos to it from a
              photo&apos;s details page.
            </p>
          }
        />
      ) : (
        <div data-testid="collections" className="contents">
          <RowList list>
            {collections.map((c) => (
              <Row
                key={c.id}
                icon={<FolderSimpleIcon />}
                href={`/admin/library/collections/${c.id}`}
                title={c.name}
                subtitle={
                  <>
                    {c.purpose ? (
                      <span className="block [overflow-wrap:anywhere]">
                        {c.purpose}
                      </span>
                    ) : null}
                    <span className="block font-mono">{collectionLine(c)}</span>
                  </>
                }
                chips={
                  c.archivedAt ? (
                    <StatusChip tone="closed">Archived</StatusChip>
                  ) : undefined
                }
              />
            ))}
          </RowList>
        </div>
      )}
      <Link
        href={
          showArchived
            ? "/admin/library/collections"
            : "/admin/library/collections?archived=1"
        }
        className="inline-flex min-h-11 w-fit items-center px-1 text-body text-accent-text underline underline-offset-4"
      >
        {showArchived
          ? "Hide archived collections"
          : "Show archived collections"}
      </Link>
    </div>
  )
}

export type CollectionPhoto = {
  id: string
  venueId: string
  venueName: string
  contributorName: string
  createdAt: string
  thumbnailUrl: string | null
}

export function CollectionDetailView({
  collection,
  photos,
  more,
}: {
  collection: LibraryCollection
  photos: CollectionPhoto[]
  /** More photos than shown: they are in the Library with this filter. */
  more: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)
  const archived = collection.archivedAt !== null

  const byVenue = new Map<string, { name: string; ids: string[] }>()
  for (const p of photos) {
    const entry = byVenue.get(p.venueId) ?? { name: p.venueName, ids: [] }
    entry.ids.push(p.id)
    byVenue.set(p.venueId, entry)
  }

  function run(
    action: () => Promise<{ ok: true } | { ok: false; error: string }>
  ) {
    setError(null)
    startTransition(async () => {
      const r = await action()
      if (!r.ok) setError(r.error)
      else router.refresh()
    })
  }

  const exports = [...byVenue.entries()]
  const photoCount = `${collection.assetCount} ${collection.assetCount === 1 ? "photo" : "photos"}`

  return (
    <div className="grid gap-6">
      {/* Second handoff: the exports are the title row's buttons, the first
          one the bottle; Archive moves behind the menu. */}
      <PageHeader
        scope="Collection"
        title={collection.name}
        summary={
          <p>{[collection.purpose, photoCount].filter(Boolean).join(" · ")}</p>
        }
        actions={
          <>
            {exports.map(([venueId, v], i) => (
              <Link
                key={venueId}
                href={`/admin/publishing/new?venue=${venueId}&assets=${v.ids.join(",")}`}
                className={buttonVariants({
                  variant: i === 0 ? "primary" : "secondary",
                })}
              >
                <DownloadSimpleIcon aria-hidden data-icon="inline-start" />
                Export {v.ids.length} from {v.name}
              </Link>
            ))}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="quiet"
                    size="icon"
                    loading={pending}
                    aria-label={`More actions for ${collection.name}`}
                  />
                }
              >
                <DotsThreeIcon weight="bold" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                <DropdownMenuItem
                  onClick={() =>
                    run(() =>
                      saveCollectionAction({
                        collectionId: collection.id,
                        name: collection.name,
                        purpose: collection.purpose,
                        archived: !archived,
                        revision: collection.revision,
                      })
                    )
                  }
                >
                  {archived ? (
                    <ArrowCounterClockwiseIcon aria-hidden />
                  ) : (
                    <ArchiveIcon aria-hidden />
                  )}
                  {archived ? "Restore collection" : "Archive collection"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
        className="pb-0 md:pb-0"
      />
      {archived ? <StatusChip tone="closed">Archived</StatusChip> : null}
      {byVenue.size > 1 ? (
        <Notice tone="info">
          An export package holds one venue&apos;s photos, so each venue is
          exported on its own. Only photos approved for public use can be chosen
          there.
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="negative" role="alert">
          {error}
        </Notice>
      ) : null}
      {photos.length === 0 ? (
        <EmptyState
          title="No photos in this collection."
          description={
            <p>Add photos from a photo&apos;s details page in the library.</p>
          }
        />
      ) : (
        <ul
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
          data-testid="collection-photos"
        >
          {photos.map((p) => (
            <li
              key={p.id}
              className="grid content-start gap-2 rounded-card border border-line bg-surface p-2"
            >
              <Link href={`/admin/library/${p.id}`} className="block">
                <Photo
                  src={p.thumbnailUrl ?? `/api/media/${p.id}/thumb`}
                  alt={`Photo by ${p.contributorName} at ${p.venueName}`}
                  ratio="1/1"
                />
              </Link>
              <span className="text-meta [overflow-wrap:anywhere] text-ink-muted">
                {p.venueName} · {formatWhen(p.createdAt)}
              </span>
              <Button
                variant="quiet"
                size="sm"
                disabled={pending}
                onClick={() =>
                  run(() =>
                    setCollectionItemsAction({
                      collectionId: collection.id,
                      assetIds: [p.id],
                      add: false,
                    })
                  )
                }
              >
                <XCircleIcon aria-hidden />
                Take out
              </Button>
            </li>
          ))}
        </ul>
      )}
      {more ? (
        <p className="text-body text-ink-muted">
          Showing the newest {photos.length}.{" "}
          <Link
            href={`/admin?collection=${collection.id}&use=all`}
            className="text-accent-text underline underline-offset-4"
          >
            See them all in the library
          </Link>
          .
        </p>
      ) : null}
      <p className="text-body text-ink-muted">
        Taking a photo out of a collection never deletes it.
      </p>
      <Link
        href={`/admin?collection=${collection.id}&use=all`}
        className={cn(buttonVariants({ variant: "secondary" }), "w-fit")}
      >
        Open in the library
      </Link>
    </div>
  )
}

export function TagsView({ tags }: { tags: LibraryTag[] }) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState<{
    id: string
    name: string
  } | null>(null)

  function save(tag: LibraryTag, patch: { name?: string; active?: boolean }) {
    setError(null)
    startTransition(async () => {
      const r = await saveTagAction({
        tagId: tag.id,
        name: patch.name ?? tag.name,
        active: patch.active ?? tag.active,
        revision: tag.revision,
      })
      if (!r.ok) setError(r.error)
      else {
        setEditing(null)
        router.refresh()
      }
    })
  }

  return (
    <div className="grid gap-6">
      <AddTagForm />
      {error ? (
        <Notice tone="negative" role="alert">
          {error}
        </Notice>
      ) : null}
      {tags.length === 0 ? (
        <EmptyState
          title="No tags yet."
          description={<p>Add the first one above.</p>}
        />
      ) : (
        // Second handoff: a DataTable so the photo counts line up; stacked
        // rows on a phone.
        <Table stacked framed aria-label="Tags" data-testid="tags">
          <TableHeader>
            <TableRow>
              <TableHead>Tag</TableHead>
              <TableHead numeric>Photos</TableHead>
              <TableHead>
                <span className="sr-only">State</span>
              </TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tags.map((t) => (
              <TableRow key={t.id}>
                <TableHead scope="row" className="h-auto whitespace-normal">
                  {editing?.id === t.id ? (
                    <form
                      className="flex flex-wrap items-end gap-2 py-2"
                      onSubmit={(e) => {
                        e.preventDefault()
                        save(t, { name: editing.name })
                      }}
                    >
                      <FormField label="Tag name" className="min-w-0 flex-1">
                        <Input
                          value={editing.name}
                          maxLength={40}
                          onChange={(e) =>
                            setEditing({
                              id: t.id,
                              name: e.currentTarget.value,
                            })
                          }
                        />
                      </FormField>
                      <Button
                        type="submit"
                        variant="secondary"
                        loading={pending}
                      >
                        Save
                      </Button>
                      <Button
                        type="button"
                        variant="quiet"
                        onClick={() => setEditing(null)}
                      >
                        Cancel
                      </Button>
                    </form>
                  ) : (
                    <Link
                      href={`/admin?tag=${t.id}&use=all`}
                      className="inline-flex min-h-11 items-center text-label [overflow-wrap:anywhere] text-accent-text underline underline-offset-4"
                    >
                      {t.name}
                    </Link>
                  )}
                </TableHead>
                <TableCell label="Photos" numeric>
                  {t.assetCount} {t.assetCount === 1 ? "photo" : "photos"}
                </TableCell>
                <TableCell label="State">
                  {t.active ? null : (
                    <StatusChip tone="closed">Retired</StatusChip>
                  )}
                </TableCell>
                <TableCell label="Actions">
                  {editing?.id === t.id ? null : (
                    <span className="flex flex-wrap justify-end gap-2 max-md:justify-start">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setEditing({ id: t.id, name: t.name })}
                      >
                        Rename
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={pending}
                        onClick={() => save(t, { active: !t.active })}
                      >
                        {t.active ? "Retire" : "Restore"}
                      </Button>
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <p className="text-body text-ink-muted">
        Retiring a tag keeps it on the photos that have it; it can no longer be
        added.
      </p>
    </div>
  )
}
