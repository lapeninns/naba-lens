"use client"

import * as React from "react"

import { OptionSelect } from "@/components/nabalens/option-select"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { DEPARTMENT_OPTIONS } from "@/lib/config/departments"

export function CommunityFilters({
  action,
  venues,
  venueId,
  mediaType,
  query,
  department,
}: {
  action: "/staff/community" | "/staff/people"
  venues: { id: string; name: string }[]
  venueId: string | null
  mediaType?: "image" | "video" | null
  query?: string
  department?: "foh" | "boh" | null
}) {
  const [venue, setVenue] = React.useState(venueId)
  const [type, setType] = React.useState<string | null>(mediaType ?? null)
  const [team, setTeam] = React.useState<string | null>(department ?? null)
  const people = action === "/staff/people"
  return (
    <form
      action={action}
      method="get"
      aria-label={people ? "Find colleagues" : "Filter uploads"}
    >
      <FieldGroup className="flex flex-col gap-3 sm:flex-row sm:items-end">
        {people ? (
          <Field className="sm:flex-1">
            <FieldLabel htmlFor="community-search">Name</FieldLabel>
            <Input
              id="community-search"
              name="q"
              type="search"
              defaultValue={query}
              placeholder="Search colleagues"
              maxLength={80}
              className="h-11 sm:h-9"
            />
          </Field>
        ) : null}
        <Field className="sm:max-w-sm sm:flex-1">
          <FieldLabel htmlFor="community-venue">Venue</FieldLabel>
          <OptionSelect
            id="community-venue"
            options={venues}
            value={venue}
            onValueChange={setVenue}
            emptyLabel="All venues"
          />
          <input type="hidden" name="venue" value={venue ?? ""} />
        </Field>
        <Field className="sm:max-w-52 sm:flex-1">
          <FieldLabel htmlFor="community-department">Team</FieldLabel>
          <OptionSelect
            id="community-department"
            options={DEPARTMENT_OPTIONS}
            value={team}
            onValueChange={setTeam}
            emptyLabel="All teams"
          />
          <input type="hidden" name="department" value={team ?? ""} />
        </Field>
        {!people ? (
          <Field className="sm:max-w-52 sm:flex-1">
            <FieldLabel htmlFor="community-type">Media</FieldLabel>
            <OptionSelect
              id="community-type"
              options={[
                { id: "image", name: "Photos" },
                { id: "video", name: "Videos" },
              ]}
              value={type}
              onValueChange={setType}
              emptyLabel="Photos and videos"
            />
            <input type="hidden" name="type" value={type ?? ""} />
          </Field>
        ) : null}
        <Button type="submit" size="touch" variant="secondary">
          {people ? "Find people" : "Apply filters"}
        </Button>
      </FieldGroup>
    </form>
  )
}
