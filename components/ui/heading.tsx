import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/*
 * Headings (common-room.md §2 Type). Four sizes use the display face through the
 * type-* recipes; `item-title` is a row title and stays in the body face.
 * Ink only: a heading never carries a state. Long titles balance and wrap
 * rather than push a 320px page sideways.
 */
const headingVariants = cva("min-w-0 text-balance wrap-break-word text-ink", {
  variants: {
    size: {
      display: "type-display",
      "page-title": "type-page-title",
      "section-title": "type-section-title",
      "heading-sm": "type-heading-sm",
      "item-title": "text-item-title",
    },
  },
  defaultVariants: { size: "section-title" },
})

type HeadingSize = NonNullable<VariantProps<typeof headingVariants>["size"]>
type HeadingLevel = 1 | 2 | 3 | 4

// The size a level gets when none is asked for: the outline decides the
// look unless the page says otherwise.
const SIZE_FOR_LEVEL = {
  1: "page-title",
  2: "section-title",
  3: "heading-sm",
  4: "item-title",
} as const satisfies Record<HeadingLevel, HeadingSize>

type HeadingProps = Omit<React.ComponentProps<"h2">, "className"> & {
  /** The place in the page outline: renders h1 to h4. Default 2. */
  level?: HeadingLevel
  /** The look. Defaults from the level: 1 page-title, 2 section-title, 3 heading-sm, 4 item-title. */
  size?: HeadingSize
  /** Another element with the same look, for a title that is not in the outline. */
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "span" | "div" | "legend"
  className?: string
}

function Heading({
  level = 2,
  size = SIZE_FOR_LEVEL[level],
  as,
  className,
  ...props
}: HeadingProps) {
  const Element = (as ?? `h${level}`) as "h2"
  return (
    <Element
      data-slot="heading"
      data-size={size}
      className={cn(headingVariants({ size }), className)}
      {...props}
    />
  )
}

export {
  Heading,
  headingVariants,
  type HeadingLevel,
  type HeadingProps,
  type HeadingSize,
}
