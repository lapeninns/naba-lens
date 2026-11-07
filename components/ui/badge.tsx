import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/*
 * A neutral pill for a kind or a count (Common Room "plain" chip). Never a
 * state: states use StatusChip, whose shapes are reserved (DESIGN.md §3).
 */
const badgeVariants = cva(
  "group/badge inline-flex min-h-8 w-fit max-w-full shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-round border-[1.5px] border-transparent px-3 py-0.5 text-chip whitespace-nowrap transition-colors focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 aria-invalid:border-warn-fg [&>svg]:pointer-events-none [&>svg]:size-[18px]!",
  {
    variants: {
      variant: {
        default: "bg-surface-2 text-ink [a]:hover:bg-raised",
        secondary: "bg-surface-2 text-ink [a]:hover:bg-raised",
        destructive: "border-warn-fg bg-warn-bg text-warn-fg",
        outline: "border-border-strong text-ink [a]:hover:bg-surface-2",
        ghost: "text-ink hover:bg-surface-2",
        link: "font-bold text-ink underline underline-offset-4",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
