import {
  CheckCircleIcon,
  InfoIcon,
  WarningCircleIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr"

import { cn } from "@/lib/utils"

export type NoticeTone = "plain" | "attention" | "negative" | "positive"

const TONE: Record<NoticeTone, { ground: string; icon: string }> = {
  plain: { ground: "bg-well", icon: "text-ink-muted" },
  attention: { ground: "bg-attention-soft", icon: "text-attention" },
  negative: { ground: "bg-negative-soft", icon: "text-negative" },
  positive: { ground: "bg-positive-soft", icon: "text-positive" },
}

const ICON = {
  plain: InfoIcon,
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
  attention: "status",
  negative: "alert",
  positive: "status",
}

type NoticeProps = Omit<React.ComponentProps<"div">, "title" | "role"> & {
  tone?: NoticeTone
  title?: React.ReactNode
  /** At most one action, repeating the fix: "Try again", "Reload". */
  action?: React.ReactNode
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
  className,
  children,
  ...props
}: NoticeProps) {
  const Icon = ICON[tone]
  const resolvedRole = role ?? ROLE[tone]
  return (
    <div
      data-slot="notice"
      data-tone={tone}
      role={resolvedRole === "none" ? undefined : resolvedRole}
      className={cn(
        "@container rounded-control text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        TONE[tone].ground,
        // In dark the secondary button's line-control edge falls under 3:1 on
        // a tinted ground, so it takes ink-muted there.
        tone !== "plain" &&
          "dark:[&_[data-variant=outline]]:border-ink-muted dark:[&_[data-variant=secondary]]:border-ink-muted",
        className
      )}
      {...props}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 px-3.5 py-3 text-body-touch md:text-body-sm @max-[32.5rem]:grid-cols-[auto_minmax(0,1fr)]">
        <Icon
          aria-hidden
          className={cn("mt-0.5 size-5 shrink-0", TONE[tone].icon)}
        />
        <div className="grid min-w-0 gap-0.5">
          {title ? <p className="font-semibold">{title}</p> : null}
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
