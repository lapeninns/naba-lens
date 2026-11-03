import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"

/** Home's way into the first-run screen for someone who has not seen it. */
export function FirstRunEntry({ href }: { href: string }) {
  return (
    <section
      aria-labelledby="first-run-heading"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4"
    >
      <div className="grid gap-1">
        <h2 id="first-run-heading" className="font-display text-xl text-ink">
          New to Naba-Lens?
        </h2>
        <p className="text-body-touch text-ink-muted md:text-body">
          A short welcome shows what to do first.
        </p>
      </div>
      <Link href={href} className={buttonVariants({ variant: "secondary" })}>
        Start here
      </Link>
    </section>
  )
}
