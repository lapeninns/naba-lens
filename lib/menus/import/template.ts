// The downloadable CSV template for menu imports, spec §8 A3. Pure.
//
// Columns (docs/menus-import.md): `section` and `item` are required. `venue`
// is checked against the venue the admin imports into; `menu` names the
// draft; `item_id` keeps a stable existing item (copy it from an export or
// the admin menu page); `active_from`/`active_to` are the dates the menu runs
// (the admin still confirms the activation). Dates are YYYY-MM-DD.

export const MENU_CSV_TEMPLATE_COLUMNS = [
  "venue",
  "menu",
  "section",
  "section_kind",
  "item",
  "item_id",
  "description",
  "variants",
  "aliases",
  "price",
  "dietary",
  "active_from",
  "active_to",
] as const

const EXAMPLE_ROWS: string[][] = [
  [
    "The Example Inn",
    "Main menu",
    "Mains",
    "food",
    "Beer-battered haddock",
    "",
    "Chips, peas and tartare sauce",
    "Regular|Large",
    "Fish and chips",
    "16.50",
    "GF on request",
    "2026-12-01",
    "",
  ],
  [
    "The Example Inn",
    "Main menu",
    "Drinks",
    "drinks",
    "House lemonade",
    "",
    "",
    "",
    "",
    "3.50",
    "",
    "2026-12-01",
    "",
  ],
]

const field = (value: string) =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

/** RFC 4180 text with a header row and two example rows, CRLF line ends. */
export function menuCsvTemplate(): string {
  return (
    [MENU_CSV_TEMPLATE_COLUMNS as readonly string[], ...EXAMPLE_ROWS]
      .map((row) => row.map(field).join(","))
      .join("\r\n") + "\r\n"
  )
}

export const MENU_CSV_TEMPLATE_FILENAME = "naba-lens-menu-template.csv"
