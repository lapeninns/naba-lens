"use client"

import {
  CoverageNotice,
  type Notice,
} from "@/components/nabalens/coverage/coverage-notice"

export type Announcement = Notice

/**
 * The Review screen's one polite live region: what the last decision did
 * ("Accepted for Soup. Soup now has a photo."), or a conflict warning. It can
 * take focus, for when the decided card was the last one with actions.
 */
export function Announcer({
  announcement,
  onDismiss,
  ref,
}: {
  announcement: Announcement | null
  onDismiss: () => void
  ref?: React.Ref<HTMLDivElement>
}) {
  return (
    <div className="sticky top-2 z-20 empty:hidden">
      <CoverageNotice ref={ref} notice={announcement} onDismiss={onDismiss} />
    </div>
  )
}
