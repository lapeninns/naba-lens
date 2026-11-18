Naba-Lens is the app pub teams use to keep a current, approved collection of photographs and short videos of what each pub serves and offers. Staff capture on a phone, managers review, group admins organise and publish. The interface is quiet so the photographs are the colour on the screen, and it never says more than it knows.

## Principles

- **The photograph is the content.** Chrome is `paper`, `surface` and `ink`. `bottle` appears once per view, on the action the screen is for.
- **Honest states.** Say exactly what has happened and nothing more: “Saved on this device” is not “Uploaded”; “Approved” is not “Published”; “Exported” is not “Live on the website”.
- **Never colour alone.** Every status is a `StatusChip`: a tone, an icon and a word.
- **Phone first, thumb sized.** Staff actions are at least `target-staff` (48px). Managers and admins on desktop use `target-compact` (40px).
- **No typing where a tap will do.** Labels are picked with `PickChip`, not typed.

## Voice

- Plain, short, kind. Sentence case everywhere, including buttons and titles. No exclamation marks, no emoji.
- Use the words staff already use: **Upload, Take photo, Choose from phone, Change label, Submit, Retake, Retry**. Never expose model words such as requirement, usage, rendition or subject in staff screens; say “photo”, “dish”, “item”.
- Buttons are a verb and an object: “Add photo”, “Approve for public use”, “Ask for another photo”.
- Feedback is about the photo, never the person: “Another photo requested: the whole plate isn’t visible”, not “Rejected”. A technical failure is “Didn’t upload”, never a comment on the photography.
- “I’m not sure” is always an acceptable answer and is written exactly so.
- Numbers show their working: “30/40, 75% covered”. Never a bare percentage.
- Dates are day and short month in the pub’s timezone: “14 Nov”. An unknown capture date reads “Capture date unknown”; never show the upload date in its place.
- Address the reader as “you”. The pub is named in full: “White Horse Inn, Swavesey”.

## Colour

- Page is `paper`; cards, bars and sheets are `surface` with a 1px `line` outline; empty slots and tracks are `surface-sunken`.
- Text is `ink`; secondary text is `ink-muted`. Both read on `paper`, `surface` and `surface-sunken` in both themes.
- `bottle` is the brand: primary button fill (label in `on-bottle`, never white), the active tab, links inside the app chrome, and the positive status.
- `brass` is the accent. It marks things that need a person’s attention. Use `brass-ink` on `brass-soft` for attention text; `brass` itself is for fills and marks beside a word.
- `sky` means in progress; `signal` means a problem or a destructive action. Neither is ever decorative.
- Control borders are `line-strong`, not `line`.
- Focus is a 2px solid `focus` outline offset 2px, on every interactive element.
- Text over a photograph is `on-photo` on `scrim`.
- Both themes are complete. Do not hard-code a hex value; use the token.

## Status language

Five tones cover every state in the product. Pick the tone from this table and write the word shown; do not invent a sixth tone.

| Tone | Tokens | Means | States that use it |
| --- | --- | --- | --- |
| Neutral | `ink` on `surface-sunken` | Nothing has happened yet, or it is out of play | Missing, Needed, Unlabelled, Saved on this device, Kept as reference, Not used, Archived, Withdrawn, Not selected, Exported, Unconfirmed |
| Progress | `sky` on `sky-soft` | Moving without the reader’s help | Uploading, Uploaded — processing, Awaiting review, Submitted, Queued |
| Positive | `bottle` on `bottle-soft` | Done and current | Sent for review, Approved for public use, Covered, Confirmed, Published |
| Attention | `brass-ink` on `brass-soft` | A person needs to do something | Needs label, Needs checking, Another photo requested, Label corrected, Didn’t upload, Update pending, Withdrawal pending, Blocked |
| Problem | `on-signal` on `signal` (solid) | Something is wrong now | Needs replacing, Processing failed, Publishing failed |

- “Kept as reference” is neutral on purpose: it must not look like it closed a public-photo requirement.
- “Needs checking” (a check is due) and “Needs replacing” (known to be wrong) are different tones and must never share a chip.
- A confirmed “No” is a positive “Confirmed” chip with the answer beside it; it is not a problem.
- Problem is the only solid chip, so it differs from the others in lightness as well as hue.

## Type

- Two families: `display` (Fraunces) for names of things and big numbers, `sans` (Figtree) for everything people read and tap. Both load from Google Fonts.
- One `display` style per screen, for what the screen is about: the dish, the pub, the queue. Section and sheet titles are `title`. Coverage counts are `figure` with tabular lining numerals.
- Card and row titles are `heading`; running text is `body`; buttons, tabs and pick chips are `label`; metadata and chips are `caption`.
- Nothing smaller than `caption` (13px). Staff body text is never below 16px.
- Text must reflow at 200% zoom; never fix a text container’s height.

