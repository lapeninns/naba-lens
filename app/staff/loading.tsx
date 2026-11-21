import { Skeleton } from "@/components/ui/skeleton"

/**
 * Any staff page loading without a skeleton of its own (DESIGN.md §16): a
 * title and a list of cards, the shape most staff pages share.
 */
export default function StaffLoading() {
  return (
    <div
      className="mx-auto grid w-full max-w-feed min-w-0 content-start gap-gutter px-page-gutter py-4 md:py-8"
      aria-busy="true"
    >
      <Skeleton shape="title" className="w-40 max-w-full" />
      <Skeleton shape="line" className="w-56 max-w-full" />
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="grid gap-2 rounded-card bg-surface p-4 shadow-card"
        >
          <Skeleton shape="line" className="w-48 max-w-full" />
          <Skeleton shape="line" className="w-64 max-w-full" />
        </div>
      ))}
    </div>
  )
}
