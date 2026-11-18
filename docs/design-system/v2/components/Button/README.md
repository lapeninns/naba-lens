# Button

The tappable action, in four weights. **Primary** (`bottle` fill) once per view, for the thing the screen is for: “Take photo”, “Submit”, “Approve for public use”. Default (outlined) for alternatives, **quiet** for low-stakes text actions such as “Change label”, **danger** (`signal` outline) for withdraw, archive and delete.

- Staff screens use the default 48px height (`target-staff`); add `nl-btn--compact` (40px) only in manager and admin desktop toolbars and tables.
- Label is a verb and an object in sentence case. A leading 20px icon is optional; an icon-only button needs `aria-label`.
- `nl-btn--block` makes it full width, for the main action at the bottom of a phone screen.
- You provide: the label, an optional icon, and the handler. Use a real `<button>`, or `<a>` for navigation.
- Don’t put two primary buttons in one view. Don’t disable Submit because files are unlabelled; “I’m not sure” is a valid label.
