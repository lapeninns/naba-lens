"use client"

import { ImageBrokenIcon } from "@phosphor-icons/react/dist/ssr"
import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

import { cn } from "@/lib/utils"

/*
 * A photo in a box of fixed shape (common-room.md §4). The box holds its ratio
 * before the file arrives, so nothing below it moves, and shows the
 * media-placeholder fill until then. A photo that cannot be shown says so in
 * words with an icon; it is never a silent grey box.
 *
 * It works with app/_media/preview-recovery.ts: the <img> stays mounted with
 * its `src` when it fails and the error still bubbles, so a wrapper's
 * `onError` and `attach` can see it and swap in a re-signed URL. A new `src`
 * starts a fresh attempt.
 */
const photoVariants = cva(
  "relative block w-full overflow-hidden bg-media-placeholder",
  {
    variants: {
      ratio: {
        "4/3": "aspect-4/3",
        "1/1": "aspect-square",
        "16/9": "aspect-video",
        "3/4": "aspect-3/4",
      },
      radius: {
        none: "rounded-none",
        square: "rounded-square",
        control: "rounded-control",
        card: "rounded-card",
      },
    },
    defaultVariants: { ratio: "4/3", radius: "control" },
  }
)

type PhotoRatio = NonNullable<VariantProps<typeof photoVariants>["ratio"]>
type PhotoRadius = NonNullable<VariantProps<typeof photoVariants>["radius"]>
type PhotoState = "loading" | "loaded" | "broken"

type PhotoProps = Omit<
  React.ComponentProps<"img">,
  "alt" | "loading" | "className" | "children" | "width" | "height"
> & {
  /** What the photo shows. Pass "" only when words beside it say the same. */
  alt: string
  /** The shape of the box. Default 4/3. */
  ratio?: PhotoRatio
  /** control (8px) by default; none in an edge-to-edge grid or a viewer. */
  radius?: PhotoRadius
  /** Load at once. Only for the first photo a screen opens on. */
  eager?: boolean
  /** The words shown when the photo cannot be loaded. */
  unavailableLabel?: string
  /** Layout for the box. */
  className?: string
  /** Extra classes for the image itself, such as object-contain. */
  imgClassName?: string
}

function Photo({
  src,
  alt,
  ratio = "4/3",
  radius = "control",
  eager = false,
  unavailableLabel = "Photo unavailable",
  className,
  imgClassName,
  decoding = "async",
  onLoad,
  onError,
  ref,
  ...props
}: PhotoProps) {
  // The result is kept with the URL it belongs to, so a new `src` (a retry
  // with a fresh signature) reads as loading again without an effect.
  const [settled, setSettled] = React.useState<{
    src: PhotoProps["src"]
    state: PhotoState
  } | null>(null)
  const state: PhotoState = !src
    ? "broken"
    : settled && settled.src === src
      ? settled.state
      : "loading"

  // A server-rendered image can finish, or fail, before React is listening.
  const attach = React.useCallback(
    (node: HTMLImageElement | null) => {
      if (typeof ref === "function") ref(node)
      else if (ref) ref.current = node
      if (!node || !node.complete || !node.getAttribute("src")) return
      const next: PhotoState = node.naturalWidth > 0 ? "loaded" : "broken"
      setSettled((current) =>
        current && current.src === src && current.state === next
          ? current
          : { src, state: next }
      )
    },
    [ref, src]
  )

  return (
    <span
      data-slot="photo"
      data-state={state}
      data-ratio={ratio}
      className={cn(photoVariants({ ratio, radius }), className)}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={attach}
          src={src}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding={decoding}
          data-slot="photo-image"
          onLoad={(event) => {
            setSettled({ src, state: "loaded" })
            onLoad?.(event)
          }}
          onError={(event) => {
            setSettled({ src, state: "broken" })
            onError?.(event)
          }}
          className={cn(
            "absolute inset-0 size-full object-cover",
            // Hidden, not removed: the browser's own broken-image mark
            // would show through, and a retry needs the element.
            state === "broken" && "opacity-0",
            imgClassName
          )}
          {...props}
        />
      ) : null}
      {state === "broken" ? (
        <span
          data-slot="photo-unavailable"
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-2 text-center text-meta text-balance text-ink-muted"
        >
          <ImageBrokenIcon aria-hidden className="size-6 shrink-0" />
          {/* With no image element there is no alt, so say what is missing. */}
          {!src && alt ? <span className="sr-only">{alt}. </span> : null}
          {unavailableLabel}
        </span>
      ) : null}
    </span>
  )
}

export {
  Photo,
  photoVariants,
  type PhotoProps,
  type PhotoRadius,
  type PhotoRatio,
  type PhotoState,
}
