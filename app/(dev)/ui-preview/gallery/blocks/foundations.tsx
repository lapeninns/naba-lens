import {
  CameraIcon,
  CheckIcon,
  ImageIcon,
  MapPinIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr"

import { cn } from "@/lib/utils"

import {
  COLOUR_GROUPS,
  CONTAINERS,
  EDGES,
  ELEVATIONS,
  ICON_SIZES,
  LAYERS,
  MOTION,
  RADII,
  RAILS,
  SPACING,
  TYPE_ROLES,
  type Swatch,
} from "../fixtures"

/*
 * Gallery block for the foundations (common-room.md §2 and §10): every token and
 * recipe in app/globals.css, drawn with the utility it produces. Nothing
 * here has a value of its own, so a token that changes shows here first.
 */

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

const CAPTION = "text-meta text-ink-muted [overflow-wrap:anywhere]"
const NAME =
  "font-mono text-mono font-semibold text-ink [overflow-wrap:anywhere]"
const GRID = "grid grid-cols-tiles gap-3"

function SwatchTile({ swatch }: { swatch: Swatch }) {
  return (
    <figure className="grid min-w-0 content-start gap-1.5">
      {/* The edge keeps a swatch that matches its ground visible. */}
      <div
        className={cn("h-14 rounded-control edge-strong", swatch.fill)}
        aria-hidden
      />
      <figcaption className="grid gap-0.5">
        <span className={NAME}>{swatch.name}</span>
        <span className={CAPTION}>{swatch.role}</span>
      </figcaption>
    </figure>
  )
}

function Swatches({ idPrefix }: { idPrefix: string }) {
  return (
    <div className="grid gap-5">
      {COLOUR_GROUPS.map((group) => {
        const id = `${idPrefix}-${group.title.toLowerCase().replace(/[^a-z]+/g, "-")}`
        return (
          <div
            key={group.title}
            role="group"
            aria-labelledby={id}
            className="grid gap-2"
          >
            <p id={id} className="text-label text-ink">
              {group.title}
            </p>
            <div className={GRID}>
              {group.swatches.map((swatch) => (
                <SwatchTile key={swatch.name} swatch={swatch} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function DefinitionRows({
  rows,
}: {
  rows: readonly { name: string; value: string; role?: string }[]
}) {
  return (
    <dl className="grid gap-2">
      {rows.map((row) => (
        <div
          key={row.name}
          className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-line pb-2"
        >
          <dt className={NAME}>{row.name}</dt>
          <dd className="font-mono text-mono text-ink tabular-nums">
            {row.value}
          </dd>
          {row.role ? <dd className={CAPTION}>{row.role}</dd> : null}
        </div>
      ))}
    </dl>
  )
}

export function FoundationsBlock() {
  return (
    <div className="grid min-w-0 gap-10">
      <Group
        id="foundations-colour"
        title="Colour"
        note="Each swatch is the utility for one role, in the theme the page is in now. Change the theme at the top of the page to see the other set."
      >
        <Swatches idPrefix="colour-page" />
      </Group>

      <Group
        id="foundations-colour-dark"
        title="Colour, dark values"
        note="The same roles inside a dark subtree, so both sets can be compared without changing the page."
      >
        <div className="dark rounded-card bg-canvas p-4 text-ink edge">
          <Swatches idPrefix="colour-dark" />
        </div>
      </Group>

      <Group
        id="foundations-edges"
        title="Edges and rails"
        note="An edge is a boundary drawn inside the box. A rail is a 4px tone bar on the leading side or along the top. One of each per element."
      >
        <div className={GRID}>
          {EDGES.map((edge) => (
            <figure
              key={edge.name}
              className="grid min-w-0 content-start gap-1.5"
            >
              <div
                className={cn(
                  "h-14 rounded-control bg-surface",
                  edge.className
                )}
                aria-hidden
              />
              <figcaption className="grid gap-0.5">
                <span className={NAME}>{edge.name}</span>
                <span className={CAPTION}>{edge.role}</span>
              </figcaption>
            </figure>
          ))}
        </div>
        <div className={GRID}>
          {RAILS.map((rail) => (
            <figure
              key={rail.name}
              className="grid min-w-0 content-start gap-1.5"
            >
              <div
                className={cn(
                  "h-14 rounded-card bg-surface shadow-card",
                  rail.className
                )}
                aria-hidden
              />
              <figcaption className={NAME}>{rail.name}</figcaption>
            </figure>
          ))}
        </div>
      </Group>

      <Group
        id="foundations-elevation"
        title="Elevation"
        note="Four shadows. In dark a card is told from the canvas by its fill and a faint ring, not by a shadow."
      >
        <div className={cn(GRID, "rounded-card bg-canvas p-4 edge")}>
          {ELEVATIONS.map((elevation) => (
            <figure
              key={elevation.name}
              className="grid min-w-0 content-start gap-2"
            >
              <div
                className={cn(
                  "h-16 rounded-card bg-surface",
                  elevation.className
                )}
                aria-hidden
              />
              <figcaption className="grid gap-0.5">
                <span className={NAME}>{elevation.name}</span>
                <span className={CAPTION}>{elevation.role}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </Group>

      <Group
        id="foundations-type"
        title="Type roles"
        note="Size / line height / weight. The floor is 17px; text-caption is the one exception and sits only on a photo."
      >
        <div className="grid gap-4">
          {TYPE_ROLES.map((role) => (
            <figure
              key={role.name}
              className="grid min-w-0 gap-1 border-b border-line pb-3"
            >
              <p
                className={cn(
                  "min-w-0 [overflow-wrap:anywhere] text-ink",
                  role.className
                )}
              >
                {role.sample}
              </p>
              <figcaption className="flex flex-wrap gap-x-3 gap-y-0.5">
                <span className={NAME}>{role.name}</span>
                <span className={CAPTION}>{role.spec}</span>
              </figcaption>
            </figure>
          ))}
          <figure className="grid min-w-0 gap-1">
            <p className="type-stamp text-chip text-stamp-fg">Complete</p>
            <figcaption className="flex flex-wrap gap-x-3 gap-y-0.5">
              <span className={NAME}>type-stamp</span>
              <span className={CAPTION}>
                Lettering only (display face, 800, caps); the chip sets the size
              </span>
            </figcaption>
          </figure>
        </div>
      </Group>

      <Group id="foundations-radius" title="Radius">
        <div className={GRID}>
          {RADII.map((radius) => (
            <figure
              key={radius.name}
              className="grid min-w-0 content-start gap-1.5"
            >
              <div
                className={cn(
                  "h-14 bg-surface-2 edge-strong",
                  radius.className
                )}
                aria-hidden
              />
              <figcaption className="grid gap-0.5">
                <span className={NAME}>{radius.name}</span>
                <span className={CAPTION}>{radius.value}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </Group>

      <Group
        id="foundations-space"
        title="Spacing and containers"
        note="Named sizes off the 4px scale, then the page widths. A container bar stops at its width or at the edge of this column, whichever comes first."
      >
        <div className="grid gap-3">
          {SPACING.map((space) => (
            <figure key={space.name} className="grid min-w-0 gap-1">
              <div
                className={cn("h-4 max-w-full bg-ink-muted", space.className)}
                aria-hidden
              />
              <figcaption className="flex flex-wrap gap-x-3 gap-y-0.5">
                <span className={NAME}>{space.name}</span>
                <span className={CAPTION}>
                  {space.value}. {space.role}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
        <div className="grid gap-3">
          {CONTAINERS.map((container) => (
            <figure key={container.name} className="grid min-w-0 gap-1">
              <div
                className={cn(
                  "h-4 w-full rounded-square bg-surface-2 edge-strong",
                  container.className
                )}
                aria-hidden
              />
              <figcaption className="flex flex-wrap gap-x-3 gap-y-0.5">
                <span className={NAME}>{container.name}</span>
                <span className={CAPTION}>{container.value}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </Group>

      <Group
        id="foundations-layers"
        title="Layers"
        note="Lowest first. Nothing in the app sets a z-index outside these five."
      >
        <DefinitionRows rows={LAYERS} />
      </Group>

      <Group
        id="foundations-motion"
        title="Motion"
        note="Three durations and one easing (ease-out). Hover or focus a bar to see it move; with reduced motion on, nothing moves."
      >
        <div className="grid gap-3">
          {MOTION.map((motion) => (
            <figure key={motion.name} className="grid min-w-0 gap-1">
              <div
                tabIndex={0}
                className="group/motion rounded-control bg-surface-2 p-1 focus-ring outline-none"
              >
                <span className="sr-only">{motion.name} specimen</span>
                <div
                  className={cn(
                    "h-6 w-1/4 rounded-square bg-ink-muted transition-[width] ease-out group-hover/motion:w-full group-focus-visible/motion:w-full",
                    motion.className
                  )}
                  aria-hidden
                />
              </div>
              <figcaption className="flex flex-wrap gap-x-3 gap-y-0.5">
                <span className={NAME}>{motion.name}</span>
                <span className={CAPTION}>
                  {motion.value}. {motion.role}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </Group>

      <Group
        id="foundations-icons"
        title="Icon sizes"
        note="Phosphor icons, regular weight; bold for a tick or a chevron. An icon never stands in for a word."
      >
        <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
          {ICON_SIZES.map((icon, index) => {
            const Icon = [
              CheckIcon,
              CameraIcon,
              WarningIcon,
              MapPinIcon,
              ImageIcon,
            ][index]
            return (
              <figure
                key={icon.name}
                className="grid min-w-0 justify-items-start gap-1.5"
              >
                <Icon aria-hidden className={cn("text-ink", icon.className)} />
                <figcaption className="grid gap-0.5">
                  <span className={NAME}>{icon.name}</span>
                  <span className={CAPTION}>
                    {icon.value}. {icon.role}
                  </span>
                </figcaption>
              </figure>
            )
          })}
        </div>
      </Group>

      <Group
        id="foundations-focus"
        title="Focus"
        note="Tab to each box. focus-ring sits 2px outside; focus-ring-inset sits inside, for rows a parent clips; focus-ring-within marks a wrapper whose child holds focus."
      >
        <div className="flex flex-wrap gap-4">
          <div
            tabIndex={0}
            className="grid min-h-11 place-items-center rounded-control bg-surface-2 px-4 text-body text-ink edge-strong focus-ring outline-none"
          >
            focus-ring
          </div>
          <div
            tabIndex={0}
            className="grid min-h-11 place-items-center rounded-control bg-surface-2 px-4 text-body text-ink edge-strong focus-ring-inset outline-none"
          >
            focus-ring-inset
          </div>
          <div className="grid min-h-11 place-items-center rounded-control bg-surface-2 px-4 text-body text-ink edge-strong focus-ring-within">
            <a href="#foundations-focus" className="underline outline-none">
              focus-ring-within
            </a>
          </div>
        </div>
      </Group>
    </div>
  )
}
