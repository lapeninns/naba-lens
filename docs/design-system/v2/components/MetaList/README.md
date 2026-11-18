# MetaList

Facts about one photo or record, as label and value pairs: who added it, when, which task, what the checks found.

- A `<dl>`: labels in `caption` `ink-muted`, values in `ink`. Two columns; values wrap.
- Uploaded and Taken are always separate rows. When the capture date isn’t known the value is “Capture date unknown”, never the upload date.
- Technical flags (blurry, dark, low resolution, possible duplicate) are attention `StatusChip`s: they inform the reviewer and never block.
- You provide: the pairs, in the order shown. Leave a row out when it doesn’t apply; don’t show “N/A”.
- Dates are in the pub’s timezone.
