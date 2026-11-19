# EmptyState

What a list shows when it has nothing in it: an icon, a plain title, one sentence and at most one action.

- Say why it is empty and whether that is good news (“Nothing needs a photo”) or a first step (“No photos yet. Add the first one.”).
- The icon is a 32px line icon in `ink-muted`; no illustrations. Title in `title`, text in `body` `ink-muted`, action is a default `Button` (primary only if it is the screen’s main action).
- A list that is empty because of a filter says so and offers “Clear filters”.
- You provide: icon, title, text and the optional action.
- Loading is not empty: while data loads, show `surface-sunken` blocks in the shape of the rows, not this component.
