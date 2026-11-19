import {
  CheckCircleIcon,
  ClockIcon,
  InfoIcon,
  WarningCircleIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr"

import { cn } from "@/lib/utils"

export type NoticeTone =
  "plain" | "info" | "attention" | "negative" | "positive"

/*
 * v2 Notice (`nl-notice`, D10): a 12px block on the tone's soft ground, the
 * tone's icon and a title in the tone's colour, the text in ink. Plain is
 * v2's neutral notice (surface-sunken); info is progress (sky), attention
 * brass, negative v2's problem (signal on signal-soft) and positive bottle.
 * The icon and the role tell attention and negative apart as well.
 */
const TONE: Record<
  NoticeTone,
  { ground: string; icon: string; title: string }
> = {
  plain: { ground: "bg-surface-2", icon: "text-ink-muted", title: "" },
  info: { ground: "bg-info-bg", icon: "text-info-fg", title: "text-info-fg" },
  attention: {
    ground: "bg-warn-bg",
    icon: "text-warn-fg",
    title: "text-warn-fg",
  },
  negative: {
    ground: "bg-signal-soft",
    icon: "text-signal",
    title: "text-signal",
  },
  positive: { ground: "bg-ok-bg", icon: "text-ok-fg", title: "text-ok-fg" },
}

// v2's fixed icon meanings: clock for progress, exclamation for a person
// needing to act, the triangle for a problem, the check for done.
const ICON = {
  plain: InfoIcon,
  info: ClockIcon,
  attention: WarningCircleIcon,
  negative: WarningIcon,
  positive: CheckCircleIcon,
} as const

/*
 * Plain notices explain a rule (role="note"); failures that stop the task are
 * role="alert"; anything that appears after an action is role="status".
 */
const ROLE: Record<NoticeTone, "note" | "alert" | "status"> = {
  plain: "note",
  info: "status",
  attention: "status",
  negative: "alert",
  positive: "status",
}

type NoticeProps = Omit<React.ComponentProps<"div">, "title" | "role"> & {
  tone?: NoticeTone
  title?: React.ReactNode
  /** At most one action, repeating the fix: "Try again", "Reload". */
  action?: React.ReactNode
  /** Replace the tone's icon (decorative; the words carry the meaning). */
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  role?: "note" | "alert" | "status" | "none"
}

/**
 * An inline message in the flow of the page. Text stays ink; the icon and
 * the title take the tone. Failure copy says what happened, then what to do.
 */
export function Notice({
  tone = "plain",
  title,
  action,
  role,
  icon,
  className,
  children,
  ...props
}: NoticeProps) {
  const Icon = icon ?? ICON[tone]
  const resolvedRole = role ?? ROLE[tone]
  return (
    <div
      data-slot="notice"
      data-tone={tone}
      role={resolvedRole === "none" ? undefined : resolvedRole}
      className={cn(
        "@container rounded-card text-ink focus-ring outline-none",
        TONE[tone].ground,
        className
      )}
      {...props}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2.5 p-4 text-body @max-compact:grid-cols-[auto_minmax(0,1fr)]">
        <Icon
          aria-hidden
          className={cn("mt-px size-5.5 shrink-0", TONE[tone].icon)}
        />
        <div className="grid min-w-0 gap-0.5">
          {title ? (
            <p className={cn("text-label", TONE[tone].title)}>{title}</p>
          ) : null}
          {children ? <div className="min-w-0">{children}</div> : null}
        </div>
        {action ? (
          <div className="flex flex-wrap gap-2 self-center @max-compact:col-start-2 @max-compact:self-start">
            {action}
          </div>
        ) : null}
      </div>
    </div>
  )
}
