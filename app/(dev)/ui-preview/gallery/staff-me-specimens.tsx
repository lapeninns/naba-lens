"use client"

import { AlbumPlaceScreen } from "@/components/nabalens/album/album-place"
import { AlbumSlotScreen } from "@/components/nabalens/album/slot-screen"
import { ContributionNoticeCard } from "@/components/nabalens/me/contribution-notice"
import { MeAccount } from "@/components/nabalens/me/me-account"
import { MyUploads } from "@/components/nabalens/me/my-uploads"
import { NoticesInbox } from "@/components/nabalens/me/notices-inbox"
import { currentPlace, findSlot, type AlbumView } from "@/lib/album/model"
import type { MyUpload } from "@/lib/staff/my-uploads"

/*
 * DEV FIXTURE (S2-STAFF): Album filters, a slot page, My uploads, Help and
 * account, notices and the first sign-in notice, on made-up data. Nothing
 * here is a real person, venue or photo; every action answers at once.
 */

const V = "00000000-0000-4000-8000-0000000000f1"
const ok = async () => ({ ok: true as const })

function upload(
  n: number,
  over: Partial<MyUpload> & Pick<MyUpload, "slots">
): MyUpload {
  return {
    assetId: `00000000-0000-4000-8000-00000000e00${n}`,
    venueId: V,
    venueName: "The Bell",
    mediaType: "image",
    uploadState: "ready",
    uploadedAt: "2026-11-12T10:00:00Z",
    capturedAt: null,
    capturedAtSource: "unknown",
    duplicate: false,
    labelRevision: 1,
    sharedKinds: [],
    labelHelp: false,
    removalRequested: false,
    removalRequestId: null,
    ...over,
  }
}

const slot = (
  name: string,
  outcome: MyUpload["slots"][number]["outcome"],
  reason: string | null = null
): MyUpload["slots"][number] => ({
  kind: "dish",
  slotId: "00000000-0000-4000-8000-0000000d0001",
  name,
  outcome,
  reason,
  decidedAt: null,
  replacesAssetId: null,
  retakeAnswered: false,
})

const UPLOADS: MyUpload[] = [
  upload(1, {
    slots: [
      slot("Guinness, pint", "retake_requested", "Show the glass side on"),
    ],
  }),
  upload(2, { uploadState: "failed", slots: [] }),
  upload(3, { uploadState: "processing", slots: [] }),
  upload(4, {
    slots: [slot("House red", "awaiting_review")],
    capturedAt: "2026-11-11T19:30:00Z",
    capturedAtSource: "metadata",
  }),
  upload(5, {
    venueId: "00000000-0000-4000-8000-0000000000f2",
    venueName: "The Crown",
    slots: [slot("Aperol spritz", "public")],
  }),
  upload(6, { slots: [slot("Eton mess", "reference")] }),
  upload(7, { slots: [slot("Cider, half", "not_used")] }),
]

function Frame({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-3">
      <h3 className="type-heading-sm text-ink">{title}</h3>
      <div className="max-w-feed rounded-card bg-canvas p-3 edge">
        {children}
      </div>
    </div>
  )
}

