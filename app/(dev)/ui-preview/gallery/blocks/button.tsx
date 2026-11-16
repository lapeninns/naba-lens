import {
  ArrowRightIcon,
  CameraIcon,
  PencilSimpleIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react/dist/ssr"

import { Button } from "@/components/ui/button"
import { LinkButton } from "@/components/ui/link-button"
import { Spinner } from "@/components/ui/spinner"

/*
 * Gallery block for Button, LinkButton and Spinner (DESIGN.md §4): every
 * variant, size and state, with fake data only. Hover cannot be forced, so
 * it is not shown; focus is described in a note.
 */
const VARIANTS = [
  "primary",
  "secondary",
  "quiet",
  "danger",
  "danger-quiet",
  "link",
] as const

const SIZES = [
  { size: "sm", height: "44px" },
  { size: "md", height: "52px, the default" },
  { size: "lg", height: "60px" },
] as const

const LABEL: Record<(typeof VARIANTS)[number], string> = {
  primary: "Send photos",
  secondary: "Edit profile",
  quiet: "Cancel",
  danger: "Delete photo",
  "danger-quiet": "Remove",
  link: "See all tasks",
}

function Specimen({
  caption,
  children,
}: {
  caption: string
  children: React.ReactNode
}) {
  return (
    <figure className="grid min-w-0 justify-items-start gap-1.5">
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
    <section
      aria-labelledby={id}
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3"
    >
      <h3 id={id} className="type-heading-sm text-ink">
        {title}
      </h3>
      {note ? <p className="text-body text-ink-muted">{note}</p> : null}
      {children}
    </section>
  )
}

const ROW = "flex flex-wrap items-end gap-x-6 gap-y-4"

// Every variant that has an icon square: all but link.
const ICON_VARIANTS = [
  "primary",
  "secondary",
  "quiet",
  "danger",
  "danger-quiet",
] as const

const ICON_LABEL: Record<(typeof ICON_VARIANTS)[number], string> = {
  primary: "Take a photo",
  secondary: "Edit name",
  quiet: "Close",
  danger: "Delete photo",
  "danger-quiet": "Remove photo",
}

const ICON: Record<(typeof ICON_VARIANTS)[number], React.ReactNode> = {
  primary: <CameraIcon aria-hidden />,
  secondary: <PencilSimpleIcon aria-hidden />,
  quiet: <XIcon aria-hidden />,
  danger: <TrashIcon aria-hidden />,
  "danger-quiet": <TrashIcon aria-hidden />,
}

export function ButtonBlock() {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-10">
      <Group
        id="gallery-button-variants"
        title="Button: variants and sizes"
        note="A button with no variant is the grey secondary. Primary is always asked for by name, and a screen has one enabled primary."
      >
        {VARIANTS.map((variant) => (
          <div key={variant} className={ROW}>
            {SIZES.map(({ size, height }) => (
              <Specimen key={size} caption={`${variant}, ${size} (${height})`}>
                <Button variant={variant} size={size}>
                  {LABEL[variant]}
                </Button>
              </Specimen>
            ))}
            <Specimen caption={`${variant}, md, with an icon`}>
              <Button variant={variant}>
                {variant === "danger" || variant === "danger-quiet" ? (
                  <TrashIcon aria-hidden />
                ) : (
                  <CameraIcon aria-hidden />
                )}
                {LABEL[variant]}
              </Button>
            </Specimen>
          </div>
        ))}
        <p className="text-meta text-ink-muted">
          A link button is the size of its text at every size; on a phone its
          target grows to 44px.
        </p>
        <div className={ROW}>
          <Specimen caption="row-link, a named exception (44px target at every width)">
            <Button variant="row-link">Refresh</Button>
          </Specimen>
        </div>
        <p className="text-meta text-ink-muted">
          row-link is not one of the six variants: it looks like link but keeps
          the 44px target at every width, for an action inside a row or a
          notice. See departures.md C20.
        </p>
      </Group>

      <Group
        id="gallery-button-icon"
        title="Button: icon sizes"
        note="An icon-only button needs an aria-label. Use one only where the icon is understood without a word, such as Close in a notice."
      >
        {ICON_VARIANTS.map((variant) => (
          <div key={variant} className={ROW}>
            <Specimen caption={`${variant}, icon (44 × 44px)`}>
              <Button
                variant={variant}
                size="icon"
                aria-label={ICON_LABEL[variant]}
              >
                {ICON[variant]}
              </Button>
            </Specimen>
            <Specimen caption={`${variant}, icon-lg (48 × 48px)`}>
              <Button
                variant={variant}
                size="icon-lg"
                aria-label={ICON_LABEL[variant]}
              >
                {ICON[variant]}
              </Button>
            </Specimen>
            <Specimen caption={`${variant}, icon, loading`}>
              <Button
                variant={variant}
                size="icon"
                aria-label={ICON_LABEL[variant]}
                loading
              >
                {ICON[variant]}
              </Button>
            </Specimen>
            <Specimen caption={`${variant}, icon-lg, loading`}>
              <Button
                variant={variant}
                size="icon-lg"
                aria-label={ICON_LABEL[variant]}
                loading
              >
                {ICON[variant]}
              </Button>
            </Specimen>
          </div>
        ))}
        <div className={ROW}>
          <Specimen caption="quiet, icon, disabled">
            <Button variant="quiet" size="icon" aria-label="Close" disabled>
              <XIcon aria-hidden />
            </Button>
          </Specimen>
          <Specimen caption="secondary, icon-lg, toggle on (aria-pressed): no room for the tick, so the icon itself changes to its filled form">
            <Button size="icon-lg" aria-label="Pin this photo" aria-pressed>
              <PencilSimpleIcon aria-hidden weight="fill" />
            </Button>
          </Specimen>
        </div>
        <p className="text-meta text-ink-muted">
          The glyph is muted on the small grey and quiet squares, and takes the
          variant&apos;s own colour everywhere else. A link button has no icon
          size: it is the size of its text.
        </p>
      </Group>

      <Group
        id="gallery-button-states"
        title="Button: states"
        note="Focus: press Tab to see the 3px focus outline, 2px clear of the button. While held down the button moves 1px, and grey and quiet buttons darken. A toggle that is on (aria-pressed) takes the selected fill and edge and a tick, so it is never told by colour alone; in forced colours it keeps an outline."
      >
        <div className={ROW}>
          <Specimen caption="secondary toggle, off (aria-pressed false)">
            <Button aria-pressed="false">Show accepted</Button>
          </Specimen>
          <Specimen caption="secondary toggle, on (aria-pressed): soft accent, selected edge and a tick">
            <Button aria-pressed="true">Show accepted</Button>
          </Specimen>
          <Specimen caption="quiet toggle, on">
            <Button variant="quiet" aria-pressed="true">
              Show accepted
            </Button>
          </Specimen>
          <Specimen caption="secondary toggle, on and aria-disabled: grey, the tick stays">
            <div className="grid gap-1.5">
              <Button
                aria-pressed="true"
                aria-disabled="true"
                aria-describedby="gallery-button-pressed-why"
              >
                Show accepted
              </Button>
              <p
                id="gallery-button-pressed-why"
                className="text-label text-ink-muted"
              >
                Nothing has been accepted yet.
              </p>
            </div>
          </Specimen>
          <Specimen caption="secondary, menu open (aria-expanded)">
            <Button aria-expanded="true">More actions</Button>
          </Specimen>
          <Specimen caption="secondary, invalid (aria-invalid), error below">
            <div className="grid gap-1.5">
              <Button aria-invalid="true" aria-describedby="gallery-button-err">
                Choose a venue
              </Button>
              <p id="gallery-button-err" className="text-label text-warn-fg">
                Error: choose a venue first.
              </p>
            </div>
          </Specimen>
        </div>
        {VARIANTS.map((variant) => (
          <div key={variant} className={ROW}>
            <Specimen caption={`${variant}, disabled (leaves the focus order)`}>
              <Button variant={variant} disabled>
                {LABEL[variant]}
              </Button>
            </Specimen>
            <Specimen
              caption={`${variant}, aria-disabled (keeps focus), reason beside it`}
            >
              <div className="grid gap-1.5">
                <Button
                  variant={variant}
                  aria-disabled="true"
                  aria-describedby={`gallery-button-why-${variant}`}
                >
                  {LABEL[variant]}
                </Button>
                <p
                  id={`gallery-button-why-${variant}`}
                  className="text-label text-ink-muted"
                >
                  You are offline. Reconnect to carry on.
                </p>
              </div>
            </Specimen>
            <Specimen caption={`${variant}, loading`}>
              <Button variant={variant} loading>
                <CameraIcon aria-hidden />
                {LABEL[variant]}
              </Button>
            </Specimen>
          </div>
        ))}
        <div className={ROW}>
          <Specimen caption="primary, loading, with loadingLabel">
            <Button variant="primary" loading loadingLabel="Sending photos">
              Send photos
            </Button>
          </Specimen>
          <Specimen caption="primary, sm, loading">
            <Button variant="primary" size="sm" loading>
              Save
            </Button>
          </Specimen>
          <Specimen caption="primary, lg, loading">
            <Button variant="primary" size="lg" loading>
              Save
            </Button>
          </Specimen>
        </div>
      </Group>

      <Group
        id="gallery-button-wrap"
        title="Button: long labels and the phone pair"
        note="A long label wraps inside the button. A pair stacks on a phone with grey above and blue below, in DOM order; side by side the primary is on the right."
      >
        <div className="grid max-w-80 gap-4">
          <Specimen caption="primary, md, long label in a 320px column">
            <Button variant="primary" className="w-full">
              <CameraIcon aria-hidden />
              Take another photo of the Sunday roast sharing platter
            </Button>
          </Specimen>
          <Specimen caption="pair, stacked (phone): grey above, blue below">
            <div className="flex w-full flex-col gap-2">
              <Button className="w-full">Not now</Button>
              <Button variant="primary" className="w-full">
                Send 3 photos
              </Button>
            </div>
          </Specimen>
        </div>
        <Specimen caption="pair, side by side: primary on the right">
          <div className="flex flex-wrap gap-2">
            <Button>Not now</Button>
            <Button variant="primary">Send 3 photos</Button>
          </div>
        </Specimen>
      </Group>

      <Group
        id="gallery-link-button"
        title="LinkButton"
        note="A real link with the button recipe: the same variants, sizes and data attributes. A link cannot be disabled; show the reason in its place."
      >
        {VARIANTS.map((variant) => (
          <div key={variant} className={ROW}>
            {SIZES.map(({ size }) => (
              <Specimen key={size} caption={`${variant}, ${size}`}>
                <LinkButton
                  href="#gallery-link-button"
                  variant={variant}
                  size={size}
                >
                  {LABEL[variant]}
                  {variant === "link" ? null : <ArrowRightIcon aria-hidden />}
                </LinkButton>
              </Specimen>
            ))}
          </div>
        ))}
        <div className={ROW}>
          <Specimen caption="quiet, icon (44 × 44px): needs an aria-label">
            <LinkButton
              href="#gallery-link-button"
              variant="quiet"
              size="icon"
              aria-label="Open the photo guide"
            >
              <ArrowRightIcon aria-hidden />
            </LinkButton>
          </Specimen>
          <Specimen caption="secondary, icon-lg (48 × 48px)">
            <LinkButton
              href="#gallery-link-button"
              size="icon-lg"
              aria-label="Open the photo guide"
            >
              <ArrowRightIcon aria-hidden />
            </LinkButton>
          </Specimen>
          <Specimen caption="primary, icon-lg">
            <LinkButton
              href="#gallery-link-button"
              variant="primary"
              size="icon-lg"
              aria-label="Open the camera"
            >
              <CameraIcon aria-hidden />
            </LinkButton>
          </Specimen>
        </div>
        <div className="max-w-80">
          <Specimen caption="primary, long label in a 320px column">
            <LinkButton
              href="#gallery-link-button"
              variant="primary"
              className="w-full"
            >
              Open the photo guide for the Sunday roast sharing platter
            </LinkButton>
          </Specimen>
        </div>
      </Group>

      <Group
        id="gallery-spinner"
        title="Spinner"
        note="Decoration beside words that say what is happening. It stops turning under reduced motion."
      >
        <div className={ROW}>
          <Specimen caption="sm (18px)">
            <Spinner size="sm" />
          </Specimen>
          <Specimen caption="md (20px), the default">
            <Spinner />
          </Specimen>
          <Specimen caption="lg (24px)">
            <Spinner size="lg" />
          </Specimen>
          <Specimen caption="md, beside its words">
            <p className="flex items-center gap-2 text-body text-ink">
              <Spinner />
              Loading photos
            </p>
          </Specimen>
          <Specimen caption="lg, with label (read out as a status, no visible words)">
            <Spinner size="lg" label="Loading photos" />
          </Specimen>
        </div>
      </Group>
    </div>
  )
}