## Space, shape and depth

- All spacing comes from `space-1` to `space-7`. Phone gutters and card padding are `space-4`; sections are `space-5` apart.
- Album grids are fluid: columns at least `tile-min` wide, `space-2` between tiles.
- Buttons, cards, tiles and inputs are `radius-md`; row thumbnails `radius-sm`; sheets `radius-lg`; chips and the round Upload button `radius-full`.
- Cards are flat with a `line` outline. `shadow-raised` is for things that float: sheets, menus and the tab bar.
- The active pub is always on screen, in `VenueBar`, on every capture and review screen.

## Photography

- Show photographs uncropped in review. In grids, crop to 4:3 with `object-fit: cover` and never crop automatically for export.
- An empty slot is a dashed `line-strong` outline with the camera icon, not a stock image or illustration.
- Do not overlay text on a photograph except a pending count on `scrim`.
- No filters, tints or rounded-circle crops on food.

## Iconography

- Line icons on a 24px grid, 1.75px stroke, round caps and joins, drawn in `currentColor`. The previews use Lucide (ISC licence) as a stand-in; there is no bespoke icon set yet.
- Icons are 20px beside `label` text, 16px inside a `StatusChip`, 24px in `TabBar`.
- Fixed meanings: check = done, clock = waiting, dashed circle = missing, question mark = not sure or needs label, triangle = problem, camera = take or retake, circular arrow = retry.
- An icon never stands alone as a status. Icon-only buttons carry an `aria-label`.
- No emoji.

## Logo

There is no logo yet. Set the name as plain text, “Naba-Lens”, in `display`, in `ink` or `bottle`. Do not draw a mark.

## Motion

Keep it short and functional: 150ms ease-out for presses and chip changes, 250ms for sheets. Progress bars move with real progress only. Honour `prefers-reduced-motion` by removing transitions.

## Layout

- Design for a 360px phone first. Phone gutters are `space-4`; one column; `TabBar` fixed to the bottom; `VenueBar` at the top.
- From `bp-tablet` (768px): two columns where it helps (review: photo left, details right), album grids of four or more, sheets become dialogs.
- From `bp-desktop` (1100px): managers and admins get `SideNav` in place of `TabBar`; content is at most `content-max` wide with `space-6` gutters; tables show every column.
- Staff screens stay a single phone-width column at every size; centre them on larger screens.
- Sticky bars (`TabBar`, `DecisionBar`) respect the safe-area insets and use `shadow-raised`.

## States

Every interactive component has these states; build all of them.

- **Hover and pressed:** outlined controls and rows take `surface-hover`; the primary button takes `bottle-strong`.
- **Focus:** the 2px `focus` outline, offset 2px. Never remove it.
- **Selected:** `ink` fill with `paper` text (pick chips), or a `bottle` ring with a check (thumbnails). Never colour alone.
- **Disabled:** `surface-sunken` ground, `line` border, `ink-muted` text. Prefer hiding an action the person may not take, and explain a blocked one with a `Notice`.
- **Busy:** keep the button’s label, set `aria-busy="true"`, and show progress where the work is (`UploadRow`), not a full-screen spinner.
- **Loading:** `surface-sunken` blocks in the shape of the content.
- **Empty:** `EmptyState`.
- **Error:** inline, beside the cause, saying what to do next: `Field` errors for input, `Notice` for the page, `UploadRow` for a file.

## Accessibility

- Target WCAG 2.2 AA. Text is at least 4.5:1 on its ground in both themes; borders, icons and focus rings at least 3:1.
- Every flow works by touch, keyboard and screen reader. Nothing depends on drag and drop, hover or colour.
- Use real elements: `<button>`, `<a href>`, `<input>` with `<label>`, `<table>`. The component guidelines name the ARIA each one needs.
- Announce upload progress and results through a polite live region; don’t move focus.
- Honour text enlargement to 200% and `prefers-reduced-motion`.

## Using the system

- Load `tokens.css`, then `components/bundle.css`. Components are plain HTML with `nl-` classes; copy the markup from each component’s preview, or wrap it in your own framework components and keep the class names.
- The light theme is the default. Set `data-theme="dark"` on `<html>` for dark, and follow the device setting unless the person chooses.
- Fonts load from Google Fonts: Figtree at 400, 500, 600 and 700, and Fraunces at 600.
- Use tokens for every colour, space, radius and size. If a design needs a value that is not a token, add the token first.
- “Screen recipes” lists, screen by screen, which components each staff, manager and admin screen is built from.
