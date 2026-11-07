"use client"

// DEV FIXTURE: the Common Room tokens, primitives, state shapes and building
// blocks with fake data. Never linked from the app; the route 404s in
// production. Every name and venue here is made up.

import {
  BellIcon,
  CameraIcon,
  ClipboardTextIcon,
  ImageIcon,
  WarningIcon,
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
import { ErrorState } from "@/components/nabalens/error-state"
import { Notice } from "@/components/nabalens/notice"
import { ProfileAvatar } from "@/components/nabalens/profile-avatar"
import {
  CHIP_STATES,
  CountBadge,
  StatusChip,
  type ChipTone,
} from "@/components/nabalens/status-chip"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

const SWATCHES = [
  ["bg", "bg-bg"],
  ["surface", "bg-surface"],
  ["surface-2", "bg-surface-2"],
  ["raised", "bg-raised"],
  ["fg", "bg-fg"],
  ["fg-muted (ink-muted)", "bg-fg-muted"],
  ["border (line)", "bg-line"],
  ["border-strong", "bg-border-strong"],
  ["accent", "bg-accent"],
  ["accent-text", "bg-accent-text"],
  ["accent-soft", "bg-accent-soft"],
  ["ok-fg / ok-bg", "bg-ok-fg"],
  ["warn-fg / warn-bg", "bg-warn-fg"],
  ["info-fg / info-bg", "bg-info-fg"],
] as const

const TONES: ChipTone[] = [
  "neutral",
  "positive",
  "attention",
  "negative",
  "pending",
  "closed",
]

function Block({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-3">
      <h3 className="font-display text-section-title">{title}</h3>
      {children}
    </div>
  )
}

export function CommonRoomPreview() {
  return (
    <div className="grid gap-8 rounded-card bg-bg p-3 md:p-6">
      <Block title="Tokens">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {SWATCHES.map(([name, cls]) => (
            <li key={name} className="grid gap-1.5">
              <span
                aria-hidden
                className={`h-14 rounded-control shadow-[inset_0_0_0_1px_var(--line)] ${cls}`}
              />
              <span className="font-mono text-meta">{name}</span>
            </li>
          ))}
        </ul>
      </Block>

      <Block title="Type">
        <Card>
          <p className="font-display text-display">Display XL 34</p>
          <p className="font-display text-page-title">Heading LG 26</p>
          <p className="font-display text-card-title">Card title 24</p>
          <p className="font-display text-section-title">Heading MD 21</p>
          <p className="font-display text-count tabular-nums">46</p>
          <p className="text-lead">Lead 18. Atkinson Hyperlegible Next.</p>
          <p className="text-body">Body 17. The floor for product text.</p>
          <p className="font-mono text-meta-strong tabular-nums">
            Meta mono 17 · 2 Nov 2026, 14:06 · 42%
          </p>
        </Card>
      </Block>

      <Block title="Buttons">
        <Card>
          <div className="flex flex-wrap gap-2">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="danger-quiet">Danger quiet</Button>
            <Button variant="link">Link</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="lg">XL 60</Button>
            <Button size="sm" variant="secondary">
              Small 44
            </Button>
            <Button aria-disabled="true">Disabled keeps its label</Button>
          </div>
        </Card>
      </Block>

      <Block title="State chips (DESIGN.md §3)">
        <Card>
          <div className="flex flex-wrap gap-2">
            {Object.keys(CHIP_STATES).map((key) => (
              <StatusChip key={key} state={key} />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {TONES.map((tone) => (
              <StatusChip key={tone} tone={tone}>
                Tone {tone}
              </StatusChip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Stamp />
            <CountBadge count={3} label="to review" tone="warn" />
            <CountBadge count={12} label="tasks" />
            <Badge>Plain badge</Badge>
          </div>
        </Card>
      </Block>

      <Block title="Fields and controls">
        <Card>
          <Field>
            <FieldLabel htmlFor="cr-preview-name">Display name</FieldLabel>
            <Input id="cr-preview-name" defaultValue="Sample staff" />
          </Field>
          <Field>
            <FieldLabel htmlFor="cr-preview-bad">Email</FieldLabel>
            <Input
              id="cr-preview-bad"
              aria-invalid
              aria-describedby="cr-preview-bad-err"
              defaultValue="sample@"
            />
            <FieldError id="cr-preview-bad-err">
              Enter a full email address.
            </FieldError>
          </Field>
          <ToggleGroup
            variant="default"
            defaultValue={["all"]}
            aria-label="Media"
          >
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            <ToggleGroupItem value="photos">Photos</ToggleGroupItem>
            <ToggleGroupItem value="videos">Videos</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            variant="outline"
            defaultValue={["mains"]}
            aria-label="Filter"
          >
            <ToggleGroupItem value="starters">Starters</ToggleGroupItem>
            <ToggleGroupItem value="mains">Mains</ToggleGroupItem>
            <ToggleGroupItem value="desserts">Desserts</ToggleGroupItem>
          </ToggleGroup>
          <label className="flex items-center gap-3">
            <Switch defaultChecked />
            <span>A switch</span>
          </label>
          <Progress value={60} aria-label="3 of 5 accepted" />
          <Progress value={42} tone="neutral" aria-label="Uploading 42%" />
          <div className="grid gap-2" aria-hidden>
            <Skeleton shape="title" />
            <Skeleton shape="line" />
            <Skeleton shape="tile" className="max-w-40" />
          </div>
        </Card>
      </Block>

      <Block title="Feed building blocks">
        <div className="mx-auto grid w-full max-w-(--size-feed) gap-(--gutter)">
          <Notice tone="positive" title="Sample confirmation">
            A positive notice, role status.
          </Notice>
          <LeadCard
            tone="warn"
            kicker="Sample task"
            chip={<StatusChip state="needs_another_photo" />}
            title="Sample lead card title"
            media={
              <span className="grid aspect-square place-items-center rounded-control bg-surface-2">
                <ImageIcon aria-hidden className="size-8 text-ink-muted" />
              </span>
            }
            actions={<Button className="w-full">The one blue action</Button>}
          >
            <p className="text-ink-muted">One job and its one action.</p>
          </LeadCard>
          <SectionHeader
            title="To do"
            action={<CountBadge count={2} label="things to do" />}
          />
          <RowList>
            <Row
              href="#"
              icon={<WarningIcon />}
              tone="warn"
              title="Sample overdue row"
              subtitle="Two lines, a chevron"
              chips={<StatusChip state="overdue" />}
            />
            <Row
              href="#"
              icon={<ClipboardTextIcon />}
              tone="info"
              title="Sample info row"
              subtitle="Second line"
            />
          </RowList>
          <Row
            icon={<BellIcon />}
            title="A single static row"
            subtitle="No chevron"
          />
          <Card>
            <CardHead>
              <h3 className="font-display text-section-title">Your month</h3>
              <StatusChip state="target_met" />
            </CardHead>
            <ScopeLabel>Sample staff · November 2026 · Sample venue</ScopeLabel>
            <ProgressSegments
              accepted={3}
              submitted={1}
              target={5}
              label="3 of 5 accepted"
              keyLabels={{
                accepted: "Accepted",
                submitted: "Submitted",
                needed: "Still needed",
              }}
            />
            <SeparateNote>
              Counted separately from the venue checklist.
            </SeparateNote>
            <CardFoot>
              <VenueScope venue="Sample venue" />
              <Button size="sm" variant="secondary">
                Open
              </Button>
            </CardFoot>
          </Card>
          <Post
            avatar={<ProfileAvatar name="Sample colleague" />}
            name="Sample colleague"
            meta="Sample venue · 2 Nov 2026, 14:06"
            media={
              <span className="grid size-full place-items-center">
                <CameraIcon aria-hidden className="size-10 text-ink-muted" />
              </span>
            }
            chip={<StatusChip state="accepted" />}
            foot="For: sample task"
          >
            <p>What the photo shows.</p>
          </Post>
          <Card className="justify-items-start">
            <IconDisc tone="ok">
              <BellIcon />
            </IconDisc>
            <p className="font-display text-section-title">Icon disc</p>
          </Card>
          <EmptyState
            title="Sample empty state"
            description="What appears here, and how it gets there."
            action={<Button variant="secondary">One action</Button>}
          />
          <ErrorState title="We couldn't load this sample" />
          <ActionDock
            overTabBar={false}
            note="A dock holds the screen's primary."
          >
            <Button variant="secondary">Back</Button>
            <Button>Send</Button>
          </ActionDock>
        </div>
      </Block>
    </div>
  )
}
