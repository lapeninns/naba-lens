import { Skeleton } from "@/components/ui/skeleton"

export default function MenusLoading() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6 sm:py-8">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-5 w-full max-w-xl" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}
