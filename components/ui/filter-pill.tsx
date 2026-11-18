import * as React from "react"
import Link from "next/link"
import { CheckIcon, ProhibitIcon, XIcon } from "@phosphor-icons/react/dist/ssr"
import { cva } from "class-variance-authority"

import { cn } from "@/lib/utils"

/*
 * v2 PickChip (`nl-pick`, D10): a surface pill with a 1px line-strong edge,
 * and when it is on, an ink fill with paper text and a tick, so the state is
 * never told by colour alone. Pills are 44px on touch widths and v2's 40px
 * (target-compact) from bp-desktop; a long label wraps inside its pill and
 * a row of pills wraps too, so nothing scrolls sideways.
 *
 * Two modes. With `href` it is a link for filters kept in the URL, and the
 * one that is on says so with `aria-current`. Without `href` it is a button
 * with `aria-pressed` for filters kept on the page.
 */
const pillVariants = cva(
  "group/pill inline-flex min-h-11 max-w-full min-w-11 items-center gap-2 rounded-round px-4 py-1.5 text-start text-label [overflow-wrap:anywhere] focus-ring transition-[background-color,box-shadow,color] duration-quick outline-none desktop:min-h-10 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4.5",
  {
    variants: {
      selected: {
        true: "bg-ink text-canvas",
        false: "bg-surface edge-strong",
      },
      // Switched off: sunken, label kept, a hairline and a "not allowed" mark.
      blocked: {
        true: "cursor-not-allowed text-ink-muted",
        false: "",
      },
    },
    compoundVariants: [
      {
        selected: false,
        blocked: true,
        className: "bg-surface-2 edge",
      },
      {
        selected: false,
        blocked: false,
        className: "text-ink hover:bg-raised active:bg-raised",
      },
    ],
    defaultVariants: { selected: false, blocked: false },
  }
)

type FilterPillShared = {
  /** The filter is on. */
  selected?: boolean
  /** How many results the filter holds; set in the mono face. */
  count?: React.ReactNode
  /**
   * A filter that is on and goes away when pressed: it shows a cross in
   * place of the tick. It is an action, so it carries no pressed or current
   * state; `removeLabel` starts its name.
   */
  removable?: boolean
  /** Hidden words before the label of a removable pill. */
  removeLabel?: string
  /**
   * Why the pill cannot be used just now. The pill stays in the focus order,
   * does nothing when pressed, and is described by these words. Show the
   * same reason on screen near the group.
   */
  disabledReason?: string
  /** Layout only. */
  className?: string
  children: React.ReactNode
}

type FilterPillLinkProps = FilterPillShared &
  Omit<React.ComponentProps<"a">, "className" | "children" | "href"> &
  Pick<
    React.ComponentProps<typeof Link>,
    "href" | "prefetch" | "replace" | "scroll"
  > & {
    /** What `aria-current` says when selected: a page, or one of a set. */
    current?: "page" | "true"
  }

type FilterPillToggleProps = FilterPillShared &
  Omit<React.ComponentProps<"button">, "className" | "children" | "type"> & {
    href?: undefined
  }

type FilterPillProps = FilterPillLinkProps | FilterPillToggleProps

function isTrue(value: boolean | "true" | "false" | undefined) {
  return value === true || value === "true"
}

