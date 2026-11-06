"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

import { initials } from "./format"

/**
 * A profile photo in a circle, or up to two initials on `well`. Beside a
 * visible name it is decorative; set `labelled` when it stands alone, so it
 * is announced as the person's name.
 */
export function ProfileAvatar({
  name,
  src,
  size = "default",
  labelled = false,
  className,
}: {
  name: string
  src?: string | null
  size?: "default" | "sm" | "md" | "target" | "lg"
  labelled?: boolean
  className?: string
}) {
  return (
    <Avatar
      size={size}
      className={className}
      {...(labelled
        ? { role: "img", "aria-label": name }
        : { "aria-hidden": true })}
    >
      {src ? <AvatarImage src={src} alt="" /> : null}
      <AvatarFallback>{initials(name)}</AvatarFallback>
    </Avatar>
  )
}
