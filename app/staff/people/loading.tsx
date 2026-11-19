import { Skeleton } from "@/components/ui/skeleton"

export default function PeopleLoading() {
  return (
    <div
      aria-label="Loading colleagues"
      className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8"
    >
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-11 w-full max-w-2xl" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-48 rounded-xl" />
        ))}
      </div>
    </div>
  )
}
