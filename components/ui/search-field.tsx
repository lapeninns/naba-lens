"use client"

import * as React from "react"
import { MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import {
  isAriaDisabled,
  type FieldControlSize,
} from "@/components/ui/field-control"
import { Input, type InputProps } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

type SearchFieldProps = Omit<
  InputProps,
  "type" | "value" | "defaultValue" | "children"
> & {
  /** Names the field. Always given; shown unless `hideLabel` is set. */
  label: React.ReactNode
  /** Keep the label for screen readers only. */
  hideLabel?: boolean
  /** The text, when the caller holds it. Leave out to let the field hold it. */
  value?: string
  /** The starting text when the field holds its own. */
  defaultValue?: string
  /** Called with the new text on every change, and with "" on clear. */
  onValueChange?: (value: string) => void
  /** Called after Clear search, once the field is empty and has focus. */
  onClear?: () => void
  /**
   * How many results the text found, in words ("3 people"). It sits in a
   * polite live region, so a change is read out without moving focus. Pass
   * "" while there is nothing to say: the region must already be on the page
   * for a later change to be announced.
   */
  resultCount?: React.ReactNode
  /**
   * Wraps the field in `<form role="search">` with these props, for a search
   * that loads a page: `formProps={{ action: "/staff/people" }}` sends a GET
   * with the input's `name`. Without it the root is a plain `div`.
   */
  formProps?: Omit<React.ComponentProps<"form">, "children" | "role">
  /** sm 44px, md 56px (default), lg 60px. */
  size?: FieldControlSize
  /** Layout only, on the root. */
  className?: string
}

/*
 * Search (common-room.md §4 Field; components.md "Text input", leading icon): a
 * labelled search input with a magnifier, the shared field recipe and a
 * Clear search button that shows once there is text. A client component:
 * it has to know whether the field is empty.
 */
function SearchField({
  label,
  hideLabel = false,
  value,
  defaultValue = "",
  onValueChange,
  onChange,
  onClear,
  resultCount,
  formProps,
  size = "md",
  className,
  id: idProp,
  ref,
  disabled,
  readOnly,
  ...props
}: SearchFieldProps) {
  const generated = React.useId()
  const id = idProp ?? generated
  const [inner, setInner] = React.useState(defaultValue)
  const text = value ?? inner
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  const setRefs = (node: HTMLInputElement | null) => {
    inputRef.current = node
    if (typeof ref === "function") ref(node)
    else if (ref) ref.current = node
  }

  const change = (next: string) => {
    if (value === undefined) setInner(next)
    onValueChange?.(next)
  }

  const clear = () => {
    change("")
    // The button is about to leave the page; focus must not go with it.
    inputRef.current?.focus()
    onClear?.()
  }

  const locked = disabled || readOnly || isAriaDisabled(props["aria-disabled"])
  const canClear = text !== "" && !locked
  const sm = size === "sm"

  const body = (
    <>
      <Label htmlFor={id} className={hideLabel ? "sr-only" : undefined}>
        {label}
      </Label>
      <div data-slot="search-field-control" className="relative">
        <MagnifyingGlassIcon
          aria-hidden
          data-slot="search-field-icon"
          className={cn(
            "pointer-events-none absolute inset-y-0 my-auto text-ink-muted",
            sm ? "left-3 size-5" : "left-3.5 size-6"
          )}
        />
        <Input
          ref={setRefs}
          id={id}
          type="search"
          enterKeyHint="search"
          size={size}
          value={text}
          disabled={disabled}
          readOnly={readOnly}
          onChange={(event) => {
            onChange?.(event)
            change(event.target.value)
          }}
          className={cn(
            // Room for the magnifier and for Clear search; the browser's own
            // clear cross is hidden so there is one, with a 44px target.
            "[&::-webkit-search-cancel-button]:appearance-none",
            sm ? "pr-11 pl-10" : "pr-13 pl-12"
          )}
          {...props}
        />
        {canClear ? (
          <Button
            variant="quiet"
            size="icon"
            data-slot="search-field-clear"
            aria-label="Clear search"
            // A press must not take focus from the input: a caller that
            // applies the text on blur would search for what is being
            // cleared (and Safari reports no relatedTarget to tell by).
            onMouseDown={(event) => event.preventDefault()}
            onClick={clear}
            className={cn(
              "absolute inset-y-0 my-auto",
              sm ? "right-0" : "right-1.5"
            )}
          >
            <XIcon aria-hidden />
          </Button>
        ) : null}
      </div>
      {resultCount !== undefined ? (
        <p
          role="status"
          data-slot="search-field-count"
          className="text-meta text-ink-muted"
        >
          {resultCount}
        </p>
      ) : null}
    </>
  )

  const rootClass = cn("grid w-full gap-1.5", className)
  return formProps ? (
    <form
      method="get"
      {...formProps}
      role="search"
      data-slot="search-field"
      data-size={size}
      className={cn(rootClass, formProps.className)}
    >
      {body}
    </form>
  ) : (
    <div data-slot="search-field" data-size={size} className={rootClass}>
      {body}
    </div>
  )
}

export { SearchField }
export type { SearchFieldProps }
