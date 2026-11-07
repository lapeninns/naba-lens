"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

import { initials } from "./format"

/**
 * A stable hue per person (0-359) from their name, for the avatar tint. It
 * only tells faces apart; it never carries a state.
 */
export function avatarHue(name: string): number {
  let hash = 0
  for (const ch of name.trim().toLowerCase()) {
    hash = (hash * 31 + ch.codePointAt(0)!) % 360
  }
  return hash
}

/**
 * A profile photo in a circle, or up to two initials in white on the
 * person's tint (Common Room avatar). Beside a
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
      style={{ "--ah": avatarHue(name) } as React.CSSProperties}
      {...(labelled
        ? { role: "img", "aria-label": name }
        : { "aria-hidden": true })}
    >
      {src ? <AvatarImage src={src} alt="" /> : null}
      <AvatarFallback>{initials(name)}</AvatarFallback>
    </Avatar>
  )
}
