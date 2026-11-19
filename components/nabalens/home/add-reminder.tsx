import { AlbumAddTrigger } from "@/components/nabalens/album/album-add-trigger"
import { Notice } from "@/components/nabalens/notice"
import type { AlbumCounts } from "@/lib/album/model"
import { HOME_COPY, type Reminder } from "@/lib/staff/home"

/**
 * Home's reminder to add photos (DESIGN.md §5c step 5): words that follow
 * when the person last added photos, the venue's empty count, and the main
 * button (the gallery, then Match; §6.1). It never names a slot (D15).
 */
export function AddReminder({
  reminder,
  counts,
  venueName,
  blocked,
}: {
  reminder: Reminder
  /** The album's counts; null when the album couldn't be read. */
  counts: AlbumCounts | null
  venueName: string
  /** Why the person can't add photos here, in place of the button. */
  blocked: string | null
}) {
  const line = HOME_COPY.reminderLine(reminder)
  return (
    <section
      aria-labelledby="home-reminder"
      className="grid gap-3 rounded-card bg-surface p-4 edge"
      data-slot="add-reminder"
    >
      <div className="grid gap-1">
        <h1 id="home-reminder" className="type-page-title text-ink">
          {HOME_COPY.reminderTitle(reminder)}
        </h1>
        {line ? <p className="text-body text-ink-muted">{line}</p> : null}
        {counts && counts.empty > 0 ? (
          <p className="text-meta text-ink-muted tabular-nums">
            {HOME_COPY.stillEmpty(counts.empty, venueName)}
          </p>
        ) : null}
      </div>
      {blocked ? (
        <Notice tone="attention">{blocked}</Notice>
      ) : (
        <AlbumAddTrigger kind="home" />
      )}
    </section>
  )
}
