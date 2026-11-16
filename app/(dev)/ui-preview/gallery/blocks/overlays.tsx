"use client"

// Client: the busy confirm below keeps its own open and saving state.
import * as React from "react"
import {
  DotsThreeIcon,
  PencilSimpleIcon,
  ProhibitIcon,
  TrashIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  type DialogSize,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const CAPTION = "text-meta text-ink-muted"

function Specimen({
  caption,
  children,
}: {
  caption: string
  children: React.ReactNode
}) {
  return (
    <div className="grid content-start justify-items-start gap-2">
      {children}
      <p className={CAPTION}>{caption}</p>
    </div>
  )
}

const LONG_TEXT =
  "The Railway asks for one photo of every dish on the Sunday menu each month, taken at the pass before the plate leaves the kitchen, and the head chef reviews them on the first Monday."

const PARAGRAPHS = Array.from({ length: 8 }, (_, index) => index)

const DIALOG_SIZES: { size: Exclude<DialogSize, "viewer">; note: string }[] = [
  { size: "sm", note: "sm: a confirm, 440px from md" },
  { size: "md", note: "md: the default, 560px from md" },
  { size: "wide", note: "wide: a two-column form, 760px from md" },
]

function SizedDialog({
  size,
  note,
}: {
  size: Exclude<DialogSize, "viewer">
  note: string
}) {
  return (
    <Specimen caption={note}>
      <Dialog>
        <DialogTrigger render={<Button />}>Open {size} dialog</DialogTrigger>
        <DialogContent size={size}>
          <DialogHeader>
            <DialogTitle>Ask for another photo</DialogTitle>
            <DialogDescription>
              The person who sent it sees your reason beside the photo.
            </DialogDescription>
          </DialogHeader>
          <p>{LONG_TEXT}</p>
          <DialogFooter>
            <DialogClose render={<Button />}>Keep the photo</DialogClose>
            <Button variant="primary">Ask for another</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Specimen>
  )
}

function LongFormDialog() {
  return (
    <Specimen caption="md with a sticky footer: the actions stay at the bottom edge while the text scrolls">
      <Dialog>
        <DialogTrigger render={<Button />}>Open long dialog</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Photo rules for The Railway, with a title long enough to wrap
              beside Close
            </DialogTitle>
          </DialogHeader>
          {PARAGRAPHS.map((index) => (
            <p key={index}>{LONG_TEXT}</p>
          ))}
          <DialogFooter sticky>
            <DialogClose render={<Button />}>Cancel</DialogClose>
            <Button variant="primary">Save rules</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Specimen>
  )
}

function BlockedDialog() {
  return (
    <Specimen caption="aria-disabled primary: it stays focusable and the reason sits beside it">
      <Dialog>
        <DialogTrigger render={<Button />}>Open blocked dialog</DialogTrigger>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Send 3 photos</DialogTitle>
            <DialogDescription>Sunday roast, The Railway.</DialogDescription>
          </DialogHeader>
          <p id="overlays-offline-reason" className="text-body text-ink">
            You are offline. Photos are sent when this device is back online.
            Nothing is sent twice.
          </p>
          <DialogFooter>
            <DialogClose render={<Button />}>Cancel</DialogClose>
            <Button
              variant="primary"
              aria-disabled
              aria-describedby="overlays-offline-reason"
            >
              Send photos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Specimen>
  )
}

function ViewerDialog() {
  return (
    <Specimen caption="viewer: full screen below md, large from md, no padding or grip; it draws its own Close">
      <Dialog>
        <DialogTrigger render={<Button />}>Open viewer</DialogTrigger>
        <DialogContent size="viewer" showCloseButton={false}>
          <div className="dark relative grid min-h-75 flex-1 place-items-center bg-stage p-6 text-on-stage">
            <p className="text-body text-on-stage-muted">
              A photo fills this stage.
            </p>
            <DialogClose
              render={
                <Button
                  variant="quiet"
                  size="sm"
                  className="absolute top-2 right-2 text-on-stage"
                />
              }
            >
              <XIcon aria-hidden />
              Close
            </DialogClose>
          </div>
          <div className="grid gap-1 bg-surface p-4">
            <DialogTitle>Sunday roast</DialogTitle>
            <DialogDescription>
              Sent by Priya Nair, The Railway.
            </DialogDescription>
          </div>
        </DialogContent>
      </Dialog>
    </Specimen>
  )
}

function ConfirmDialog() {
  return (
    <Specimen caption="alert dialog, sm (default): no Close, the scrim does not dismiss it, safe choice first">
      <AlertDialog>
        <AlertDialogTrigger render={<Button variant="danger" />}>
          <TrashIcon aria-hidden />
          Delete photo
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this photo?</AlertDialogTitle>
            <AlertDialogDescription>
              It is removed from The Railway for everyone. You cannot undo this.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep photo</AlertDialogCancel>
            <AlertDialogAction variant="danger">Delete photo</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Specimen>
  )
}

function BusyConfirmDialog() {
  const [open, setOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => () => clearTimeout(timer.current ?? undefined), [])

  function activate() {
    setSaving(true)
    timer.current = setTimeout(() => {
      setSaving(false)
      setOpen(false)
    }, 2000)
  }

  return (
    <Specimen caption="alert dialog, md, with media and a busy confirm: press Activate menu to see the loading state for two seconds">
      <AlertDialog open={open} onOpenChange={saving ? undefined : setOpen}>
        <AlertDialogTrigger render={<Button />}>
          Activate menu
        </AlertDialogTrigger>
        <AlertDialogContent size="md">
          <AlertDialogHeader>
            <AlertDialogMedia>
              <WarningIcon aria-hidden />
            </AlertDialogMedia>
            <AlertDialogTitle>
              Activate the Autumn menu at The Railway?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Staff see the new dishes straight away. The Summer menu stops
              asking for photos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction
              loading={saving}
              loadingLabel="Activating…"
              onClick={activate}
            >
              Activate menu
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Specimen>
  )
}

function MenuSpecimen() {
  const [showClosed, setShowClosed] = React.useState(true)
  const [order, setOrder] = React.useState("newest")
  return (
    <Specimen caption="dropdown menu: label, items with icons, an item with a shortcut, a sub-menu, a danger item, a disabled item, a ticked item, a choice of one, and a long item that wraps">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="quiet"
              size="icon"
              aria-label="More actions for Priya Nair"
            />
          }
        >
          <DotsThreeIcon weight="bold" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-auto max-w-80 min-w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Priya Nair</DropdownMenuLabel>
            <DropdownMenuItem>
              <PencilSimpleIcon aria-hidden />
              Edit details
              <DropdownMenuShortcut>E</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Move to a team</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Kitchen</DropdownMenuItem>
                <DropdownMenuItem>Front of house</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem disabled>
              <PencilSimpleIcon aria-hidden />
              Resend invitation (already joined)
            </DropdownMenuItem>
            <DropdownMenuItem>
              Move every photo this person has sent to another venue
            </DropdownMenuItem>
            <DropdownMenuItem variant="danger">
              <ProhibitIcon aria-hidden />
              Deactivate
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={showClosed}
            onCheckedChange={setShowClosed}
          >
            Show closed tasks
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Order</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={order} onValueChange={setOrder}>
              <DropdownMenuRadioItem value="newest">
                Newest first
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="oldest">
                Oldest first
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </Specimen>
  )
}