function FilterPill(props: FilterPillProps) {
  const {
    selected = false,
    count,
    removable = false,
    removeLabel = "Remove filter:",
    disabledReason,
    className,
    children,
    "aria-describedby": describedBy,
    "aria-disabled": ariaDisabled,
    ...rest
  } = props
  const reasonId = React.useId()
  const on = selected || removable
  const blocked =
    disabledReason !== undefined ||
    isTrue(ariaDisabled) ||
    ("disabled" in rest && rest.disabled === true)

  const shared = {
    "data-slot": "filter-pill",
    "data-size": "sm",
    "data-selected": on ? "" : undefined,
    "data-removable": removable ? "" : undefined,
    "aria-disabled": blocked || undefined,
    "aria-describedby":
      [describedBy, disabledReason ? reasonId : null]
        .filter(Boolean)
        .join(" ") || undefined,
    className: cn(pillVariants({ selected: on, blocked }), className),
  }

  const content = (
    <>
      {blocked && !on ? (
        <ProhibitIcon aria-hidden data-slot="filter-pill-off" />
      ) : null}
      {on && !removable ? (
        <CheckIcon aria-hidden weight="bold" data-slot="filter-pill-tick" />
      ) : null}
      <span data-slot="filter-pill-label" className="min-w-0">
        {removable ? (
          <>
            <span className="sr-only">{removeLabel}</span>{" "}
          </>
        ) : null}
        {children}
      </span>
      {count !== undefined && count !== null ? (
        <>
          {/* A space, so the name reads "Waiting 12" and not "Waiting12". */}{" "}
          <span
            data-slot="filter-pill-count"
            className={cn(
              "font-mono text-label font-medium",
              on ? "text-canvas" : "text-ink-muted"
            )}
          >
            {count}
          </span>
        </>
      ) : null}
      {removable ? (
        <XIcon aria-hidden weight="bold" data-slot="filter-pill-remove" />
      ) : null}
    </>
  )

  // Outside the pill, so the reason describes it without joining its name.
  const reason = disabledReason ? (
    <span id={reasonId} data-slot="filter-pill-reason" className="sr-only">
      {disabledReason}
    </span>
  ) : null

  if (rest.href !== undefined) {
    const {
      href,
      prefetch,
      replace,
      scroll,
      current = "page",
      ...anchor
    } = rest as Omit<FilterPillLinkProps, keyof FilterPillShared>
    const ariaCurrent = selected && !removable ? current : undefined
    if (blocked) {
      // A link with nowhere to go: no href, still focusable, so the reason
      // can be reached and read. Like the blocked button below it takes no
      // handler that acts, so a caller's onClick cannot run.
      const inert = Object.fromEntries(
        Object.entries(anchor).filter(
          ([name]) =>
            !/^on[A-Z]/.test(name) || name === "onFocus" || name === "onBlur"
        )
      )
      return (
        <>
          <span
            {...(inert as React.ComponentProps<"span">)}
            {...shared}
            role="link"
            tabIndex={0}
            data-mode="link"
            aria-current={ariaCurrent}
          >
            {content}
          </span>
          {reason}
        </>
      )
    }
    return (
      <Link
        {...anchor}
        {...shared}
        href={href}
        prefetch={prefetch}
        replace={replace}
        scroll={scroll}
        data-mode="link"
        aria-current={ariaCurrent}
      >
        {content}
      </Link>
    )
  }

  const { onClick, ...button } = rest as Omit<
    FilterPillToggleProps,
    keyof FilterPillShared
  >
  return (
    <>
      <button
        {...button}
        {...shared}
        type="button"
        data-mode="toggle"
        aria-pressed={removable ? undefined : selected}
        // A blocked pill takes no handler at all, so nothing runs.
        onClick={blocked ? undefined : onClick}
      >
        {content}
      </button>
      {reason}
    </>
  )
}

type PillGroupProps = Omit<
  React.ComponentProps<"div">,
  "className" | "role" | "aria-label"
> & {
  /** Accessible name of the group, such as "Status". */
  label?: string
  /** Layout only. */
  className?: string
}

/*
 * A named row of pills (common-room.md §4): 8px apart, wrapping onto new lines,
 * never a sideways scroller. Name it with `label`, or with `aria-labelledby`
 * when the name is on screen.
 */
function PillGroup({
  label,
  "aria-labelledby": labelledBy,
  className,
  ...props
}: PillGroupProps) {
  return (
    <div
      role="group"
      data-slot="pill-group"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      className={cn("flex min-w-0 flex-wrap gap-2", className)}
      {...props}
    />
  )
}

export { FilterPill, PillGroup }
export type {
  FilterPillLinkProps,
  FilterPillProps,
  FilterPillToggleProps,
  PillGroupProps,
}
