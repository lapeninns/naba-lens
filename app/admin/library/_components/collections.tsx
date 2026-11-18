"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  DownloadSimpleIcon,
  PlusIcon,
  XCircleIcon,
} from "@phosphor-icons/react"

import { EmptyState } from "@/components/nabalens/empty-state"
import { Notice } from "@/components/nabalens/notice"
import { StatusChip } from "@/components/nabalens/status-chip"
import { Button, buttonVariants } from "@/components/ui/button"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Photo } from "@/components/ui/photo"
import { Textarea } from "@/components/ui/textarea"
import type { LibraryCollection, LibraryTag } from "@/lib/library/model"

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

/** Create a collection or a tag: one name field (and a purpose) and Add. */
function CreateForm({
  kind,
  onCreate,
}: {
  kind: "collection" | "tag"
  onCreate: (
    name: string,
    purpose: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>
}) {
  const router = useRouter()
  const [name, setName] = React.useState("")
  const [purpose, setPurpose] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  return (
    <form
      className="grid gap-3 rounded-card border border-line bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        startTransition(async () => {
          const r = await onCreate(name, purpose)
          if (!r.ok) setError(r.error)
          else {
            setName("")
            setPurpose("")
            router.refresh()
          }
        })
      }}
    >
      <FormField
        label={kind === "collection" ? "New collection" : "New tag"}
        error={error}
      >
        <Input
          value={name}
          maxLength={kind === "collection" ? 80 : 40}
          onChange={(e) => setName(e.currentTarget.value)}
        />
      </FormField>
      {kind === "collection" ? (
        <FormField label="What it is for" optional>
          <Textarea
            value={purpose}
            maxLength={500}
            rows={2}
            onChange={(e) => setPurpose(e.currentTarget.value)}
          />
        </FormField>
      ) : null}
      <div>
        <Button type="submit" variant="primary" loading={pending}>
          <PlusIcon aria-hidden />
          {kind === "collection" ? "Add collection" : "Add tag"}
        </Button>
      </div>
    </form>
  )
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
      <CreateForm
        kind="collection"
        onCreate={(name, purpose) =>
          saveCollectionAction({ name, purpose: purpose || null })
        }
      />
      {collections.length === 0 ? (
        <EmptyState
          title={
            showArchived ? "No collections yet." : "No open collections yet."
          }
          description={
            <p>Add photos to a collection from a photo&apos;s details page.</p>
          }
        />
      ) : (
        <ul className="grid gap-3" data-testid="collections">
          {collections.map((c) => (
            <li
              key={c.id}
              className="grid gap-2 rounded-card border border-line bg-surface p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/admin/library/collections/${c.id}`}
                  className="text-body font-bold [overflow-wrap:anywhere] text-accent-text underline underline-offset-4"
                >
                  {c.name}
                </Link>
                {c.archivedAt ? (
                  <StatusChip tone="closed">Archived</StatusChip>
                ) : null}
              </div>
              {c.purpose ? (
                <p className="text-body [overflow-wrap:anywhere] text-ink-muted">
                  {c.purpose}
                </p>
              ) : null}
              <p className="font-mono text-meta text-ink-muted">
                {c.assetCount} {c.assetCount === 1 ? "photo" : "photos"}
                {c.venues.length > 0
                  ? ` · ${c.venues.map((v) => `${v.venueName} ${v.count}`).join(" · ")}`
                  : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
      <Link
        href={
          showArchived
            ? "/admin/library/collections"
            : "/admin/library/collections?archived=1"
        }
        className="text-body text-accent-text underline underline-offset-4"
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

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap gap-2">
        {[...byVenue.entries()].map(([venueId, v]) => (
          <Link
            key={venueId}
            href={`/admin/publishing/new?venue=${venueId}&assets=${v.ids.join(",")}`}
            className={buttonVariants({ variant: "secondary" })}
          >
            <DownloadSimpleIcon aria-hidden />
            Export {v.ids.length} from {v.name}
          </Link>
        ))}
        <Link
          href={`/admin?collection=${collection.id}&use=all`}
          className={buttonVariants({ variant: "secondary" })}
        >
          Open in the library
        </Link>
        <Button
          variant="secondary"
          loading={pending}
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
        </Button>
      </div>
      {byVenue.size > 1 ? (
        <p className="text-body text-ink-muted">
          An export package holds one venue&apos;s photos, so each venue is
          exported on its own. Only photos approved for public use can be chosen
          there.
        </p>
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
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
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
      <CreateForm kind="tag" onCreate={(name) => saveTagAction({ name })} />
      {error ? (
        <Notice tone="negative" role="alert">
          {error}
        </Notice>
      ) : null}
      {tags.length === 0 ? (
        <EmptyState title="No tags yet." />
      ) : (
        <ul className="grid gap-2" data-testid="tags">
          {tags.map((t) => (
            <li
              key={t.id}
              className="grid gap-2 rounded-card border border-line bg-surface p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
            >
              {editing?.id === t.id ? (
                <form
                  className="flex flex-wrap items-end gap-2"
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
                        setEditing({ id: t.id, name: e.currentTarget.value })
                      }
                    />
                  </FormField>
                  <Button type="submit" variant="primary" loading={pending}>
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setEditing(null)}
                  >
                    Cancel
                  </Button>
                </form>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/admin?tag=${t.id}&use=all`}
                    className="text-body font-bold text-accent-text underline underline-offset-4"
                  >
                    {t.name}
                  </Link>
                  <span className="font-mono text-meta text-ink-muted">
                    {t.assetCount} {t.assetCount === 1 ? "photo" : "photos"}
                  </span>
                  {t.active ? null : (
                    <StatusChip tone="closed">Retired</StatusChip>
                  )}
                </div>
              )}
              {editing?.id === t.id ? null : (
                <div className="flex flex-wrap gap-2">
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
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-body text-ink-muted">
        Retiring a tag keeps it on the photos that have it; it can no longer be
        added.
      </p>
    </div>
  )
}
