"use client"

import * as React from "react"
import {
  ArrowClockwiseIcon,
  CameraIcon,
  CheckCircleIcon,
  EnvelopeSimpleIcon,
  ForkKnifeIcon,
  UserIcon,
  WarningCircleIcon,
  WifiSlashIcon,
} from "@phosphor-icons/react"

import {
  ActionDock,
  Card,
  CardFoot,
  CardHead,
  IconDisc,
  LeadCard,
  Post,
  ProgressSegments,
  Row,
  RowList,
  ScopeLabel,
  SectionHeader,
  SeparateNote,
  Stamp,
  VenueScope,
} from "@/components/nabalens/common-room"
import { EmptyState } from "@/components/nabalens/empty-state"
import { ERROR_COPY, ErrorState } from "@/components/nabalens/error-state"
import { LoadMoreButton } from "@/components/nabalens/load-more-button"
import { Notice, type NoticeTone } from "@/components/nabalens/notice"
import {
  OFFLINE_COPY,
  OfflineNotice,
} from "@/components/nabalens/offline-notice"
import { OptionSelect } from "@/components/nabalens/option-select"
import { PageHeader } from "@/components/nabalens/page-header"
import { ProfileAvatar } from "@/components/nabalens/profile-avatar"
import { SectionTabs } from "@/components/nabalens/section-tabs"
import {
  CHIP_STATES,
  CountBadge,
  StatusChip,
  type ChipStateKey,
  type ChipTone,
} from "@/components/nabalens/status-chip"
import { Button } from "@/components/ui/button"
import { LinkButton } from "@/components/ui/link-button"

import {
  LONG_VENUE,
  MONTH,
  PEOPLE,
  PHOTOS,
  PROGRESS_KEY,
  TABS,
  VENUE,
  VENUE_OPTIONS,
} from "../fixtures"

/*
 * Gallery block for the shared patterns (DESIGN.md §3 and §4; strategy.md
 * 6.3): each one as it is built today, with fake data. Nothing is restyled
 * here, so what you see is what the product draws.
 */

function Specimen({
  caption,
  className,
  children,
}: {
  caption: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <figure className="grid min-w-0 gap-1.5">
      <div className={className ?? "min-w-0"}>{children}</div>
      <figcaption className="text-meta [overflow-wrap:anywhere] text-ink-muted">
        {caption}
      </figcaption>
    </figure>
  )
}

function Group({
  id,
  title,
  note,
  children,
}: {
  id: string
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <section aria-labelledby={id} className="grid min-w-0 gap-3">
      <h3 id={id} className="type-heading-sm text-ink">
        {title}
      </h3>
      {note ? <p className="text-body text-ink-muted">{note}</p> : null}
      {children}
    </section>
  )
}

const WRAP = "flex min-w-0 flex-wrap items-start gap-x-6 gap-y-4"
const STACK = "grid min-w-0 gap-4"
const TWO_UP = "grid min-w-0 gap-4 @regular:grid-cols-2"
/** The canvas a card sits on, so its shadow and fill read as they do in the app. */
const GROUND = "rounded-card bg-canvas p-3 edge"

const CHIP_KEYS = Object.keys(CHIP_STATES) as ChipStateKey[]
const CHIP_TONES: ChipTone[] = [
  "neutral",
  "positive",
  "attention",
  "negative",
  "pending",
  "closed",
]
const NOTICE_TONES: NoticeTone[] = [
  "plain",
  "info",
  "attention",
  "negative",
  "positive",
]
const TONES = ["warn", "info", "ok"] as const
const DISC_TONES = ["neutral", "ok", "warn", "info"] as const

function Thumb({ src }: { src: string }) {
  // A plain img: these are small fixtures served from /public.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" />
}

