"use client"

// DEV FIXTURE: interactive preview of every Naba-Lens component with fake data
// and a fake uploader. Never linked from the app; the route 404s in production.

import * as React from "react"
import {
  PencilSimpleIcon,
  UploadSimpleIcon,
  UserPlusIcon,
} from "@phosphor-icons/react"
import { useTheme } from "next-themes"

import {
  AppShell,
  ConfirmDeleteDialog,
  EditProfileDialog,
  EMPTY_LIBRARY_FILTERS,
  EmptyState,
  InviteStaffDialog,
  LibraryFilters,
  LoadMoreButton,
  LoginCard,
  MediaGrid,
  MediaGridSkeleton,
  MediaViewer,
  ProfileHeader,
  StaffDirectoryTable,
  UploadDialog,
  type InviteResult,
  type LibraryFilterValue,
  type MediaItem,
  type Uploader,
} from "@/components/nabalens"
import { Button } from "@/components/ui/button"
import { OptionSelect } from "@/components/nabalens/option-select"

import {
  FAKE_MEDIA,
  FAKE_STAFF,
  FAKE_STAFF_OPTIONS,
  FAKE_VENUES,
  PREVIEW_LIMITS,
  PREVIEW_MAX_AVATAR_BYTES,
} from "./fixtures"

/** Fake uploader: ticks progress, then "processes". Files named *fail* fail. */
const fakeUploader: Uploader = (file, ctx) =>
  new Promise<void>((resolve, reject) => {
    let progress = 0
    const timers: ReturnType<typeof setTimeout>[] = []
    const abort = () => {
      timers.forEach(clearTimeout)
      reject(new DOMException("Aborted", "AbortError"))
    }
    ctx.signal.addEventListener("abort", abort, { once: true })
    ctx.setResumeToken(ctx.resumeToken ?? `fake-asset-${file.name}`)
    const tick = () => {
      progress += 0.1 + Math.random() * 0.15
      ctx.onProgress(Math.min(progress, 1))
      if (progress < 1) {
        timers.push(setTimeout(tick, 250))
        return
      }
      ctx.onProcessing()
      timers.push(
        setTimeout(() => {
          ctx.signal.removeEventListener("abort", abort)
          if (/fail/i.test(file.name) && ctx.attempt === 1) {
            reject(new Error("The server could not validate this file."))
          } else resolve()
        }, 900)
      )
    }
    timers.push(setTimeout(tick, 200))
  })

function Section({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children: React.ReactNode
}) {
  const id = React.useId()
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <div>
        <h2 id={id} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      </div>
      {children}
    </section>
  )
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-xl border">{children}</div>
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  // Static label: the resolved theme is unknown during server rendering.
  return (
    <Button
      variant="outline"
      size="touch"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      Toggle light or dark theme
    </Button>
  )
}

function applyFilters(items: MediaItem[], f: LibraryFilterValue) {
  const venueName = FAKE_VENUES.find((v) => v.id === f.venueId)?.name
  return items.filter(
    (m) =>
      m.uploadState === "ready" &&
      (!f.venueId || m.venueName === venueName) &&
      (!f.staffId || m.contributorId === f.staffId) &&
      (f.type === "all" || m.mediaType === f.type)
  )
}

