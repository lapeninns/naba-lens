import Link from "next/link"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"

import { buttonVariants } from "@/components/ui/button"

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
}: {
  venueName: string
  title: string
  noteTitle?: string
  note: string
  back?: { href: string; label: string }
}) {
  return (
    <div className="grid gap-(--gutter)">
      {back ? (
        <Link
          href={back.href}
          className={buttonVariants({
            variant: "link",
            className: "justify-self-start",
          })}
        >
          <ArrowLeftIcon data-icon="inline-start" aria-hidden />
          {back.label}
        </Link>
      ) : null}
      <PageHeader
        scope={venueName}
        venueScope
        title={title}
        className="pb-0 md:pb-0"
      />
      <Notice tone="plain" title={noteTitle} className="max-w-(--size-reading)">
        <p>{note}</p>
      </Notice>
    </div>
  )
}
