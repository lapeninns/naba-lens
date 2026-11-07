"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"
import { XIcon } from "@phosphor-icons/react"

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
      className={cn(
        "fixed inset-0 isolate z-50 bg-scrim duration-(--duration-sheet) data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          // Phones: a sheet from the bottom with a grip, at most 92% of the
          // screen. From md: centred, size-dialog wide.
          "fixed inset-x-0 bottom-0 z-50 mx-auto grid max-h-[92dvh] w-full grid-cols-[minmax(0,1fr)] gap-4 overflow-y-auto overscroll-contain rounded-t-sheet bg-surface px-4 pt-2 pb-[calc(1.75rem+env(safe-area-inset-bottom,0px))] text-body text-ink shadow-float duration-(--duration-sheet) ease-(--ease-out) outline-none before:-mb-1 before:h-[5px] before:w-11 before:justify-self-center before:rounded-[3px] before:bg-border-strong before:content-[''] md:top-1/2 md:right-auto md:bottom-auto md:left-1/2 md:max-h-[min(45rem,calc(100dvh-3rem))] md:max-w-(--size-dialog) md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-sheet md:p-6 md:text-body md:before:hidden data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-bottom-8 md:data-open:slide-in-from-bottom-0 md:data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-bottom-8 md:data-closed:slide-out-to-bottom-0 md:data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                // A labelled Close (DESIGN.md §4), 44px target at every width.
                className="absolute top-3 right-2 gap-1 px-2.5 md:top-4 md:right-4"
                size="sm"
              />
            }
          >
            <XIcon aria-hidden />
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
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        // Phones stack the actions full width with the primary (last) nearest
        // the thumb; from md they sit right-aligned, secondary first.
        "flex flex-col gap-2 bg-surface pt-2 max-md:*:w-full md:flex-row md:flex-wrap md:justify-end md:*:min-w-35",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "pr-24 font-display text-section-title text-balance text-ink md:pr-28 md:text-page-title",
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
        "text-body text-ink-muted *:[a]:font-bold *:[a]:text-ink *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-ink",
        className
      )}
      {...props}
    />
  )
}

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
