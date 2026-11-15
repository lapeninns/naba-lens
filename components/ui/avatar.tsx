"use client"

import * as React from "react"
import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/*
 * Avatar (DESIGN.md §4): a photo in a circle, or up to two initials in white
 * on a per-person tint. Set `--ah` (a hue) on the Avatar; ProfileAvatar
 * derives it from the name. The tint only tells faces apart: it never
 * carries a state. Not interactive, so it has no hover or focus of its own;
 * a link or button around it draws those.
 *
 * Sizes: sm 36px (bars, stacks, tables), md 44px (rows, posts; the default),
 * lg 84px (profile heads).
 */
const avatarVariants = cva(
  "group/avatar relative flex shrink-0 overflow-hidden rounded-round bg-surface-2 select-none",
  {
    variants: {
      size: {
        sm: "size-9",
        md: "size-11",
        lg: "size-21",
      },
    },
    defaultVariants: { size: "md" },
  }
)

type AvatarSize = NonNullable<VariantProps<typeof avatarVariants>["size"]>

function Avatar({
  className,
  size = "md",
  ...props
}: Omit<AvatarPrimitive.Root.Props, "className"> & {
  size?: AvatarSize
  className?: string
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(avatarVariants({ size }), className)}
      {...props}
    />
  )
}

function AvatarImage({
  className,
  ...props
}: Omit<AvatarPrimitive.Image.Props, "className"> & { className?: string }) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn(
        "aspect-square size-full rounded-round object-cover",
        className
      )}
      {...props}
    />
  )
}

function AvatarFallback({
  className,
  ...props
}: Omit<AvatarPrimitive.Fallback.Props, "className"> & {
  className?: string
}) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        // Initials stay at the 17px floor at sm and md: two letters still fit
        // a 36px circle. The spec's 15px for sm is below the floor. lg has
        // no type role: 30px sits between page-title (26) and display (34).
        "flex size-full items-center justify-center rounded-round bg-avatar-fill font-display text-label leading-none font-extrabold text-on-avatar group-data-[size=lg]/avatar:text-[30px]",
        // Forced colours drop the tint; an outline keeps the circle.
        "forced-colors:border",
        className
      )}
      {...props}
    />
  )
}

/** A small dot on the avatar's corner. Decoration: say the state in words beside it. */
function AvatarBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        "absolute right-0 bottom-0 z-local inline-flex size-2.5 items-center justify-center rounded-round bg-ink text-surface ring-2 ring-surface select-none [&>svg]:size-2",
        "group-data-[size=sm]/avatar:size-2 group-data-[size=sm]/avatar:[&>svg]:hidden",
        "group-data-[size=lg]/avatar:size-3",
        className
      )}
      {...props}
    />
  )
}

/** Avatars in a row, each overlapping the last by 8px with a 2px ring. */
function AvatarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        "group/avatar-group flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-surface",
        className
      )}
      {...props}
    />
  )
}

/** "+3" at the end of a group. As big as the avatars beside it. */
function AvatarGroupCount({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group-count"
      className={cn(
        "relative flex size-11 shrink-0 items-center justify-center rounded-round bg-surface-2 text-meta font-semibold text-ink ring-2 ring-surface group-has-data-[size=sm]/avatar-group:size-9 [&>svg]:size-5",
        className
      )}
      {...props}
    />
  )
}

export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarBadge,
  avatarVariants,
  type AvatarSize,
}
