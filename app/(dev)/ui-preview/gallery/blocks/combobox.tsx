"use client"

import * as React from "react"
import { WarningIcon } from "@phosphor-icons/react"

import {
  Combobox,
  type ComboboxOption,
  type ComboboxOptionGroup,
} from "@/components/ui/combobox"
import { FormField } from "@/components/ui/field"

/*
 * Gallery block for Combobox (common-room.md §4): every size and state, with fake
 * data only. Hover cannot be forced, so it is not shown; focus and the open
 * list are described in notes, because an open list would cover the page.
 */
const STARTERS: ComboboxOption[] = [
  { value: "soup", label: "Soup of the day", description: "Starters" },
  { value: "prawns", label: "Prawn cocktail", description: "Starters" },
  { value: "pate", label: "Chicken liver pâté", description: "Starters" },
]
const MAINS: ComboboxOption[] = [
  {
    value: "pie",
    label: "Steak and ale pie",
    description: "Mains",
    keywords: ["beef"],
  },
  { value: "fish", label: "Fish and chips", description: "Mains" },
  {
    value: "special",
    label: "Fish special",
    description: "Mains. Not on today",
    disabled: true,
  },
  {
    value: "roast",
    label:
      "Slow-roast shoulder of lamb with rosemary potatoes, seasonal greens, mint sauce and a jug of gravy for the table",
    description: "Mains. A long name, to show how an option wraps",
  },
]
const PUDDINGS: ComboboxOption[] = [
  { value: "brulee", label: "Crème brûlée", description: "Puddings" },
  { value: "crumble", label: "Apple crumble", description: "Puddings" },
]

const DISHES: ComboboxOption[] = [...STARTERS, ...MAINS, ...PUDDINGS]
const PLAIN: ComboboxOption[] = DISHES.map(({ value, label, disabled }) => ({
  value,
  label,
  disabled,
}))
const GROUPS: ComboboxOptionGroup[] = [
  { label: "Starters", items: STARTERS },
  { label: "Mains", items: MAINS },
  { label: "Puddings", items: PUDDINGS },
]

const SIZES = [
  { size: "sm", height: "44px" },
  { size: "md", height: "56px, the default" },
  { size: "lg", height: "60px" },
] as const

function Specimen({
  caption,
  children,
}: {
  caption: string
  children: React.ReactNode
}) {
  return (
    <figure className="grid w-full max-w-sm min-w-0 gap-1.5">
      {children}
      <figcaption className="text-meta text-ink-muted">{caption}</figcaption>
    </figure>
  )
}

function Group({
  id,
  title,
  note,
  children,
}: {
  id: string
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <section
      aria-labelledby={id}
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3"
    >
      <h3 id={id} className="type-heading-sm text-ink">
        {title}
      </h3>
      {note ? <p className="text-body text-ink-muted">{note}</p> : null}
      {children}
    </section>
  )
}

function Label({ htmlFor, children }: { htmlFor: string; children: string }) {
  return (
    <label htmlFor={htmlFor} className="text-label text-ink">
      {children}
    </label>
  )
}

const ROW = "flex flex-wrap items-start gap-x-6 gap-y-5"

// A stand-in for a server search: the list arrives a moment after typing.
function AsyncSpecimen() {
  const [text, setText] = React.useState("")
  const [value, setValue] = React.useState<ComboboxOption | null>(null)
  const [results, setResults] = React.useState<ComboboxOption[]>([])
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    const query = text.trim().toLowerCase()
    const timer = window.setTimeout(
      () => {
        setResults(
          query === ""
            ? []
            : PLAIN.filter((dish) => dish.label.toLowerCase().includes(query))
        )
        setLoading(false)
      },
      query === "" ? 0 : 900
    )
    return () => window.clearTimeout(timer)
  }, [text])

  return (
    <Specimen caption="async: the caller owns the text and the list (filter off), loading while it waits">
      <Label htmlFor="gallery-combobox-async">Menu item</Label>
      <Combobox
        id="gallery-combobox-async"
        items={results}
        filter={null}
        value={value}
        onValueChange={setValue}
        inputValue={text}
        onInputValueChange={(next) => {
          setText(next)
          setLoading(next.trim() !== "")
        }}
        loading={loading}
        loadingMessage="Searching the menu"
        emptyMessage={
          text.trim() === ""
            ? "Type to search the menu."
            : "No menu items match."
        }
        placeholder="Search the menu"
        clearable
        clearLabel="Clear menu item"
      />
    </Specimen>
  )
}

