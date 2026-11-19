# StatusChip

A tone, an icon and a word that say what state something is in. It is the only way status is shown anywhere in the product.

- Tones: default (neutral), `nl-chip--progress`, `nl-chip--positive`, `nl-chip--attention`, `nl-chip--problem`. The README’s status table says which state takes which tone and wording.
- Always include the 16px icon and the word; never a coloured dot alone.
- You provide: the tone class, the icon and the text. It is not interactive; put it inside the row or card that is.
- Staff see human wording (“Another photo requested”), not system states (“RETAKE_REQUESTED”).
- Don’t stack more than two chips on one item; show the one the reader can act on first.
