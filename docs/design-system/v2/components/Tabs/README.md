# Tabs

A row of text tabs that switches views of one list: the Album filters, the My uploads sections, the Venue sections.

- `role="tablist"` with `role="tab"` buttons; the selected tab has `aria-selected="true"`, `ink` text and a 3px `bottle` underline. Arrow keys move between tabs.
- A count after the label (`nl-tabs__count`) shows how many items are in that view. Leave it off when zero.
- The row scrolls sideways on narrow phones; never shrink the text or wrap to two rows.
- You provide: the tab labels, optional counts, the selected tab and the panel it controls.
- Use `PickChip` instead when more than one choice can be on at once (category filters). Use `TabBar` or `SideNav` for moving between screens.
