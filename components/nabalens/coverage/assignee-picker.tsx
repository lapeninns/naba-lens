"use client"

import * as React from "react"

import { ProfileAvatar } from "@/components/nabalens/profile-avatar"
import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field"
import { DEPARTMENT_OPTIONS, type Department } from "@/lib/config/departments"

import { CoverageNotice } from "./coverage-notice"
import { COVERAGE_LIMITS, TEAM_SUGGESTION_COPY, plural } from "./copy"
import type { CoverageResult, CoveragePerson, RequirementView } from "./types"
import { useCoverageAction } from "./use-coverage-action"

export type SetAssigneesHandler = (
  assigneeIds: string[]
) => Promise<CoverageResult<object>>

/**
 * The team that usually photographs this kind of item. Display only: it
 * pre-sorts the list and never limits who can be assigned.
 */
export function suggestedTeam(requirement: RequirementView): Department | null {
  if (requirement.kind === "menu_section") {
    const kind = requirement.menuSection?.sectionKind
    if (kind === "drinks") return "foh"
    if (kind === "food") return "boh"
    return null
  }
  return "foh"
}

const NO_TEAM = "none"

/** Choose who works on a checklist item; several people share its target. */
export function AssigneePicker({
  requirement,
  roster,
  onSave,
  onStale,
}: {
  requirement: RequirementView
  /** Active staff currently at the venue. */
  roster: CoveragePerson[]
  onSave: SetAssigneesHandler
  onStale?: () => void
}) {
  const ids = React.useId()
  const action = useCoverageAction(onStale)
  // Reset the choice only when the saved set changes, not on every refresh:
  // a re-render after another action must not clear an unsaved selection.
  const savedKey = [...requirement.assigneeIds].sort().join(",")
  const [seed, setSeed] = React.useState(savedKey)
  const [selected, setSelected] = React.useState<string[]>(
    requirement.assigneeIds
  )
  if (seed !== savedKey) {
    setSeed(savedKey)
    setSelected(requirement.assigneeIds)
  }
  const [error, setError] = React.useState<string | null>(null)
  const suggestion = suggestedTeam(requirement)

  const groups = React.useMemo(() => {
    const teams: { id: Department | typeof NO_TEAM; name: string }[] = [
      ...DEPARTMENT_OPTIONS,
      { id: NO_TEAM, name: "No team set" },
    ]
    teams.sort((a, b) =>
      a.id === suggestion ? -1 : b.id === suggestion ? 1 : 0
    )
    return teams
      .map((team) => ({
        ...team,
        people: roster.filter((p) => (p.department ?? NO_TEAM) === team.id),
      }))
      .filter((team) => team.people.length > 0)
  }, [roster, suggestion])

  const initial = new Set(requirement.assigneeIds)
  const dirty =
    selected.length !== initial.size || selected.some((id) => !initial.has(id))

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    )
  }

  function addTeam(people: CoveragePerson[]) {
    setSelected((current) => [
      ...current,
      ...people.map((p) => p.id).filter((id) => !current.includes(id)),
    ])
  }

  async function save() {
    if (selected.length > COVERAGE_LIMITS.assigneesMax) {
      setError(`Choose up to ${COVERAGE_LIMITS.assigneesMax} people.`)
      return
    }
    setError(null)
    await action.run(
      () => onSave(selected),
      selected.length === 0
        ? "Saved. No one is assigned."
        : `Saved. ${plural(selected.length, "person", "people")} assigned.`
    )
  }

  return (
    <section aria-labelledby={`${ids}-title`} className="grid gap-3">
      <h2 id={`${ids}-title`} className="text-lg font-medium">
        Assigned to
      </h2>
      <p className="text-sm text-muted-foreground">
        Everyone assigned shares the target of{" "}
        {plural(requirement.photoTarget, "photo")}. Only assigned people can
        submit photos to it; you can also attach existing photos below.{" "}
        {TEAM_SUGGESTION_COPY}
      </p>
      <CoverageNotice notice={action.notice} onDismiss={action.dismiss} />
      {requirement.needsReassignment ? (
        <p className="text-sm text-warning">
          Someone assigned here left or moved venue before it was complete.
          Choose who takes it over.
        </p>
      ) : null}
      {roster.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No active staff at this venue.
        </p>
      ) : (
        <div className="grid gap-4">
          {groups.map((group) => (
            <fieldset
              key={group.id}
              className="grid gap-1"
              disabled={action.pending}
            >
              <legend className="mb-1 flex w-full flex-wrap items-center justify-between gap-2 text-sm font-medium">
                <span>
                  {group.name}
                  {group.id === suggestion ? (
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      · suggested
                    </span>
                  ) : null}
                </span>
                {group.id !== NO_TEAM ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-11 sm:h-7"
                    onClick={() => addTeam(group.people)}
                  >
                    Select all {group.people.length}
                  </Button>
                ) : null}
              </legend>
              <ul className="grid gap-1 sm:grid-cols-2">
                {group.people.map((person) => (
                  <li key={person.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 py-1 hover:bg-muted/50">
                      <input
                        type="checkbox"
                        checked={selected.includes(person.id)}
                        onChange={() => toggle(person.id)}
                        className="size-4 accent-primary"
                      />
                      <ProfileAvatar
                        name={person.displayName}
                        src={person.avatarUrl}
                        className="size-8"
                      />
                      <span className="grid min-w-0">
                        <span className="text-sm font-medium break-words">
                          {person.displayName}
                        </span>
                        {person.jobTitle ? (
                          <span className="text-xs text-muted-foreground">
                            {person.jobTitle}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          ))}
        </div>
      )}
      {error ? <FieldError>{error}</FieldError> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="touch"
          onClick={() => void save()}
          disabled={!dirty || action.pending}
          aria-busy={action.pending || undefined}
        >
          {action.pending ? "Saving…" : "Save assignees"}
        </Button>
        <span className="text-sm text-muted-foreground">
          {plural(selected.length, "person", "people")} selected
        </span>
      </div>
    </section>
  )
}
