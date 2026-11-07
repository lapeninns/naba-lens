import { cn } from "@/lib/utils"

/**
 * The pinned action area that holds a screen's one primary (DESIGN.md §4
 * `.dock`): white, a hairline above, 12px gutter. Only use it where the
 * product already pins its action. On phones it sticks above the TabBar
 * (or to the bottom with `overTabBar={false}` on screens without one); from
 * md it is a plain row at the end of the content.
 *
 * Pairs: put the grey button first and the blue one last, so the primary
 * sits on the right (thumb side) and, when stacked, below.
 */
export function ActionDock({
  note,
  overTabBar = true,
  className,
  children,
}: {
  /** One muted line under the buttons (why the primary is disabled…). */
  note?: React.ReactNode
  overTabBar?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      data-slot="cr-action-dock"
      className={cn(
        "sticky z-30 -mx-(--page-gutter) grid gap-2 bg-surface px-(--page-gutter) pt-3 pb-3 shadow-[0_-1px_0_var(--line)] md:static md:mx-0 md:rounded-card md:p-4 md:shadow-card",
        overTabBar
          ? "bottom-[calc(var(--size-tabbar)+env(safe-area-inset-bottom,0px))]"
          : "bottom-0 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]",
        className
      )}
    >
      <div className="grid gap-2 has-[>:nth-child(2)]:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] max-[359px]:has-[>:nth-child(2)]:grid-cols-1">
        {children}
      </div>
      {note ? (
        <p className="text-center text-meta text-ink-muted">{note}</p>
      ) : null}
    </div>
  )
}
