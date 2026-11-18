# ThumbPick

A photo thumbnail you tap to select, used to group a batch before labelling and to choose photos for a review decision or an export.

- A toggle `<button>` with `aria-pressed`. Selected shows a 3px `bottle` inset ring and a filled check; unselected shows an empty ring. Selection never relies on colour alone.
- `nl-thumbpick__label` shows the label a photo already carries. A photo with no label shows none; the count line below says how many are unlabelled.
- Lay out in `nl-thumbgrid`. Selection is by tapping, with “Select all” as a `Button` beside the grid; never require drag and drop.
- Each button’s `aria-label` gives its position and state (“Photo 3, labelled Garden”).
- You provide: the thumbnail image, pressed state, existing label and the toggle handler. Keep the selection when the person returns from the camera or a full-size preview.
