# JobCard

One thing a member of staff can photograph now: what it is, one short instruction, its state and one action.

- Layout: a `thumb-row` thumbnail (the approved example, or a camera icon when there is none), the name in `heading`, one line of brief in `ink-muted`, then a `StatusChip` and a `Button`.
- An item with nothing yet gets the primary “Add photo”. An item already awaiting review gets the default “Add another”, so it doesn’t look like an urgent empty slot.
- You provide: name, brief (one sentence, no more than about 60 characters), thumbnail, status and the action. Home shows at most three, then “View all”.
- Don’t show who else has uploaded, a due-date countdown or a score.
