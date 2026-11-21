import { BackLink } from "../back-link"
import { Notice } from "../notice"
import { PageHeader } from "../page-header"

/**
 * A workspace page whose data is not switched on yet: the page header scoped
 * to the venue, then a neutral note on what will appear here. No action, as
 * nothing is waiting on the manager.
 */
export function WorkspacePending({
  venueName,
  title,
  noteTitle,
  note,
  back,
  tabs,
}: {
  venueName: string
  title: string
  noteTitle?: string
  note: string
  back?: { href: string; label: string }
  /** The section's tabs, under the title (redesign R4, ia.md). */
  tabs?: React.ReactNode
}) {
  return (
    <div className="grid gap-gutter">
      {back ? (
        <BackLink href={back.href} compact className="-mb-4">
          {back.label}
        </BackLink>
      ) : null}
      <PageHeader
        scope={venueName}
        venueScope
        title={title}
        className="pb-0 md:pb-0"
      />
      {tabs}
      <Notice tone="plain" title={noteTitle} className="max-w-reading">
        <p>{note}</p>
      </Notice>
    </div>
  )
}
