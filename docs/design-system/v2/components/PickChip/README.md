# PickChip

A pill that picks one thing with a tap: a category filter, or a label for a group of photos. It replaces typing.

- A toggle `<button>` with `aria-pressed`. Selected is `ink` fill with `paper` text, so selection reads without colour.
- Wrap a set in an element with `role="group"` and an `aria-label` (“Category”, “Label for these 4 photos”).
- `nl-pick--unsure` is the dashed “I’m not sure” choice. Offer it at the end of every label set, worded exactly so.
- `nl-pick__count` shows how many photos carry that label.
- You provide: the label text, pressed state and an optional count. Show a few suggestions first, then search; never preselect a recent label.
- Categories are always these five, in this order: Food, Drinks, Spaces, Facilities, Other.
