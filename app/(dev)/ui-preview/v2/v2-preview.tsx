"use client"

// DEV FIXTURE: design system v2 (D10) as this app builds it. Every name,
// venue and number here is made up. Never linked from the app.

import * as React from "react"
import Link from "next/link"
import {
  ArrowClockwiseIcon,
  ChartBarIcon,
  ClipboardTextIcon,
  ForkKnifeIcon,
  GearSixIcon,
  HouseIcon,
  ImagesIcon,
  ImagesSquareIcon,
  ListChecksIcon,
  StorefrontIcon,
  UserCircleIcon,
  UsersIcon,
} from "@phosphor-icons/react"

import { AlbumAddTrigger } from "@/components/nabalens/album/album-add-trigger"
import { HomeRow } from "@/components/nabalens/album/home-rows"
import { SlotTile } from "@/components/nabalens/album/slot-tile"
import { TabLink } from "@/components/nabalens/app-shell"
import { ActionDock } from "@/components/nabalens/common-room/action-dock"
import { Row, RowList } from "@/components/nabalens/common-room/row"
import { EmptyState } from "@/components/nabalens/empty-state"
import { MetaList } from "@/components/nabalens/meta-list"
import { Notice } from "@/components/nabalens/notice"
import { SectionTabs } from "@/components/nabalens/section-tabs"
import { SideNav } from "@/components/nabalens/side-nav"
import { StatusChip, V2_TONE } from "@/components/nabalens/status-chip"
import { ThemeSetting } from "@/components/nabalens/theme-setting"
import { Toast } from "@/components/nabalens/toast"
import { VenueBar } from "@/components/nabalens/venue-bar"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { FormField } from "@/components/ui/field"
import { FilterPill, PillGroup } from "@/components/ui/filter-pill"
import { Input } from "@/components/ui/input"
import { OptionRow } from "@/components/ui/option-row"
import { Progress } from "@/components/ui/progress"
import { SearchField } from "@/components/ui/search-field"
import { SelectableTile } from "@/components/ui/selectable-tile"
import { sheetFooter, sheetPopup } from "@/components/ui/sheet-recipe"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

/* ------------------------------------------------------------ frames */

/**
 * One sample four times: light and dark, at a phone's width (390px) and at
 * the full column. Breakpoint variants (md:, desktop:) follow the browser
 * window, not the frame: resize the window to see them change.
 */
function Frames({
  children,
  phone = true,
}: {
  children: React.ReactNode
  /** Leave out the phone frames (desktop-only components). */
  phone?: boolean
}) {
  const frame = (dark: boolean, narrow: boolean) => (
    <figure
      key={`${dark}-${narrow}`}
      className={cn(
        "grid min-w-0 gap-1.5",
        narrow ? "w-full max-w-[390px]" : "w-full"
      )}
    >
      <figcaption className="text-meta text-ink-muted">
        {dark ? "Dark" : "Light"} · {narrow ? "phone, 390px" : "desktop"}
      </figcaption>
      <div
        className={cn(
          "min-w-0 overflow-x-auto rounded-card bg-canvas p-4 text-ink shadow-card",
          dark && "dark"
        )}
      >
        {children}
      </div>
    </figure>
  )
  return (
    <div className="grid min-w-0 gap-4">
      {phone ? (
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          {frame(false, true)}
          {frame(true, true)}
        </div>
      ) : null}
      {frame(false, false)}
      {frame(true, false)}
    </div>
  )
}

function Section({
  id,
  title,
  file,
  children,
}: {
  id: string
  title: string
  file: string
  children: React.ReactNode
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="grid min-w-0 scroll-mt-4 gap-4"
    >
      <div className="grid gap-1 border-b border-line pb-3">
        <h2 id={`${id}-title`} className="type-title text-ink">
          {title}
        </h2>
        <p className="font-mono text-meta text-ink-muted">{file}</p>
      </div>
      {children}
    </section>
  )
}

/* ------------------------------------------------------------ samples */

const STATUS_SAMPLES = [
  "processing",
  "submitted",
  "accepted",
  "needs_another_photo",
  "closed",
  "needs_setup",
  "failed",
  "overdue",
] as const

