import Link from "next/link"
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr"

import { EmptyState } from "@/components/nabalens/empty-state"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

import {
  ALBUM_COLUMNS,
  tintLevel,
  type AdminAlbumCell,
  type AdminAlbumGap,
  type AdminAlbums,
  type AlbumColumn,
  type SlotCounts,
} from "./albums-model"

/*
 * Admin albums (DESIGN.md §6.6). First what is missing across the group
 * (§11 rule 3), then the matrix, venues down and Food, Drinks, Amenities,
 * Areas across, each cell "filled of total" on a tint that darkens as it
 * fills, then the biggest gaps. Colour is never alone (§4, §8): every cell
 * writes its numbers, and None yet, Full and the waiting count in words.
 * The table scrolls inside its own box on a narrow screen (§8).
 *
 * Venues are listed by name. Nothing here ranks staff (§9); the gaps are
 * ordered by how many slots are still empty, which is where work is needed.
 */

export const ADMIN_ALBUMS_COPY = {
  title: "Albums",
  scope: "All venues",
  summary:
    "Every venue's album: how many slots have an accepted photo, out of every slot it has.",
  stillEmpty: (n: number) =>
    n === 1 ? "slot still empty" : "slots still empty",
  acrossVenues: (n: number) =>
    n === 1 ? "across 1 venue" : `across ${n} venues`,
  allFull: "Every slot at every venue has a photo",
  line: (c: SlotCounts) =>
    `${c.filled} in · ${c.waiting} waiting · ${c.total} in all`,
  matrixTitle: "By venue",
  venue: "Venue",
  allVenues: "All venues",
  filledOf: (c: SlotCounts) => `${c.filled} of ${c.total}`,
  waiting: (n: number) => `${n} waiting`,
  full: "Full",
  noneYet: "None yet",
  noSlots: "None listed",
  noMenu: "No menu",
  unavailable: "Couldn't load",
  unavailableNote:
    "Some cells couldn't be loaded. Reload the page to try again; the rest is up to date.",
  legendTitle: "The darker the cell, the more of it is filled",
  legend: ["None yet", "Under half", "Half or more", "Full"],
  gapsTitle: "Biggest gaps",
  gapsIntro: "Where the most slots are still empty.",
  noGaps: "No slot is empty. Photos still waiting for review are not gaps.",
  gapEmpty: (gap: AdminAlbumGap) => `${gap.empty} of ${gap.total} still empty`,
  emptyTitle: "No venues yet",
  emptyText: "When a venue is added, its album appears here.",
}

/**
 * The cell tints, lightest to darkest (DESIGN.md §3.1 ok tones). Half or more
 * has its own step, `ok-half`: `ok-waiting` means Waiting on a count bar.
 */
const TINT: Record<0 | 1 | 2 | 3, string> = {
  0: "bg-surface text-ink",
  1: "bg-ok-bg text-ink",
  2: "bg-ok-half text-ink",
  3: "bg-ok-fg text-on-ok",
}

function gapHref(gap: AdminAlbumGap) {
  const base = `/admin/coverage/${gap.venueId}`
  switch (gap.column) {
    case "food":
    case "drinks":
      return `${base}/menu-photos`
    case "amenities":
      return `${base}/amenities`
    case "areas":
      return `${base}/amenities/places`
  }
}

function CountsCell({ counts, label }: { counts: SlotCounts; label: string }) {
  const level = tintLevel(counts)
  const word =
    level === null
      ? ADMIN_ALBUMS_COPY.noSlots
      : level === 3
        ? ADMIN_ALBUMS_COPY.full
        : counts.waiting > 0
          ? ADMIN_ALBUMS_COPY.waiting(counts.waiting)
          : level === 0
            ? ADMIN_ALBUMS_COPY.noneYet
            : null
  return (
    <TableCell
      label={label}
      data-tint={level ?? "none"}
      className={cn(
        "min-w-32 border-l border-line align-top",
        level === null ? "bg-surface text-ink-muted" : TINT[level]
      )}
    >
      {level === null ? (
        <span className="text-body">{word}</span>
      ) : (
        <span className="grid gap-0.5">
          <span className="font-mono text-mono font-semibold tabular-nums">
            {ADMIN_ALBUMS_COPY.filledOf(counts)}
          </span>
          {word ? <span className="text-meta">{word}</span> : null}
        </span>
      )}
    </TableCell>
  )
}

function Cell({ cell, label }: { cell: AdminAlbumCell; label: string }) {
  if (cell.kind === "counts") return <CountsCell counts={cell} label={label} />
  return (
    <TableCell
      label={label}
      data-tint="none"
      className="min-w-32 border-l border-line bg-surface align-top text-body text-ink-muted"
    >
      {cell.kind === "no-menu"
        ? ADMIN_ALBUMS_COPY.noMenu
        : ADMIN_ALBUMS_COPY.unavailable}
    </TableCell>
  )
}

