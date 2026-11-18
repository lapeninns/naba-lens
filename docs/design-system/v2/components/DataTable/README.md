# DataTable

Rows of records with comparable numbers, for the admin group overview, the library, people and activity.

- A real `<table>` with a caption, `<th scope="col">` headers and a `<th scope="row">` first cell. Wrap it in `nl-tablewrap` so it scrolls sideways in its own box on small screens.
- Numbers are right-aligned with `nl-num` (tabular numerals). Coverage is always “30/40” with the percentage beneath in `nl-table__sub`.
- Every number is a link to the records behind it. Status cells hold a `StatusChip`.
- Rows are 56px or taller; controls in rows use `target-compact`. Row hover is `surface-hover`.
- You provide: columns, rows, sort state and the link targets. Show problems and blocked setup first by default; never offer a ranking of people.
- Below `bp-tablet`, prefer a list of `ListRow`s over a table with more than four columns.