export function UiPreview() {
  const [viewerItem, setViewerItem] = React.useState<MediaItem | null>(null)
  const [viewerMode, setViewerMode] = React.useState<"staff" | "admin">("staff")
  const [deleteItem, setDeleteItem] = React.useState<MediaItem | null>(null)
  const [uploadOpen, setUploadOpen] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState<"staff" | "admin" | null>(null)
  const [inviteOpen, setInviteOpen] = React.useState(false)
  const [inviteOutcome, setInviteOutcome] = React.useState<string | null>(
    "sent"
  )
  const [filters, setFilters] = React.useState<LibraryFilterValue>(
    EMPTY_LIBRARY_FILTERS
  )
  const [pagerError, setPagerError] = React.useState(false)
  const [lastEvent, setLastEvent] = React.useState("None yet")

  const own = FAKE_MEDIA.filter(
    (m) => m.contributorId === "staff-1" || m.uploadState !== "ready"
  )
  const library = applyFilters(FAKE_MEDIA, filters)
  const editTarget = FAKE_STAFF[0]

  function openViewer(item: MediaItem, mode: "staff" | "admin") {
    setViewerMode(mode)
    setViewerItem(item)
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-12 px-4 py-8 sm:px-6">
      <header className="grid gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          Naba-Lens UI preview
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Development only. Every name, venue, image and upload here is a fake
          fixture. The uploader is simulated: files with “fail” in the name fail
          on the first attempt.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <ThemeToggle />
          <p className="text-sm" aria-live="polite">
            Last callback: <span className="font-medium">{lastEvent}</span>
          </p>
        </div>
      </header>

      <Section
        title="Login card"
        note="Idle state, and the expired-link state."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="flex justify-center rounded-xl bg-muted/50 px-4 py-10">
            <LoginCard
              onSubmit={async (email) => {
                await new Promise((r) => setTimeout(r, 600))
                setLastEvent(`login link requested for ${email}`)
              }}
            />
          </div>
          <div className="flex justify-center rounded-xl bg-muted/50 px-4 py-10">
            <LoginCard
              linkExpired
              onSubmit={async () => setLastEvent("login (expired card)")}
            />
          </div>
        </div>
      </Section>

      <Section
        title="Staff portfolio"
        note="AppShell staff variant: no navigation, Log out only."
      >
        <Frame>
          <AppShell
            variant="staff"
            userName="Sample staff 1"
            onLogout={() => setLastEvent("logout")}
            className="min-h-0"
          >
            <div className="grid gap-8">
              <ProfileHeader
                displayName={editTarget.displayName}
                avatarUrl={editTarget.avatarUrl}
                jobTitle={editTarget.jobTitle}
                venueName={editTarget.venueName}
                actions={
                  <>
                    <Button
                      variant="outline"
                      size="touch"
                      onClick={() => setEditOpen("staff")}
                    >
                      <PencilSimpleIcon data-icon="inline-start" aria-hidden />
                      Edit profile
                    </Button>
                    <Button size="touch" onClick={() => setUploadOpen(true)}>
                      <UploadSimpleIcon data-icon="inline-start" aria-hidden />
                      Upload photos or videos
                    </Button>
                  </>
                }
              />
              <MediaGrid
                label="Your portfolio"
                items={own}
                onOpen={(m) => openViewer(m, "staff")}
              />
              <LoadMoreButton
                hasMore={false}
                onLoadMore={() => {}}
                shownCount={own.length}
              />
            </div>
          </AppShell>
        </Frame>
      </Section>

      <Section title="Empty and loading states">
        <div className="grid gap-6 lg:grid-cols-2">
          <EmptyState
            action={
              <Button size="touch" onClick={() => setUploadOpen(true)}>
                <UploadSimpleIcon data-icon="inline-start" aria-hidden />
                Upload photos or videos
              </Button>
            }
          />
          <EmptyState
            title="No media matches these filters."
            action={
              <Button
                variant="outline"
                size="touch"
                onClick={() => setFilters(EMPTY_LIBRARY_FILTERS)}
              >
                Clear filters
              </Button>
            }
          />
        </div>
        <MediaGridSkeleton count={6} showAttribution />
      </Section>

      <Section
        title="Admin library"
        note="AppShell admin variant, Content active. Filters are live on the fake data."
      >
        <Frame>
          <AppShell
            variant="admin"
            active="content"
            hrefs={{ content: "#", staff: "#" }}
            userName="Sample admin"
            onLogout={() => setLastEvent("logout")}
            className="min-h-0"
          >
            <div className="grid gap-6">
              <h1 className="text-2xl font-semibold tracking-tight">Content</h1>
              <LibraryFilters
                venues={FAKE_VENUES}
                staff={FAKE_STAFF_OPTIONS}
                value={filters}
                onChange={(v) => {
                  setFilters(v)
                  setLastEvent(`filters ${JSON.stringify(v)}`)
                }}
              />
              {library.length > 0 ? (
                <MediaGrid
                  label="Library"
                  items={library}
                  showAttribution
                  onOpen={(m) => openViewer(m, "admin")}
                />
              ) : (
                <EmptyState
                  title="No media matches these filters."
                  action={
                    <Button
                      variant="outline"
                      size="touch"
                      onClick={() => setFilters(EMPTY_LIBRARY_FILTERS)}
                    >
                      Clear filters
                    </Button>
                  }
                />
              )}
              <LoadMoreButton
                hasMore
                error={pagerError ? "The next page could not be loaded." : null}
                onLoadMore={() => {
                  setPagerError((e) => !e)
                  setLastEvent("load more")
                }}
              />
            </div>
          </AppShell>
        </Frame>
      </Section>

      <Section
        title="Staff directory"
        note="AppShell admin variant, Staff active. Table from 768px, list below."
      >
        <Frame>
          <AppShell
            variant="admin"
            active="staff"
            hrefs={{ content: "#", staff: "#" }}
            onLogout={() => setLastEvent("logout")}
            className="min-h-0"
          >
            <div className="grid gap-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-2xl font-semibold tracking-tight">Staff</h1>
                <Button size="touch" onClick={() => setInviteOpen(true)}>
                  <UserPlusIcon data-icon="inline-start" aria-hidden />
                  Invite staff
                </Button>
              </div>
              <StaffDirectoryTable
                staff={FAKE_STAFF}
                getPortfolioHref={() => "#"}
                onEdit={() => setEditOpen("admin")}
                onResendInvite={(m) =>
                  setLastEvent(`resend invite to ${m.displayName}`)
                }
                onSetActive={(m, active) =>
                  setLastEvent(
                    `${active ? "reactivate" : "deactivate"} ${m.displayName}`
                  )
                }
              />
              <ProfileHeader
                headingLevel="h2"
                displayName="Sample staff 3 with a much longer display name"
                avatarUrl={null}
                jobTitle={null}
                venueName={null}
                actions={
                  <Button
                    variant="outline"
                    size="touch"
                    onClick={() => setEditOpen("admin")}
                  >
                    Edit account
                  </Button>
                }
              />
            </div>
          </AppShell>
        </Frame>
      </Section>

      <Section title="Dialogs" note="Open each dialog directly.">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="touch"
            onClick={() => setUploadOpen(true)}
          >
            Upload dialog
          </Button>
          <Button
            variant="outline"
            size="touch"
            onClick={() => openViewer(FAKE_MEDIA[3], "admin")}
          >
            Viewer: photo (admin)
          </Button>
          <Button
            variant="outline"
            size="touch"
            onClick={() => openViewer(FAKE_MEDIA[2], "admin")}
          >
            Viewer: unplayable video
          </Button>
          <Button
            variant="outline"
            size="touch"
            onClick={() => setDeleteItem(FAKE_MEDIA[3])}
          >
            Confirm delete
          </Button>
          <Button
            variant="outline"
            size="touch"
            onClick={() => setEditOpen("staff")}
          >
            Edit profile (staff)
          </Button>
          <Button
            variant="outline"
            size="touch"
            onClick={() => setEditOpen("admin")}
          >
            Edit account (admin)
          </Button>
          <Button
            variant="outline"
            size="touch"
            onClick={() => setInviteOpen(true)}
          >
            Invite staff
          </Button>
        </div>
        <div className="grid max-w-xs gap-1.5">
          <label htmlFor="invite-outcome" className="text-sm font-medium">
            Fake invite outcome
          </label>
          <OptionSelect
            id="invite-outcome"
            options={[
              { id: "sent", name: "Sent" },
              { id: "partial", name: "Partial failure" },
              { id: "error", name: "Server error (existing email)" },
            ]}
            value={inviteOutcome}
            onValueChange={setInviteOutcome}
          />
        </div>
      </Section>

      <MediaViewer
        item={viewerItem}
        open={viewerItem !== null}
        onOpenChange={(open) => !open && setViewerItem(null)}
        showAttribution={viewerMode === "admin"}
        getDownloadHref={viewerMode === "admin" ? () => "#download" : undefined}
        getPortfolioHref={
          viewerMode === "admin" ? () => "#portfolio" : undefined
        }
        onDelete={(item) => {
          setViewerItem(null)
          setDeleteItem(item)
        }}
      />
      <ConfirmDeleteDialog
        open={deleteItem !== null}
        onOpenChange={(open) => !open && setDeleteItem(null)}
        fileName={deleteItem?.originalFilename}
        onConfirm={async () => {
          await new Promise((r) => setTimeout(r, 500))
          setLastEvent(`deleted ${deleteItem?.originalFilename}`)
          return { ok: true }
        }}
      />
      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        uploader={fakeUploader}
        limits={PREVIEW_LIMITS}
        onUploaded={(n) => setLastEvent(`${n} uploaded, refresh gallery`)}
      />
      <EditProfileDialog
        open={editOpen !== null}
        onOpenChange={(open) => !open && setEditOpen(null)}
        variant={editOpen ?? "staff"}
        initial={{
          displayName: editTarget.displayName,
          avatarUrl: editTarget.avatarUrl,
          jobTitle: editTarget.jobTitle,
          venueId: editTarget.venueId,
          active: true,
        }}
        venues={FAKE_VENUES}
        maxAvatarBytes={PREVIEW_MAX_AVATAR_BYTES}
        onSubmit={async (values) => {
          await new Promise((r) => setTimeout(r, 500))
          setLastEvent(`profile saved: ${values.displayName}`)
          return { ok: true }
        }}
      />
      <InviteStaffDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        venues={FAKE_VENUES}
        onSubmit={async (values): Promise<InviteResult> => {
          await new Promise((r) => setTimeout(r, 500))
          setLastEvent(`invite ${values.email}`)
          if (inviteOutcome === "partial") {
            return {
              status: "partial",
              message:
                "The invitation email could not be sent. Use Resend invitation from the staff list.",
            }
          }
          if (inviteOutcome === "error") {
            return {
              status: "error",
              error: "This email already has a Naba-Lens account.",
              fieldErrors: { email: "Already in use." },
            }
          }
          return { status: "sent" }
        }}
      />
    </div>
  )
}