function Legend() {
  return (
    <div className="grid gap-2">
      <p id="albums-legend" className="text-meta text-ink-muted">
        {ADMIN_ALBUMS_COPY.legendTitle}
      </p>
      <ul
        aria-labelledby="albums-legend"
        className="flex flex-wrap gap-x-4 gap-y-2"
      >
        {([0, 1, 2, 3] as const).map((level) => (
          <li key={level} className="flex items-center gap-2 text-meta">
            <span
              aria-hidden
              className={cn(
                "size-6 shrink-0 rounded-control border border-line",
                TINT[level]
              )}
            />
            {ADMIN_ALBUMS_COPY.legend[level]}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Gaps({ gaps }: { gaps: AdminAlbumGap[] }) {
  const columnLabel = (key: AlbumColumn) =>
    ALBUM_COLUMNS.find((c) => c.key === key)?.label ?? ""
  return (
    <section aria-labelledby="albums-gaps-title" className="grid gap-3">
      <div className="grid gap-1 px-1">
        <h2 id="albums-gaps-title" className="type-section-title text-ink">
          {ADMIN_ALBUMS_COPY.gapsTitle}
        </h2>
        <p className="text-body text-ink-muted">
          {gaps.length ? ADMIN_ALBUMS_COPY.gapsIntro : ADMIN_ALBUMS_COPY.noGaps}
        </p>
      </div>
      {gaps.length ? (
        <ol className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {gaps.map((gap) => (
            <li key={`${gap.venueId}:${gap.column}:${gap.group}`}>
              <Link
                href={gapHref(gap)}
                className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 focus-ring-inset outline-none hover:bg-surface-2"
              >
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-label text-ink">
                    {gap.venueName} · {gap.group}
                  </span>
                  <span className="text-meta text-ink-muted">
                    {columnLabel(gap.column)}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-mono font-semibold text-ink tabular-nums">
                    {ADMIN_ALBUMS_COPY.gapEmpty(gap)}
                  </span>
                  <CaretRightIcon
                    aria-hidden
                    className="size-5 text-ink-muted"
                  />
                </span>
              </Link>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  )
}

export function AdminAlbumsView({ albums }: { albums: AdminAlbums }) {
  if (albums.rows.length === 0)
    return (
      <EmptyState
        title={ADMIN_ALBUMS_COPY.emptyTitle}
        description={<p>{ADMIN_ALBUMS_COPY.emptyText}</p>}
      />
    )
  const all = ALBUM_COLUMNS.reduce(
    (n, { key }) => ({
      filled: n.filled + albums.totals[key].filled,
      waiting: n.waiting + albums.totals[key].waiting,
      total: n.total + albums.totals[key].total,
    }),
    { filled: 0, waiting: 0, total: 0 }
  )
  const unavailable = albums.rows.some((row) =>
    ALBUM_COLUMNS.some(({ key }) => row.cells[key].kind === "unavailable")
  )

  return (
    <div className="grid gap-6">
      <section aria-labelledby="albums-count" className="grid gap-1 px-1">
        {albums.empty > 0 ? (
          <p
            id="albums-count"
            className="flex flex-wrap items-baseline gap-x-2"
          >
            <span className="type-figure text-ink tabular-nums">
              {albums.empty}
            </span>
            <span className="text-label text-ink">
              {ADMIN_ALBUMS_COPY.stillEmpty(albums.empty)}{" "}
              {ADMIN_ALBUMS_COPY.acrossVenues(albums.rows.length)}
            </span>
          </p>
        ) : (
          <p id="albums-count" className="text-label text-ink">
            {ADMIN_ALBUMS_COPY.allFull}
          </p>
        )}
        <p className="font-mono text-mono font-semibold text-ink-muted tabular-nums">
          {ADMIN_ALBUMS_COPY.line(all)}
        </p>
      </section>

      <section aria-labelledby="albums-matrix-title" className="grid gap-3">
        <h2
          id="albums-matrix-title"
          className="px-1 type-section-title text-ink"
        >
          {ADMIN_ALBUMS_COPY.matrixTitle}
        </h2>
        <div className="px-1">
          <Legend />
        </div>
        {unavailable ? (
          <p className="px-1 text-body text-warn-fg">
            {ADMIN_ALBUMS_COPY.unavailableNote}
          </p>
        ) : null}
        <Table
          framed
          aria-labelledby="albums-matrix-title"
          className="min-w-[40rem]"
        >
          <TableHeader>
            <TableRow>
              <TableHead>{ADMIN_ALBUMS_COPY.venue}</TableHead>
              {ALBUM_COLUMNS.map((c) => (
                <TableHead key={c.key} className="border-l border-line">
                  {c.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {albums.rows.map((row) => (
              <TableRow key={row.venueId} className="hover:bg-transparent">
                <TableHead scope="row" className="align-top text-ink">
                  <Link
                    href={`/admin/coverage/${row.venueId}`}
                    className="inline-flex min-h-12 items-center underline decoration-1 underline-offset-4 focus-ring outline-none hover:decoration-2"
                  >
                    {row.venueName}
                  </Link>
                </TableHead>
                {ALBUM_COLUMNS.map((c) => (
                  <Cell key={c.key} cell={row.cells[c.key]} label={c.label} />
                ))}
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableHead scope="row" className="text-ink">
                {ADMIN_ALBUMS_COPY.allVenues}
              </TableHead>
              {ALBUM_COLUMNS.map((c) => (
                <CountsCell
                  key={c.key}
                  counts={albums.totals[c.key]}
                  label={c.label}
                />
              ))}
            </TableRow>
          </TableFooter>
        </Table>
      </section>

      <Gaps gaps={albums.gaps} />
    </div>
  )
}
