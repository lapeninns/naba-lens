"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

import { initials } from "./format"

/** Profile photo with an initials fallback. Decorative: the name is always shown beside it. */
export function ProfileAvatar({
  name,
  src,
  className,
}: {
  name: string
  src?: string | null
  className?: string
}) {
  return (
    <Avatar className={cn("size-10", className)}>
      {src ? <AvatarImage src={src} alt="" /> : null}
      <AvatarFallback className="font-medium text-foreground" aria-hidden>
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  )
}