const VENUES = [
  {
    name: "The Railway",
    manager: "Priya Nair",
    photos: 128,
    state: "Complete",
  },
  {
    name: "The Old School House, Thorpe-on-the-Hill",
    manager: "No venue manager yet",
    photos: 9,
    state: "Needs setup",
  },
  {
    name: "The Bell",
    manager: "Tom Okafor",
    photos: 64,
    state: "12 to review",
  },
]

const TOTAL_PHOTOS = VENUES.reduce((sum, venue) => sum + venue.photos, 0)

function VenueTable({ stacked }: { stacked: boolean }) {
  return (
    <div className="w-full overflow-hidden rounded-card bg-surface px-1 shadow-card">
      <Table stacked={stacked}>
        <TableCaption>Photos this month</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Venue</TableHead>
            <TableHead>Venue manager</TableHead>
            <TableHead numeric>Photos</TableHead>
            <TableHead>State</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {VENUES.map((venue, index) => (
            <TableRow
              key={venue.name}
              aria-selected={index === 2 ? true : undefined}
            >
              <TableHead
                scope="row"
                className="text-item-title whitespace-normal text-ink"
              >
                {venue.name}
                {index === 2 ? (
                  <span className="block text-meta font-normal text-ink-muted">
                    Selected
                  </span>
                ) : null}
              </TableHead>
              <TableCell label="Venue manager">{venue.manager}</TableCell>
              <TableCell label="Photos" numeric>
                {venue.photos}
              </TableCell>
              <TableCell label="State">{venue.state}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableHead scope="row" className="text-ink">
              All venues
            </TableHead>
            <TableCell label="Venue manager">3 venues</TableCell>
            <TableCell label="Photos" numeric>
              {TOTAL_PHOTOS}
            </TableCell>
            <TableCell label="State">1 complete</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  )
}

/** Dialogs, alert dialogs, the dropdown menu and both table modes. */
export function OverlaysBlock() {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-10">
      <section aria-labelledby="overlays-dialog" className="grid gap-4">
        <h3 id="overlays-dialog" className="type-heading-sm text-ink">
          Dialog
        </h3>
        <p className={CAPTION}>
          Below 768px every size is a sheet from the bottom edge with a grip,
          and the footer stacks full width with the grey button above the blue.
          From 768px it is centred and the footer sits right-aligned. Focus
          moves into the dialog when it opens, Tab stays inside it, Escape or
          Close returns focus to the button that opened it.
        </p>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {DIALOG_SIZES.map(({ size, note }) => (
            <SizedDialog key={size} size={size} note={note} />
          ))}
          <ViewerDialog />
          <LongFormDialog />
          <BlockedDialog />
        </div>
      </section>

      <section aria-labelledby="overlays-footer" className="grid gap-4">
        <h3 id="overlays-footer" className="type-heading-sm text-ink">
          Dialog footer
        </h3>
        <div className="grid gap-6">
          <Specimen caption="two actions: safe choice first in the markup, primary last">
            <DialogFooter className="w-full">
              <Button>Cancel</Button>
              <Button variant="primary">Save changes</Button>
            </DialogFooter>
          </Specimen>
          <Specimen caption="one action, and a long label that wraps">
            <DialogFooter className="w-full">
              <Button variant="primary">
                Ask for another photo of the Sunday roast with all the trimmings
              </Button>
            </DialogFooter>
          </Specimen>
          <Specimen caption="danger with its safe choice, and a busy confirm">
            <DialogFooter className="w-full">
              <Button>Keep account</Button>
              <Button variant="danger" loading loadingLabel="Deactivating…">
                Deactivate
              </Button>
            </DialogFooter>
          </Specimen>
        </div>
      </section>

      <section aria-labelledby="overlays-alert" className="grid gap-4">
        <h3 id="overlays-alert" className="type-heading-sm text-ink">
          Alert dialog
        </h3>
        <p className={CAPTION}>
          Focus lands on the first button, the safe choice. Escape takes the
          safe choice.
        </p>
        <div className="grid gap-6 sm:grid-cols-2">
          <ConfirmDialog />
          <BusyConfirmDialog />
        </div>
      </section>

      <section aria-labelledby="overlays-menu" className="grid gap-4">
        <h3 id="overlays-menu" className="type-heading-sm text-ink">
          Dropdown menu
        </h3>
        <p className={CAPTION}>
          Arrow keys move between items, and the focused item draws the 3px
          focus outline inside its box. A ticked item shows a tick as well as
          its colour.
        </p>
        <MenuSpecimen />
      </section>

      <section aria-labelledby="overlays-table" className="grid gap-4">
        <h3 id="overlays-table" className="type-heading-sm text-ink">
          Table
        </h3>
        <div className="grid gap-6">
          <Specimen caption="scroll (default): columns are kept and the table scrolls sideways on a phone. The Bell is the selected row; the total is a footer row">
            <VenueTable stacked={false} />
          </Specimen>
          <Specimen caption="stacked: below 768px each row is a block, each value has its column name before it, and the header row is hidden from sight but still read. From 768px it is the same table as above">
            <VenueTable stacked />
          </Specimen>
        </div>
      </section>
    </div>
  )
}
