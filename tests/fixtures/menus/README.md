# Menu development fixtures

These are DEV FIXTURES, converted on 2026-10-30. They are not proof the venue
currently serves these items. Prices, dietary/spice labels and other notes are
source metadata only. Each venue stays a separate document. No source repository
was changed and no upstream JS/TS was executed or imported.

Paths below are relative to `LapenInns Project/`. Captured time is the upstream
revision's commit time, not the conversion date or proof of menu freshness.
The group JSON source block has revision `78a0719` and clean source status.
`shasum -a 256` on all three original files matched the investigation hashes.

| Fixture | Original source path | SHA-256 | Upstream commit | Captured at | menuUpdated | Sections / items | Converter warnings |
| --- | --- | --- | --- | --- | --- | --- | --- |
| the-railway.food.json | venues/LapenInnsLP/data/menus/the-railway.json | a997109ecb68977b095d8ccd0a573b3c5078de62d15726cab18d5000ddaca41c | 78a0719 | 2026-10-21T17:23:43+01:00 | 2026-05-06 | 14 / 125 | 3 |
| the-prince-of-wales.food.json | venues/LapenInnsLP/data/menus/the-prince-of-wales.json | c2b00181004495787f6fc36d242ac13340f610ea746d73d1789bcc80fa8a1403 | 78a0719 | 2026-10-21T17:23:43+01:00 | 2026-09-18 | 15 / 127 | 3 |
| the-railway.drinks.json | venues/TheRailwayLP/data/drinks-menu.json | 79438f7abfa0e276e1263bb413ca92f51ed475713eaa17413ac1a24d68e3e3c2 | 42274d283035d6bfdfe2f9f75ce7bab4eb28b899 | 2026-09-14T20:58:35+01:00 | 2026-09-14 (file commit date) | 18 / 101 | 0 |

Both food conversions warn on the same three unresolved label/price lists:
Samosas (Veg/Meat), Veg / Vegan Burger & Chips, CTM / Korma. Their original
names/prices remain intact, no variants inferred. Nested Lasun Kukhura Khursani
labels are split correctly. Prince of Wales also covers four-way Tikka Masala,
Farsi Chicken / Lamb without parentheses, and Veg Momo (Steam / Chilli).

Freshness questions from the prior investigation remain unresolved: Set B/C
food last changed in May 2026; White Horse (Waterbeach) venue-repository prices
differ from menu-design. These are questions to reconcile with venue owners,
not assertions that these snapshots are current. The scripts do not query live
venue operations. Drinks menuUpdated is not an upstream field; the file commit
date is used and explicitly identified here.

`synthetic-*` files contain SYNTHETIC TEST DATA: valid base, renamed key, two
same-name candidates, explicit-key category move, duplicate keys, malformed
JSON and BOM/CRLF CSV with quoting and a multiline field. To exercise stable
matching, tests assign synthetic IDs to parsed base documents; imported source
files deliberately contain no database IDs.

Regenerate from the original read-only paths with the commands documented in
`docs/menus-import.md`. Warning logs are emitted on stdout; the counts above
record the actual conversion run. Provenance in each fixture records the hash,
revision, captured time and conversion date independently of this table.
