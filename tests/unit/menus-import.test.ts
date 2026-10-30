// @vitest-environment node
import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import {
  parseMenuJson,
  parseMenuCsv,
  parseMenuFile,
  slugify,
  makeSourceKey,
  validateMenuDocument,
  sha256Hex,
  matchImportToBase,
  diffMenuDocuments,
  applyReviewDecision,
} from "../../lib/menus/import"
import { MENU_IMPORT_LIMITS as L } from "../../lib/menus/types"
import type { MenuDocument } from "../../lib/menus/types"
const raw = () => ({
  format: "nabalens-menu@1",
  title: "SYNTHETIC TEST DATA",
  sections: [
    {
      name: "Curries",
      items: [{ name: " Chicken ", variants: ["Veg", "Chicken"] }],
    },
  ],
})
const parse = (r: unknown) => parseMenuJson(JSON.stringify(r))
const doc = (): MenuDocument => {
  const r = parse(raw())
  if (!r.ok) throw Error(JSON.stringify(r.issues))
  return r.document
}
const base = () => {
  const b = doc()
  b.sections[0].items[0].itemId = "item-1"
  b.sections[0].items[0].variants.forEach((v, n) => (v.variantId = `v${n}`))
  return b
}
const errors = (r: ReturnType<typeof parseMenuJson>) =>
  r.issues.filter((i) => i.severity === "error")
