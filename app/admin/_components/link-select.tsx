"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { OptionSelect } from "@/components/nabalens/option-select"
import { Field, FieldLabel } from "@/components/ui/field"
import { cn } from "@/lib/utils"

export type LinkSelectOption = { id: string; name: string; href: string }

/**
 * A labelled OptionSelect whose every choice is a page (second handoff:
 * "Venue pills become a Select"). The server passes each choice's href, so
 * no function crosses into this client component; choosing one replaces the
 * URL and the page re-reads with the choice in the address.
 */
export function LinkSelect({
  label,
  options,
  value,
  emptyLabel,
  emptyHref,
  className,
}: {
  label: string
  options: LinkSelectOption[]
  /** The chosen option's id; null for the empty choice. */
  value: string | null
  /** The "everything" choice ("All venues") and where it goes. */
  emptyLabel?: string
  emptyHref?: string
  className?: string
}) {
  const router = useRouter()
  const id = React.useId()
  const [pending, startTransition] = React.useTransition()
  return (
    <Field className={cn("grid min-w-0 gap-1.5", className)}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <OptionSelect
        id={id}
        options={options}
        value={value}
        emptyLabel={emptyLabel}
        disabled={pending}
        onValueChange={(next) => {
          const href =
            next == null
              ? emptyHref
              : options.find((option) => option.id === next)?.href
          if (!href) return
          startTransition(() => router.push(href, { scroll: false }))
        }}
      />
    </Field>
  )
}
