import { WarningCircleIcon } from "@phosphor-icons/react"

/** Labels and help text of the capture forms. */
export const LABEL = "text-label-touch text-ink md:text-label"
export const MUTED = "text-meta-touch text-ink-muted md:text-meta"

/**
 * A field's error, read through the field's aria-describedby: a failed check
 * focuses the first invalid control instead of announcing every message at
 * once (CA-13).
 */
export function FieldMessage({ id, error }: { id: string; error?: string }) {
  if (!error) return null
  return (
    <p
      id={id}
      className="flex items-start gap-1.5 text-meta-touch font-semibold text-negative md:text-meta-strong"
    >
      <WarningCircleIcon aria-hidden className="mt-px size-4 shrink-0" />
      {error}
    </p>
  )
}
