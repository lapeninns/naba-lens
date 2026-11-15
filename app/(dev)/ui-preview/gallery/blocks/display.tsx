import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@/components/ui/avatar"
import { Heading } from "@/components/ui/heading"
import { Photo } from "@/components/ui/photo"
import {
  Progress,
  ProgressIndicator,
  ProgressLabel,
  ProgressTrack,
  ProgressValue,
} from "@/components/ui/progress"
import {
  Skeleton,
  SkeletonDetail,
  SkeletonFeed,
  SkeletonForm,
  SkeletonGrid,
  SkeletonList,
  SkeletonRegion,
} from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"

/*
 * Gallery block for the display primitives (DESIGN.md §2 and §4): Heading,
 * Progress, Photo, Avatar, Skeleton and Switch, in every size and state,
 * with fake data only. Hover cannot be forced, so it is not shown; focus is
 * described in a note.
 */

// The guide photos ship with the app, so the gallery needs no upload.
const SAMPLE = "/guide/v1/curry-45.webp"
const SAMPLE_SET = "/guide/v1/curry-45.webp 1x, /guide/v1/curry-45@2x.webp 2x"
// A path nothing serves, to show a photo that cannot be loaded.
const MISSING = "/guide/v1/not-a-photo.webp"

const HEADINGS = [
  { size: "display", note: "34px, display face" },
  { size: "page-title", note: "26px, display face; level 1 by default" },
  { size: "section-title", note: "21px, display face; level 2 by default" },
  { size: "heading-sm", note: "19px, display face; level 3 by default" },
  { size: "item-title", note: "18px, body face; level 4 by default" },
] as const

const RATIOS = ["4/3", "1/1", "16/9", "3/4"] as const
const RADII = ["none", "square", "control", "card"] as const

const PEOPLE = [
  { name: "Mina Walker", initials: "MW", hue: 20 },
  { name: "Asha Rai", initials: "AR", hue: 150 },
  { name: "Tom Okafor", initials: "TO", hue: 265 },
] as const

const AVATAR_SIZES = [
  { size: "sm", note: "36px" },
  { size: "md", note: "44px, the default" },
  { size: "lg", note: "84px" },
] as const

function hue(value: number) {
  return { "--ah": value } as React.CSSProperties
}

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
    <figure className={`grid min-w-0 gap-1.5 ${className ?? ""}`}>
      {children}
      <figcaption className="text-meta text-ink-muted">{caption}</figcaption>
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
    <section aria-labelledby={id} className="grid gap-4">
      <h3 id={id} className="type-heading-sm text-ink">
        {title}
      </h3>
      {note ? <p className="text-body text-ink-muted">{note}</p> : null}
      {children}
    </section>
  )
}

const ROW = "flex flex-wrap items-end gap-x-6 gap-y-4"
const COLUMNS = "grid gap-x-6 gap-y-5 sm:grid-cols-2"
const PHONE = "w-full max-w-80 rounded-card bg-surface p-3 shadow-card"