export function StaffMeSpecimens({
  album,
  barId,
}: {
  album: AlbumView
  barId: string
}) {
  const bar = currentPlace(album, barId)!
  const firstFilled =
    bar.groups.flatMap((g) => g.slots).find((s) => s.state === "accepted") ??
    bar.groups[0]!.slots[0]!
  const found = findSlot(album, firstFilled.id)!
  return (
    <div className="grid gap-8">
      <Frame title="A place, filtered to Retake or needs checking (spec §6 S3: Needs updating)">
        <AlbumPlaceScreen
          venueName="The Bell"
          place={bar}
          canAdd
          filter={{ show: "updating", category: null }}
          sendReport={async () => ({ ok: true, created: true })}
          headingLevel={4}
        />
      </Frame>
      <Frame title="A slot page, asked to retake (spec §6 S3)">
        <AlbumSlotScreen
          venueName="The Bell"
          placeLabel={found.place.label}
          placeHref="#"
          slot={{ ...found.slot, pendingCount: 2 }}
          retake={{ reason: "Show the glass side on" }}
          ownPhotos={[
            {
              assetId: "00000000-0000-4000-8000-00000000e001",
              outcome: "retake_requested",
              uploadedAt: "2026-11-12T10:00:00Z",
            },
          ]}
          canAdd
          blocked={null}
          sendReport={async () => ({ ok: true, created: true })}
          headingLevel={4}
        />
      </Frame>
      <Frame title="My uploads (spec §6 S4)">
        <MyUploads
          initial={{ items: UPLOADS, next: null }}
          currentVenueId={V}
          actions={{
            loadMore: async () => ({
              ok: true,
              page: { items: [], next: null },
            }),
            withdraw: ok,
            changeSlot: ok,
            loadBoard: async () => ({
              ok: true,
              board: { slots: [], amenities: [] },
            }),
            requestRemoval: ok,
            report: async () => ({ ok: true, created: true }),
          }}
          headingLevel={4}
        />
      </Frame>
      <Frame title="My uploads, empty and unread">
        <div className="grid gap-4">
          <MyUploads
            initial={{ items: [], next: null }}
            currentVenueId={V}
            actions={{} as never}
            headingLevel={4}
          />
          <MyUploads
            initial={null}
            currentVenueId={V}
            actions={{} as never}
            headingLevel={4}
          />
        </div>
      </Frame>
      <Frame title="Help and account (spec §6 S5)">
        <MeAccount
          venues={[
            {
              venueId: V,
              venueName: "The Bell",
              role: "staff",
              isActive: true,
            },
            {
              venueId: "00000000-0000-4000-8000-0000000000f2",
              venueName: "The Crown",
              role: "manager",
              isActive: false,
            },
          ]}
          switchVenue={async () => ({ ok: false, code: "failed" })}
          managers={[
            {
              id: "m1",
              displayName: "Sam Example",
              jobTitle: "General manager",
              isYou: false,
            },
          ]}
          unread={2}
          helpHref="#"
          headingLevel={4}
        />
      </Frame>
      <Frame title="Notices (spec §17)">
        <NoticesInbox
          initial={{
            items: [
              {
                id: 2,
                kind: "retake_requested",
                subjectType: "menu_item",
                subjectId: null,
                venueId: V,
                venueName: "The Bell",
                payload: {
                  source: "menu_photo",
                  itemName: "Guinness, pint",
                  reason: "Show the glass side on",
                },
                createdAt: "2026-11-18T10:00:00Z",
                state: "unread",
              },
              {
                id: 1,
                kind: "upload_problem",
                subjectType: "media_asset",
                subjectId: null,
                venueId: V,
                venueName: "The Bell",
                payload: { problem: "upload_failed" },
                createdAt: "2026-11-17T10:00:00Z",
                state: "read",
              },
            ],
            unread: 1,
            nextBefore: null,
          }}
          preferences={{
            retakes: true,
            assignments: true,
            uploadProblems: true,
            digests: false,
            quietStart: null,
            quietEnd: null,
            organisationQuietStart: "21:00",
            organisationQuietEnd: "08:00",
            timezone: "Europe/London",
          }}
          actions={{
            loadMore: async () => ({
              ok: true,
              inbox: { items: [], unread: 0, nextBefore: null },
            }),
            markRead: async () => ({ ok: true, changed: 1 }),
            savePreferences: async () => ({
              ok: false,
              error: "Preview only.",
            }),
          }}
        />
      </Frame>
      <Frame title="First sign-in notice (spec §3.2)">
        <ContributionNoticeCard
          venueName="The Bell"
          roleLabel="Staff"
          acknowledged={false}
          acknowledge={async () => ({ ok: true })}
        />
      </Frame>
    </div>
  )
}