const STAFF_TABS = [
  { id: "tasks", label: "Album", href: "#tabbar", icon: ImagesSquareIcon },
  { id: "portfolio", label: "Me", href: "#tabbar", icon: UserCircleIcon },
]

const MANAGER_ITEMS = [
  { id: "overview", label: "Overview", href: "#sidenav", icon: HouseIcon },
  {
    id: "review",
    label: "Review",
    href: "#sidenav",
    icon: ImagesIcon,
    count: { value: 4, label: "photos waiting" },
  },
  { id: "album", label: "Album", href: "#sidenav", icon: ListChecksIcon },
  {
    id: "requests",
    label: "Requests",
    href: "#sidenav",
    icon: ClipboardTextIcon,
  },
  { id: "venue", label: "Venue", href: "#sidenav", icon: StorefrontIcon },
]

const ADMIN_ITEMS = [
  { id: "overview", label: "Overview", href: "#sidenav", icon: ChartBarIcon },
  { id: "venues", label: "Venues", href: "#sidenav", icon: StorefrontIcon },
  { id: "menus", label: "Menus", href: "#sidenav", icon: ForkKnifeIcon },
  { id: "people", label: "People", href: "#sidenav", icon: UsersIcon },
  { id: "settings", label: "Settings", href: "#sidenav", icon: GearSixIcon },
]

const SECTIONS = [
  ["button", "Button"],
  ["status-chip", "StatusChip"],
  ["pick-chip", "PickChip"],
  ["job-card", "JobCard"],
  ["subject-card", "SubjectCard"],
  ["upload-row", "UploadRow"],
  ["coverage-meter", "CoverageMeter"],
  ["venue-bar", "VenueBar"],
  ["tabbar", "TabBar"],
  ["field", "Field"],
  ["tabs", "Tabs"],
  ["notice", "Notice"],
  ["sheet", "Sheet and Dialog"],
  ["toast", "Toast"],
  ["thumb-pick", "ThumbPick"],
  ["decision-bar", "DecisionBar"],
  ["meta-list", "MetaList"],
  ["data-table", "DataTable"],
  ["sidenav", "SideNav"],
  ["list-row", "ListRow"],
  ["empty-state", "EmptyState"],
] as const

