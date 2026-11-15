import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
  FormField,
  type FormFieldControlProps,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { SearchField } from "@/components/ui/search-field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

/*
 * Gallery block for the field family (DESIGN.md §4 Field): Input, Textarea,
 * Select, SearchField and the FormField that labels them, in every size and
 * state, with fake data only. Hover cannot be forced, so it is not shown;
 * focus is described in a note.
 */
const SECTIONS = [
  { value: "starters", label: "Starters" },
  { value: "mains", label: "Mains" },
  { value: "soft", label: "Soft drinks" },
  { value: "wine", label: "Wine" },
]

const VENUES = [
  { value: "crown", label: "The Crown" },
  { value: "anchor", label: "The Anchor" },
  {
    value: "long",
    label: "The Fox and Hounds at Little Wittering on the Water, upstairs bar",
  },
]

function Specimen({
  caption,
  children,
}: {
  caption: string
  children: React.ReactNode
}) {
  return (
    <figure className="grid min-w-0 content-start gap-1.5">
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

// Fields fill their column, as they do on a phone; two columns from md.
const GRID = "grid items-start gap-x-6 gap-y-6 md:grid-cols-2"

function VenueSelect({
  control,
  size,
  defaultValue = null,
  disabled,
}: {
  control: FormFieldControlProps
  size?: "sm" | "md" | "lg"
  defaultValue?: string | null
  disabled?: boolean
}) {
  return (
    <Select items={VENUES} defaultValue={defaultValue} disabled={disabled}>
      <SelectTrigger
        id={control.id}
        size={size}
        aria-describedby={control["aria-describedby"]}
        aria-invalid={control["aria-invalid"]}
      >
        <SelectValue placeholder="Choose…" />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {VENUES.map((venue) => (
          <SelectItem key={venue.value} value={venue.value}>
            {venue.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function FieldsBlock() {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-10">
      <Group
        id="gallery-fields-input"
        title="Input: sizes and states"
        note="Every field sits in a FormField, which links the label, the hint and the error. Focus: press Tab to see the 3px focus outline, 2px clear of the field. Fields are required unless the label says optional."
      >
        <div className={GRID}>
          <Specimen caption="md (56px, the default), empty with a placeholder">
            <FormField label="Full name">
              <Input name="gallery-name" placeholder="As on your rota" />
            </FormField>
          </Specimen>
          <Specimen caption="sm (44px), for rows and tables">
            <FormField label="Full name">
              <Input size="sm" name="gallery-name-sm" defaultValue="Asha Rai" />
            </FormField>
          </Specimen>
          <Specimen caption="lg (60px), beside an lg button">
            <FormField label="Full name">
              <Input size="lg" name="gallery-name-lg" defaultValue="Asha Rai" />
            </FormField>
          </Specimen>
          <Specimen caption="md, filled, with a hint">
            <FormField
              label="Work email"
              description="We send your sign-in link here."
            >
              <Input
                type="email"
                name="gallery-email"
                defaultValue="asha@example.test"
              />
            </FormField>
          </Specimen>
          <Specimen caption="md, optional (the label says so)">
            <FormField label="Phone number" optional>
              <Input type="tel" name="gallery-phone" />
            </FormField>
          </Specimen>
          <Specimen caption="md, invalid: 2px warn edge, error with an icon and words">
            <FormField
              label="Work email"
              description="We send your sign-in link here."
              error="Enter an email address, like name@example.com."
              announce="polite"
            >
              <Input
                type="email"
                name="gallery-email-bad"
                defaultValue="asha@"
              />
            </FormField>
          </Specimen>
          <Specimen caption="md, hidden label (screen readers still hear it)">
            <FormField label="Dish name" hideLabel>
              <Input name="gallery-dish" placeholder="Dish name" />
            </FormField>
          </Specimen>
          <Specimen caption="md, disabled (leaves the focus order)">
            <FormField label="Venue code">
              <Input name="gallery-code" defaultValue="CROWN-01" disabled />
            </FormField>
          </Specimen>
          <Specimen caption="md, aria-disabled (keeps focus, read-only), reason below">
            <FormField
              label="Venue code"
              description="Only an admin can change the venue code."
            >
              <Input
                name="gallery-code-held"
                defaultValue="CROWN-01"
                aria-disabled="true"
              />
            </FormField>
          </Specimen>
          <Specimen caption="md, long label and long hint that wrap">
            <FormField
              label="What should the team photograph for this section of the menu this week"
              description="Say what the photo must show, such as the whole plate from above with the garnish in place and nothing else on the table."
            >
              <Input name="gallery-long" />
            </FormField>
          </Specimen>
          <Specimen caption="md, file input">
            <FormField label="Profile photo" optional>
              <Input type="file" name="gallery-file" />
            </FormField>
          </Specimen>
        </div>
      </Group>

      <Group
        id="gallery-fields-textarea"
        title="Textarea: states"
        note="At least three rows and 120px tall. It can be dragged taller, never wider."
      >
        <div className={GRID}>
          <Specimen caption="default, empty">
            <FormField label="Reason" description="The team member sees this.">
              <Textarea name="gallery-reason" />
            </FormField>
          </Specimen>
          <Specimen caption="filled with text that wraps">
            <FormField label="Reason">
              <Textarea
                name="gallery-reason-filled"
                defaultValue="The plate is cut off on the left and the light is too low to see the garnish. Please take it again by the window."
              />
            </FormField>
          </Specimen>
          <Specimen caption="invalid, error below">
            <FormField
              label="Reason"
              error="Give a reason so the team member knows what to change."
              announce="polite"
            >
              <Textarea name="gallery-reason-bad" />
            </FormField>
          </Specimen>
          <Specimen caption="disabled">
            <FormField label="Reason">
              <Textarea
                name="gallery-reason-off"
                defaultValue="Sent on Monday."
                disabled
              />
            </FormField>
          </Specimen>
          <Specimen caption="aria-disabled (keeps focus, read-only), reason below">
            <FormField
              label="Reason"
              description="This photo was accepted, so the reason can no longer change."
            >
              <Textarea
                name="gallery-reason-held"
                defaultValue="Sent on Monday."
                aria-disabled="true"
              />
            </FormField>
          </Specimen>
        </div>
      </Group>

      <Group
        id="gallery-fields-select"
        title="Select: sizes and states"
        note="The trigger is the same field as Input: same height, width and edge. Open it to see the options: the chosen one has a tint and a tick, and the arrow keys draw the focus outline inside each option."
      >
        <div className={GRID}>
          <Specimen caption="md (56px), nothing chosen">
            <FormField label="Venue">
              {(control) => <VenueSelect control={control} />}
            </FormField>
          </Specimen>
          <Specimen caption="sm (44px), a value chosen">
            <FormField label="Venue">
              {(control) => (
                <VenueSelect control={control} size="sm" defaultValue="crown" />
              )}
            </FormField>
          </Specimen>
          <Specimen caption="lg (60px), a value chosen">
            <FormField label="Venue">
              {(control) => (
                <VenueSelect
                  control={control}
                  size="lg"
                  defaultValue="anchor"
                />
              )}
            </FormField>
          </Specimen>
          <Specimen caption="md, written as an element: FormField wires the trigger through Select. Options in named groups with a separator">
            <FormField
              label="Menu section"
              description="Open it to see the group names."
            >
              <Select items={SECTIONS} defaultValue="mains">
                <SelectTrigger>
                  <SelectValue placeholder="Choose…" />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    <SelectLabel>Food</SelectLabel>
                    <SelectItem value="starters">Starters</SelectItem>
                    <SelectItem value="mains">Mains</SelectItem>
                  </SelectGroup>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>Drinks</SelectLabel>
                    <SelectItem value="soft">Soft drinks</SelectItem>
                    <SelectItem value="wine">Wine</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </FormField>
          </Specimen>
          <Specimen caption="md, as an element, invalid: the error and aria-invalid reach the trigger">
            <FormField
              label="Menu section"
              error="Choose a menu section."
              announce="polite"
            >
              <Select items={SECTIONS}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose…" />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {SECTIONS.map((section) => (
                    <SelectItem key={section.value} value={section.value}>
                      {section.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </Specimen>
          <Specimen caption="md, a long value cut to one line in the trigger; it wraps in the list">
            <FormField label="Venue">
              {(control) => (
                <VenueSelect control={control} defaultValue="long" />
              )}
            </FormField>
          </Specimen>
          <Specimen caption="md, invalid, error below">
            <FormField label="Venue" error="Choose a venue." announce="polite">
              {(control) => <VenueSelect control={control} />}
            </FormField>
          </Specimen>
          <Specimen caption="md, disabled, reason below">
            <FormField
              label="Venue"
              description="You work at one venue, so there is nothing to choose."
            >
              {(control) => (
                <VenueSelect control={control} defaultValue="anchor" disabled />
              )}
            </FormField>
          </Specimen>
        </div>
      </Group>

      <Group
        id="gallery-fields-search"
        title="SearchField"
        note="Clear search shows once there is text, and puts focus back in the field. The result count is read out politely when it changes."
      >
        <div className={GRID}>
          <Specimen caption="md, empty, visible label">
            <SearchField
              label="Search people"
              name="gallery-q"
              placeholder="Name or department"
            />
          </Specimen>
          <Specimen caption="md, with text: Clear search (44px) and a result count">
            <SearchField
              label="Search people"
              name="gallery-q-filled"
              defaultValue="Asha"
              resultCount="2 people"
            />
          </Specimen>
          <Specimen caption="sm (44px), hidden label">
            <SearchField
              label="Search dishes"
              hideLabel
              size="sm"
              name="gallery-q-sm"
              defaultValue="Soup"
              placeholder="Search dishes"
            />
          </Specimen>
          <Specimen caption="md, no results">
            <SearchField
              label="Search people"
              name="gallery-q-none"
              defaultValue="Zzz"
              resultCount="No one matches. Check the spelling or clear the search."
            />
          </Specimen>
          <Specimen caption="md, in a search form that loads a page (GET)">
            <SearchField
              label="Search photos"
              name="q"
              formProps={{ action: "/ui-preview" }}
            />
          </Specimen>
          <Specimen caption="md, disabled (no Clear search)">
            <SearchField
              label="Search people"
              name="gallery-q-off"
              defaultValue="Asha"
              disabled
            />
          </Specimen>
          <Specimen caption="lg (60px)">
            <SearchField
              label="Search photos"
              size="lg"
              name="gallery-q-lg"
              defaultValue="Roast"
            />
          </Specimen>
          <Specimen caption="md, invalid, error below">
            <div className="grid gap-1.5">
              <SearchField
                label="Search people"
                name="gallery-q-bad"
                defaultValue="A"
                aria-invalid="true"
                aria-describedby="gallery-q-bad-error"
              />
              <FieldError id="gallery-q-bad-error" announce="polite">
                Type at least two letters.
              </FieldError>
            </div>
          </Specimen>
          <Specimen caption="md, aria-disabled (keeps focus, read-only, no Clear search), reason below">
            <div className="grid gap-1.5">
              <SearchField
                label="Search people"
                name="gallery-q-held"
                defaultValue="Asha"
                aria-disabled="true"
                aria-describedby="gallery-q-held-why"
              />
              <FieldDescription id="gallery-q-held-why">
                You are offline. Reconnect to search.
              </FieldDescription>
            </div>
          </Specimen>
        </div>
      </Group>

      <Group
        id="gallery-fields-parts"
        title="Field parts"
        note="The loose parts, for layouts FormField does not cover. An error always has an icon and words."
      >
        <div className={GRID}>
          <Specimen caption="FieldLabel, optional">
            <FieldLabel optional>Notes for the kitchen</FieldLabel>
          </Specimen>
          <Specimen caption="FieldDescription">
            <FieldDescription>Up to 200 characters.</FieldDescription>
          </Specimen>
          <Specimen caption="FieldError, polite (role=status): used under a form-level notice">
            <FieldError announce="polite">Enter the dish name.</FieldError>
          </Specimen>
          <Specimen caption="FieldError, several messages">
            <FieldError
              announce="polite"
              errors={[
                { message: "Enter the dish name." },
                { message: "Choose a menu section." },
              ]}
            />
          </Specimen>
        </div>
      </Group>

      <Group
        id="gallery-fields-set"
        title="FieldSet, FieldGroup and Field"
        note="For a set of fields under one question. The legend names the set; a Field with FieldContent puts a title and its hint beside a control."
      >
        <div className={GRID}>
          <Specimen caption="FieldSet with a legend, a hint, a FieldGroup and separators (plain, and with a word)">
            <FieldSet>
              <FieldLegend>Contact details</FieldLegend>
              <FieldDescription>How the venue reaches you.</FieldDescription>
              <FieldGroup>
                <Field role={undefined}>
                  <FieldLabel htmlFor="gallery-set-email">
                    Work email
                  </FieldLabel>
                  <Input
                    id="gallery-set-email"
                    type="email"
                    name="gallery-set-email"
                  />
                </Field>
                <FieldSeparator>or</FieldSeparator>
                <Field role={undefined}>
                  <FieldLabel htmlFor="gallery-set-phone">
                    Phone number
                  </FieldLabel>
                  <Input
                    id="gallery-set-phone"
                    type="tel"
                    name="gallery-set-phone"
                  />
                </Field>
                <FieldSeparator />
                <Field
                  orientation="horizontal"
                  aria-labelledby="gallery-set-texts"
                >
                  <FieldContent>
                    <FieldTitle id="gallery-set-texts">
                      Text me when a photo is accepted
                    </FieldTitle>
                    <FieldDescription id="gallery-set-texts-hint">
                      One message a day at most.
                    </FieldDescription>
                  </FieldContent>
                  <Switch
                    aria-labelledby="gallery-set-texts"
                    aria-describedby="gallery-set-texts-hint"
                  />
                </Field>
              </FieldGroup>
            </FieldSet>
          </Specimen>
          <Specimen caption="FieldLegend, label variant (17px, for a small set), and a responsive Field">
            <FieldSet>
              <FieldLegend variant="label">Shift</FieldLegend>
              <FieldGroup>
                <Field orientation="responsive" role={undefined}>
                  <FieldLabel htmlFor="gallery-set-start">Starts at</FieldLabel>
                  <Input
                    id="gallery-set-start"
                    size="sm"
                    name="gallery-set-start"
                    defaultValue="17:00"
                  />
                </Field>
              </FieldGroup>
            </FieldSet>
          </Specimen>
        </div>
      </Group>

      <Group
        id="gallery-fields-phone"
        title="Phone layout (320px)"
        note="Fields fill the width. Labels, hints and errors wrap; nothing scrolls sideways."
      >
        <div className="grid w-full max-w-80 gap-5">
          <Specimen caption="Input at 320px, invalid">
            <FormField
              label="What should the team photograph this week"
              error="Say what the photo must show, such as the whole plate from above."
              announce="polite"
            >
              <Input name="gallery-phone-input" />
            </FormField>
          </Specimen>
          <Specimen caption="Select at 320px, long value">
            <FormField label="Venue">
              {(control) => (
                <VenueSelect control={control} defaultValue="long" />
              )}
            </FormField>
          </Specimen>
          <Specimen caption="SearchField at 320px">
            <SearchField
              label="Search people"
              name="gallery-phone-q"
              defaultValue="Asha Rai from the kitchen team"
              resultCount="1 person"
            />
          </Specimen>
        </div>
      </Group>
    </div>
  )
}
