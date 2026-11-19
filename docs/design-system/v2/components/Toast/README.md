# Toast

A brief confirmation that something the person just did has happened. It appears above the tab bar and leaves on its own.

- `ink` ground with `paper` text, so it reads the same in both themes. `role="status"`; it never takes focus.
- One short sentence in the past tense, with an optional single text action such as “Undo”. Stays 5 seconds, or 8 with an action; pauses on hover and focus.
- Only for confirmed results. “Sent for review” appears after the server confirms, never when the upload starts.
- You provide: the message and an optional action. Show one at a time; a new toast replaces the old one.
- Don’t use it for errors or anything that needs a decision; use `Notice` or `Sheet`.
