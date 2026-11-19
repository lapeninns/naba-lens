import { cva, type VariantProps } from "class-variance-authority"

/*
 * The one field recipe (v2 Field, `nl-input`; D10), shared by Input,
 * Textarea, the Select trigger and SearchField so they cannot drift apart:
 * surface fill, a 1px line-strong edge, 12px radius, 16px text so phones do
 * not zoom.
 *
 * - Height is a minimum, so text at 200% zoom grows the box instead of
 *   being cut off. `md` is v2's 48px (the default), `sm` is 44px and `lg`
 *   is 48px too, the same words and heights as every other control.
 * - Invalid is a 2px signal edge (v2: the border thickens as well as
 *   changing colour). The error under the field carries the icon and the
 *   words.
 * - Off is one look however it is switched off (`disabled`, `aria-disabled`
 *   or Base UI's `data-disabled`): surface-sunken ground, a line edge and
 *   muted text; hover does nothing.
 * - Edges are box-shadows, which forced colours drops, so a real border
 *   stands in for them there.
 */
// Written out in full: Tailwind finds class names by reading this file.
const OFF =
  "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-muted disabled:edge disabled:hover:bg-surface-2 aria-disabled:cursor-not-allowed aria-disabled:bg-surface-2 aria-disabled:text-ink-muted aria-disabled:edge aria-disabled:hover:bg-surface-2 data-disabled:cursor-not-allowed data-disabled:bg-surface-2 data-disabled:text-ink-muted data-disabled:edge data-disabled:hover:bg-surface-2"

const fieldControlVariants = cva(
  `w-full min-w-0 rounded-control border-0 bg-surface text-ink edge-strong focus-ring transition-[background-color,box-shadow,color] duration-quick ease-out outline-none placeholder:text-ink-muted placeholder:opacity-100 hover:bg-raised aria-invalid:edge-invalid forced-colors:border forced-colors:aria-invalid:border-2 ${OFF}`,
  {
    variants: {
      size: {
        sm: "min-h-11 px-3.5 py-1.5 text-field",
        md: "min-h-12 px-4 py-2 text-field",
        lg: "min-h-12 px-4 py-2 text-field",
      },
    },
    defaultVariants: { size: "md" },
  }
)

type FieldControlSize = NonNullable<
  VariantProps<typeof fieldControlVariants>["size"]
>

/** True for `aria-disabled` written as a boolean or as the string. */
function isAriaDisabled(value: boolean | "true" | "false" | undefined) {
  return value === true || value === "true"
}

export { fieldControlVariants, isAriaDisabled }
export type { FieldControlSize }
