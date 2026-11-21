"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { OptionSelect } from "@/components/nabalens/option-select"

/**
 * A filter kept in the URL, as a Select (second handoff: a Category or
 * "More kinds" Select beside PickChips). Each choice carries the address of
 * the filtered page, worked out on the server, so a Server Component can
 * render it without passing a function. Choosing replaces the URL without
 * scrolling.
 */
export function LinkSelect({
  id,
  options,
  value,
  placeholder,
  className,
  ...aria
}: {
  id?: string
  /** Each choice and the page it opens. */
  options: { id: string; name: string; href: string }[]
  /** The choice now on; null shows the placeholder. */
  value: string | null
  placeholder?: string
  className?: string
  "aria-label"?: string
  "aria-describedby"?: string
}) {
  const router = useRouter()
  const [, start] = React.useTransition()
  const [shown, setShown] = React.useOptimistic(value)
  return (
    <OptionSelect
      id={id}
      options={options}
      value={shown}
      placeholder={placeholder}
      className={className}
      onValueChange={(next) => {
        const choice = options.find((o) => o.id === next)
        if (!choice) return
        start(() => {
          setShown(choice.id)
          router.replace(choice.href, { scroll: false })
        })
      }}
      {...aria}
    />
  )
}
