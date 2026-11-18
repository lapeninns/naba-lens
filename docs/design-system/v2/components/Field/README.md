# Field

A labelled input: text, search, textarea, select or checkbox. Staff rarely type; fields are mostly for search, the optional note, and manager and admin forms.

- Always a visible `nl-field__label` tied to the input with `for`/`id`. Placeholder text is never the label.
- Inputs are 48px tall with 16px text, so phones don’t zoom. Use `nl-search` to add the leading search icon.
- Help goes in `nl-field__hint`; link it with `aria-describedby`. Mark optional fields “(optional)” in the label instead of starring required ones.
- Errors: add `nl-field--error`, set `aria-invalid="true"`, and say what to do next in `nl-field__error` with the triangle icon. The border thickens as well as turning `signal`, so the error is not colour alone.
- Checkboxes use `nl-check`: the whole 48px row is the target.
- You provide: label, value, hint, error text and the change handler. Validate on blur or submit, not on every keystroke.
