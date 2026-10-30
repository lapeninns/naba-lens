# Menu import (packet C, v0.3 / amendment A1)

The import module is pure TypeScript shared by the server preview and browser
editor. It accepts structured JSON or CSV text only. PDF, images, spreadsheets,
Word documents and JavaScript/TypeScript sources are unsupported. Input is never
executed. Prices, dietary and spice labels are source metadata, not verified
facts about food currently served. Each import is one venue's document; callers
must select and authorise that venue independently.

## JSON: `nabalens-menu@1`

```json
{
  "format": "nabalens-menu@1",
  "title": "SYNTHETIC TEST DATA",
  "source": {
    "label": "source.json",
    "revision": "abc123",
    "capturedAt": "2026-10-25T16:49:00Z",
    "notes": "Source metadata only"
  },
  "sections": [{
    "key": "curries",
    "name": "Authentic Curries",
    "kind": "food",
    "items": [{
      "key": "curries--korma--chicken",
      "name": "Chicken",
      "description": null,
      "aliases": ["Chicken Korma"],
      "variants": ["Veg", {"name": "Chicken"}],
      "meta": {"price": "12.00", "labels": ["GF"]}
    }]
  }]
}
```

`format`, `title`, and `sections` are required. Section `key` defaults to
`slugify(name)`; `kind` defaults to `food` and permits `food`, `drinks`, `other`.
Item `key` defaults to `makeSourceKey(sectionSlug, name)`; description defaults
to null, aliases/variants to empty arrays and meta to an empty object. Variant
entries may be strings or objects with `name`. Input identity fields are ignored:
all parsed itemId/variantId fields and review start null. Unknown top-level,
section and item fields produce warnings and are ignored.

`meta` must be an object with values limited to string, finite number, boolean,
null or string arrays. No nested objects or other array types are supported.
`source` is optional; its four fields are nullable strings, capturedAt must be a
parseable timestamp. Successful JSON parsing returns optional `source` alongside
`document` and `issues`, with kind `json` and sha256 null. The caller computes the
raw upload hash, fills filename defaults as needed, and persists provenance
separately from MenuDocument. No provenance is injected into items.

## CSV (RFC 4180)

Header names are case insensitive and order independent. Required: `section`,
`item`. Optional: `section_kind`, `section_key`, `description`, `variants`,
`aliases`, `key`, `price`, `dietary`, and `meta_<name>`. Variants/aliases/dietary
split on `|`; dietary goes to meta.labels, price to meta.price and meta columns
remain strings. Quoted commas/newlines, escaped double quotes, UTF-8 BOM and
CRLF/LF are supported. Quotes must begin a field and closing quotes must be
followed by a separator or end of file. Duplicate headers, missing required
headers, incorrect field counts and unclosed quotes are errors. Blank records
are skipped. A repeated section key groups rows; its name/kind must agree.

CSV has no embedded title or comment syntax. `parseMenuFile` uses the basename
without extension as title; standalone `parseMenuCsv` uses `Imported CSV`.
`# title:` is not special. Issue paths use **logical record numbers**, starting
with header row 1 and the first data row 2. Quoted newlines stay in the same
logical record; skipped blank records still consume record numbers. Duplicate
item keys report both rows. Unknown non-meta columns are ignored.

## Normalisation and limits

Names, descriptions and aliases are NFC, trimmed, with control characters
replaced by spaces and whitespace collapsed. Slugs use NFKD, remove combining
marks, lowercase ASCII, replace other runs with `-`, trim hyphens and cap at 80
characters. An all-non-ASCII name may need an explicit ASCII key. Section slugs
must match `^[a-z0-9]+(-[a-z0-9]+)*$`. Item keys follow SOURCE_KEY_PATTERN:
`^[a-z0-9][a-z0-9:_-]{0,159}$`. Use `--` between section/group/item segments;
`/` is invalid. Explicit keys are preserved, never silently disambiguated.

Limits come from MENU_IMPORT_LIMITS: upload 1 MiB in UTF-8 bytes; 100 sections;
2000 items total; 12 variants/item; 10 aliases/item; title/section/item name 120
characters; description 600; alias/variant name 80; item key 160; serialised
sourceMeta 4096 UTF-8 bytes. NUL-containing text is rejected. Duplicate section
keys, item keys anywhere in the document, and case-insensitive variant names
within an item are errors. Empty sections generate warnings and are dropped.
Repeated names in different sections/groups are valid with distinct keys.

