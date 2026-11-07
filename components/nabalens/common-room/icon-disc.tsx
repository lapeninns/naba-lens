import { cn } from "@/lib/utils"

const TONE = {
  neutral: "bg-surface-2 text-ink",
  ok: "bg-ok-bg text-ok-fg",
  warn: "bg-warn-bg text-warn-fg",
  info: "bg-info-bg text-info-fg",
} as const

/**
 * A 52px round disc above a state heading (mail sent, link expired, could not
 * load). Decorative: the heading beside it carries the meaning.
 */
export function IconDisc({
  tone = "neutral",
  size = "md",
  className,
  children,
}: {
  tone?: keyof typeof TONE
  /** md 52px (state headings), lg 72px (empty states). */
  size?: "md" | "lg"
  className?: string
  /** The icon, e.g. <EnvelopeSimpleIcon />. */
  children: React.ReactNode
}) {
  return (
    <span
      aria-hidden
      data-slot="cr-icon-disc"
      className={cn(
        "grid shrink-0 place-items-center rounded-round",
        size === "md" ? "size-13 [&_svg]:size-7" : "size-18 [&_svg]:size-9",
        TONE[tone],
        className
      )}
    >
      {children}
    </span>
  )
}
