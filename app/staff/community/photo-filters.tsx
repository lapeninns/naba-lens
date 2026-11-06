"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { FunnelSimpleIcon } from "@phosphor-icons/react"

import { Segmented } from "@/app/_media/segmented"
import { OptionSelect } from "@/components/nabalens/option-select"
import { CountBadge } from "@/components/nabalens/status-chip"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"

import { TEAM_OPTIONS, type PhotoFilters as Filters } from "./search"

/** The `type` values communityFilters reads; "" is no media filter. */
type Media = "image" | "video" | ""

const MEDIA: { value: Media; label: string }[] = [
  { value: "image", label: "Photos" },
  { value: "video", label: "Videos" },
  { value: "", label: "Photos and videos" },
]

const PHOTOS = "/staff/community"

/**
 * The Filters button and its sheet. Applying navigates to a GET URL with only
 * the filters that are on, so every filtered view keeps its own address.
 */
export function PhotoFilters({
  venues,
  filters,
  activeCount,
}: {
  venues: { id: string; name: string }[]
  filters: Filters
  activeCount: number
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [venue, setVenue] = React.useState(filters.venueId)
  const [team, setTeam] = React.useState<string | null>(filters.department)
  const [media, setMedia] = React.useState<Media>(filters.mediaType ?? "")

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const query = new URLSearchParams()
    for (const [key, value] of new FormData(event.currentTarget)) {
      if (typeof value === "string" && value) query.set(key, value)
    }
    const search = query.toString()
    setOpen(false)
    router.push(search ? `${PHOTOS}?${search}` : PHOTOS)
  }

  return (
    <>
      <Button
        variant="secondary"
        size="touch"
        onClick={() => {
          setVenue(filters.venueId)
          setTeam(filters.department)
          setMedia(filters.mediaType ?? "")
          setOpen(true)
        }}
      >
        <FunnelSimpleIcon aria-hidden />
        Filters
        <CountBadge count={activeCount} label="active" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form
            action={PHOTOS}
            method="get"
            onSubmit={onSubmit}
            aria-labelledby="photo-filters-title"
            className="grid gap-4"
          >
            <DialogHeader>
              <DialogTitle id="photo-filters-title">Filters</DialogTitle>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor="photos-venue">Venue</FieldLabel>
              <OptionSelect
                id="photos-venue"
                options={venues}
                value={venue}
                onValueChange={setVenue}
                emptyLabel="All venues"
                aria-describedby="photos-venue-hint"
              />
              <FieldDescription id="photos-venue-hint">
                Where the photo was taken.
              </FieldDescription>
              {venue ? (
                <input type="hidden" name="venue" value={venue} />
              ) : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="photos-team">Team</FieldLabel>
              <OptionSelect
                id="photos-team"
                options={TEAM_OPTIONS}
                value={team}
                onValueChange={setTeam}
                emptyLabel="All teams"
              />
              {team ? (
                <input type="hidden" name="department" value={team} />
              ) : null}
            </Field>
            <FieldSet className="gap-2">
              <FieldLegend
                id="photos-media"
                variant="label"
                className="mb-0 text-label-touch text-ink md:text-label"
              >
                Media
              </FieldLegend>
              <Segmented
                aria-labelledby="photos-media"
                name="type"
                options={MEDIA}
                value={media}
                onValueChange={setMedia}
              />
            </FieldSet>
            <DialogFooter>
              <Link
                href={PHOTOS}
                onClick={() => setOpen(false)}
                className={buttonVariants({
                  variant: "secondary",
                  size: "touch",
                })}
              >
                Clear filters
              </Link>
              <Button type="submit" variant="primary" size="touch">
                Apply filters
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