describe("menu structured input", () => {
  it("normalises names, defaults keys, preserves metadata and provenance", () => {
    const r = raw()
    Object.assign(r.sections[0].items[0], {
      name: " Cafe\u0301  \n Chicken ",
      meta: {
        price: "12.00",
        labels: ["GF"],
        flag: true,
        count: 2,
        other: null,
      },
      extra: 1,
    })
    const out = parse({
      ...r,
      unknown: 1,
      source: {
        label: "source.json",
        revision: "abc",
        capturedAt: "2026-10-25T16:49:00Z",
        notes: "fixture",
      },
    })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.document.sections[0].items[0]).toMatchObject({
      name: "Café Chicken",
      sourceKey: "curries--cafe-chicken",
      itemId: null,
      review: null,
      variants: [
        { variantId: null, name: "Veg" },
        { variantId: null, name: "Chicken" },
      ],
    })
    expect(out.source?.revision).toBe("abc")
    expect(out.issues.filter((i) => i.severity === "warning")).toHaveLength(2)
  })
  it.each([
    "{",
    "[]",
    "null",
    '{"format":"other","sections":[]}',
    '{"title":"Missing","sections":[]}',
  ])("rejects malformed JSON/schema %s", (s) =>
    expect(parseMenuJson(s).ok).toBe(false)
  )
  it.each(["pdf", "png", "js", "ts", "xlsx", "docx"])(
    "rejects unsupported %s",
    (ext) =>
      expect(parseMenuFile({ fileName: `input.${ext}`, text: "{}" }).ok).toBe(
        false
      )
  )
  it("dispatches case insensitive extensions and explicit format", () => {
    expect(
      parseMenuFile({ fileName: "MENU.JSON", text: JSON.stringify(raw()) }).ok
    ).toBe(true)
    expect(
      parseMenuFile({
        fileName: "no-extension",
        format: "json",
        text: JSON.stringify(raw()),
      }).ok
    ).toBe(true)
  })
  it("enforces bytes, not JS length; rejects NUL", () => {
    expect(
      parseMenuJson("é".repeat(L.maxBytes / 2 + 1)).issues[0].message
    ).toContain("1 MiB")
    expect(parseMenuCsv("section,item\na,b\0").ok).toBe(false)
  })
  it.each([
    { nested: {} },
    { values: [1] },
    { bad: [true] },
    { bad: { x: 1 } },
  ])("rejects bad metadata %j", (meta) => {
    const r = raw()
    Object.assign(r.sections[0].items[0], { meta })
    expect(parse(r).ok).toBe(false)
  })
  it.each([
    { aliases: "bad" },
    { variants: "bad" },
    { variants: [{}] },
    { name: 42 },
    { description: 42 },
    { meta: null },
    { meta: [] },
    { key: "bad/key" },
  ])("rejects malformed item fields %j", (fields) => {
    const r = raw()
    Object.assign(r.sections[0].items[0], fields)
    expect(parse(r).ok).toBe(false)
  })
  it("rejects malformed sections and provenance", () => {
    for (const sections of [
      null,
      [null],
      [{ name: "A", kind: "bad", items: [] }],
      [{ name: "A", items: "bad" }],
    ])
      expect(parse({ ...raw(), sections }).ok).toBe(false)
    for (const source of [null, { label: 42 }, { capturedAt: "not-a-date" }])
      expect(parse({ ...raw(), source }).ok).toBe(false)
  })
  it("rejects duplicates and reports both locations", () => {
    const r = raw()
    r.sections[0].items.push({ ...r.sections[0].items[0] })
    const out = parse(r)
    expect(out.ok).toBe(false)
    expect(
      out.issues.some(
        (i) =>
          i.message.includes("sections[0].items[0]") &&
          i.path.includes("items[1]")
      )
    ).toBe(true)
    r.sections.push({ ...r.sections[0], items: [] })
    expect(
      parse(r).issues.some((i) => i.message.includes("Duplicate section"))
    ).toBe(true)
  })
  it("rejects duplicate variant names", () => {
    const r = raw()
    r.sections[0].items[0].variants = ["Veg", " veg "]
    expect(parse(r).ok).toBe(false)
  })
  it("drops empty sections with a warning", () => {
    const r = raw()
    r.sections.push({ name: "Empty", items: [] })
    const out = parse(r)
    expect(out.ok && out.document.sections.length).toBe(1)
    expect(out.issues.some((i) => i.message === "Empty section dropped")).toBe(
      true
    )
  })
  it("accepts repeated names across distinct sections", () => {
    const r = raw()
    r.sections.push({
      name: "Specials",
      items: [{ name: "Chicken", variants: [] }],
    })
    expect(parse(r).ok).toBe(true)
  })
  it("validates every document limit and invalid structural values", () => {
    const cases: ((d: MenuDocument) => void)[] = [
      (d) => (d.title = "x".repeat(L.titleMax + 1)),
      (d) =>
        (d.sections = Array.from({ length: L.maxSections + 1 }, (_, n) => ({
          ...d.sections[0],
          slug: `s-${n}`,
          items: [],
        }))),
      (d) => (d.sections[0].name = "x".repeat(L.sectionNameMax + 1)),
      (d) => (d.sections[0].slug = "BAD/SLUG"),
      (d) => (d.sections[0].items[0].name = "x".repeat(L.nameMax + 1)),
      (d) =>
        (d.sections[0].items[0].description = "x".repeat(L.descriptionMax + 1)),
      (d) =>
        (d.sections[0].items[0].aliases = Array(L.maxAliases + 1).fill("a")),
      (d) => (d.sections[0].items[0].aliases = ["x".repeat(L.aliasMax + 1)]),
      (d) =>
        (d.sections[0].items[0].sourceKey = "x".repeat(L.sourceKeyMax + 1)),
      (d) => (d.sections[0].items[0].sourceKey = "bad/key"),
      (d) =>
        (d.sections[0].items[0].sourceMeta = {
          x: "é".repeat(L.sourceMetaMaxBytes),
        }),
      (d) =>
        (d.sections[0].items[0].variants = Array.from(
          { length: L.maxVariantsPerItem + 1 },
          (_, n) => ({ variantId: null, name: `v${n}` })
        )),
      (d) =>
        (d.sections[0].items[0].variants[0].name = "x".repeat(
          L.variantNameMax + 1
        )),
      (d) =>
        (d.sections[0].items = Array.from(
          { length: L.maxItems + 1 },
          (_, n) => ({ ...d.sections[0].items[0], sourceKey: `i-${n}` })
        )),
    ]
    for (const mutate of cases) {
      const d = doc()
      mutate(d)
      expect(validateMenuDocument(d).some((i) => i.severity === "error")).toBe(
        true
      )
    }
  })
  it("rejects runtime malformed edited structures without throwing", () => {
    for (const v of [
      null,
      {},
      { title: "a", sections: [null] },
      {
        title: "a",
        sections: [{ name: "a", slug: "a", kind: "food", items: [{}] }],
      },
    ])
      expect(validateMenuDocument(v as MenuDocument).length).toBeGreaterThan(0)
  })
  it("slugifies and hashes consistently", async () => {
    expect(slugify(" Crème & Rice ")).toBe("creme-rice")
    expect(slugify("雪")).toBe("")
    expect(makeSourceKey("curries", "Chicken")).toBe("curries--chicken")
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    )
  })
})
describe("CSV records", () => {
  it("parses BOM, CRLF, reordered headers, escaped quotes, embedded newlines, pipes, metadata and filename title", () => {
    const out = parseMenuFile({
      fileName: "SYNTHETIC TEST DATA.CSV",
      text: '\uFEFFITEM,SECTION,description,variants,aliases,price,dietary,meta_origin\r\n"Chicken, special",Curries,"A ""fine""\r\ndish",Veg|Chicken,Meal|Curry,12.00,GF|V,Nepal\r\n',
    })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.document.title).toBe("SYNTHETIC TEST DATA")
    expect(out.document.sections[0].items[0]).toMatchObject({
      name: "Chicken, special",
      description: 'A "fine" dish',
      aliases: ["Meal", "Curry"],
      sourceMeta: { price: "12.00", labels: ["GF", "V"], origin: "Nepal" },
    })
  })
  it.each([
    "",
    "item\na",
    'section,item\na,"unclosed',
    'section,item\na,a"b',
    'section,item\na,"b"x',
    "section,item\na,b,c",
    "section,section,item\na,a,b",
  ])("rejects malformed CSV %s", (s) => expect(parseMenuCsv(s).ok).toBe(false))
  it("reports duplicate keys with both logical row numbers", () => {
    const out = parseMenuCsv("section,item\nFood,Chicken\nFood,Chicken")
    expect(out.ok).toBe(false)
    expect(out.issues).toContainEqual(
      expect.objectContaining({
        path: "row 3.sourceKey",
        message: "Duplicate source key; first at row 2",
      })
    )
  })
})
describe("reimport identity and diff", () => {
  it("preserves ids only on exact keys, is deterministic and leaves inputs unchanged", () => {
    const b = base(),
      i = doc(),
      saved = JSON.stringify([b, i])
    const matched = matchImportToBase(b, i)
    expect(matched.sections[0].items[0]).toEqual(b.sections[0].items[0])
    expect(diffMenuDocuments(b, matched).unchangedCount).toBe(1)
    expect(matchImportToBase(b, i)).toEqual(matched)
    expect(JSON.stringify([b, i])).toBe(saved)
  })
  it("renames on the same key and moves sections while retaining identity", () => {
    const b = base(),
      i = doc()
    i.sections[0].items[0].name = "New Chicken"
    i.sections[0].name = "Specials"
    i.sections[0].slug = "specials"
    const d = diffMenuDocuments(b, matchImportToBase(b, i))
    expect(d.changed[0].fields).toEqual(["name", "section"])
    expect(d.changed[0].before).toEqual({
      name: "Chicken",
      sectionName: "Curries",
    })
  })
  it("treats changed default keys as uncertain, including two candidates", () => {
    const b = base()
    const second = structuredClone(b.sections[0].items[0])
    second.itemId = "item-2"
    second.sourceKey = "specials--chicken"
    b.sections.push({
      name: "Specials",
      slug: "specials",
      kind: "food",
      items: [second],
    })
    const i = doc()
    i.sections[0].items[0].sourceKey = "new--chicken"
    const m = matchImportToBase(b, i)
    expect(m.sections[0].items[0]).toMatchObject({
      itemId: null,
      review: { candidates: ["item-1", "item-2"] },
    })
    const diff = diffMenuDocuments(b, m)
    expect(diff.uncertain[0].candidates.map((c) => c.sectionName)).toEqual([
      "Curries",
      "Specials",
    ])
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(2)
  })
  it("matches aliases and excludes exact-matched candidates", () => {
    const b = base(),
      i = doc()
    i.sections[0].items[0].name = "Completely different"
    i.sections[0].items[0].aliases = ["CHICKEN!"]
    i.sections[0].items[0].sourceKey = "other"
    expect(matchImportToBase(b, i).sections[0].items[0].review).not.toBeNull()
    i.sections[0].items.push(doc().sections[0].items[0])
    expect(matchImportToBase(b, i).sections[0].items[0].review).toBeNull()
  })
  it("resolves same/new safely and fills variants from optional base", () => {
    const b = base(),
      i = doc()
    i.sections[0].items[0].sourceKey = "renamed"
    const m = matchImportToBase(b, i)
    expect(() =>
      applyReviewDecision(m, "renamed", { kind: "same", itemId: "wrong" }, b)
    ).toThrow()
    expect(() => applyReviewDecision(m, "missing", { kind: "new" })).toThrow()
    const same = applyReviewDecision(
      m,
      "renamed",
      { kind: "same", itemId: "item-1" },
      b
    )
    expect(same.sections[0].items[0].variants[1].variantId).toBe("v1")
    expect(same.sections[0].items[0].review).toBeNull()
    const fresh = applyReviewDecision(m, "renamed", { kind: "new" })
    expect(fresh.sections[0].items[0].itemId).toBeNull()
    expect(
      fresh.sections[0].items[0].variants.every((v) => v.variantId === null)
    ).toBe(true)
  })
  it("handles variant additions/removals/renames and ambiguous base variants", () => {
    for (const names of [
      ["Veg"],
      ["Veg", "Chicken", "Lamb"],
      ["Vegetable", "Chicken"],
    ]) {
      const b = base(),
        i = doc()
      i.sections[0].items[0].variants = names.map((name) => ({
        name,
        variantId: null,
      }))
      const m = matchImportToBase(b, i)
      expect(diffMenuDocuments(b, m).changed[0].fields).toEqual(["variants"])
      for (const v of m.sections[0].items[0].variants)
        expect(v.variantId).toBe(
          v.name === "Veg" ? "v0" : v.name === "Chicken" ? "v1" : null
        )
    }
    const b = base()
    b.sections[0].items[0].variants.push({
      name: " veg ",
      variantId: "duplicate",
    })
    const m = matchImportToBase(b, doc())
    expect(m.sections[0].items[0].variants[0].variantId).toBeNull()
    expect(m.sections[0].items[0].review?.reason).toContain("variant")
  })
  it("counts additions, removals, metadata changes and unresolved reviews", () => {
    const b = base()
    expect(diffMenuDocuments(null, doc()).added).toHaveLength(1)
    expect(
      diffMenuDocuments(b, { title: "Empty", sections: [] }).removed
    ).toHaveLength(1)
    const m = matchImportToBase(b, doc())
    m.sections[0].items[0].sourceMeta = { price: "new" }
    expect(diffMenuDocuments(b, m).changed[0].fields).toEqual(["meta"])
    m.sections[0].items[0].review = { candidates: ["item-1"], reason: "Check" }
    expect(
      validateMenuDocument(m).some((i) =>
        i.message.includes("needs review before activation")
      )
    ).toBe(true)
  })
  it("rejects duplicate item and variant ids", () => {
    const b = base()
    b.sections[0].items.push({
      ...structuredClone(b.sections[0].items[0]),
      sourceKey: "second",
    })
    b.sections[0].items[0].variants[1].variantId = "v0"
    const issues = validateMenuDocument(b)
    expect(issues.some((i) => i.message.includes("Duplicate itemId"))).toBe(
      true
    )
    expect(issues.some((i) => i.message.includes("Duplicate variantId"))).toBe(
      true
    )
  })
})
describe("offline fixtures and execution boundary", () => {
  it.each([
    ["the-railway.food.json", 14, 125],
    ["the-prince-of-wales.food.json", 15, 127],
    ["the-railway.drinks.json", 18, 101],
  ] as const)("parses %s with no errors", (name, sections, items) => {
    const text = readFileSync(join("tests/fixtures/menus", name), "utf8")
    const r = parseMenuJson(text)
    expect(errors(r)).toEqual([])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.document.sections).toHaveLength(sections)
    expect(r.document.sections.reduce((n, s) => n + s.items.length, 0)).toBe(
      items
    )
    expect(r.document.title).toContain("DEV FIXTURE")
    expect(r.source?.notes).toContain("not proof the venue currently serves")
  })
  it("keeps venues separate and handles reviewed source quirks", () => {
    const read = (f: string) => {
      const r = parseMenuJson(
        readFileSync(`tests/fixtures/menus/${f}.food.json`, "utf8")
      )
      if (!r.ok) throw Error("fixture")
      return r.document
    }
    const railway = read("the-railway"),
      prince = read("the-prince-of-wales")
    expect(railway.title).not.toBe(prince.title)
    const items = prince.sections.flatMap((s) => s.items)
    expect(items.find((i) => i.name === "Tikka Masala")?.variants).toHaveLength(
      4
    )
    expect(
      items.find((i) => i.name === "Farsi")?.variants.map((v) => v.name)
    ).toEqual(["Chicken", "Lamb"])
    expect(items.find((i) => i.name === "Veg Momo")?.variants).toHaveLength(2)
    expect(
      railway.sections
        .flatMap((s) => s.items)
        .find((i) => i.name === "Lasun Kukhura Khursani")
        ?.variants.map((v) => v.name)
    ).toEqual(["LKK (Chicken)", "LLK (Lamb)"])
  })
  it("exercises synthetic fixture files", () => {
    const read = (f: string) =>
      readFileSync(`tests/fixtures/menus/synthetic-${f}`, "utf8")
    expect(parseMenuJson(read("malformed.json")).ok).toBe(false)
    expect(parseMenuJson(read("duplicates.json")).ok).toBe(false)
    expect(parseMenuCsv(read("quoting.csv")).ok).toBe(true)
    const parsed = (f: string) => {
      const r = parseMenuJson(read(f))
      if (!r.ok) throw Error(JSON.stringify(r.issues))
      return r.document
    }
    const b = parsed("two-candidates.json")
    b.sections[0].items.forEach((i, n) => (i.itemId = `candidate-${n}`))
    const m = matchImportToBase(b, parsed("renamed-key.json"))
    expect(m.sections[0].items[0].review?.candidates).toHaveLength(2)
    const original = parsed("base.json")
    original.sections[0].items[0].itemId = "stable"
    const move = matchImportToBase(original, parsed("category-move.json"))
    expect(diffMenuDocuments(original, move).changed[0].fields).toEqual([
      "section",
    ])
  })
  it("has no input execution primitives in any import module", () => {
    const walk = (p: string): string[] =>
      readdirSync(p, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(p, e.name)) : [join(p, e.name)]
      )
    for (const f of walk("lib/menus/import"))
      expect(readFileSync(f, "utf8")).not.toMatch(
        /\beval\s*\(|new\s+Function\b|\bimport\s*\(|\brequire\s*\(/
      )
  })
})
