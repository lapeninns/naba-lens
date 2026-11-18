"use client"

import { ImagesIcon } from "@phosphor-icons/react"

import { AlbumSlotTile } from "@/components/nabalens/album/album-home"
import {
  useAdd,
  type OpenAddOptions,
} from "@/components/nabalens/shell/add-context"
import { Button } from "@/components/ui/button"
import type { AlbumSlot } from "@/lib/album/model"
import {
  staffDateWords,
  staffRequestExtras,
  type StaffRequest,
} from "@/lib/requests/model"

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
  addPhotos: "Add photos for this",
  more: (n: number) => `${n} more in the album`,
} as const

/** Shown at most, the person's own first (the read orders them). */
const MAX = 6

export type AskedForItem = {
  request: StaffRequest
  /** The album's own slot, when the request is on one the album shows. */
  slot: AlbumSlot | null
}

/** Pairs each request with the album slot it points at. */
export function askedForItems(
  requests: StaffRequest[],
  slots: ReadonlyMap<string, AlbumSlot>
): AskedForItem[] {
  return requests.flatMap((request): AskedForItem[] => {
    if (!request.slot) return [{ request, slot: null }]
    const slot = slots.get(`${request.slot.kind}:${request.slot.slotId}`)
    // A slot the album no longer shows (Not here, retired) is left out.
    return slot ? [{ request, slot }] : []
  })
}

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
    if (canAdd && openAdd) openAdd(opts)
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
        <span className="font-mono text-mono font-semibold text-ink-muted tabular-nums">
          {ASKED_FOR_COPY.count(items.length)}
        </span>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {shown.map(({ request, slot }) => {
          const when = staffDateWords(request.neededBy, today)
          const extras = staffRequestExtras(request)
          return (
            <li
              key={request.id}
              className="grid content-start gap-1"
              data-request-id={request.id}
            >
              {slot ? (
                <AlbumSlotTile slot={slot} add={add} />
              ) : (
                <div className="grid aspect-square content-between gap-2 rounded-card bg-surface p-3 edge">
                  <span className="text-label [overflow-wrap:anywhere] text-ink">
                    {request.subject}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={!canAdd}
                    onClick={() => add({ match: { place: null } })}
                  >
                    <ImagesIcon data-icon="inline-start" aria-hidden />
                    {ASKED_FOR_COPY.addPhotos}
                  </Button>
                </div>
              )}
              <p className="text-body [overflow-wrap:anywhere] text-ink">
                {request.brief}
              </p>
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
