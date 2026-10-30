import path from "node:path"
import { slugify } from "../../lib/menus/import/index"
import {
  convertItem,
  emit,
  git,
  provenance,
  readInput,
} from "./converter-common"
import type { RawItem } from "./converter-common"
type Snapshot = {
  source: { commit: string; uncommittedChanges: boolean }
  menuUpdated: string
  venue: { name: string }
  sections: {
    id: string
    title: string
    subtitle?: string
    groups: { title?: string; note?: string; items: RawItem[] }[]
  }[]
}
const [input, output] = process.argv.slice(2)
if (!input || !output)
  throw Error("Usage: convert-group-snapshot.ts input.json output.json")
const { raw, hash } = readInput(input)
const snapshot = raw as Snapshot
const warnings: string[] = []
if (snapshot.source.uncommittedChanges)
  warnings.push("Snapshot reports uncommitted upstream changes")
const upstream = path.resolve(
  path.dirname(input),
  "../../../../menus/lapen-inns-menu-design"
)
if (!/^[a-f0-9]{7,40}$/.test(snapshot.source.commit))
  throw Error("Invalid upstream revision")
const capturedAt = git(
  upstream,
  "show",
  "-s",
  "--format=%cI",
  snapshot.source.commit
)
const sections = snapshot.sections.map((s) => ({
  key: s.id,
  name: s.title,
  kind: "food",
  items: s.groups.flatMap((g) =>
    g.items.map((i) => {
      const group = g.title?.startsWith("Balti /")
        ? "house-styles"
        : slugify(g.title ?? "")
      const key = [s.id, group, slugify(i.name)].filter(Boolean).join("--")
      const item = convertItem(i, key, warnings)
      if (g.title) {
        item.meta.group = g.title
        if (["Curry", "Korma", "Masala"].includes(g.title))
          item.aliases.push(`${i.name} ${g.title}`)
      }
      if (g.note) item.meta.groupNote = g.note
      if (s.subtitle) item.meta.sectionSubtitle = s.subtitle
      return item
    })
  ),
}))
emit(
  output,
  {
    format: "nabalens-menu@1",
    title: `${snapshot.venue.name} food (DEV FIXTURE)`,
    source: provenance(
      input,
      hash,
      snapshot.source.commit,
      capturedAt,
      snapshot.menuUpdated
    ),
    sections,
  },
  warnings
)
