"use client"

import * as React from "react"
import { MagnifyingGlassIcon } from "@phosphor-icons/react"

import { OptionSelect } from "@/components/nabalens/option-select"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { Department } from "@/lib/config/departments"

import { TEAM_OPTIONS } from "../community/search"
import { PEOPLE_COPY } from "./people"

export function PeopleSearch({
  venues,
  venueId,
  department,
  query,
}: {
  venues: { id: string; name: string }[]
  venueId: string | null
  department: Department | null
  query: string
}) {
  const [venue, setVenue] = React.useState(venueId)
  const [team, setTeam] = React.useState<string | null>(department)
  return (
    <form
      action="/staff/people"
      method="get"
      role="search"
      aria-label="Find people"
      className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"
    >
      <Field>
        <FieldLabel htmlFor="people-name">Name</FieldLabel>
        <span className="relative block">
          <MagnifyingGlassIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-ink-muted"
          />
          <Input
            id="people-name"
            name="q"
            type="search"
            autoComplete="off"
            enterKeyHint="search"
            defaultValue={query}
            placeholder="Search by name"
            maxLength={80}
            className="h-11 pl-9 md:h-9"
          />
        </span>
      </Field>
      <div className="grid grid-cols-2 gap-3 md:contents">
        <Field>
          <FieldLabel htmlFor="people-venue">Venue</FieldLabel>
          <OptionSelect
            id="people-venue"
            options={venues}
            value={venue}
            onValueChange={setVenue}
            emptyLabel="All venues"
          />
          {venue ? <input type="hidden" name="venue" value={venue} /> : null}
        </Field>
        <Field>
          <FieldLabel htmlFor="people-team">Team</FieldLabel>
          <OptionSelect
            id="people-team"
            options={TEAM_OPTIONS}
            value={team}
            onValueChange={setTeam}
            emptyLabel="All teams"
          />
          {team ? <input type="hidden" name="department" value={team} /> : null}
        </Field>
      </div>
      <Button
        type="submit"
        variant="primary"
        size="touch"
        className="w-full md:w-auto"
      >
        <MagnifyingGlassIcon aria-hidden />
        {PEOPLE_COPY.find}
      </Button>
    </form>
  )
}
