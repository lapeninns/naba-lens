import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"

/** Home's way into the first-run screen for someone who has not seen it. */
export function FirstRunEntry({ href }: { href: string }) {
  return (
    <section
      aria-labelledby="first-run-heading"
      className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface p-4 shadow-card"
    >
      <div className="grid min-w-0 gap-1">
        <h2
          id="first-run-heading"
          className="font-display text-section-title [overflow-wrap:anywhere] text-ink"
        >
          New to Naba-Lens?
        </h2>
        <p className="text-meta text-ink-muted">
          A short welcome shows what to do first.
        </p>
      </div>
      <Link
        href={href}
        className={buttonVariants({
          variant: "secondary",
          className: "w-full sm:w-auto",
        })}
      >
        Start here
      </Link>
    </section>
  )
}
