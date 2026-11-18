"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import {
  sheetBackdrop,
  sheetFooter,
  sheetPopup,
  type SheetSize,
} from "@/components/ui/sheet-recipe"
import { cn } from "@/lib/utils"

/*
 * Dialog (common-room.md §4, Sheet and Dialog): a sheet from the bottom edge on
 * phones, a centred dialog from md. It has a title, a visible Close, a scrim
 * that closes it, and Escape closes it. The look lives in sheet-recipe.ts,
 * shared with AlertDialog. Pick a `size`; do not set a width or a height.
 *
 * A client file because Base UI's parts are read off one namespace, which a
 * server component cannot do.
 */
type DialogSize = SheetSize

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(sheetBackdrop, className)}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  size = "md",
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  /** sm: a confirm. md: the default. wide: a two-column form. viewer: a
   *  photo or guide, full screen on a phone, with no padding and no grip. */
  size?: DialogSize
  /** Set false only when the content draws its own labelled Close. */
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        data-size={size}
        className={cn(sheetPopup({ size }), className)}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="quiet"
                size="sm"
                // A labelled Close with a 48px target (v2 target-staff), clear
                // of the title's first line at every width.
                className="absolute top-2.5 right-2 min-h-12 min-w-12 gap-1 px-2.5 md:top-3.5 md:right-3.5"
              />
            }
          >
            <XIcon aria-hidden className="size-6" />
            <span>Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  sticky = false,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  /** Keep the actions at the bottom edge while a long form scrolls. */
  sticky?: boolean
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      data-sticky={sticky || undefined}
      className={cn(sheetFooter({ sticky }), className)}
      {...props}
    >
      {showCloseButton && (
        // Written first: the safe choice sits above the primary on a phone
        // and to its left from md.
        <DialogPrimitive.Close render={<Button variant="secondary" />}>
          Close
        </DialogPrimitive.Close>
      )}
      {children}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "pr-24 type-section-title text-balance text-ink md:pr-28",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-body text-ink-muted *:[a]:font-semibold *:[a]:text-accent-text *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-accent-text",
        className
      )}
      {...props}
    />
  )
}

export type { DialogSize }
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
