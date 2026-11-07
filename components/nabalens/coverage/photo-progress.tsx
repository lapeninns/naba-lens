import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

/** "3 of 5 accepted" with a bar. A missing target is "needs setup", never done. */
export function PhotoProgress({
  accepted,
  target,
  pending = 0,
  className,
}: {
  accepted: number
  target: number | null
  pending?: number
  className?: string
}) {
  if (target == null) {
    return (
      <p className={cn("text-meta text-ink-muted", className)}>
        No photo target set
        {pending > 0 ? ` · ${pending} to review` : null}
      </p>
    )
  }
  const value = target > 0 ? Math.min(100, (accepted / target) * 100) : 0
  const text = `${accepted} of ${target} accepted`
  return (
    <div className={cn("grid min-w-32 gap-1.5", className)}>
      <p className="flex flex-wrap gap-x-2 font-mono text-meta-strong tabular-nums">
        <span className="text-ink">{text}</span>
        {pending > 0 ? (
          <span className="text-ink-muted">{pending} to review</span>
        ) : null}
      </p>
      <Progress value={value} aria-label={text} />
    </div>
  )
}
