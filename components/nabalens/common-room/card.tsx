import { cn } from "@/lib/utils"

/*
 * Common Room cards (DESIGN.md §4). Purely presentational; no client hooks,
 * so they render in server and client components alike.
 */

export type CardTone = "warn" | "info" | "ok"

/** Inset bar on the left of a card (Card) or along the top (LeadCard). */
const LEFT_BAR: Record<CardTone, string> = {
  warn: "shadow-[var(--elevation-card),inset_4px_0_0_var(--warn-fg)]",
  info: "shadow-[var(--elevation-card),inset_4px_0_0_var(--info-fg)]",
  ok: "shadow-[var(--elevation-card),inset_4px_0_0_var(--ok-fg)]",
}
const TOP_BAR: Record<CardTone, string> = {
  warn: "pt-5 shadow-[var(--elevation-card),inset_0_4px_0_var(--warn-fg)]",
  info: "pt-5 shadow-[var(--elevation-card),inset_0_4px_0_var(--info-fg)]",
  ok: "pt-5 shadow-[var(--elevation-card),inset_0_4px_0_var(--ok-fg)]",
}

type CardProps = Omit<React.HTMLAttributes<HTMLElement>, "ref"> & {
  /** `flat`: no shadow, hairline edge. `tint`: grey fill. Default: white. */
  variant?: "default" | "flat" | "tint"
  /** 4px bar on the left in the tone (a card that needs attention). */
  tone?: CardTone
  /** 12px padding and 8px gap instead of 16 / 12. */
  tight?: boolean
  /** Render as another element (section, article, li…). */
  as?: "div" | "section" | "article" | "li" | "aside"
}

/** A white card on the grey canvas: 12px radius, 16px padding, a soft shadow. */
export function Card({
  variant = "default",
  tone,
  tight = false,
  as: Element = "div",
  className,
  ...props
}: CardProps) {
  return (
    <Element
      data-slot="cr-card"
      className={cn(
        "grid min-w-0 content-start rounded-card",
        tight ? "gap-2 p-3" : "gap-3 p-4",
        variant === "default" && "bg-surface shadow-card",
        variant === "flat" && "border border-line bg-transparent",
        variant === "tint" && "bg-surface-2",
        tone && variant === "default" && LEFT_BAR[tone],
        className
      )}
      {...props}
    />
  )
}

/** A card's head row: title on the left, a chip or link on the right. */
export function CardHead({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="cr-card-head"
      className={cn(
        "flex flex-wrap items-center justify-between gap-2",
        className
      )}
      {...props}
    />
  )
}

/** A card's foot: a hairline above, meta on the left, an action on the right. */
export function CardFoot({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="cr-card-foot"
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-line pt-3",
        className
      )}
      {...props}
    />
  )
}

type LeadCardProps = Omit<React.ComponentProps<"section">, "title"> & {
  /** A 4px bar along the top in the tone (photo to replace = warn). */
  tone?: CardTone
  /** Small line above the title (kind of job, venue). */
  kicker?: React.ReactNode
  /** State chip beside the kicker. */
  chip?: React.ReactNode
  title: React.ReactNode
  titleAs?: "h2" | "h3"
  titleId?: string
  /** A short thumbnail (112px column) beside the text; keep it short. */
  media?: React.ReactNode
  /** The one blue action (and at most one grey one). */
  actions?: React.ReactNode
}

/**
 * The one job on a screen and its one blue action (DESIGN.md §4). At most one
 * per screen, and none on a screen whose dock holds the primary. Keep the
 * media short so the action shows without scrolling on a 390x844 phone.
 */
export function LeadCard({
  tone,
  kicker,
  chip,
  title,
  titleAs: Title = "h2",
  titleId,
  media,
  actions,
  className,
  children,
  ...props
}: LeadCardProps) {
  const text = (
    <div className="grid min-w-0 content-start gap-2">
      {kicker || chip ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {kicker ? (
            <span className="text-meta font-semibold text-ink-muted">
              {kicker}
            </span>
          ) : null}
          {chip}
        </div>
      ) : null}
      <Title
        id={titleId}
        className="font-display text-card-title [overflow-wrap:anywhere] text-ink"
      >
        {title}
      </Title>
      {children ? <div className="grid gap-1 text-body">{children}</div> : null}
    </div>
  )
  return (
    <section
      data-slot="cr-lead-card"
      className={cn(
        "relative grid min-w-0 gap-3 overflow-hidden rounded-card bg-surface p-4 shadow-card",
        tone && TOP_BAR[tone],
        className
      )}
      {...props}
    >
      {media ? (
        <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-3 [&_img]:rounded-control">
          <div className="min-w-0">{media}</div>
          {text}
        </div>
      ) : (
        text
      )}
      {actions ? <div className="grid gap-2">{actions}</div> : null}
    </section>
  )
}
