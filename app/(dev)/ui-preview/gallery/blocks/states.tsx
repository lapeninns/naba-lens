import { CameraIcon } from "@phosphor-icons/react/dist/ssr"

import { Card } from "@/components/nabalens/common-room"
import { EmptyState } from "@/components/nabalens/empty-state"
import { ERROR_COPY, ErrorState } from "@/components/nabalens/error-state"
import { NotFoundCard } from "@/components/nabalens/not-found-card"
import { Button } from "@/components/ui/button"
import { LinkButton } from "@/components/ui/link-button"
import {
  SkeletonDetail,
  SkeletonFeed,
  SkeletonForm,
  SkeletonGrid,
  SkeletonList,
} from "@/components/ui/skeleton"

/*
 * Gallery block for whole-screen states (DESIGN.md §5): what a screen shows
 * in place of its content while it loads, when it has nothing, when the
 * request fails, when the address is wrong and when the person may not see
 * it. Built only from what the product uses today.
 */

function Specimen({
  caption,
  children,
}: {
  caption: string
  children: React.ReactNode
}) {
  return (
    <figure className="grid min-w-0 gap-1.5">
      <div className="min-w-0">{children}</div>
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
      {/* The canvas, so cards read as they do on a real screen. */}
      <div className="rounded-card bg-canvas p-3 edge">{children}</div>
    </section>
  )
}

const TWO_UP = "grid min-w-0 gap-4 @regular:grid-cols-2"

export function StatesBlock() {
  return (
    <div className="@container grid min-w-0 gap-10">
      <Group
        id="states-loading"
        title="Loading"
        note="A skeleton in the shape of what is coming, in one region that says what is loading. The grey blocks are hidden from a screen reader; the words are not."
      >
        <div className={TWO_UP}>
          <Specimen caption="SkeletonFeed: post cards">
            <SkeletonFeed label="Loading photos…" count={1} />
          </Specimen>
          <Specimen caption="SkeletonList: rows in one card">
            <SkeletonList label="Loading people…" count={3} />
          </Specimen>
          <Specimen caption="SkeletonGrid: square tiles">
            <SkeletonGrid label="Loading your photos…" count={4} />
          </Specimen>
          <Specimen caption="SkeletonDetail: one record">
            <SkeletonDetail label="Loading this dish…" />
          </Specimen>
          <Specimen caption="SkeletonForm: labels and fields">
            <SkeletonForm label="Loading your details…" fields={2} />
          </Specimen>
        </div>
      </Group>

      <Group
        id="states-empty"
        title="Empty"
        note="Say what appears here and how it gets there. The first-use state offers the action; a filtered one offers to clear the filters; a finished one is a plain line."
      >
        <div className={TWO_UP}>
          <Specimen caption="First use">
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
          <Specimen caption="Nothing matches the filters">
            <EmptyState
              variant="filtered"
              title="No people match"
              description="Nobody at The Example Arms is called that."
              action={<Button>Clear search</Button>}
            />
          </Specimen>
          <Specimen caption="Nothing waiting">
            <EmptyState variant="done" title="Nothing is waiting for review." />
          </Specimen>
        </div>
      </Group>

      <Group
        id="states-error"
        title="Error"
        note="What happened, then what to do. No apology and no error code in the sentence."
      >
        <Specimen caption="ErrorState in the page's place">
          <ErrorState
            title={ERROR_COPY.couldNotLoad("your tasks")}
            action={<Button size="sm">{ERROR_COPY.tryAgain}</Button>}
          />
        </Specimen>
      </Group>

      <Group
        id="states-not-found"
        title="Not found"
        note="A wrong or old address: what happened and the one way back. In the app its title is the page's h1; here it is an h4."
      >
        <Specimen caption="NotFoundCard">
          <NotFoundCard
            titleAs="h4"
            backHref="#states-not-found"
            backLabel="Go to Home"
          />
        </Specimen>
      </Group>

      <Group
        id="states-no-access"
        title="No access"
        note="There is no shared component for this yet. This is what Manage shows a person who is not a venue manager (app/staff/manage/_shared/frame.tsx): a card that says who the screen is for, what they still have, and the way back."
      >
        <Specimen caption="A card with the reason and one primary link">
          <Card className="max-w-reading text-body">
            <p>
              Manage is for venue managers. To manage your venue, ask an admin
              to change your account to a venue manager account.
            </p>
            <p className="text-ink-muted">
              You still have Home, Photos, Add, People and Me.
            </p>
            <div>
              <LinkButton href="#states-no-access" variant="primary">
                Go to Home
              </LinkButton>
            </div>
          </Card>
        </Specimen>
      </Group>
    </div>
  )
}