export function V2Preview() {
  const [picked, setPicked] = React.useState<string[]>(["Food"])
  const toggle = (name: string) =>
    setPicked((now) =>
      now.includes(name) ? now.filter((n) => n !== name) : [...now, name]
    )
  return (
    <div className="mx-auto grid w-full max-w-page min-w-0 gap-8 px-page-gutter py-6 md:px-6">
      <header className="grid min-w-0 gap-3">
        <h1 className="type-display text-ink">Design system v2</h1>
        <p className="max-w-reading text-body text-ink-muted">
          Development only. v2&apos;s 21 components as Naba-Lens builds them
          (decision D10), each in light and dark at a phone&apos;s width and at
          full width. Words are Album&apos;s (FA-7); the staff tabs are Album,
          Add photos and Me. Breakpoints follow the window: resize it to see a
          component change at 768px and 1100px.
        </p>
        <p className="flex flex-wrap gap-x-4 text-body">
          <Link
            href="/ui-preview"
            className="inline-flex min-h-11 items-center rounded-control font-semibold text-accent-text underline underline-offset-3 focus-ring outline-none"
          >
            UI preview
          </Link>
          <Link
            href="/ui-preview/gallery"
            className="inline-flex min-h-11 items-center rounded-control font-semibold text-accent-text underline underline-offset-3 focus-ring outline-none"
          >
            Design system gallery
          </Link>
        </p>
        <div className="max-w-feed">
          <ThemeSetting layout="card" />
        </div>
        <nav aria-label="v2 components">
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {SECTIONS.map(([id, title]) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="inline-flex min-h-11 items-center rounded-control text-label text-accent-text underline underline-offset-3 focus-ring outline-none"
                >
                  {title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-12">
        <Section id="button" title="Button" file="components/ui/button.tsx">
          <Frames>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary">Add photos</Button>
              <Button>Change label</Button>
              <Button variant="quiet">Report a change</Button>
              <Button variant="danger">Archive</Button>
              <Button size="sm">Compact</Button>
              <Button aria-disabled>Unavailable</Button>
              <Button loading loadingLabel="Saving">
                Save
              </Button>
              <Button size="icon" variant="quiet" aria-label="Retry">
                <ArrowClockwiseIcon aria-hidden />
              </Button>
            </div>
          </Frames>
        </Section>

        <Section
          id="status-chip"
          title="StatusChip"
          file="components/nabalens/status-chip.tsx"
        >
          <Frames>
            <div className="grid gap-3">
              <div className="flex flex-wrap gap-2">
                {STATUS_SAMPLES.map((state) => (
                  <StatusChip key={state} state={state} />
                ))}
              </div>
              <p className="text-meta text-ink-muted">
                Five v2 tones:{" "}
                {Array.from(new Set(Object.values(V2_TONE))).join(", ")}.
              </p>
            </div>
          </Frames>
        </Section>

        <Section
          id="pick-chip"
          title="PickChip"
          file="components/ui/filter-pill.tsx"
        >
          <Frames>
            <PillGroup label="Category">
              {["Food", "Drinks", "Spaces", "Facilities", "Other"].map(
                (name, index) => (
                  <FilterPill
                    key={name}
                    selected={picked.includes(name)}
                    onClick={() => toggle(name)}
                    count={index + 3}
                  >
                    {name}
                  </FilterPill>
                )
              )}
            </PillGroup>
          </Frames>
        </Section>

        <Section
          id="job-card"
          title="JobCard"
          file="components/nabalens/album/home-rows.tsx (HomeRow)"
        >
          <Frames>
            <HomeRow
              href="#job-card"
              slot="preview-job"
              icon={<ImagesIcon aria-hidden />}
              title="Fish and chips"
              line="Whole plate, from above, in daylight."
            />
          </Frames>
        </Section>

        <Section
          id="subject-card"
          title="SubjectCard"
          file="components/nabalens/album/slot-tile.tsx (SlotTile)"
        >
          <Frames>
            <div className="grid grid-cols-tiles gap-x-2 gap-y-4">
              <SlotTile name="Guinness, pint" state="needed" href="#" />
              <SlotTile name="Sunday roast" state="waiting" />
              <SlotTile name="Garden" state="retake" />
              <SlotTile name="Bar counter" state="accepted" />
              <SlotTile name="Darts board" state="not-here" />
              <SlotTile name="Lager" state="needed" optional />
            </div>
          </Frames>
        </Section>

        <Section
          id="upload-row"
          title="UploadRow"
          file="components/nabalens/upload-dialog.tsx (QueueRow), upload-state-badge.tsx"
        >
          <Frames>
            <ul className="grid gap-3">
              {(
                [
                  ["uploading", 40],
                  ["processing", null],
                  ["failed", null],
                ] as const
              ).map(([state, value]) => (
                <li
                  key={state}
                  className="flex items-center gap-3 rounded-card bg-surface p-3 shadow-card"
                >
                  <span className="grid size-14 shrink-0 place-items-center rounded-square bg-media-placeholder text-ink-muted">
                    <ImagesIcon aria-hidden className="size-6" />
                  </span>
                  <span className="grid min-w-0 flex-1 gap-1">
                    <span className="text-label">IMG_2041.jpg</span>
                    <StatusChip state={state} />
                    {value !== null ? (
                      <Progress value={value} aria-label="Uploading photo 1" />
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </Frames>
        </Section>

        <Section
          id="coverage-meter"
          title="CoverageMeter"
          file="components/ui/progress.tsx (segments)"
        >
          <Frames>
            <div className="grid gap-3 rounded-card bg-surface p-4 shadow-card">
              <p className="flex items-baseline justify-between gap-3">
                <span className="text-heading">Food</span>
                <span className="type-figure">
                  30/40
                  <span className="ml-1 font-sans text-meta text-ink-muted">
                    75% covered
                  </span>
                </span>
              </p>
              <Progress
                mode="segments"
                accepted={30}
                submitted={4}
                needsAnother={2}
                total={40}
                label="30 of 40 covered"
                labelHidden
                keyLabels={{
                  accepted: "30 covered",
                  submitted: "4 awaiting review",
                  needsAnother: "2 need replacing",
                  needed: "4 missing",
                }}
              />
            </div>
          </Frames>
        </Section>

        <Section
          id="venue-bar"
          title="VenueBar"
          file="components/nabalens/venue-bar.tsx"
        >
          <Frames>
            <VenueBar
              name="White Horse Inn, Swavesey"
              role="You're a manager here"
              action={<Button variant="quiet">Change</Button>}
            />
          </Frames>
        </Section>

        <Section
          id="tabbar"
          title="TabBar"
          file="components/nabalens/app-shell.tsx, album/album-add-trigger.tsx"
        >
          <Frames>
            <nav
              aria-label="Staff (preview)"
              className="grid auto-cols-fr grid-flow-col bg-surface shadow-bar"
            >
              <TabLink item={STAFF_TABS[0]} href="#tabbar" current />
              <AlbumAddTrigger kind="tab" />
              <TabLink
                item={STAFF_TABS[1]}
                href="#tabbar"
                current={false}
                count={2}
                label="unread notices"
              />
            </nav>
          </Frames>
        </Section>

        <Section id="field" title="Field" file="components/ui/field.tsx">
          <Frames>
            <div className="grid max-w-feed gap-5">
              <FormField label="Venue name" description="As guests know it.">
                <Input defaultValue="The Railway" />
              </FormField>
              <FormField
                label="Opening time"
                error="Write a time such as 11:30."
              >
                <Input defaultValue="half eleven" />
              </FormField>
              <SearchField label="Search dishes" />
              <FormField label="Note" optional>
                <Textarea />
              </FormField>
              <OptionRow
                type="checkbox"
                label="Email me when a photo is back"
              />
              <label className="flex min-h-12 items-center gap-3 text-body">
                <Checkbox defaultChecked aria-label="Weekly summary" />
                Weekly summary
              </label>
            </div>
          </Frames>
        </Section>

        <Section
          id="tabs"
          title="Tabs"
          file="components/nabalens/section-tabs.tsx"
        >
          <Frames>
            <SectionTabs
              label="Album views (preview)"
              active="needed"
              tabs={[
                {
                  id: "needed",
                  label: "Needed",
                  href: "#tabs",
                  count: { value: 6, label: "needed" },
                },
                { id: "waiting", label: "Waiting", href: "#tabs" },
                { id: "accepted", label: "In the album", href: "#tabs" },
                { id: "all", label: "All", href: "#tabs" },
              ]}
            />
          </Frames>
        </Section>

        <Section
          id="notice"
          title="Notice"
          file="components/nabalens/notice.tsx"
        >
          <Frames>
            <div className="grid gap-3">
              <Notice title="Saved on this device">
                It will send when you are back online.
              </Notice>
              <Notice tone="info" title="Uploading 3 photos">
                You can keep using the app.
              </Notice>
              <Notice tone="positive" title="Sent for review">
                A manager will look at it.
              </Notice>
              <Notice
                tone="attention"
                title="2 photos need a label"
                action={<Button size="sm">Fix labels</Button>}
              >
                The others are safe.
              </Notice>
              <Notice tone="negative" title="Processing failed">
                Try sending that photo again.
              </Notice>
            </div>
          </Frames>
        </Section>

        <Section
          id="sheet"
          title="Sheet and Dialog"
          file="components/ui/sheet-recipe.ts, dialog.tsx, alert-dialog.tsx"
        >
          <Frames>
            <div className="grid gap-4">
              <div
                className={cn(
                  sheetPopup({ size: "sm" }),
                  "static z-local mx-0 w-full translate-x-0 translate-y-0 md:translate-x-0 md:translate-y-0"
                )}
              >
                <h3 className="type-title text-ink">
                  Sign out with 3 photos unsent?
                </h3>
                <p className="text-body text-ink-muted">
                  They stay on this phone until you sign in again.
                </p>
                <div className={sheetFooter()}>
                  <Button>Stay signed in</Button>
                  <Button variant="danger">Sign out</Button>
                </div>
              </div>
              <Dialog>
                <DialogTrigger render={<Button />}>
                  Open the dialog
                </DialogTrigger>
                <DialogContent size="sm">
                  <DialogHeader>
                    <DialogTitle>Archive this photo?</DialogTitle>
                    <DialogDescription>
                      It leaves the album and can be restored later.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter showCloseButton>
                    <Button variant="danger">Archive</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </Frames>
        </Section>

        <Section id="toast" title="Toast" file="components/nabalens/toast.tsx">
          <Frames>
            <Toast action={<button type="button">Undo</button>}>
              Sent for review
            </Toast>
          </Frames>
        </Section>

        <Section
          id="thumb-pick"
          title="ThumbPick"
          file="components/ui/selectable-tile.tsx"
        >
          <Frames>
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3].map((n) => (
                <SelectableTile
                  key={n}
                  label={`Photo ${n}`}
                  defaultChecked={n === 2}
                >
                  <span className="block aspect-square bg-media-placeholder" />
                </SelectableTile>
              ))}
            </div>
          </Frames>
        </Section>

        <Section
          id="decision-bar"
          title="DecisionBar"
          file="components/nabalens/common-room/action-dock.tsx (ActionDock)"
        >
          <Frames>
            <ActionDock overTabBar={false} className="static mx-0">
              <Button>Ask for another photo</Button>
              <Button variant="primary">Accept</Button>
            </ActionDock>
          </Frames>
        </Section>

        <Section
          id="meta-list"
          title="MetaList"
          file="components/nabalens/meta-list.tsx"
        >
          <Frames>
            <MetaList
              items={[
                { label: "Added by", value: "Sam" },
                { label: "Uploaded", value: "14 Nov" },
                { label: "Taken", value: "Capture date unknown" },
                {
                  label: "Checks",
                  value: <StatusChip tone="attention">Blurry</StatusChip>,
                },
              ]}
            />
          </Frames>
        </Section>

        <Section
          id="data-table"
          title="DataTable"
          file="components/ui/table.tsx (framed)"
        >
          <Frames>
            <Table framed>
              <TableCaption>Venues</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Pub</TableHead>
                  <TableHead numeric>Food</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableHead scope="row">The Railway</TableHead>
                  <TableCell numeric>
                    <a href="#data-table">30/40</a>
                  </TableCell>
                  <TableCell>
                    <StatusChip state="needs_setup" />
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableHead scope="row">The Bell</TableHead>
                  <TableCell numeric>
                    <a href="#data-table">38/40</a>
                  </TableCell>
                  <TableCell>
                    <StatusChip state="setup_in_place" />
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Frames>
        </Section>

        <Section
          id="sidenav"
          title="SideNav"
          file="components/nabalens/side-nav.tsx"
        >
          <p className="max-w-reading text-body text-ink-muted">
            Managers and admins from 1100px; drawn here in place, not fixed to
            the window.
          </p>
          <Frames phone={false}>
            <div className="flex flex-wrap gap-6">
              <SideNav
                label="Venue workspace (preview)"
                active="review"
                homeHref="#sidenav"
                items={MANAGER_ITEMS}
                className="static flex"
              />
              <SideNav
                label="Admin (preview)"
                active="overview"
                homeHref="#sidenav"
                items={ADMIN_ITEMS}
                className="static flex"
              />
            </div>
          </Frames>
        </Section>

        <Section
          id="list-row"
          title="ListRow"
          file="components/nabalens/common-room/row.tsx (Row, RowList)"
        >
          <Frames>
            <RowList>
              <Row
                icon={<StorefrontIcon />}
                title="Is there step-free access?"
                subtitle="Yes, through the garden gate · confirmed 14 Nov"
                end={<StatusChip state="setup_in_place" />}
                chevron={false}
              />
              <Row
                icon={<ImagesIcon />}
                tone="warn"
                title="Review next"
                subtitle="4 photos waiting"
                href="#list-row"
              />
            </RowList>
          </Frames>
        </Section>

        <Section
          id="empty-state"
          title="EmptyState"
          file="components/nabalens/empty-state.tsx"
        >
          <Frames>
            <EmptyState
              title="Nothing needs a photo"
              description="Every dish on the menu has a photo in the album."
            />
          </Frames>
        </Section>
      </main>
    </div>
  )
}
