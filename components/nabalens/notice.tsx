import {
  CheckCircleIcon,
  InfoIcon,
  WarningCircleIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr"

import { cn } from "@/lib/utils"

export type NoticeTone =
  "plain" | "info" | "attention" | "negative" | "positive"

/*
 * Common Room notice (DESIGN.md §4): a 12px card. Plain is a white card;
 * the tones are a tint with a 4px bar of the tone on the left. Attention and
 * negative are both the warn tone; the icon and role tell them apart.
 */
const TONE: Record<NoticeTone, { ground: string; icon: string }> = {
  plain: { ground: "bg-surface shadow-card", icon: "text-ink-muted" },
  info: {
    ground: "bg-info-bg shadow-[inset_4px_0_0_var(--info-fg)]",
    icon: "text-info-fg",
  },
  attention: {
    ground: "bg-warn-bg shadow-[inset_4px_0_0_var(--warn-fg)]",
    icon: "text-warn-fg",
  },
  negative: {
    ground: "bg-warn-bg shadow-[inset_4px_0_0_var(--warn-fg)]",
    icon: "text-warn-fg",
  },
  positive: {
    ground: "bg-ok-bg shadow-[inset_4px_0_0_var(--ok-fg)]",
    icon: "text-ok-fg",
  },
}

const ICON = {
  plain: InfoIcon,
  info: InfoIcon,
  attention: WarningIcon,
  negative: WarningCircleIcon,
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
 * An inline message in the flow of the page. Text stays ink; only the icon
 * takes the tone. Failure copy says what happened, then what to do.
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
        "@container rounded-card text-ink outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid",
        TONE[tone].ground,
        className
      )}
      {...props}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2.5 py-3.5 pr-4 pl-5 text-body @max-[32.5rem]:grid-cols-[auto_minmax(0,1fr)]">
        <Icon
          aria-hidden
          className={cn("mt-0.5 size-6 shrink-0", TONE[tone].icon)}
        />
        <div className="grid min-w-0 gap-0.5">
          {title ? <p className="font-bold">{title}</p> : null}
          {children ? <div className="min-w-0">{children}</div> : null}
        </div>
        {action ? (
          <div className="flex flex-wrap gap-2 self-center @max-[32.5rem]:col-start-2 @max-[32.5rem]:self-start">
            {action}
          </div>
        ) : null}
      </div>
    </div>
  )
}