export function DisplayBlock() {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-10">
      <Group
        id="gallery-heading"
        title="Heading"
        note="The level sets the element and the place in the page outline; the size sets the look. Leave the size out and it follows the level. Headings are ink only and are not interactive, so they have no hover, focus or disabled state."
      >
        <div className="grid gap-4">
          {HEADINGS.map(({ size, note }, index) => (
            <Specimen key={size} caption={`${size} (${note})`}>
              <Heading as="p" size={size}>
                {index === 0 ? "Welcome to Naba-Lens" : "Photos for the menu"}
              </Heading>
            </Specimen>
          ))}
          <Specimen caption="level 4 with size page-title: an h4 that looks like a page title (the others here use as p, to stay out of the outline)">
            <Heading level={4} size="page-title">
              Kitchen team
            </Heading>
          </Specimen>
          <Specimen
            caption="Long text at phone width: it balances and wraps, and a long word breaks"
            className={PHONE}
          >
            <Heading as="p" size="page-title">
              Photos of the Sunday roast with all the trimmings for the autumn
              menu, Thepubwithaverylongnameindeedandnospaces
            </Heading>
          </Specimen>
        </div>
      </Group>

      <Group
        id="gallery-progress-segments"
        title="Progress: segments"
        note="One segment for each photo: green is accepted, striped is submitted and waiting, grey with an edge is still needed. The words are required and always go with it. Above 12 the segments merge into one bar. Progress is not interactive."
      >
        <div className={COLUMNS}>
          <Specimen caption="segments, md: 3 accepted, 1 submitted, 1 still needed, with a key">
            <Progress
              mode="segments"
              accepted={3}
              submitted={1}
              total={5}
              label="3 of 5 accepted"
              keyLabels={{
                accepted: "Accepted",
                submitted: "Submitted, waiting",
                needed: "Still needed",
              }}
            />
          </Specimen>
          <Specimen caption="segments, sm (compact, for a table cell or a row)">
            <Progress
              mode="segments"
              size="sm"
              accepted={2}
              submitted={2}
              total={6}
              label="2 of 6 accepted"
            />
          </Specimen>
          <Specimen caption="segments, md: nothing sent yet">
            <Progress
              mode="segments"
              accepted={0}
              total={4}
              label="0 of 4 accepted"
            />
          </Specimen>
          <Specimen caption="segments, md: all accepted">
            <Progress
              mode="segments"
              accepted={4}
              total={4}
              label="4 of 4 accepted"
            />
          </Specimen>
          <Specimen caption="segments, md: 12, the most drawn one by one">
            <Progress
              mode="segments"
              accepted={7}
              submitted={2}
              total={12}
              label="7 of 12 accepted"
            />
          </Specimen>
          <Specimen caption="segments, md: 30, merged into one bar">
            <Progress
              mode="segments"
              accepted={14}
              submitted={6}
              total={30}
              label="14 of 30 accepted"
            />
          </Specimen>
          <Specimen caption="segments, sm: 30, merged">
            <Progress
              mode="segments"
              size="sm"
              accepted={14}
              submitted={6}
              total={30}
              label="14 of 30 accepted"
            />
          </Specimen>
          <Specimen caption="segments, md: the words are for screen readers only, because the row already says them">
            <p className="text-body text-ink">
              Chicken tikka masala: 1 of 3 accepted
            </p>
            <Progress
              mode="segments"
              accepted={1}
              total={3}
              label="Chicken tikka masala: 1 of 3 accepted"
              labelHidden
            />
          </Specimen>
          <Specimen
            caption="Phone width, long words that wrap"
            className={PHONE}
          >
            <Progress
              mode="segments"
              accepted={2}
              submitted={1}
              total={8}
              label="2 of 8 accepted for the Sunday roast with all the trimmings, 1 waiting for a manager"
              keyLabels={{
                accepted: "Accepted",
                submitted: "Submitted, waiting",
                needed: "Still needed",
              }}
            />
          </Specimen>
        </div>
      </Group>

      <Group
        id="gallery-progress-bar"
        title="Progress: bar"
        note="A continuous bar for a share that has no single units. It fills with ink (neutral, the default), for any share or technical progress such as an upload. Green (ok) is only for a bar that counts accepted work. Blue never marks progress."
      >
        <div className={COLUMNS}>
          <Specimen caption="bar, md, tone neutral (the default): ink">
            <Progress value={42} label="Uploading 42%" />
          </Specimen>
          <Specimen caption="bar, md, tone ok: green, for accepted work">
            <Progress
              value={60}
              tone="ok"
              label="18 of 30 menu items have an accepted photo"
            />
          </Specimen>
          <Specimen caption="bar, sm (compact, for a table cell or a row)">
            <Progress
              value={60}
              size="sm"
              tone="ok"
              label="18 of 30 accepted"
            />
          </Specimen>
          <Specimen caption="bar, empty">
            <Progress
              value={0}
              tone="ok"
              label="0 of 30 menu items have an accepted photo"
            />
          </Specimen>
          <Specimen caption="bar, full">
            <Progress
              value={100}
              tone="ok"
              label="30 of 30 menu items have an accepted photo"
            />
          </Specimen>
          <Specimen caption="the parts, put together by hand: ProgressLabel, ProgressValue, ProgressTrack and ProgressIndicator">
            <div className="group/progress grid min-w-0 gap-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <ProgressLabel id="gallery-progress-parts">
                  Photo 2 of 5
                </ProgressLabel>
                <ProgressValue>40%</ProgressValue>
              </div>
              <ProgressTrack
                role="progressbar"
                aria-labelledby="gallery-progress-parts"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={40}
                aria-valuetext="40%"
              >
                <ProgressIndicator percent={40} />
              </ProgressTrack>
            </div>
          </Specimen>
          <Specimen caption="bar, amount not known (busy): stripes across the track, and the words say what is happening">
            <Progress value={null} tone="neutral" label="Processing photo 2" />
          </Specimen>
          <Specimen caption="bar with the words beside it, named by aria-label">
            <p className="text-body text-ink">Photo 3: uploading 75%</p>
            <Progress
              value={75}
              tone="neutral"
              aria-label="Photo 3: uploading 75%"
            />
          </Specimen>
        </div>
      </Group>

      <Group
        id="gallery-photo"
        title="Photo"
        note="The box keeps its shape before the file arrives, filled with the placeholder grey, so nothing below it moves. Photos load when they come near the screen unless eager is set. A photo is not interactive: a link or button around it draws hover and focus."
      >
        <div className="grid grid-cols-2 items-start gap-4 md:grid-cols-4">
          {RATIOS.map((ratio) => (
            <Specimen
              key={ratio}
              caption={`ratio ${ratio}${ratio === "4/3" ? " (the default)" : ""}`}
            >
              <Photo
                src={SAMPLE}
                srcSet={SAMPLE_SET}
                alt="A bowl of curry seen from an angle"
                ratio={ratio}
              />
            </Specimen>
          ))}
          {RADII.map((radius) => (
            <Specimen
              key={radius}
              caption={`radius ${radius}${radius === "control" ? " (the default)" : ""}`}
            >
              <Photo
                src={SAMPLE}
                srcSet={SAMPLE_SET}
                alt="A bowl of curry seen from an angle"
                ratio="1/1"
                radius={radius}
              />
            </Specimen>
          ))}
          <Specimen caption="eager: loads at once, for the first photo on a screen">
            <Photo
              src={SAMPLE}
              alt="A bowl of curry seen from an angle"
              eager
            />
          </Specimen>
          <Specimen caption="broken: the file could not be loaded">
            <Photo src={MISSING} alt="Lamb bhuna, from the side" />
          </Specimen>
          <Specimen caption="broken, with the area's own words">
            <Photo
              src={MISSING}
              alt="Lamb bhuna, from above"
              unavailableLabel="This photo could not be shown. Try again later."
            />
          </Specimen>
          <Specimen caption="no file: the same message, no request made">
            <Photo src={undefined} alt="Lamb bhuna, close up" ratio="1/1" />
          </Specimen>
          <Specimen caption="loading: the placeholder fill, before the file arrives (drawn here with a skeleton, because a load cannot be held)">
            <Skeleton shape="photo" className="rounded-control" />
          </Specimen>
        </div>
      </Group>

      <Group
        id="gallery-avatar"
        title="Avatar"
        note="Initials in white on a tint taken from the person's name. The tint only tells people apart and never carries a state. Beside a written name the avatar is hidden from screen readers. It is not interactive."
      >
        <div className={ROW}>
          {AVATAR_SIZES.map(({ size, note }) => (
            <Specimen key={size} caption={`${size} (${note})`}>
              <Avatar size={size} style={hue(PEOPLE[0].hue)} aria-hidden>
                <AvatarFallback>{PEOPLE[0].initials}</AvatarFallback>
              </Avatar>
            </Specimen>
          ))}
          <Specimen caption="with a photo: the initials show until it loads, and if it fails">
            <Avatar style={hue(PEOPLE[0].hue)} aria-hidden>
              <AvatarImage src={SAMPLE} alt="" />
              <AvatarFallback>{PEOPLE[0].initials}</AvatarFallback>
            </Avatar>
          </Specimen>
          <Specimen caption="lg, with a photo">
            <Avatar size="lg" style={hue(PEOPLE[0].hue)} aria-hidden>
              <AvatarImage src={SAMPLE} alt="" />
              <AvatarFallback>{PEOPLE[0].initials}</AvatarFallback>
            </Avatar>
          </Specimen>
          <Specimen caption="one letter">
            <Avatar style={hue(PEOPLE[1].hue)} aria-hidden>
              <AvatarFallback>A</AvatarFallback>
            </Avatar>
          </Specimen>
          <Specimen caption="no hue set: the default tint">
            <Avatar aria-hidden>
              <AvatarFallback>NL</AvatarFallback>
            </Avatar>
          </Specimen>
          <Specimen caption="standing alone: role img, named for the person">
            <Avatar
              style={hue(PEOPLE[2].hue)}
              role="img"
              aria-label={PEOPLE[2].name}
            >
              <AvatarFallback>{PEOPLE[2].initials}</AvatarFallback>
            </Avatar>
          </Specimen>
          <Specimen caption="with a badge">
            <Avatar style={hue(PEOPLE[1].hue)} aria-hidden>
              <AvatarFallback>{PEOPLE[1].initials}</AvatarFallback>
              <AvatarBadge />
            </Avatar>
          </Specimen>
        </div>
        <div className={ROW}>
          <Specimen caption="group, md, with a count">
            <AvatarGroup aria-hidden>
              {PEOPLE.map((person) => (
                <Avatar key={person.name} style={hue(person.hue)}>
                  <AvatarFallback>{person.initials}</AvatarFallback>
                </Avatar>
              ))}
              <AvatarGroupCount>+4</AvatarGroupCount>
            </AvatarGroup>
          </Specimen>
          <Specimen caption="group, sm, with a count">
            <AvatarGroup aria-hidden>
              {PEOPLE.map((person) => (
                <Avatar key={person.name} size="sm" style={hue(person.hue)}>
                  <AvatarFallback>{person.initials}</AvatarFallback>
                </Avatar>
              ))}
              <AvatarGroupCount>+4</AvatarGroupCount>
            </AvatarGroup>
          </Specimen>
          <Specimen caption="in a row, beside a long name that wraps">
            <div className="flex max-w-80 items-center gap-3">
              <Avatar style={hue(PEOPLE[0].hue)} aria-hidden>
                <AvatarFallback>{PEOPLE[0].initials}</AvatarFallback>
              </Avatar>
              <p className="min-w-0 text-item-title text-ink">
                Mina Walker-Featherstonehaugh, assistant general manager
              </p>
            </div>
          </Specimen>
        </div>
      </Group>

      <Group
        id="gallery-skeleton"
        title="Skeleton"
        note="Flat grey blocks in the shape of what is loading. They never shimmer or pulse. Each recipe is a waiting region with one status for screen readers; the page header and navigation are drawn for real around it."
      >
        <div className={ROW}>
          <Specimen caption="shape title" className="w-60">
            <Skeleton shape="title" />
          </Specimen>
          <Specimen caption="shape line" className="w-60">
            <Skeleton shape="line" />
          </Specimen>
          <Specimen caption="shape line-short" className="w-60">
            <Skeleton shape="line-short" />
          </Specimen>
          <Specimen caption="shape av">
            <Skeleton shape="av" />
          </Specimen>
          <Specimen caption="shape button" className="w-40">
            <Skeleton shape="button" />
          </Specimen>
          <Specimen caption="shape tile" className="w-32">
            <Skeleton shape="tile" />
          </Specimen>
          <Specimen caption="shape photo" className="w-40">
            <Skeleton shape="photo" />
          </Specimen>
        </div>
        <div className="grid items-start gap-x-6 gap-y-5 md:grid-cols-2">
          <Specimen caption="SkeletonRegion, written by hand: one hidden status round any shapes">
            <SkeletonRegion label="Loading the photo…" className="grid gap-2">
              <Skeleton shape="photo" />
              <Skeleton shape="line" />
              <Skeleton shape="line-short" />
            </SkeletonRegion>
          </Specimen>
          <Specimen caption="SkeletonFeed, count 1">
            <SkeletonFeed label="Loading posts…" count={1} />
          </Specimen>
          <Specimen caption="SkeletonList, count 3">
            <SkeletonList label="Loading people…" count={3} />
          </Specimen>
          <Specimen caption="SkeletonList, no avatar">
            <SkeletonList label="Loading tasks…" count={2} avatar={false} />
          </Specimen>
          <Specimen caption="SkeletonGrid, count 6">
            <SkeletonGrid label="Loading photos…" count={6} />
          </Specimen>
          <Specimen caption="SkeletonDetail">
            <SkeletonDetail label="Loading the task…" />
          </Specimen>
          <Specimen caption="SkeletonForm, fields 2">
            <SkeletonForm label="Loading your profile…" fields={2} />
          </Specimen>
        </div>
      </Group>

      <Group
        id="gallery-switch"
        title="Switch"
        note="One size: a 52 by 32px track with a 44px tall target. On is the selection colour with the thumb at the end; off is grey with an edge and the thumb at the start, so the state is a position as well as a colour. Focus draws the 3px focus outline, 2px clear of the track: press Tab to see it."
      >
        <div className={ROW}>
          <Specimen caption="off">
            <label className="flex min-h-11 items-center gap-3 text-body text-ink">
              <Switch />
              Show my photos to the team
            </label>
          </Specimen>
          <Specimen caption="on (selected)">
            <label className="flex min-h-11 items-center gap-3 text-body text-ink">
              <Switch defaultChecked />
              Show my photos to the team
            </label>
          </Specimen>
          <Specimen caption="invalid, off, with its error">
            <div className="grid gap-1.5">
              <label className="flex min-h-11 items-center gap-3 text-body text-ink">
                <Switch aria-invalid aria-describedby="gallery-switch-error" />I
                have checked these photos
              </label>
              <p id="gallery-switch-error" className="text-meta text-warn-fg">
                Error: check the photos before you send them.
              </p>
            </div>
          </Specimen>
        </div>
        <div className={ROW}>
          <Specimen caption="aria-disabled, off, with its reason: stays focusable, cannot be changed">
            <div className="grid gap-1.5">
              <label className="flex min-h-11 items-center gap-3 text-body text-ink">
                <Switch
                  aria-disabled
                  aria-describedby="gallery-switch-why-off"
                />
                Account active
              </label>
              <p
                id="gallery-switch-why-off"
                className="text-meta text-ink-muted"
              >
                You cannot change your own account.
              </p>
            </div>
          </Specimen>
          <Specimen caption="aria-disabled, on, with its reason">
            <div className="grid gap-1.5">
              <label className="flex min-h-11 items-center gap-3 text-body text-ink">
                <Switch
                  defaultChecked
                  aria-disabled
                  aria-describedby="gallery-switch-why-on"
                />
                Account active
              </label>
              <p
                id="gallery-switch-why-on"
                className="text-meta text-ink-muted"
              >
                Saving. You can change this in a moment.
              </p>
            </div>
          </Specimen>
          <Specimen caption="disabled, off: out of the tab order, so prefer aria-disabled">
            <label className="flex min-h-11 items-center gap-3 text-body text-ink">
              <Switch disabled />
              Account active
            </label>
          </Specimen>
          <Specimen caption="disabled, on">
            <label className="flex min-h-11 items-center gap-3 text-body text-ink">
              <Switch disabled defaultChecked />
              Account active
            </label>
          </Specimen>
        </div>
        <Specimen
          caption="Phone width, a long label that wraps beside the switch"
          className={PHONE}
        >
          <label className="flex min-h-11 items-center gap-3 text-body text-ink">
            <Switch defaultChecked />
            <span className="min-w-0">
              Tell me by email when a manager accepts or sends back one of my
              photos
            </span>
          </label>
        </Specimen>
      </Group>
    </div>
  )
}
