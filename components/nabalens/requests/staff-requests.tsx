"use client"

import { ImagesIcon } from "@phosphor-icons/react"

import { AlbumSlotTile } from "@/components/nabalens/album/album-home"
import {
  useAdd,
  type OpenAddOptions,
} from "@/components/nabalens/shell/add-context"
import { Button } from "@/components/ui/button"
import { Photo } from "@/components/ui/photo"
import type { AskedForItem } from "@/lib/requests/asked-for"
import { staffDateWords, staffRequestExtras } from "@/lib/requests/model"

/*
 * "Asked for" on Album Home (spec §7 M4, AC01; FA-5): a manager's open
 * requests, shown as the slots themselves with the manager's brief under
 * each. Tapping a Needed slot opens the gallery for that slot, so the venue,
 * the slot and the brief are already chosen and nothing is typed (§6.1). A
 * request with no slot (a New brief) opens the gallery for Match. Staff
 * words only: "Needed by", never a due date or Overdue (DESIGN.md §7, §9),
 * and never "task" or "request".
 */

export const ASKED_FOR_COPY = {
  title: "Asked for",
  count: (n: number) => (n === 1 ? "1 slot" : `${n} slots`),
  forYou: "For you",
  example: "Example from the album",
  addPhotos: "Add photos for this",
  more: (n: number) => `${n} more in the album`,
} as const

/** Shown at most, the person's own first (the read orders them). */
const MAX = 6

export function AskedFor({
  items,
  today,
  canAdd,
  headingLevel = 2,
}: {
  items: AskedForItem[]
  today: string
  canAdd: boolean
  headingLevel?: 2 | 3 | 4 | 5
}) {
  const openAdd = useAdd()
  if (items.length === 0) return null
  const add = (opts: OpenAddOptions) => {
    // S2-METRICS (K5): photos started here count under the request route.
    if (canAdd && openAdd) openAdd({ ...opts, route: "request" })
  }
  const Heading = `h${headingLevel}` as "h2"
  const shown = items.slice(0, MAX)
  return (
    <section
      aria-labelledby="album-asked-for"
      className="grid gap-2"
      data-slot="asked-for"
    >
      <div className="flex items-baseline justify-between gap-3">
        <Heading id="album-asked-for" className="type-section-title text-ink">
          {ASKED_FOR_COPY.title}
        </Heading>
        <span className="text-caption text-ink-muted tabular-nums">
          {ASKED_FOR_COPY.count(items.length)}
        </span>
      </div>
      {/* v2 JobCards: one card per request, the slot as its thumbnail
          (it still adds to itself), the brief and when beside it. */}
      <ul className="grid gap-3 md:grid-cols-2">
        {shown.map(({ request, slot }) => {
          const when = staffDateWords(request.neededBy, today)
          const extras = staffRequestExtras(request)
          // The manager's reference photo, else the slot's approved example
          // (its category's shot template; FA-52).
          const example =
            request.referenceAssetId ?? slot?.exampleAssetId ?? null
          return (
            <li
              key={request.id}
              className="grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-3 rounded-card bg-surface p-3 edge"
              data-request-id={request.id}
            >
              {slot ? (
                <AlbumSlotTile slot={slot} add={add} />
              ) : (
                <span
                  aria-hidden
                  className="grid aspect-4/3 w-full place-items-center rounded-card bg-surface-2 text-ink-muted"
                >
                  <ImagesIcon className="size-6" />
                </span>
              )}
              <div className="grid min-w-0 content-start gap-1">
                {slot ? null : (
                  <span className="text-heading [overflow-wrap:anywhere] text-ink">
                    {request.subject}
                  </span>
                )}
                <p className="text-body [overflow-wrap:anywhere] text-ink">
                  {request.brief}
                </p>
                {example ? (
                  <figure className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-2">
                    <Photo
                      src={`/api/media/${encodeURIComponent(example)}/thumb`}
                      alt=""
                      ratio="1/1"
                      radius="square"
                    />
                    <figcaption className="text-meta text-ink-muted">
                      {ASKED_FOR_COPY.example}
                    </figcaption>
                  </figure>
                ) : null}
                {request.forMe || when || extras.length > 0 ? (
                  <p className="text-meta [overflow-wrap:anywhere] text-ink-muted">
                    {[
                      request.forMe ? ASKED_FOR_COPY.forYou : null,
                      when,
                      ...extras,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                ) : null}
                {slot ? null : (
                  <Button
                    type="button"
                    variant="secondary"
                    className="mt-1 w-fit max-w-full"
                    disabled={!canAdd}
                    onClick={() => add({ match: { place: null } })}
                  >
                    <ImagesIcon data-icon="inline-start" aria-hidden />
                    {ASKED_FOR_COPY.addPhotos}
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {items.length > MAX ? (
        <p className="text-meta text-ink-muted">
          {ASKED_FOR_COPY.more(items.length - MAX)}
        </p>
      ) : null}
    </section>
  )
}