function OptionSelectSpecimens() {
  const [venue, setVenue] = React.useState<string | null>("v1")
  const [filter, setFilter] = React.useState<string | null>(null)
  const [missing, setMissing] = React.useState<string | null>(null)
  return (
    <div className={TWO_UP}>
      <Specimen caption="A required choice, with a value">
        <OptionSelect
          aria-label="Venue"
          options={VENUE_OPTIONS}
          value={venue}
          onValueChange={setVenue}
        />
      </Specimen>
      <Specimen caption="emptyLabel: a filter that can be cleared">
        <OptionSelect
          aria-label="Filter by venue"
          options={VENUE_OPTIONS}
          emptyLabel="All venues"
          value={filter}
          onValueChange={setFilter}
        />
      </Specimen>
      <Specimen caption="Invalid, with the placeholder and its error">
        <div className="grid gap-1.5">
          <OptionSelect
            aria-label="Venue, required"
            aria-describedby="patterns-select-error"
            options={VENUE_OPTIONS}
            value={missing}
            onValueChange={setMissing}
            invalid={missing === null}
          />
          {missing === null ? (
            <p
              id="patterns-select-error"
              className="flex items-start gap-1.5 text-body font-bold text-warn-fg"
            >
              <WarningCircleIcon
                aria-hidden
                className="mt-0.5 size-5 shrink-0"
              />
              Choose a venue.
            </p>
          ) : null}
        </div>
      </Specimen>
      <Specimen caption="Disabled, holding a long name that is cut short">
        <OptionSelect
          aria-label="Venue, switched off"
          options={VENUE_OPTIONS}
          value="v3"
          onValueChange={() => {}}
          disabled
        />
      </Specimen>
    </div>
  )
}

function LoadMoreSpecimens() {
  const [loading, setLoading] = React.useState(false)
  const load = () => {
    setLoading(true)
    window.setTimeout(() => setLoading(false), 1200)
  }
  return (
    <div className={TWO_UP}>
      <Specimen caption="More to load (press it: it is busy for a second)">
        <LoadMoreButton hasMore loading={loading} onLoadMore={load} />
      </Specimen>
      <Specimen caption="Loading">
        <LoadMoreButton hasMore loading onLoadMore={() => {}} />
      </Specimen>
      <Specimen caption="The last request failed">
        <LoadMoreButton
          hasMore
          error="We couldn't load more photos."
          onLoadMore={() => {}}
        />
      </Specimen>
      <Specimen caption="Nothing more, with shownCount">
        <LoadMoreButton hasMore={false} shownCount={48} onLoadMore={() => {}} />
      </Specimen>
    </div>
  )
}