export function ComboboxBlock() {
  const [picked, setPicked] = React.useState<ComboboxOption | null>(MAINS[0])

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-10">
      <Group
        id="gallery-combobox-sizes"
        title="Combobox: sizes"
        note="A field you type in to narrow a long list, then pick one option. It has the same look as a text field, with a caret button that opens the list."
      >
        <div className={ROW}>
          {SIZES.map(({ size, height }) => (
            <Specimen key={size} caption={`${size} (${height})`}>
              <Label htmlFor={`gallery-combobox-${size}`}>Menu item</Label>
              <Combobox
                id={`gallery-combobox-${size}`}
                items={PLAIN}
                size={size}
                placeholder="Any menu item"
              />
            </Specimen>
          ))}
        </div>
      </Group>

      <Group
        id="gallery-combobox-list"
        title="Combobox: the list"
        note="Open a field to see the list. Arrow keys move a 3px inset outline from option to option, Enter chooses, Escape closes. The chosen option has a tick and bold text. Typing matches every word, without accents or capitals: try “creme” or “beef”."
      >
        <div className={ROW}>
          <Specimen caption="flat list, nothing chosen">
            <Label htmlFor="gallery-combobox-flat">Menu item</Label>
            <Combobox
              id="gallery-combobox-flat"
              items={PLAIN}
              placeholder="Any menu item"
            />
          </Specimen>
          <Specimen caption="chosen (controlled), clearable: the cross removes the choice">
            <Label htmlFor="gallery-combobox-chosen">Menu item</Label>
            <Combobox
              id="gallery-combobox-chosen"
              items={PLAIN}
              value={picked}
              onValueChange={setPicked}
              clearable
              clearLabel="Clear menu item"
              placeholder="Any menu item"
            />
            <p className="text-meta text-ink-muted">
              Chosen: {picked ? picked.label : "nothing"}
            </p>
          </Specimen>
          <Specimen caption="groups with labels, a second line, one option switched off, one long name that wraps">
            <Label htmlFor="gallery-combobox-groups">Menu item</Label>
            <Combobox
              id="gallery-combobox-groups"
              items={GROUPS}
              placeholder="Any menu item"
            />
          </Specimen>
          <Specimen caption="options drawn by the caller (children)">
            <Label htmlFor="gallery-combobox-custom">Menu item</Label>
            <Combobox
              id="gallery-combobox-custom"
              items={DISHES}
              placeholder="Any menu item"
            >
              {(dish) => (
                <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span>{dish.label}</span>
                  <span className="text-meta font-normal text-ink-muted">
                    {dish.description}
                  </span>
                </span>
              )}
            </Combobox>
          </Specimen>
          <Specimen caption="limit: only the first three matches are listed">
            <Label htmlFor="gallery-combobox-limit">Menu item</Label>
            <Combobox
              id="gallery-combobox-limit"
              items={PLAIN}
              limit={3}
              placeholder="Any menu item"
            />
          </Specimen>
        </div>
      </Group>

      <Group
        id="gallery-combobox-states"
        title="Combobox: states"
        note="Focus: press Tab to see the 3px focus outline, 2px clear of the field. The caret and the cross are for the pointer; the keyboard clears with Backspace."
      >
        <div className={ROW}>
          <Specimen caption="invalid (2px warn edge), error below with an icon and words">
            <Label htmlFor="gallery-combobox-invalid">Menu item</Label>
            <Combobox
              id="gallery-combobox-invalid"
              items={PLAIN}
              invalid
              aria-describedby="gallery-combobox-invalid-error"
              placeholder="Any menu item"
            />
            <p
              id="gallery-combobox-invalid-error"
              className="flex items-start gap-1.5 text-label text-warn-fg"
            >
              <WarningIcon aria-hidden className="mt-0.5 size-5 shrink-0" />
              Error: choose a menu item.
            </p>
          </Specimen>
          <Specimen caption="in a FormField: the label, the hint, the error and aria-invalid are wired for you">
            <FormField
              label="Menu item"
              description="The dish this photo shows."
              error="Choose a menu item."
              announce="polite"
            >
              <Combobox items={PLAIN} placeholder="Any menu item" />
            </FormField>
          </Specimen>
          <Specimen caption="in a FormField, optional and valid">
            <FormField label="Menu item" optional>
              <Combobox items={PLAIN} placeholder="Any menu item" clearable />
            </FormField>
          </Specimen>
          <Specimen caption="disabled, nothing chosen: the reason is under it">
            <Label htmlFor="gallery-combobox-disabled">Menu item</Label>
            <Combobox
              id="gallery-combobox-disabled"
              items={PLAIN}
              disabled
              aria-describedby="gallery-combobox-disabled-why"
              placeholder="Any menu item"
            />
            <p
              id="gallery-combobox-disabled-why"
              className="text-meta text-ink-muted"
            >
              Choose a venue first.
            </p>
          </Specimen>
          <Specimen caption="disabled, with a choice: the label is kept">
            <Label htmlFor="gallery-combobox-disabled-chosen">Menu item</Label>
            <Combobox
              id="gallery-combobox-disabled-chosen"
              items={PLAIN}
              defaultValue={PLAIN[4]}
              disabled
              clearable
            />
          </Specimen>
          <Specimen caption="loading: open it to see the spinner and the words">
            <Label htmlFor="gallery-combobox-loading">Menu item</Label>
            <Combobox
              id="gallery-combobox-loading"
              items={[]}
              filter={null}
              loading
              loadingMessage="Loading menu items"
              placeholder="Any menu item"
            />
          </Specimen>
          <Specimen caption="empty: type “zzz” to see the message">
            <Label htmlFor="gallery-combobox-empty">Menu item</Label>
            <Combobox
              id="gallery-combobox-empty"
              items={PLAIN}
              emptyMessage="No menu items match."
              placeholder="Any menu item"
            />
          </Specimen>
          <Specimen caption="long choice: the field shows one line and scrolls with the cursor">
            <Label htmlFor="gallery-combobox-long">Menu item</Label>
            <Combobox
              id="gallery-combobox-long"
              items={PLAIN}
              defaultValue={PLAIN[6]}
              clearable
              clearLabel="Clear menu item"
            />
          </Specimen>
          <AsyncSpecimen />
        </div>
      </Group>

      <Group
        id="gallery-combobox-form"
        title="Combobox: in a form"
        note="With a name, the chosen option’s value is submitted (here “brulee”), not its label."
      >
        <form
          className={ROW}
          onSubmit={(event) => event.preventDefault()}
          aria-label="Combobox form example"
        >
          <Specimen caption="name=“dish”, required">
            <Label htmlFor="gallery-combobox-form-field">Menu item</Label>
            <Combobox
              id="gallery-combobox-form-field"
              items={PLAIN}
              name="dish"
              required
              defaultValue={PLAIN[7]}
            />
          </Specimen>
        </form>
      </Group>

      <Group
        id="gallery-combobox-phone"
        title="Combobox: phone layout"
        note="The same at every width. The field fills its container and the list is as wide as the field, opens under it (or above, where there is more room) and scrolls inside itself."
      >
        <div className="w-full max-w-80">
          <Specimen caption="in a 320px column">
            <Label htmlFor="gallery-combobox-phone-field">Menu item</Label>
            <Combobox
              id="gallery-combobox-phone-field"
              items={GROUPS}
              clearable
              clearLabel="Clear menu item"
              defaultValue={MAINS[3]}
            />
          </Specimen>
        </div>
      </Group>
    </div>
  )
}
