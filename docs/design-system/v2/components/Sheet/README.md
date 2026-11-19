# Sheet

A panel over the page for one short decision: choosing how to add a photo, picking a retake reason, confirming something that can’t be undone.

- On phones it is a bottom sheet (`nl-sheet`) on `scrim`, with a grip, a `title`, one line of text and stacked full-width buttons, primary first.
- From `bp-tablet` up, and for confirmations, use `nl-sheet--dialog`: centred, at most `sheet-max` wide, buttons in a row with the safe choice first and the destructive one last.
- `role="dialog"` (or `alertdialog` for confirmations), `aria-modal="true"`, labelled by its title. Trap focus inside, return focus to the opener on close, close on Escape and on scrim tap.
- You provide: title, text, the actions and the close handler. Confirmation titles are a question that names the consequence (“Sign out with 3 photos unsent?”); buttons repeat the verb, never “OK”.
- Don’t put a form longer than three fields in a sheet; use a page. Don’t open a sheet from a sheet.
