import { Checkbox } from "@/components/ui/checkbox"
import { OptionRow } from "@/components/ui/option-row"
import { Radio, RadioGroup } from "@/components/ui/radio-group"
import { SelectableTile } from "@/components/ui/selectable-tile"

/*
 * Gallery block for the choice controls (DESIGN.md §4): Checkbox, RadioGroup,
 * OptionRow and SelectableTile in every size and state, with fake data only.
 * Hover cannot be forced, so it is not shown; focus is described in a note.
 */
function Specimen({
  caption,
  children,
  className,
}: {
  caption: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <figure className={className ?? "grid min-w-0 justify-items-start gap-1.5"}>
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

const ROW = "flex flex-wrap items-start gap-x-8 gap-y-5"
const STACK = "grid min-w-0 gap-1.5"
const INLINE =
  "flex min-h-11 cursor-pointer items-center gap-3 text-body text-ink"
const TILES = "grid max-w-reading grid-cols-2 gap-2.5 sm:grid-cols-3"

// A stand-in for a photo: a hatched 4:3 box, so no image file is needed.
function Photo({ name }: { name: string }) {
  return (
    <div className="flex aspect-4/3 items-end bg-hatch bg-surface-2 p-2">
      <span className="rounded-square bg-plate px-1.5 text-meta text-on-stage">
        {name}
      </span>
    </div>
  )
}

export function ChoiceBlock() {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-10">
      <Group
        id="gallery-choice-checkbox"
        title="Checkbox"
        note="A 24px box in a 44px target. It has one size. Focus draws the 3px focus ring 2px outside the box; Space ticks and unticks it."
      >
        <div className={ROW}>
          <Specimen caption="Empty">
            <label className={INLINE}>
              <Checkbox name="gallery-diet" value="vegan" />
              Vegan
            </label>
          </Specimen>
          <Specimen caption="Ticked">
            <label className={INLINE}>
              <Checkbox defaultChecked />
              Vegetarian
            </label>
          </Specimen>
          <Specimen caption="Indeterminate: some, not all">
            <label className={INLINE}>
              <Checkbox indeterminate />
              All dishes
            </label>
          </Specimen>
          <Specimen caption="Invalid, with its error">
            <div className={STACK}>
              <label className={INLINE}>
                <Checkbox
                  aria-invalid
                  aria-describedby="gallery-choice-terms"
                />
                I have checked the allergens
              </label>
              <p
                id="gallery-choice-terms"
                className="text-meta font-bold text-warn-fg"
              >
                Tick this before you send the menu.
              </p>
            </div>
          </Specimen>
        </div>
        <div className={ROW}>
          <Specimen caption="Disabled, empty">
            <label className={`${INLINE} cursor-not-allowed text-ink-muted`}>
              <Checkbox disabled />
              Halal
            </label>
          </Specimen>
          <Specimen caption="Disabled, ticked">
            <label className={`${INLINE} cursor-not-allowed text-ink-muted`}>
              <Checkbox disabled defaultChecked />
              Gluten free
            </label>
          </Specimen>
          <Specimen caption="aria-disabled: still focusable, with its reason">
            <div className={STACK}>
              <label className={`${INLINE} cursor-not-allowed text-ink-muted`}>
                <Checkbox
                  aria-disabled
                  defaultChecked
                  aria-describedby="gallery-choice-import"
                />
                Contains nuts
              </label>
              <p id="gallery-choice-import" className="text-meta text-ink">
                Set by the menu import. Change it in the menu file.
              </p>
            </div>
          </Specimen>
          <Specimen caption="Long label that wraps">
            <label className={`${INLINE} max-w-64 items-start`}>
              <Checkbox className="mt-0.5" />
              <span className="min-w-0">
                Tell me by email when a manager sends one of my photos back
              </span>
            </label>
          </Specimen>
        </div>
      </Group>

      <Group
        id="gallery-choice-radio"
        title="RadioGroup and Radio"
        note="One tab stop for the group; the arrow keys move the choice. Focus draws the same ring round the circle."
      >
        <div className={ROW}>
          <Specimen caption="Vertical (the default), second chosen">
            <RadioGroup
              aria-label="Portion size"
              name="gallery-portion"
              defaultValue="regular"
            >
              {["Small", "Regular", "Large"].map((size) => (
                <label key={size} className={INLINE}>
                  <Radio value={size.toLowerCase()} />
                  {size}
                </label>
              ))}
            </RadioGroup>
          </Specimen>
          <Specimen caption="Horizontal: wraps on a phone">
            <RadioGroup
              aria-label="Served"
              orientation="horizontal"
              defaultValue="hot"
            >
              {["Hot", "Cold", "Either"].map((served) => (
                <label key={served} className={INLINE}>
                  <Radio value={served.toLowerCase()} />
                  {served}
                </label>
              ))}
            </RadioGroup>
          </Specimen>
          <Specimen caption="Nothing chosen, invalid, with its error">
            <div className={STACK}>
              <RadioGroup
                aria-label="Spice level"
                aria-invalid
                aria-describedby="gallery-choice-spice"
              >
                {["Mild", "Medium", "Hot"].map((level) => (
                  <label key={level} className={INLINE}>
                    <Radio value={level.toLowerCase()} />
                    {level}
                  </label>
                ))}
              </RadioGroup>
              <p
                id="gallery-choice-spice"
                className="mt-1 text-meta font-bold text-warn-fg"
              >
                Choose a spice level.
              </p>
            </div>
          </Specimen>
        </div>
        <div className={ROW}>
          <Specimen caption="Disabled group, first chosen">
            <RadioGroup aria-label="Menu" disabled defaultValue="lunch">
              {["Lunch", "Dinner"].map((menu) => (
                <label
                  key={menu}
                  className={`${INLINE} cursor-not-allowed text-ink-muted`}
                >
                  <Radio value={menu.toLowerCase()} />
                  {menu}
                </label>
              ))}
            </RadioGroup>
          </Specimen>
          <Specimen caption="One radio aria-disabled: the keyboard skips it, so its reason is visible text">
            <div className={STACK}>
              <RadioGroup aria-label="Who can see it" defaultValue="team">
                <label className={INLINE}>
                  <Radio value="team" />
                  My team
                </label>
                <label
                  className={`${INLINE} cursor-not-allowed text-ink-muted`}
                >
                  <Radio
                    value="public"
                    aria-disabled
                    aria-describedby="gallery-choice-public"
                  />
                  Everyone
                </label>
              </RadioGroup>
              <p id="gallery-choice-public" className="text-meta text-ink">
                A manager has to accept the photo first.
              </p>
            </div>
          </Specimen>
        </div>
      </Group>

      <Group
        id="gallery-choice-row-radio"
        title="OptionRow: radio rows"
        note="The whole row is the label and the target. A chosen row is accent-soft with a selected edge, and the dot still shows. Focus draws the ring round the row."
      >
        <RadioGroup
          aria-label="Where is this dish served"
          name="gallery-area"
          defaultValue="bar"
          className="max-w-reading"
        >
          <OptionRow type="radio" value="bar" label="Bar" end="12 dishes" />
          <OptionRow
            type="radio"
            value="restaurant"
            label="Restaurant"
            hint="Table service, lunch and dinner"
            end="31 dishes"
          />
          <OptionRow
            type="radio"
            value="garden"
            label="Garden"
            hint="Open from May to September"
            reason="Closed for the winter. It opens again in May."
            aria-disabled
          />
          <OptionRow
            type="radio"
            value="private"
            label="Private dining room on the first floor, booked ahead for groups of twelve or more"
            hint="A long label and a long hint both wrap inside the row and never push the page sideways on a phone"
            end="4 dishes"
          />
        </RadioGroup>
        <p className="text-meta text-ink-muted">
          Md rows (56px or taller): chosen, with a hint, aria-disabled with its
          reason, long text.
        </p>

        <div className="grid max-w-reading gap-4">
          <Specimen caption="Size sm (44px)" className={STACK}>
            <RadioGroup aria-label="Small rows" defaultValue="a">
              <OptionRow type="radio" size="sm" value="a" label="Today" />
              <OptionRow type="radio" size="sm" value="b" label="This week" />
            </RadioGroup>
          </Specimen>
          <Specimen caption="Size lg (60px)" className={STACK}>
            <RadioGroup aria-label="Large rows" defaultValue="b">
              <OptionRow type="radio" size="lg" value="a" label="Staff" />
              <OptionRow type="radio" size="lg" value="b" label="Manager" />
            </RadioGroup>
          </Specimen>
          <Specimen caption="Invalid group, with its error" className={STACK}>
            <RadioGroup
              aria-label="Account type"
              aria-invalid
              aria-describedby="gallery-choice-account"
            >
              <OptionRow type="radio" value="staff" label="Staff" />
              <OptionRow type="radio" value="manager" label="Manager" />
            </RadioGroup>
            <p
              id="gallery-choice-account"
              className="mt-1 text-meta font-bold text-warn-fg"
            >
              Choose an account type.
            </p>
          </Specimen>
          <Specimen caption="Disabled group, first chosen" className={STACK}>
            <RadioGroup aria-label="Venue" disabled defaultValue="one">
              <OptionRow
                type="radio"
                value="one"
                label="The Old Mill"
                reason="You work at one venue."
              />
              <OptionRow type="radio" value="two" label="The Anchor" />
            </RadioGroup>
          </Specimen>
        </div>
      </Group>

      <Group
        id="gallery-choice-row-checkbox"
        title="OptionRow: checkbox rows"
        note="Each row stands alone and can be ticked on its own."
      >
        <div className="grid max-w-reading gap-2">
          <Specimen caption="Empty" className={STACK}>
            <OptionRow
              type="checkbox"
              name="gallery-notify"
              value="accepted"
              label="A photo is accepted"
            />
          </Specimen>
          <Specimen
            caption="Ticked, with a hint and an end slot"
            className={STACK}
          >
            <OptionRow
              type="checkbox"
              defaultChecked
              label="A photo is sent back"
              hint="With the manager's note"
              end="Email"
            />
          </Specimen>
          <Specimen caption="Indeterminate" className={STACK}>
            <OptionRow
              type="checkbox"
              indeterminate
              label="All starters"
              hint="3 of 8 chosen"
            />
          </Specimen>
          <Specimen caption="Size sm (44px)" className={STACK}>
            <OptionRow type="checkbox" size="sm" defaultChecked label="Vegan" />
          </Specimen>
          <Specimen caption="Size lg (60px)" className={STACK}>
            <OptionRow
              type="checkbox"
              size="lg"
              label="Send me a weekly summary"
            />
          </Specimen>
          <Specimen caption="Invalid" className={STACK}>
            <OptionRow
              type="checkbox"
              aria-invalid
              label="I have checked the allergens"
              hint="Tick this before you send the menu."
            />
          </Specimen>
          <Specimen
            caption="Disabled, ticked, with its reason"
            className={STACK}
          >
            <OptionRow
              type="checkbox"
              disabled
              defaultChecked
              label="Sign-in codes"
              reason="Everyone gets these. They cannot be turned off."
            />
          </Specimen>
          <Specimen
            caption="aria-disabled: still focusable, with its reason"
            className={STACK}
          >
            <OptionRow
              type="checkbox"
              aria-disabled
              label="Show on the public menu"
              reason="A manager has to accept a photo first."
            />
          </Specimen>
        </div>
      </Group>

      <Group
        id="gallery-choice-tile"
        title="SelectableTile"
        note="The whole tile is the target and the tick box sits on a plate in the corner. A picked tile fills its box and takes a 3px ring. Focus draws the ring round the tile. Two columns on a phone, three from 640px."
      >
        <div className={TILES}>
          <Specimen caption="Not picked" className={STACK}>
            <SelectableTile label="Bar, photo 1" name="gallery-photo" value="1">
              <Photo name="Bar 1" />
            </SelectableTile>
          </Specimen>
          <Specimen caption="Picked" className={STACK}>
            <SelectableTile label="Bar, photo 2" defaultChecked>
              <Photo name="Bar 2" />
            </SelectableTile>
          </Specimen>
          <Specimen
            caption="Ineligible: a reason, no control"
            className={STACK}
          >
            <SelectableTile
              label="Bar, photo 3"
              ineligible="Too dark to use. Take it again in better light."
            >
              <Photo name="Bar 3" />
            </SelectableTile>
          </Specimen>
          <Specimen caption="Disabled" className={STACK}>
            <SelectableTile label="Bar, photo 4" disabled>
              <Photo name="Bar 4" />
            </SelectableTile>
          </Specimen>
          <Specimen
            caption="aria-disabled at the limit, with its reason"
            className={STACK}
          >
            <SelectableTile
              label="Bar, photo 5"
              aria-disabled
              aria-describedby="gallery-choice-limit"
            >
              <Photo name="Bar 5" />
            </SelectableTile>
            <p id="gallery-choice-limit" className="text-meta text-ink">
              You can pick up to three photos.
            </p>
          </Specimen>
          <Specimen caption="Picked, then disabled" className={STACK}>
            <SelectableTile label="Bar, photo 6" disabled defaultChecked>
              <Photo name="Bar 6" />
            </SelectableTile>
          </Specimen>
        </div>
      </Group>
    </div>
  )
}
