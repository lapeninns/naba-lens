import { Card } from "@/components/nabalens/common-room/card"
import { formatBytes } from "@/components/nabalens/format"
import { MEDIA_LIMITS } from "@/lib/config/media"

import { GUIDE_PATH } from "./task-photo-guide"

/** Where "If you can't add photos" lives: a section of the Photo guide. */
export const CANT_ADD_ID = "cant-add"
export const CANT_ADD_HREF = `${GUIDE_PATH}#${CANT_ADD_ID}`

/*
 * Help when adding photos is refused (spec §6 S5, §15.3; AC06, AC10;
 * S2-STAFF): photo access on the phone (Add photos opens the phone's own
 * gallery, DESIGN.md §2), the files Naba-Lens takes and their limits (from
 * lib/config/media.ts, the same numbers the upload checks), and what an
 * account or venue refusal means. Plain words, in one place.
 */
export const CANT_ADD_COPY = {
  title: "If you can't add photos",
  access: {
    title: "Photo access on your phone",
    points: [
      "Add photos opens your phone's own photos. If your phone asks, allow access to Photos.",
      "iPhone: if you only see some photos, open Settings, then Privacy & Security, then Photos, and choose Full Access for your browser.",
      "Android: if you said no before, open Settings, then Apps, then your browser, then Permissions, and allow Photos and videos.",
    ],
  },
  files: {
    title: "Files Naba-Lens takes",
    points: [
      `Photos: JPEG, PNG, WebP or HEIC, up to ${formatBytes(MEDIA_LIMITS.maxPhotoBytes)} each.`,
      `Videos: MP4 or MOV, up to ${MEDIA_LIMITS.maxVideoSeconds} seconds and ${formatBytes(MEDIA_LIMITS.maxVideoBytes)} each.`,
      `Up to ${MEDIA_LIMITS.maxBatchFiles} at a time.`,
      "Screenshots and photos forwarded in other apps lose their quality: add the photo from your camera roll instead.",
    ],
  },
  account: {
    title: "If it says you can't add photos",
    points: [
      "Your account needs a venue, and the venue must be taking photos. Ask your manager or an admin.",
      "If you work at more than one venue, check which one you are working at on Me.",
    ],
  },
} as const

export function CantAddHelp() {
  const groups = [
    CANT_ADD_COPY.access,
    CANT_ADD_COPY.files,
    CANT_ADD_COPY.account,
  ]
  return (
    <Card
      as="section"
      id={CANT_ADD_ID}
      aria-labelledby={`${CANT_ADD_ID}-heading`}
      className="scroll-mt-20"
    >
      <h2 id={`${CANT_ADD_ID}-heading`} className="type-section-title text-ink">
        {CANT_ADD_COPY.title}
      </h2>
      {groups.map((group) => (
        <div key={group.title} className="grid max-w-reading gap-1.5">
          <h3 className="text-item-title text-ink">{group.title}</h3>
          <ul className="grid list-disc gap-1.5 pl-5 text-body text-ink">
            {group.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </div>
      ))}
    </Card>
  )
}
