"use client"

import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog"

import {
  Button,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from "@/components/ui/button"
import {
  sheetBackdrop,
  sheetFooter,
  sheetPopup,
  type SheetSize,
} from "@/components/ui/sheet-recipe"
import { cn } from "@/lib/utils"

/*
 * AlertDialog (DESIGN.md §4 and §6, destructive actions): a question the
 * person must answer. It has no Close and the scrim does not dismiss it;
 * the safe choice is written first and Escape takes it. Same sheet recipe
 * as Dialog (sheet-recipe.ts): a bottom sheet on phones, centred from md.
 *
 * A client file because Base UI's parts are read off one namespace, which a
 * server component cannot do.
 */
type AlertDialogSize = Extract<SheetSize, "sm" | "md">

function AlertDialog({ ...props }: AlertDialogPrimitive.Root.Props) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger({ ...props }: AlertDialogPrimitive.Trigger.Props) {
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
  )
}

function AlertDialogPortal({ ...props }: AlertDialogPrimitive.Portal.Props) {
  return (
    <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
  )
}

function AlertDialogOverlay({
  className,
  ...props
}: AlertDialogPrimitive.Backdrop.Props) {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-overlay"
      className={cn(sheetBackdrop, className)}
      {...props}
    />
  )
}

function AlertDialogContent({
  className,
  size = "sm",
  ...props
}: AlertDialogPrimitive.Popup.Props & {
  /** sm: a confirm, the default. md: when the question needs more room. */
  size?: AlertDialogSize
}) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Popup
        data-slot="alert-dialog-content"
        data-size={size}
        className={cn(sheetPopup({ size }), className)}
        {...props}
      />
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn("grid justify-items-start gap-1.5 text-left", className)}
      {...props}
    />
  )
}

function AlertDialogFooter({
  className,
  sticky = false,
  ...props
}: React.ComponentProps<"div"> & {
  /** Keep the actions at the bottom edge while long content scrolls. */
  sticky?: boolean
}) {
  return (
    <div
      data-slot="alert-dialog-footer"
      data-sticky={sticky || undefined}
      className={cn(sheetFooter({ sticky }), className)}
      {...props}
    />
  )
}

function AlertDialogMedia({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-media"
      className={cn(
        "mb-2 inline-flex size-13 items-center justify-center rounded-round bg-surface-2 text-ink *:[svg:not([class*='size-'])]:size-6",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("type-section-title text-balance text-ink", className)}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn(
        "text-body text-pretty text-ink-muted *:[a]:font-bold *:[a]:text-ink *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-ink",
        className
      )}
      {...props}
    />
  )
}

// The dialog's two buttons are real buttons: never a text-sized link.
type DialogButtonLook = {
  variant?: Exclude<ButtonVariant, "link" | "row-link">
  size?: ButtonSize
}

function AlertDialogAction({
  className,
  // The confirming action is the dialog's one primary unless the caller says otherwise.
  variant = "primary",
  ...props
}: Omit<ButtonProps, "variant" | "size"> & DialogButtonLook) {
  return (
    <Button
      data-slot="alert-dialog-action"
      variant={variant}
      className={cn(className)}
      {...props}
    />
  )
}

function AlertDialogCancel({
  className,
  variant = "secondary",
  size = "md",
  ...props
}: AlertDialogPrimitive.Close.Props & DialogButtonLook) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-cancel"
      className={cn(className)}
      render={<Button variant={variant} size={size} />}
      {...props}
    />
  )
}

export type { AlertDialogSize }
export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
}