export function PatternsBlock() {
  const [rowPresses, setRowPresses] = React.useState(0)
  return (
    <div className="@container grid min-w-0 gap-10">
      <Group
        id="patterns-status-chip"
        title="StatusChip, CountBadge and Stamp"
        note="Every entry in CHIP_STATES, by key, with its fixed word. The word is the meaning; the shape and tone only repeat it."
      >
        <ul className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-3 @regular:grid-cols-2">
          {CHIP_KEYS.map((key) => (
            <li
              key={key}
              className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-line pb-3"
            >
              <StatusChip state={key} />
              <span className="font-mono text-mono [overflow-wrap:anywhere] text-ink-muted">
                {key}
              </span>
            </li>
          ))}
        </ul>
        <div className={WRAP}>
          {CHIP_TONES.map((tone) => (
            <Specimen key={tone} caption={`tone ${tone}, no fixed state`}>
              <StatusChip tone={tone}>2 labels</StatusChip>
            </Specimen>
          ))}
          <Specimen caption="A state with its word replaced">
            <StatusChip state="accepted">Accepted late · 3 Nov</StatusChip>
          </Specimen>
          <Specimen caption="An unknown key: neutral, never a crash">
            <StatusChip state="waiting_for_stock" />
          </Specimen>
        </div>
        <div className={WRAP}>
          <Specimen caption="CountBadge, neutral">
            <span className="inline-flex items-center gap-2 text-body">
              Review
              <CountBadge count={4} label="to review" />
            </span>
          </Specimen>
          <Specimen caption="CountBadge, tone warn (the tab bar's count)">
            <span className="inline-flex items-center gap-2 text-body">
              Home
              <CountBadge count={12} label="things to do" tone="warn" />
            </span>
          </Specimen>
          <Specimen caption="CountBadge with count 0 draws nothing">
            <span className="inline-flex items-center gap-2 text-body">
              Menu
              <CountBadge count={0} label="to review" />
            </span>
          </Specimen>
          <Specimen caption="Stamp: Complete's shape alone">
            <Stamp />
          </Specimen>
        </div>
      </Group>

      <Group
        id="patterns-notice"
        title="Notice"
        note="A message in the flow of the page. Text stays ink; only the icon takes the tone. Attention and negative share the warn tone and differ by icon and role."
      >
        <div className={STACK}>
          {NOTICE_TONES.map((tone) => (
            <React.Fragment key={tone}>
              <Specimen caption={`tone ${tone}, no action`}>
                {/* role none: five live regions at once would all be read out. */}
                <Notice
                  tone={tone}
                  role="none"
                  title="Photos are checked by your manager"
                >
                  A photo counts towards the month once it is accepted.
                </Notice>
              </Specimen>
              <Specimen caption={`tone ${tone}, with one action`}>
                <Notice
                  tone={tone}
                  role="none"
                  title="Two photos could not be sent"
                  action={
                    <Button size="sm">
                      <ArrowClockwiseIcon aria-hidden />
                      Try again
                    </Button>
                  }
                >
                  Check your connection, then send them again. Nothing is sent
                  twice.
                </Notice>
              </Specimen>
            </React.Fragment>
          ))}
          <Specimen caption="No title, own icon, a long address that wraps">
            <Notice tone="info" role="none" icon={EnvelopeSimpleIcon}>
              {/* Notice does not break a long word itself, so the specimen
                  does: an address this long would widen a 320px page. */}
              <span className="[overflow-wrap:anywhere]">
                We sent a sign-in link to
                mina.walker.at.the.example.arms@example.test. It works once and
                for one hour.
              </span>
            </Notice>
          </Specimen>
        </div>
      </Group>

      <Group
        id="patterns-card"
        title="Card, CardHead, CardFoot and LeadCard"
        note="A white card on the grey canvas. A tone bar marks a card that needs attention; the words still say why."
      >
        <div className={GROUND}>
          <div className={TWO_UP}>
            <Specimen caption="variant default">
              <Card>
                <p className="text-body">A white card with a soft shadow.</p>
              </Card>
            </Specimen>
            <Specimen caption="variant flat">
              <Card variant="flat">
                <p className="text-body">No shadow, a hairline edge.</p>
              </Card>
            </Specimen>
            <Specimen caption="variant tint">
              <Card variant="tint">
                <p className="text-body">A grey fill, inside a white card.</p>
              </Card>
            </Specimen>
            <Specimen caption="tight: 12px padding, 8px gap">
              <Card tight>
                <p className="text-body">Tighter, for a dense list.</p>
              </Card>
            </Specimen>
            {TONES.map((tone) => (
              <Specimen
                key={tone}
                caption={`tone ${tone}: a 4px bar on the left`}
              >
                <Card tone={tone}>
                  <p className="text-body">
                    {tone === "warn"
                      ? "One photo needs replacing."
                      : tone === "info"
                        ? "Your menu changed on 2 November."
                        : "Every dish has an accepted photo."}
                  </p>
                </Card>
              </Specimen>
            ))}
            <Specimen caption="CardHead and CardFoot">
              <Card as="article">
                <CardHead>
                  <h4 className="text-item-title">Starters</h4>
                  <StatusChip state="target_met" />
                </CardHead>
                <p className="text-body text-ink-muted">
                  6 dishes, each with an accepted photo.
                </p>
                <CardFoot>
                  <span className="text-meta text-ink-muted">
                    Updated 2 Nov 2026
                  </span>
                  <LinkButton href="#patterns-card" variant="link" size="sm">
                    See dishes
                  </LinkButton>
                </CardFoot>
              </Card>
            </Specimen>
          </div>
        </div>
        <div className={GROUND}>
          <div className={TWO_UP}>
            <Specimen caption="LeadCard: kicker, chip, title, text and the one blue action">
              <LeadCard
                kicker="Photo task"
                chip={<StatusChip state="needs_another_photo" />}
                title="Chicken tikka masala"
                titleAs="h3"
                actions={
                  <Button variant="primary">
                    <CameraIcon aria-hidden />
                    Take the photo again
                  </Button>
                }
              >
                <p>Your manager asked for a brighter photo.</p>
              </LeadCard>
            </Specimen>
            <Specimen caption="LeadCard with media and a grey second action">
              <LeadCard
                kicker={VENUE}
                title="Mixed grill, from the front"
                titleAs="h3"
                media={<Thumb src={PHOTOS.grill} />}
                actions={
                  <>
                    <Button>See the guide</Button>
                    <Button variant="primary">Add a photo</Button>
                  </>
                }
              >
                <p className="text-ink-muted">2 of 3 angles sent.</p>
              </LeadCard>
            </Specimen>
            {TONES.map((tone) => (
              <Specimen
                key={tone}
                caption={`LeadCard tone ${tone}: a 4px bar along the top`}
              >
                <LeadCard tone={tone} title="This month's photos" titleAs="h3">
                  <p>3 of 5 accepted.</p>
                </LeadCard>
              </Specimen>
            ))}
          </div>
        </div>
      </Group>

      <Group
        id="patterns-row"
        title="Row and RowList"
        note="Icon, two lines, chevron. The whole row is the link or the button; a static row has no chevron."
      >
        <div className={GROUND}>
          <div className={STACK}>
            <Specimen caption="A link row with an icon, tone neutral">
              <Row
                href="#patterns-row"
                icon={<ForkKnifeIcon />}
                title="Our menu"
                subtitle="42 dishes, 31 with a photo"
              />
            </Specimen>
            {TONES.map((tone) => (
              <Specimen key={tone} caption={`A link row, tone ${tone}`}>
                <Row
                  href="#patterns-row"
                  tone={tone}
                  icon={
                    tone === "ok" ? <CheckCircleIcon /> : <WarningCircleIcon />
                  }
                  title={
                    tone === "warn"
                      ? "1 photo to replace"
                      : tone === "info"
                        ? "Menu changed"
                        : "Starters are complete"
                  }
                  subtitle="Chicken tikka masala"
                />
              </Specimen>
            ))}
            <Specimen
              caption={`A button row with a thumbnail, chips and an end slot (pressed ${rowPresses} times)`}
            >
              <Row
                onClick={() => setRowPresses((n) => n + 1)}
                thumb={<Thumb src={PHOTOS.curry} />}
                title="Lamb bhuna"
                subtitle="Sent 2 Nov 2026, 14:06"
                chips={<StatusChip state="submitted" />}
                end={<span className="font-mono text-mono">2</span>}
              />
            </Specimen>
            <Specimen caption="A static row: no link, no chevron">
              <Row
                icon={<UserIcon />}
                title="Mina Walker"
                subtitle="Chef"
                end={<StatusChip state="active" />}
              />
            </Specimen>
            <Specimen caption="Long text that wraps, no icon">
              <Row
                href="#patterns-row"
                title="Slow-cooked shoulder of lamb with saffron rice, mint yoghurt and a warm flatbread"
                subtitle={LONG_VENUE}
              />
            </Specimen>
            <Specimen caption="RowList with a head, as a real list">
              <RowList
                list
                head={
                  <h4 className="text-meta font-semibold text-ink-muted">
                    Also to do
                  </h4>
                }
              >
                <Row
                  href="#patterns-row"
                  icon={<CameraIcon />}
                  title="Garden, from the gate"
                  subtitle="Amenity check"
                />
                <Row
                  href="#patterns-row"
                  icon={<ForkKnifeIcon />}
                  tone="warn"
                  title="Paneer tikka"
                  subtitle="Needs another photo"
                />
                <Row
                  href="#patterns-row"
                  icon={<UserIcon />}
                  title="Your work details"
                  subtitle="Add your main job"
                />
              </RowList>
            </Specimen>
          </div>
        </div>
      </Group>

      <Group
        id="patterns-section-header"
        title="SectionHeader, ScopeLabel, VenueScope and SeparateNote"
        note="A section's title on the canvas, and the lines that say whose number it is and where."
      >
        <div className={GROUND}>
          <div className={STACK}>
            <Specimen caption="Title only (h3 here; h2 in the app)">
              <SectionHeader title="This month" as="h3" />
            </Specimen>
            <Specimen caption="With an action on the right and a scope under it">
              <SectionHeader
                as="h3"
                title="Photos to review"
                action={
                  <LinkButton
                    href="#patterns-section-header"
                    variant="link"
                    size="sm"
                  >
                    See all
                  </LinkButton>
                }
                scope={
                  <ScopeLabel icon={<UserIcon />}>
                    Mina · {MONTH} · {VENUE}
                  </ScopeLabel>
                }
              />
            </Specimen>
            <Specimen caption="ScopeLabel without an icon">
              <ScopeLabel>
                {MONTH} · {VENUE}
              </ScopeLabel>
            </Specimen>
            <Specimen caption="ScopeLabel with a long scope: it wraps beside the icon">
              <ScopeLabel icon={<UserIcon />}>
                Priya Nair-Hetherington · {MONTH} · {LONG_VENUE}
              </ScopeLabel>
            </Specimen>
            <Specimen caption="VenueScope">
              <VenueScope venue={VENUE} />
            </Specimen>
            <Specimen caption="VenueScope with words around a long venue name">
              <VenueScope
                venue={LONG_VENUE}
                prefix="Photos at"
                suffix="this month"
              />
            </Specimen>
            <Specimen caption="SeparateNote">
              <SeparateNote>
                Menu photos and amenity checks are counted separately. They are
                never added together.
              </SeparateNote>
            </Specimen>
          </div>
        </div>
      </Group>

      <Group
        id="patterns-post"
        title="Post"
        note="A colleague's photo: face, name, venue and time, the photo edge to edge, what it shows, its state. Nothing social is attached to it."
      >
        <div className={GROUND}>
          <div className={TWO_UP}>
            <Specimen caption="4:3 photo, a linked name, a chip and a foot">
              <Post
                avatar={<ProfileAvatar name={PEOPLE[0].name} />}
                name={PEOPLE[0].name}
                nameHref="#patterns-post"
                meta={`${VENUE} · 2 Nov 2026, 14:06`}
                media={<Thumb src={PHOTOS.curry} />}
                mediaHref="#patterns-post"
                mediaLabel="Open the photo of chicken tikka masala"
                chip={<StatusChip state="accepted" />}
                foot="For the menu"
              >
                <p>Chicken tikka masala, from the front.</p>
              </Post>
            </Specimen>
            <Specimen caption="compact: a 16:9 photo, no link, a long name">
              <Post
                compact
                avatar={<ProfileAvatar name={PEOPLE[2].name} />}
                name={PEOPLE[2].name}
                meta={`${LONG_VENUE} · 1 Nov 2026, 09:12`}
                media={<Thumb src={PHOTOS.curryOverhead} />}
                chip={<StatusChip state="submitted" />}
              >
                <p>Lamb bhuna, from above.</p>
              </Post>
            </Specimen>
            <Specimen caption="No photo and no foot">
              <Post
                avatar={<ProfileAvatar name={PEOPLE[1].name} />}
                name={PEOPLE[1].name}
                meta={`${VENUE} · 31 Oct 2026`}
              >
                <p>The photo is still being processed.</p>
              </Post>
            </Specimen>
          </div>
        </div>
      </Group>

      <Group
        id="patterns-icon-disc"
        title="IconDisc and ProfileAvatar"
        note="A disc is decoration above a state heading. An avatar is a face or initials on the person's own tint; the tint never carries a state."
      >
        <div className={WRAP}>
          {DISC_TONES.map((tone) => (
            <Specimen key={tone} caption={`IconDisc md (52px), tone ${tone}`}>
              <IconDisc tone={tone}>
                {tone === "warn" ? (
                  <WarningCircleIcon />
                ) : (
                  <EnvelopeSimpleIcon />
                )}
              </IconDisc>
            </Specimen>
          ))}
          <Specimen caption="IconDisc lg (72px), for an empty state">
            <IconDisc size="lg">
              <CameraIcon />
            </IconDisc>
          </Specimen>
        </div>
        <div className={WRAP}>
          {(["sm", "md", "lg"] as const).map((size) => (
            <Specimen
              key={size}
              caption={`ProfileAvatar ${size}: ${size === "sm" ? "36px" : size === "md" ? "44px, the default" : "84px"}`}
            >
              <ProfileAvatar name={PEOPLE[0].name} size={size} />
            </Specimen>
          ))}
          <Specimen caption="With a photo">
            <ProfileAvatar name={PEOPLE[1].name} src={PHOTOS.currySide} />
          </Specimen>
          <Specimen caption="labelled: announced as the person's name">
            <ProfileAvatar name={PEOPLE[2].name} labelled />
          </Specimen>
          {PEOPLE.map((person) => (
            <Specimen key={person.id} caption={`Tint for ${person.name}`}>
              <ProfileAvatar name={person.name} />
            </Specimen>
          ))}
        </div>
      </Group>

      <Group
        id="patterns-progress-segments"
        title="ProgressSegments"
        note="One segment per photo: green accepted, striped submitted, grey still needed, always with the words. The Progress primitive's segments mode is due to replace it."
      >
        <div className={TWO_UP}>
          <Specimen caption="Segments with the key">
            <ProgressSegments
              accepted={3}
              submitted={1}
              target={5}
              label="3 of 5 accepted"
              keyLabels={PROGRESS_KEY}
            />
          </Specimen>
          <Specimen caption="Nothing sent yet">
            <ProgressSegments accepted={0} target={4} label="0 of 4 accepted" />
          </Specimen>
          <Specimen caption="All accepted">
            <ProgressSegments accepted={6} target={6} label="6 of 6 accepted" />
          </Specimen>
          <Specimen caption="More than 12: the segments merge into one bar">
            <ProgressSegments
              accepted={14}
              submitted={5}
              target={30}
              label="14 of 30 accepted"
            />
          </Specimen>
        </div>
      </Group>

      <Group
        id="patterns-action-dock"
        title="ActionDock"
        note="The pinned area that holds a screen's one primary. On a phone it sticks to the bottom of what scrolls; here each sits in its own box so it stays put. From md it is a plain card."
      >
        <div className={STACK}>
          <Specimen
            caption="One primary"
            className="overflow-hidden rounded-card px-page-gutter edge"
          >
            <ActionDock overTabBar={false}>
              <Button variant="primary">Send 3 photos</Button>
            </ActionDock>
          </Specimen>
          <Specimen
            caption="A pair (grey first, blue last) and a note saying why the primary is off"
            className="overflow-hidden rounded-card px-page-gutter edge"
          >
            <ActionDock
              overTabBar={false}
              note={
                <span id="patterns-dock-why">Add a photo before you send.</span>
              }
            >
              <Button>Save for later</Button>
              <Button
                variant="primary"
                aria-disabled
                aria-describedby="patterns-dock-why"
              >
                Send photos
              </Button>
            </ActionDock>
          </Specimen>
        </div>
      </Group>

      <Group
        id="patterns-page-header"
        title="PageHeader and SectionTabs"
        note="The top of a page: scope line, the title, a summary and the page's main action. In the app the title is the page's one h1; here it is an h4, under this group's heading."
      >
        <div className={GROUND}>
          <div className={STACK}>
            <Specimen caption="Venue scope, summary and two actions">
              <PageHeader
                titleAs="h4"
                venueScope
                scope={[VENUE, MONTH]}
                title="Photos to review"
                summary="Accept a photo to count it towards the month, or ask for another one with a reason."
                actions={
                  <>
                    <Button>Download list</Button>
                    <Button variant="primary">Prepare next month</Button>
                  </>
                }
              />
            </Specimen>
            <Specimen caption="Title only">
              <PageHeader titleAs="h4" title="People" />
            </Specimen>
            <Specimen caption="A long title and scope, with SectionTabs underneath">
              <PageHeader
                titleAs="h4"
                venueScope
                scope={[LONG_VENUE, MONTH]}
                title="Menu coverage for the autumn and winter menu"
              >
                <SectionTabs
                  label={`Manage ${VENUE}`}
                  tabs={TABS}
                  active="review"
                />
              </PageHeader>
            </Specimen>
            <Specimen caption="SectionTabs alone: the row scrolls sideways on a phone, the page does not">
              <div id="section-tabs">
                <SectionTabs
                  label="Example views"
                  tabs={TABS}
                  active="overview"
                />
              </div>
            </Specimen>
          </div>
        </div>
      </Group>

      <Group
        id="patterns-empty-state"
        title="EmptyState"
        note="What a list shows when it has nothing in it: why, and what fills it. One action at most."
      >
        <div className={GROUND}>
          <div className={TWO_UP}>
            <Specimen caption="variant first-use, with the action that fills the list">
              <EmptyState
                title="No photos yet"
                description="Photos you send appear here."
                action={
                  <Button variant="primary">
                    <CameraIcon aria-hidden />
                    Add a photo
                  </Button>
                }
              />
            </Specimen>
            <Specimen caption="variant filtered">
              <EmptyState
                variant="filtered"
                title="No photos match"
                description="Nothing at The Example Arms from Mina this month."
                action={<Button>Clear filters</Button>}
              />
            </Specimen>
            <Specimen caption="variant done: a plain line">
              <EmptyState
                variant="done"
                title="Nothing is waiting for review."
              />
            </Specimen>
            <Specimen caption="inline: no frame, inside a panel">
              <Card>
                <EmptyState
                  inline
                  title="No dishes in this section"
                  description="Add one from the menu editor."
                />
              </Card>
            </Specimen>
          </div>
        </div>
      </Group>

      <Group
        id="patterns-error-state"
        title="ErrorState and OfflineNotice"
        note="What happened, then what to do, with one action that repeats the fix."
      >
        <div className={STACK}>
          <Specimen caption="ErrorState with the default advice and an action">
            <ErrorState
              title={ERROR_COPY.couldNotLoad("your photos")}
              action={<Button size="sm">{ERROR_COPY.tryAgain}</Button>}
            />
          </Specimen>
          <Specimen caption="ErrorState with an admin-only detail in mono">
            <ErrorState
              title={ERROR_COPY.couldNotLoad("this menu")}
              detail="Request example-0000-0000"
              action={<Button size="sm">{ERROR_COPY.reload}</Button>}
            >
              The menu service did not answer. Try again in a minute.
            </ErrorState>
          </Specimen>
          <Specimen caption="OfflineNotice: drawn only while this browser is offline (turn the connection off to see it here)">
            <OfflineNotice />
            <p className="text-body text-ink-muted">
              Nothing shows above while you are online.
            </p>
          </Specimen>
          <Specimen caption="The same notice, drawn from its parts so it can be seen online">
            <Notice
              tone="negative"
              role="none"
              icon={WifiSlashIcon}
              title={OFFLINE_COPY.title}
              action={
                <Button size="sm">
                  <ArrowClockwiseIcon aria-hidden />
                  {OFFLINE_COPY.action}
                </Button>
              }
            >
              {`${OFFLINE_COPY.loadedAt("14:02")} ${OFFLINE_COPY.offlineSince("14:06")}`}
            </Notice>
          </Specimen>
        </div>
      </Group>

      <Group
        id="patterns-load-more"
        title="LoadMoreButton"
        note="A cursor pager: the page owns the cursor and asks the server for the next page."
      >
        <LoadMoreSpecimens />
      </Group>

      <Group
        id="patterns-option-select"
        title="OptionSelect"
        note="One choice from id and name options, on the Select primitive. Focus it with Tab; the arrow keys and typing move through the list."
      >
        <OptionSelectSpecimens />
      </Group>

      <Group
        id="patterns-theme-setting"
        title="ThemeSetting"
        note="The Appearance control at the top of this page is ThemeSetting in its card layout. It is drawn once: two on one page would share the radio name."
      >
        <p className="text-body">
          <a
            href="#gallery-theme"
            className="rounded-control font-bold underline underline-offset-4 focus-ring outline-none"
          >
            Go to the theme control
          </a>
        </p>
      </Group>
    </div>
  )
}
