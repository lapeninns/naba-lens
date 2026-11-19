# ListRow

One record in a list: an icon or thumbnail, a title, a line of detail, then its status and at most one action. It is the row for venue facts, publishing destinations, menu import changes, tasks, notifications and people.

- Structure: `nl-row__lead` (a 20px icon or a `nl-thumb`), title in `label`, `nl-row__meta` in `caption`, and `nl-row__trail` holding one `StatusChip` and one text link or compact `Button`.
- **Facts:** the title is the question, the meta is the answer with its conditions and the date confirmed. A confirmed “No” is still a positive “Confirmed” chip. “Unconfirmed” is neutral; a check that is due is attention “Needs checking”.
- **Publishing:** say what is true here and what is true at the destination separately (“Withdrawn here · still live on the site”). Never show “Published” without an acknowledgment.
- **Menu import:** one row per change with Added (positive), Changed (attention), Possible match (attention, with Resolve), Leaving the menu (neutral) or Unchanged (neutral).
- Group rows in `nl-list`. You provide: lead, title, meta, status and the action. If the whole row opens a detail page, make the title the link.
