import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Toggle } from "@/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

/*
 * Gallery block for the primitives no Batch 2 worker rewrote (strategy.md
 * 6.3): Label and Separator, which stay; and Toggle and ToggleGroup, which
 * are internal (SegmentedControl draws its segments from toggle.tsx). They
 * are shown so that nothing in components/ui is missing from the gallery.
 */

function Specimen({
  caption,
  children,
}: {
  caption: string
  children: React.ReactNode
}) {
  return (
    <figure className="grid min-w-0 justify-items-start gap-1.5">
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
    <section aria-labelledby={id} className="grid min-w-0 gap-3">
      <h3 id={id} className="type-heading-sm text-ink">
        {title}
      </h3>
      {note ? <p className="text-body text-ink-muted">{note}</p> : null}
      {children}
    </section>
  )
}

const ROW = "flex flex-wrap items-end gap-x-6 gap-y-4"

export function OtherBlock() {
  return (
    <div className="grid min-w-0 gap-10">
      <Group
        id="other-label"
        title="Label"
        note="The visible name of a control: 17px, weight 700. Inside a field use FieldLabel, or FormField, which wires it for you."
      >
        <div className={ROW}>
          <Specimen caption="Label with its input (htmlFor)">
            <div className="grid w-full gap-2">
              <Label htmlFor="other-label-input">Display name</Label>
              <Input id="other-label-input" defaultValue="Mina Walker" />
            </div>
          </Specimen>
          <Specimen caption="Long label that wraps">
            <Label className="max-w-60">
              The name your colleagues see beside every photo you send
            </Label>
          </Specimen>
        </div>
      </Group>

      <Group
        id="other-separator"
        title="Separator"
        note="A hairline in the line colour. Decoration only: it never stands in for a control's edge."
      >
        <div className={ROW}>
          <Specimen caption="Horizontal (the default)">
            <div className="grid w-60 max-w-full gap-3 text-body">
              <span>Above</span>
              <Separator />
              <span>Below</span>
            </div>
          </Specimen>
          <Specimen caption="Vertical">
            <div className="flex min-h-11 items-center gap-3 text-body">
              <span>Before</span>
              <Separator orientation="vertical" />
              <span>After</span>
            </div>
          </Specimen>
        </div>
      </Group>

      <Group
        id="other-toggle"
        title="Toggle and ToggleGroup (internal)"
        note="Internal: no production screen renders these now. New code uses SegmentedControl or FilterPill; the variant and size names here are outside the contract."
      >
        <div className={ROW}>
          <Specimen caption="Toggle, not pressed">
            <Toggle aria-label="Videos only">Videos only</Toggle>
          </Specimen>
          <Specimen caption="Toggle, pressed">
            <Toggle defaultPressed>Videos only</Toggle>
          </Specimen>
          <Specimen caption="Toggle, outline variant, pressed">
            <Toggle variant="outline" defaultPressed>
              Videos only
            </Toggle>
          </Specimen>
          <Specimen caption="Toggle, disabled">
            <Toggle disabled>Videos only</Toggle>
          </Specimen>
          <Specimen caption="Toggle, size sm (44px, tighter padding)">
            <Toggle size="sm">Videos only</Toggle>
          </Specimen>
          <Specimen caption="Toggle, size lg (48px: older than the contract, where lg is 60px)">
            <Toggle size="lg">Videos only</Toggle>
          </Specimen>
        </div>
        <div className={ROW}>
          <Specimen caption="ToggleGroup, default variant (the grey track)">
            <ToggleGroup aria-label="Media" defaultValue={["all"]}>
              <ToggleGroupItem value="all">All</ToggleGroupItem>
              <ToggleGroupItem value="photos">Photos</ToggleGroupItem>
              <ToggleGroupItem value="videos">Videos</ToggleGroupItem>
            </ToggleGroup>
          </Specimen>
          <Specimen caption="ToggleGroup, outline variant">
            <ToggleGroup
              aria-label="Media, outline"
              variant="outline"
              defaultValue={["photos"]}
            >
              <ToggleGroupItem value="all">All</ToggleGroupItem>
              <ToggleGroupItem value="photos">Photos</ToggleGroupItem>
              <ToggleGroupItem value="videos">Videos</ToggleGroupItem>
            </ToggleGroup>
          </Specimen>
        </div>
      </Group>
    </div>
  )
}