`validateMenuDocument` checks edited documents without mutating them, including
structural types, limits, slugs/keys, duplicate itemId, duplicate variantId within
an item and unresolved review (`needs review before activation`). Parsing calls
the same validator. Call it after edits and before saving/activating.

## API and identity

```ts
parseMenuJson(text: string): ParseResult
parseMenuCsv(text: string): ParseResult
parseMenuFile(input: {fileName: string; text: string; format?: ImportFormat}): ParseResult
slugify(value: string): string
makeSourceKey(sectionSlug: string, itemName: string): string
normaliseName(value: string): string
validateMenuDocument(document: MenuDocument): ImportIssue[]
matchImportToBase(base: MenuDocument | null, incoming: MenuDocument): MenuDocument
diffMenuDocuments(base: MenuDocument | null, next: MenuDocument): MenuDiff
applyReviewDecision(document: MenuDocument, sourceKey: string,
  decision: ReviewDecision, base?: MenuDocument): MenuDocument
sha256Hex(text: string): Promise<string>
```

ParseResult is `{ok:true, document, issues, source?:MenuSource}` or
`{ok:false, issues}`. Dispatch uses the explicit format if supplied, otherwise
the case-insensitive `.json`/`.csv` extension. SHA-256 uses Web Crypto in Node
and browsers. No Node runtime dependency exists under lib/menus/import.

Matching clones inputs and preserves incoming order. Only exact sourceKey
matches copy itemId. Within that item, variant IDs match `lower(trim(name))`.
Unmatched variants remain null. Duplicate base variant names leave affected
IDs null and create a review reason. For unmatched keys, base entries already
claimed by any exact incoming key are excluded. A punctuation-stripped,
whitespace-collapsed lowercase base name matching the incoming name or one of
its aliases becomes a candidate. Name matches never assign IDs automatically.

`same` decisions require an ID from review.candidates. Pass the active base as
the fourth argument to carry variant IDs forward; without it all variant IDs
remain null and therefore create new variants under A1. Duplicate base variant
names throw rather than clearing review silently. `new` clears itemId and all
variantIds. Missing keys and invalid candidates throw. Match/review operations
never mutate the supplied objects.

Diff compares by itemId: null without review is added, review is uncertain,
missing base IDs are removed, retained IDs compare name/description/aliases,
section name/slug/kind, variants (names and IDs) and metadata. Metadata object
key order is immaterial; array order is meaningful. Before values include prior
name/description/aliases, sectionName, variant names and (at runtime) meta.
The shared DiffChange.before type does not yet expose meta; lead can extend it
with `meta?: SourceMeta` if the UI needs typed access. Unresolved candidates
also remain in removed until resolved, since their IDs are absent from next.

## Offline converters

```sh
pnpm exec tsx scripts/menus/convert-group-snapshot.ts INPUT.json OUTPUT.json
pnpm exec tsx scripts/menus/convert-railway-drinks.ts INPUT.json OUTPUT.json
```

These scripts only read JSON and git history; output paths are caller-selected.
They reject non-JSON inputs and validate the resulting import document before
writing it. Group snapshots are the reviewed LapenInnsLP `data/menus` shape.
The upstream commit and commit time come from the snapshot source revision
in the sibling menu-design repository (git history only). Drinks provenance
uses the venue repository's last commit touching the input file. Source labels
are relative to `LapenInns Project/`. Conversion date is UTC; output logs include
section/item counts and every warning. See the fixture README for exact hashes.

Food keys include section, group and original name; the long Balti group has
fixed alias `house-styles`. Curry/Korma/Masala items also receive qualified
aliases. Name suffixes split on balanced outer parentheses (nested label
parentheses supported), or a recognised protein slash list such as Farsi
Chicken / Lamb, only when label and price counts agree. Original prices remain
in meta.price, split prices in meta.variantPrices. Ambiguities retain one item
with no variants and emit a warning. Specials options explicitly supply labels
and prices. Drinks traverse only columns/panels/sections/subsections; picks are
excluded. Measure variants require matching price counts. Source notes/badges,
labels and measures remain metadata.

Menu-design `*.js` sources are **not converted** here. A reviewed restricted
`window.X = <JSON>` extractor would be needed; it is not implemented. Never
execute/import those files or run the upstream sync script to convert them.

Packet C has no browser/mobile UI surface. Its validation is deterministic
unit tests, typecheck and lint; no e2e runner, server, build, database or Docker
execution is applicable to this packet. Integrated upload/review/editor journeys
remain the integration QA packet's responsibility.
