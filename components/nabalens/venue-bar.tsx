import { cn } from "@/lib/utils"

/**
 * v2 VenueBar (`nl-venue`, D10): names the pub the person is working in and
 * their role there. The pub's name is in full in heading type and wraps to
 * two lines rather than being shortened; the role line ("You're staff
 * here") is caption in ink-muted. `action` is the optional Change control,
 * shown only when the person belongs to more than one pub (the caller
 * decides and keeps its own behaviour, such as warning before labels are
 * cleared).
 */
export function VenueBar({
  name,
  role,
  action,
  className,
}: {
  name: string
  role?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="venue-bar"
      className={cn(
        "flex items-center gap-3 border-b border-line bg-surface px-4 py-2",
        className
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-heading [overflow-wrap:anywhere] text-ink">{name}</p>
        {role ? <p className="text-meta text-ink-muted">{role}</p> : null}
      </div>
      {action ? <div className="flex-none">{action}</div> : null}
    </div>
  )
}
