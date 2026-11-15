# Common Room: Naba-Lens design system

Version 0.4 · 15 Nov 2026 · Status: signed off on 14 Nov 2026 (decision D1 in [decisions.md](decisions.md)). It shipped to every screen on 7 Nov 2026.

Applies to every Naba-Lens surface: the staff app (phone first), the venue manager workspace (phone, tablet, desktop) and the admin desktop app.

Sections 1 to 9 are the v0.3 text of 7 Nov 2026, unchanged apart from where they point and the goals changes of 0.4 (NabaLens v0.5, see the changelog). Sections 10 to 13 were added when the spec moved into the repo. Section numbers never change, because code comments cite them ("DESIGN.md §4").

| Subject                                               | Where it lives                        |
| ----------------------------------------------------- | ------------------------------------- |
| Token values                                          | `app/globals.css`                     |
| State words, icons and shapes as built                | `components/nabalens/status-chip.tsx` |
| Measured values for each component, beside what ships | [components.md](components.md)        |
| Which components exist and how widely they are used   | [catalogue.md](catalogue.md)          |
| Where the product differs from this spec              | [departures.md](departures.md)        |
| The living reference                                  | `/ui-preview` (dev only)              |

Names in brackets such as `UI.row()` and `.lead-card` are the builders and classes of the prototype kit this spec was written against. They are kept so the text stays as written; they are not names in this codebase. Section 10 maps the token names to the ones the code uses.

## 1. Idea

A staff room you already know how to use. Staff aged 40 and over scroll social feeds every day, so Naba-Lens borrows the _patterns_ of a feed: a light grey canvas, white cards, posts with a face and a name, a share box at the top, grey buttons and tabs at the bottom. The palette, type and details are Naba-Lens's own; no other company's branding is used.

Principles:

1. **Feels familiar.** Feed, posts, share box, bottom tabs. Nothing new to learn.
2. **One next step.** One solid blue button per screen, inside thumb reach. Everything else is a grey button or a link.
3. **State is a word, a shape and a tone.** Never colour alone. The four core states never share a shape.
4. **Scope is always on screen.** Every venue screen names the venue. A person's month and a venue's checklist are never added together.
5. **Honest feedback.** Say what happened, then what to do. Nothing moves on its own except real status.
6. **Built for a busy shift.** 17px text floor, 44px minimum targets, 52 to 60px main buttons, labels under every icon, dark mode available.

## 2. Tokens

Authored in OKLCH; hex values are sRGB fallbacks. Light is the default everywhere; dark is a user choice.

| Token                     | Light                 | Dark                  | Use                                                   |
| ------------------------- | --------------------- | --------------------- | ----------------------------------------------------- |
| `--bg`                    | `#eef0f3`             | `#131415`             | Grey canvas behind the feed                           |
| `--surface`               | `#ffffff`             | `#1f2122`             | Cards, posts, bars, sheets                            |
| `--surface-2`             | `#e7eaed`             | `#2e3133`             | Grey buttons, fields, hover                           |
| `--raised`                | `#d9dde0`             | `#3b3d40`             | Hover on grey                                         |
| `--fg`                    | `#13161a`             | `#edeff0`             | Text, icons                                           |
| `--muted`                 | `#50565c`             | `#b0b5b9`             | Secondary text                                        |
| `--border`                | `#d5d8db`             | `#3b3d40`             | Dividers                                              |
| `--border-strong`         | `#6f757b`             | `#7d8185`             | Empty checkboxes, field edges, neutral state outlines |
| `--accent`                | `#0063ba`             | `#0063ba`             | Primary button fill (white text); selection marks     |
| `--accent-hover`          | `#0052a1`             | `#0052a1`             | Primary hover                                         |
| `--accent-text`           | `#0063ba`             | `#73b6fa`             | Active tab                                            |
| `--accent-soft`           | `#d8eaff`             | `#1a3450`             | Selected filter, segment, side nav item, selected row |
| `--focus`                 | `#0063ba`             | `#73b6fa`             | Focus ring                                            |
| `--ok-fg` / `--ok-bg`     | `#005e31` / `#d5f5de` | `#86eaab` / `#123923` | Accepted, progress                                    |
| `--warn-fg` / `--warn-bg` | `#9d2e1c` / `#ffe7df` | `#ffb49d` / `#51231d` | Needs another photo, overdue, menu changed, errors    |
| `--info-fg` / `--info-bg` | `#005e71` / `#d9f4fb` | `#8cd8eb` / `#083740` | Ready, self-review                                    |

OKLCH sources: accent `oklch(0.5 0.16 252)`, accent-hover `oklch(0.44 0.15 252)`, bg light `oklch(0.955 0.004 250)`, surface dark `oklch(0.245 0.004 250)`. Full list, plus `--on-accent`, `--stamp-fg`, `--hatch`, `--plate`, `--scrim` and the two elevations, in `app/globals.css` (names in §10). Components bind these tokens. The only other values allowed are the camera and viewer stage (below), the avatar tint and the chip colours on a photo plate (§4); anything else is a departure to fix.

### Contrast (computed, WCAG 2.x)

| Pair                                | Light           | Dark            |
| ----------------------------------- | --------------- | --------------- |
| fg on bg                            | 15.9            | 16.0            |
| muted on surface                    | 7.4             | 7.8             |
| muted on surface-2                  | 6.1             | 6.4             |
| white on accent (button)            | 6.0             | 6.0             |
| white on accent-hover               | 7.7             | 7.7             |
| accent-text on surface (active tab) | 6.0             | 10.2            |
| ok / warn / info text on tint       | 6.8 / 6.2 / 6.4 | 8.8 / 7.6 / 8.1 |
| focus ring on bg (non-text)         | 5.3             | 8.6             |
| border-strong on surface (non-text) | 4.6             | 4.1             |

**Blue is rationed.** Solid blue fills the one primary button. Lighter blue (`--accent-text`) marks the active tab only. `--accent-soft` marks a selected filter, segment, side nav item or selected row. Solid `--accent` may also mark a **selection the person made**: a ticked checkbox, a chosen radio, and the 3px ring on a picked photo tile. Blue never marks a state, progress or decoration. Progress is green because it means accepted. Hover darkens fills; text never gets lighter.

**Camera and viewer.** The in-app camera and the photo viewer's stage always use the dark token set (`data-theme="dark"` on that screen), in both themes, so the photo is judged against a dark surround and nothing glares. Their stage behind the photo is `oklch(0.12 0.005 250)` (near black). Every other screen follows the person's theme.

### Type

| Role                         | Family                     | Size / line / weight                      |
| ---------------------------- | -------------------------- | ----------------------------------------- |
| Display XL                   | Figtree                    | 34 / 1.05 / 800, -0.02em                  |
| Heading LG                   | Figtree                    | 26 / 1.15 / 750                           |
| Heading MD, card title       | Figtree                    | 21 to 24 / 1.25 / 700                     |
| Count                        | Figtree                    | 46 / 0.95 / 800, tabular                  |
| Tab label                    | Figtree                    | 17 / 1.1 / 600, active 800 in accent-text |
| Body                         | Atkinson Hyperlegible Next | 17 / 1.5 / 400 (lead 18)                  |
| Button                       | Atkinson Hyperlegible Next | 18 / 1.2 / 700                            |
| Meta, times, %               | Atkinson Hyperlegible Mono | 17 / 600, tabular                         |
| Complete chip                | Figtree                    | 17 / 800 caps, +0.06em                    |
| Complete stamp (item header) | Figtree                    | 21 / 800 caps, +0.08em                    |

Floor 17px for product text. The only exceptions are the device status bar and the 15px caption laid over a photo stand-in. Fallbacks: `system-ui, -apple-system, "Segoe UI", sans-serif`.

### Space, shape, elevation

- 4px base: `4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48`. Feed gutter 12, card gap 12, card padding 12 to 16.
- Targets ≥ 44px with 8px between. Button 52, XL 60, field 56, row 64, tab 60, stepper button 48.
- Radius: button and field 8, card, post and row 12, sheet top 16, pills (chips, filters, share box, segmented) full, square state 4, stamp 2, icon disc full.
- Elevation by shadow: cards `0 1px 2px` at 12% plus a 4% hairline; sheets and dialogs `0 12px 28px` at 18%. Dark mode uses a faint 6% white edge instead.
- Motion: sheets 260ms rise, press 1px, hover 150ms; reduced motion turns all of it off. A sheet that stays open while its content changes never replays its entrance and keeps its scroll position.
- Design sizes: phone 390 × 844, narrow phone 320 wide, tablet 1024 × 768 (landscape, so the side nav applies), desktop and admin 1280 × 800.

## 3. State vocabulary

The four core states must never blur.

| State           | Word        | Shape                                       | Tone     | Means                                                                         |
| --------------- | ----------- | ------------------------------------------- | -------- | ----------------------------------------------------------------------------- |
| **Ready**       | Ready       | Round pill, outline, open-dot icon          | info     | Uploaded and shared in Photos and on the profile. Says nothing about counting |
| **Accepted**    | Accepted    | Square tag (4px), filled, tick              | ok       | Counts toward a dish, a monthly target or a checklist item                    |
| **Complete**    | COMPLETE    | Stamp: 2px radius, 4px double border, caps  | ink (fg) | A checklist item has enough accepted photos                                   |
| **Needs setup** | Needs setup | Square tag, 2px dashed border, hatched fill | neutral  | Missing team, target or plan. Never complete                                  |

**Reserved shapes.** The filled ok square with a tick belongs to Accepted alone. The round outline info pill belongs to Ready alone. The double-bordered stamp belongs to Complete alone. The dashed hatched square belongs to Needs setup and Needs verification alone. No other state, tag or label may use them, even with a different word.

Other photo states: **Submitted** (round pill, grey outline, up arrow), **Needs another photo** (round pill, warn fill and border, return arrow, always shown with the reason), **Closed** (grey square, padlock).

Task and checklist states: **Overdue** (square, warn outline, clock; never blocks sending), **In progress** (round pill, neutral), **Not applicable** (dotted square, minus; stays visible with reason, not counted), **Retired** (grey square, padlock), **Needs reassignment** (square, warn outline, people), **Target met** (square, ok outline, no fill, target icon). Since 0.4, tasks, due dates and Overdue belong to service, venue-specific and amenity work only (NabaLens v0.5 rule 28). Food and drink work never shows them.

Food and drink goals (0.4, NabaLens v0.5). Nobody owns a dish, and nothing about it has a due date:

- **Still needed** is a list heading and a count on Our menu, not a chip: the dishes on the active menu with no accepted photo, shared by everyone at the venue.
- **Waiting for review**: a dish whose only photo waits for a decision, and the striped frame of the month. It is Submitted in staff words and takes Submitted's shape (round pill, grey outline, up arrow). The dish stays in Still needed.
- **Being checked**: a dish whose photo is rechecked after a menu change. It takes Menu changed's shape, never the Overdue clock. The dish stays in Still needed.
- **Needed by 30 Nov**, then **Needed**: a manager's date on one dish, written as plain meta text beside it. It is not a chip and has no warn tone, clock or late state. After the date it reads "Needed" and the dish stays first.
- **Needs another photo** is the retake note's word, always with the reviewer's reason. It has no date. Later sets it aside on Home; it stays on Me and never comes back as a reminder.

Menu coverage: **Menu changed** (square, neutral outline with a thick warn bar on the left, menu icon). It means a coverage decision is waiting, not a missed deadline, so it never uses the Overdue clock. The other coverage states are words in a card: "No active menu", "Menu coverage needs setup" (Needs setup tag), "Menu coverage is current".

Amenity facts: **Present** (square, ok outline, no fill, tick), **Not present** (grey square, minus), **Needs verification** (dashed, hatched).

Roles and accounts: **Self-review** (info square). Staff **Invited** (dashed round pill) / **Active** (neutral outline square, person icon) / **Inactive** (grey square, padlock). Menu **Draft** (dashed round pill) / **Active · for labelling only** (neutral grey square, menu icon) / **Retired** / **Discarded**. Grant **In effect** (neutral outline square) / **Not in effect: reason** (grey square). None of these uses the tick.

Upload states, written in mono beside each file: Waiting · Uploading 42% · Processing · Uploaded · Failed · Cancelled.

After sending, Home confirms in words: "Sent 1 photo to your month", "Sent 3 photos to Bar set-up", "Sent your new photo to your month". Keeping a photo as shared only says so: "Kept as shared only… Nothing was sent for review."

Banned words: Approved, Rejected, Pending approval, Done, Published, Live. Staff screens for food and drink work also never say task, due, overdue or better photo (0.4).

## 4. Components

The measured values for each component (heights, padding, radius, fill, edge, states), beside what the product ships today, are in [components.md](components.md). Which of these exist as shared components is in [catalogue.md](catalogue.md).

- **Button** `.btn` + `primary | secondary | ghost | danger`, modifiers `full`, `xl`, `sm`. One enabled primary per screen. A disabled primary keeps its label, goes grey, uses `aria-disabled` and says why beside it. In a side-by-side pair the primary sits on the right (thumb side). When a pair is too narrow and stacks, grey goes above and blue below, in DOM order, so the focus order matches what people see.
- **Icon button** `.icon-btn`, `.labelled` and `.stacked` always show text (Back, Our menu, Close).
- **Chip** `.chip.<state>` via `UI.chip(state, text?)`. Always icon + word, in the shapes in §3.
- **Stamp** `UI.stamp()`: the large Complete stamp on a checklist item header.
- **Share box** `.composer` via `UI.composer()`: avatar, a pill that opens Add, and Take a photo / Choose photos. When adding is blocked (no venue, venue paused) the reason replaces the two actions. Not on Home since 0.4 (§5a): the Add tab opens capture for any photo.
- **Post** `UI.post()`, `article.post`: avatar, name, venue and time, the photo edge to edge, then what it shows, what it was for and its state chip. No likes, comments, reactions or counts. `compact` for accepted photos in a thread and the admin library.
- **Lead card** `UI.leadCard()`, `.lead-card`: one job and its one blue action. At most one per screen, and none on a screen whose dock holds the primary. Its media is kept short enough that the action shows without scrolling on a 390 × 844 phone.
- **Row** `UI.row()`, `.row` (+ `warn`, `info`, `ok`): icon, two lines, chevron. The to-do rail of secondary jobs. `UI.list()` groups rows in one card.
- **Card** `.card`, `.card.flat`. Plain grouping.
- **Thread** `UI.thread()`: a task as a post thread. The task's own post first (what to photograph, by when, the section's shared progress), then each photo sent as a post. `UI.reason()` puts the reviewer's reason directly under the old photo as its caption, with the action below it in the same post.
- **Progress** `UI.progress()`, `UI.frames()`, `UI.framesKey()`. One rounded segment per photo: green accepted, striped submitted, grey still needed. Always paired with the words "N of M accepted". The month's roll of frames is this component in its segments mode, not a component of its own (0.4). It has four frame states, keyed in this order: Accepted (green), Waiting for review (striped), Needs another photo (warn tint with a warn edge) and Still to take (grey).
- **Scope label** `.scope-label`, **venue scope** `.venue-scope`, **separate note** `.separate-note`: who and where a number belongs to, and that the two counts are separate.
- **Notice** `UI.notice(ok|info|warn, title, text, actions)`: what happened, then what to do. `warn` gets `role="alert"`, others `role="status"`. Home's sent confirmation is an ok notice.
- **Offline banner** `.banner-off` under the status bar.
- **Field** `UI.field()`, `.input`, `textarea.input`, `.field-err` (icon + text, never colour alone; `aria-invalid`, `aria-describedby`). Code entry is one input set in mono, digits spaced.
- **Stepper** `- [n] +` for targets (`.a-manage-stepper`, `.a-manager-account-stepper`): 48px buttons with drawn minus and plus of equal weight, the value in mono in a labelled field, an `aria-label` on each button ("Decrease Priya Gurung"), and the error under the group. The minus and plus carry no visible word (see rationale).
- **Icon disc** (`.a-gi-disc` and its area twins): a 52px round disc above a state heading (mail sent, link expired, could not load), neutral, ok or warn tint. Decorative: the heading carries the meaning.
- **Step marker**: `UI.steps()` for multi-step setup ("Choose sections", "Set photos per section"), and the short two-segment "Step 1 of 2 · Your email" marker on sign in (`.a-gi-step`) where two long labels would wrap.
- **Segmented** `UI.seg()` with `aria-pressed`. **Select pill** `UI.filters()` for filters and suggestions; selected uses accent-soft with an accent-text inset edge. Pills wrap; nothing scrolls sideways.
- **Tile check** `UI.pick()` / `UI.picker()` for photo pickers. Ineligible photos show the reason instead of a checkbox. A picked tile gets a filled box and a 3px accent ring.
- **Radio row** `UI.choice()`, **checkbox** `UI.check()`.
- **Sheet** `UI.sheet()` (phone), **Dialog** `UI.dialog()` (desktop, or `phone` for a phone confirm), **Drawer** `UI.drawer()` (admin media details). All have `role="dialog"`, `aria-modal`, a label, a visible Close, a scrim that closes, and close on Escape.
- **Tab bar** `UI.tabbar()`: staff Home · Photos · Add · Me; managers add Manage with a review count. Hidden on action screens, replaced by the **action dock** `UI.dock()` (pinned, holds the primary).
- **Top bar** `UI.top()`: Back with label, title, venue scope.
- **Side nav** `.side` for Manage and admin at 1024px and up. `UI.wide()`, `UI.adminShell()`, `UI.wideHead()`.
- **Table** `UI.table()`, **Stat** `UI.stat()`, **Key values** `UI.kv()`.
- **Menu diff tag** (`.a-admin-diff`, admin only): a neutral pill with a mono sign and a word ("+ 3 added", "~ 2 changed", "− 1 removed"); uncertain matches use the warn tint ("? 2 uncertain"). Never colour alone.
- **Upload queue item** `UI.qItem()`: thumbnail, "Photo N", mono state, progress bar, Cancel / Retry / Undo.
- **Camera** (`.camera`, `.a-add-cam`): dark stage, labelled shutter, a quiet list of suggested angles (current one bold with a 2px underline), "Use N" as the primary.
- **Photo stand-in** `UI.ph()`. Prototypes never use real venue photos or stock people. A chip laid on a photo sits on a solid `--plate`, with Ready and Submitted drawn in light outline values so they read on it.
- **Avatar** `UI.avatar(name, hue)`: initials in white on a per-person tint `oklch(0.42 0.06 hue)`. The tint only tells faces apart; it never carries a state. **Skeleton** `UI.skeleton()`: static, photo areas as flat blocks.

Prototype only, not product: the **Controls panel** beside the playable phone and admin (`play-` and `pl-` classes in the prototype kit): role, theme, connection, scenario, flows, and a running tap counter.

## 5. Patterns

- **Screen anatomy (phone):** status bar → optional offline banner → top bar with venue → scroll area → tab bar or action dock.
- **Home shows goals, not tasks (0.4),** in this order: setup notice → retake note → Our menu with what is still needed → Your month → Other jobs → From the team as posts. One main action: Reshoot when a retake note is open, else the first Still needed dish, else Open camera when the menu is complete. Food and drink work has no assignment, due date or Overdue. The full Home rules are in §5a.
- **Goals, not tasks:** the menu belongs to the whole venue. Anyone at the venue may photograph any dish still needed, and it leaves Still needed for everyone once a photo of it is accepted. Your month is one person's goal, private to them, their venue manager and admins. No screen ranks or compares staff.
- **After sending,** the phone returns to Home and confirms what was sent, in words, in an ok notice at the top of the feed. The photo keeps its Sent state.
- **Task as a thread** (service, venue-specific and amenity work only): task post → your photos as posts → for Needs another photo, the old photo with the reason as its caption and the action under it.
- **Two counts, never added:** "Your month" (person, month, venue) and "Venue progress" / "Checklist" (venue, month). Each has its own scope label and the sentence that they are counted separately.
- **Offline:** uploads wait ("Waiting for a signal") and carry on when the signal returns. Sending to your month or a job always needs a tap ("Send when you're back online" stays disabled until then). On the admin desktop every save is disabled with the reason "You're offline"; navigation still works.
- **Errors:** what happened, then what to do, then reassurance when true. "We couldn't reach Naba-Lens. Check your connection and try again. Nothing is sent twice."
- **Empty states:** icon, what appears here, and how it gets there. One action at most.
- **Loading:** skeletons in the real layout plus a status line ("Loading Home…").
- **Destructive actions:** danger button, confirmation dialog naming the venue and the external effect, safe choice on the left.
- **Reasons:** any change after the first (targets, not applicable, ask for another photo, revoking a grant) asks for a reason that admins can see. Suggested reasons fill the field and stay editable.
- **Self-review:** allowed, and flagged on the photo, on the lead card, in the dialog and in the confirmation.

### 5a. Home (staff)

Added in 0.3.2; rewritten in 0.4 for NabaLens v0.5 ("goals, not tasks"). The staff landing page (`/staff/tasks`, "Home" on screen). The "v3" prototype of the goals canvas (15 Nov 2026) shows the model only. Its tokens and drawings are not the spec: tokens come from §2 and components from §4.

Home answers three questions: what does the venue still need, how is my month going, and has anyone asked me for another photo. It shows no assignment, due date or Overdue for food and drink work (v0.5 rule 21).

Order, top to bottom. A block with nothing true to say is left out, never shown empty.

1. **Top bar:** wordmark, the venue as a grey pill, the person's avatar linking to Me.
2. **Sent notice**, only after a send: an ok notice in the words of §3 ("Sent your new photo to your month."), then who reviews it next. It stays until closed or the page is left.
3. **Greeting:** the date ("Saturday 14 Nov 2026") above "Good evening, Priya", Heading LG. "Welcome, Priya" until the first photo.
4. **Setup notice**, only when the venue, team or name is missing: what is missing and who fixes it. Nothing on Home then says "complete", and no action leads to a camera that cannot save.
5. **Start here**, for a new starter only: a row to the welcome guide (`/staff/tasks/welcome`).
6. **Retake note**, when a reviewer asked for another photo: the old photo with the Needs another photo chip on the plate, the reviewer's reason in their words, then Later (grey) and Reshoot (blue). Reshoot opens the camera with the dish already labelled. Later hides the note from Home, on every device. The note stays on Me and clears when a new photo of the dish is accepted. It has no date and is never repeated or escalated. Its photo is 2:1 at most, so Reshoot shows without scrolling at 390 × 844.
7. **Photos to review**, for a staff account with a legacy reviewer grant only: one row with the count.
8. **Our menu:** "N of M dishes at The Railway have a photo", an ok bar, and "Counted for the venue, separately from your month." Under it, **Still needed**: up to four dish rows, then "See all N" to `/staff/menu?filter=gaps`. Each row offers Take a photo and Choose from photos, with the dish already labelled. A row carries Waiting for review or Being checked (§3) when that applies, and stays listed. A dish with a needed by date comes first, with the date as meta text; after the date it reads "Needed" (§3). Then menu order. When every dish has a photo, the block says so and Open camera is the main action.
9. **Your month:** its own card with the scope label "You · November 2026 · The Railway", "N of M accepted" in mono, and Progress segments with the four frame states and their key (§4). The sentence under it says what counts: "Accepted food and drink photos you labelled, and photos you sent to the month, count." Never "any photo counts". It shows no due date and no Overdue; the month ends with the London calendar month. Before a target exists, the card shows Needs setup and what is still missing, and says nothing is the person's to do.
10. **Other jobs**, only when the person has service, venue-specific or amenity work: one row linking to the list of those jobs. Due dates and Overdue stay on that list (rule 28).
11. **From the team:** posts (§4), newest first, then "See more in Photos". Target met adds nothing here: no collage, badge or other celebration (§8).

**One main action.** Home has one solid blue button, the first that applies:

| When                             | The blue button                             |
| -------------------------------- | ------------------------------------------- |
| A retake note is open            | Reshoot, in the retake note                 |
| A dish is still needed           | Take a photo, on the first Still needed row |
| Every dish has a photo           | Open camera, in Our menu                    |
| No venue, or setup is incomplete | None                                        |

Every other action on Home is grey or a link. There is no share box on Home: the Add tab opens capture for any photo. The Home tab badge counts the cards on Home that ask the person to act, never dishes.

The tab bar is the shipped five (Home, Photos, Add, People, Me; departure N2). Add is a grey pill around the plus, never blue, so Home's main action stays the only solid blue on Home.

## 6. Voice

British English, sentence case, digits, correct plurals ("1 photo", "3 of 5 accepted"). UK dates in Europe/London: "2 Nov 2026", "2 Nov 2026, 14:06", "Needed by 30 Nov". No exclamation marks, no emoji. Never imply that uploading publishes anything, or that a label is allergen information. Never invent numbers: every count on screen comes from the data.

Food and drink work (0.4, NabaLens v0.5) is a shared goal, so its words are the goal's words: "Our menu", "Still needed", "Your month", "Waiting for review", "Needs another photo", "Needed by 30 Nov", then "Needed". Staff screens for it never say task, due, overdue or better photo, and never rank or compare staff. "Due 30 Nov 2026" and Overdue stay on service, venue-specific and amenity work. Month copy says "Accepted food and drink photos you labelled, and photos you sent to the month, count", never "any photo counts".

## 7. Accessibility

- WCAG 2.2 AA: text 4.5:1, large text and icons 3:1 (see contrast table).
- Focus: 3px `--focus` outline, 2px offset, on every interactive element, in both themes.
- Real `<button>` and `<a>`; dialogs have `aria-modal` and a label; status changes use `role="status"` or `aria-live`.
- Focus order follows the visual order: never reorder controls with CSS alone. A disabled control uses `aria-disabled`, stays in the focus order and says why it is unavailable.
- Text 17px or larger; targets 44px or larger; main buttons 52 to 60px; labels under every icon.
- No swipe-only or long-press-only actions. Nothing moves on its own.
- Text survives 200% zoom; no horizontal scroll from 320px.

## 8. Not in this system

Likes, comments, stories, reactions, leaderboards, scores, gradients beyond functional striping and hatching, glassmorphism, decorative illustration, celebration effects. No third-party logos, brand colours or icon sets: the look is familiar, not borrowed.

## 9. Changes from v0.2

- **Reserved shapes** (§3): the filled ok square with a tick is Accepted's alone. Target met, Present, account Active, grant In effect and menu Active · for labelling only get their own shapes. In v0.2 Target met was "square, ok fill", the same shape as Accepted.
- **Menu changed** added as a state (§3) with its own shape, never the Overdue clock.
- **Selection marks** may use solid accent (§2): ticked checkbox, chosen radio, the 3px ring on a picked tile. Selected rows use accent-soft.
- **Camera and viewer** always use the dark token set (§2).
- **Allowed raw values** listed (§2, §4): the camera and viewer stage, the avatar tint, chips on a photo plate. Anything else is a departure.
- **Complete chip** set at 17px, not 16px, to meet the floor (§2 type). The large stamp is listed.
- **Design sizes** stated (§2): tablet is 1024 × 768 landscape.
- **New components** (§4): stepper, icon disc, sign-in step marker, menu diff tag, camera; the post, lead card, thread and Home confirmation described in full; the Controls panel marked as prototype only.
- **Button pairs** (§4): when a pair stacks, grey above, blue below, in DOM order.
- **Lead card** (§4): its action must show without scrolling at 390 × 844.
- **Patterns** (§5): return to Home with a confirmation after sending; the manager's coverage row on Home; offline rules for sending and admin saves; self-review flagging.
- **Accessibility** (§7) strengthened: focus order follows visual order; disabled controls stay focusable and say why.
- **Motion** (§2): a sheet that stays open never replays its entrance.

## 10. Names in code

Sections 1 to 9 keep the names of the prototype kit (`--bg`, `--fg`, `--border-strong`). The code uses one public set of names, decided as D7 in [decisions.md](decisions.md) and shipped in Batch 1 on 14 Nov 2026. This section is the map from one to the other. `app/globals.css` holds the values; when this section and that file disagree, the file is right and this section needs fixing.

The file has three tiers. Values are custom properties on `:root` (light) and `.dark`. Tokens bind a role name to a value in `@theme`, and Tailwind turns each into utilities (`bg-surface`, `text-ink`, `gap-gutter`). Recipes are `@utility` rules for anything that needs more than one property (`edge-strong`, `focus-ring`, `type-page-title`). Application code uses token and recipe names only. `tests/unit/token-discipline.test.ts` fails on a raw colour, a removed name or a shadcn slot name, and `tests/unit/token-integrity.test.ts` recomputes the contrast of each pair below.

### Colour

Light and dark are the values in `app/globals.css`. The utility is the token name after a Tailwind prefix: `bg-canvas`, `text-ink-muted`, `border-line`.

| Spec token        | Light                        | Dark                         | Custom property    | Token (utility stem) | Value matches spec?                                                                                                |
| ----------------- | ---------------------------- | ---------------------------- | ------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `--bg`            | `oklch(0.955 0.004 250)`     | `oklch(0.19 0.003 250)`      | `--canvas`         | `canvas`             | Yes (name differs)                                                                                                 |
| `--surface`       | `oklch(1 0 0)`               | `oklch(0.245 0.004 250)`     | `--surface`        | `surface`            | Yes                                                                                                                |
| `--surface-2`     | `oklch(0.935 0.005 250)`     | `oklch(0.31 0.005 250)`      | `--surface-2`      | `surface-2`          | Yes                                                                                                                |
| `--raised`        | `oklch(0.895 0.006 250)`     | `oklch(0.36 0.006 250)`      | `--raised`         | `raised`             | Yes                                                                                                                |
| `--fg`            | `oklch(0.2 0.01 250)`        | `oklch(0.95 0.003 250)`      | `--ink`            | `ink`                | Yes (name differs)                                                                                                 |
| `--muted`         | `oklch(0.45 0.012 250)`      | `oklch(0.77 0.008 250)`      | `--ink-muted`      | `ink-muted`          | Yes (name differs). The repo's `--muted` is a private shadcn slot for the grey fill, not this token                |
| `--border`        | `oklch(0.88 0.006 250)`      | `oklch(0.36 0.005 250)`      | `--line`           | `line`               | Yes (name differs). A bare `border` also takes this colour from the base layer                                     |
| `--border-strong` | `oklch(0.56 0.012 250)`      | `oklch(0.65 0.008 250)`      | `--edge-strong`    | `edge-strong`        | Light yes. Dark is lifted from 0.6 to 0.65 so a field's edge holds 3:1 on `surface-2` (strategy.md section 5.2)    |
| `--accent`        | `oklch(0.5 0.16 252)`        | `oklch(0.5 0.16 252)`        | `--accent`         | `accent`             | Yes                                                                                                                |
| `--accent-hover`  | `oklch(0.44 0.15 252)`       | `oklch(0.44 0.15 252)`       | `--accent-hover`   | `accent-hover`       | Yes                                                                                                                |
| `--on-accent`     | `oklch(1 0 0)`               | `oklch(1 0 0)`               | `--on-accent`      | `on-accent`          | Yes                                                                                                                |
| `--accent-text`   | `oklch(0.5 0.16 252)`        | `oklch(0.76 0.12 250)`       | `--accent-text`    | `accent-text`        | Yes                                                                                                                |
| `--accent-soft`   | `oklch(0.93 0.035 252)`      | `oklch(0.32 0.06 252)`       | `--accent-soft`    | `accent-soft`        | Yes                                                                                                                |
| `--focus`         | `oklch(0.5 0.16 252)`        | `oklch(0.76 0.12 250)`       | `--focus`          | `focus`              | Yes. Drawn with the `focus-ring` recipes, not with `outline-focus` by hand                                         |
| `--select`        | accent                       | accent-text                  | `--select`         | `select`             | Yes                                                                                                                |
| `--on-select`     | on-accent                    | surface                      | `--on-select`      | `on-select`          | Yes                                                                                                                |
| `--ok-fg`         | `oklch(0.42 0.11 155)`       | `oklch(0.86 0.13 155)`       | `--ok-fg`          | `ok-fg`              | Yes                                                                                                                |
| `--ok-bg`         | `oklch(0.94 0.045 155)`      | `oklch(0.31 0.06 155)`       | `--ok-bg`          | `ok-bg`              | Yes                                                                                                                |
| `--warn-fg`       | `oklch(0.47 0.15 32)`        | `oklch(0.85 0.11 35)`        | `--warn-fg`        | `warn-fg`            | Yes                                                                                                                |
| `--warn-bg`       | `oklch(0.95 0.035 35)`       | `oklch(0.32 0.07 30)`        | `--warn-bg`        | `warn-bg`            | Yes                                                                                                                |
| `--info-fg`       | `oklch(0.44 0.09 215)`       | `oklch(0.84 0.08 215)`       | `--info-fg`        | `info-fg`            | Yes                                                                                                                |
| `--info-bg`       | `oklch(0.95 0.03 215)`       | `oklch(0.31 0.05 215)`       | `--info-bg`        | `info-bg`            | Yes                                                                                                                |
| `--stamp-fg`      | `oklch(0.2 0.01 250)`        | `oklch(0.95 0.003 250)`      | `--stamp-fg`       | `stamp-fg`           | Yes                                                                                                                |
| `--hatch`         | `oklch(0.88 0.006 250)`      | `oklch(0.38 0.005 250)`      | `--hatch`          | `hatch`              | Yes. `bg-hatch` is a recipe that draws the hatching, not a plain fill                                              |
| `--shell`         | `oklch(0.9 0.005 250)`       | `oklch(0.13 0.003 250)`      | none               | none                 | Not in the repo: it is the prototype's canvas behind device frames                                                 |
| `--plate`         | `oklch(0.15 0.01 250 / .86)` | `oklch(0.12 0.005 250 / .9)` | `--plate`          | `plate`              | Yes                                                                                                                |
| `--scrim`         | `oklch(0.15 0.01 250 / .5)`  | `oklch(0 0 0 / .6)`          | `--scrim`          | `scrim`              | Yes                                                                                                                |
| repo only         | `oklch(0.12 0.005 250)`      | same in both themes          | `--stage`          | `stage`              | Matches the raw camera and viewer stage value in §2                                                                |
| repo only         | `oklch(0.97 0 0)`            | same in both themes          | `--on-stage`       | `on-stage`           | No spec counterpart: text and icons on the stage                                                                   |
| repo only         | `oklch(0.78 0.005 250)`      | same in both themes          | `--on-stage-muted` | `on-stage-muted`     | No spec counterpart: secondary text on the stage                                                                   |
| repo only         | `oklch(0.49 0.012 250)`      | `oklch(0.7 0.008 250)`       | `--ink-subtle`     | `ink-subtle`         | No spec counterpart: tertiary text                                                                                 |
| repo only         | see-through                  | accent-text                  | `--accent-edge`    | `accent-edge`        | No spec counterpart: the primary button's 1px edge. It shows in dark only, where the fill alone is 2.7:1 on a card |
| repo only         | surface-2                    | surface-2                    | none               | `media-placeholder`  | No spec counterpart: the fill behind a photo before it loads                                                       |
| repo only         | `oklch(0.42 0.06 hue)`       | same in both themes          | none               | `avatar-fill`        | The avatar tint of §2. The avatar sets the hue (`--ah`); `on-avatar` is the initials on it                         |

Names that no longer exist. Each was a second name for a value in the table and was removed in Batch 1: `bg`, `paper`, `panel`, `well`, `fill-hover`, `fill-press`, `fg`, `fg-muted`, `border-strong`, `line-control`, `positive*`, `attention*`, `negative*`, `warning*`, `info` and `info-surface`, `viewer`, `on-viewer*`, `tile-badge` and `on-tile-badge`.

The shadcn slot names (`--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--secondary`, `--muted`, `--destructive`, `--border`, `--input`, `--ring` and their `-foreground` pairs) are private. They are plain custom properties so that what `shadcn add` writes still resolves. They have no utilities, so `bg-background` and `text-muted-foreground` draw nothing, and the discipline test forbids them and their `var()` forms.

### Type

Sizes in px; the repo stores them in rem (17px = 1.0625rem). Families: display `Figtree` (`font-display`); body `Atkinson Hyperlegible Next` (`font-sans`); mono `Atkinson Hyperlegible Mono` (`font-mono`), loaded through next/font variables in `app/layout.tsx`.

A role sets size, line height and weight together. Body roles are `text-*` tokens. A Tailwind text token cannot set a family, so each Figtree role also has a `type-*` recipe that adds the family; use the recipe for headings, counts and tab labels.

| Spec role                                               | Spec size / line / weight / family                 | Name in code                            | Same?                                                                                                                           |
| ------------------------------------------------------- | -------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Display XL (`.h-xl`)                                    | 34 / 1.05 / 800, -0.02em, Figtree                  | `type-display`                          | Yes                                                                                                                             |
| Heading LG (`.h-lg`, `.profile-head h1`)                | 26 / 1.15 / 750, -0.01em, Figtree                  | `type-page-title`                       | Yes, at every width                                                                                                             |
| Top bar title (`.topbar .ttl h1`)                       | 24 / 1.15 / 800, -0.01em, Figtree                  | `type-page-title`                       | No: 26 / 1.15 / 750. The role was folded into the page title in Batch 1                                                         |
| Heading MD (`.h-md`, `.sec-head h2, h3`, table caption) | 21 / 1.25 / 700, Figtree                           | `type-section-title`                    | Yes                                                                                                                             |
| Card title (`.lead-card h2, h3`, `.ticket h3`)          | 24 / 1.15 / 750, -0.01em, Figtree                  | `type-section-title`                    | No: 21 / 1.25 / 700, no letter spacing. Inside §2's "21 to 24" for a card title; the role was folded into Heading MD in Batch 1 |
| Heading SM (`.h-sm`)                                    | 19 / 1.3 / 700, Figtree                            | `type-heading-sm`                       | Yes                                                                                                                             |
| Count (`.counter .big`)                                 | 46 / 0.95 / 800, -0.03em, tabular, Figtree         | `type-count`                            | Yes (add `tabular-nums`)                                                                                                        |
| Count unit (`.counter .big small`)                      | 21 / 1 / 700, muted, Figtree                       | none                                    | No role                                                                                                                         |
| Stat number (`.stat .n`)                                | 40 / 1 / 800, -0.02em, tabular, Figtree            | none                                    | No role                                                                                                                         |
| Tab label (`.tab`)                                      | 17 / 1.1 / 600, active 800 in accent-text, Figtree | `type-tab-label`                        | Yes (the active weight is set in the component)                                                                                 |
| Body (`.app`, `.wide`)                                  | 17 / 1.5 / 400, body                               | `text-body`                             | Yes                                                                                                                             |
| Lead (`.lead`)                                          | 18 / 1.5, body                                     | `text-lead`                             | Yes                                                                                                                             |
| Button (`.btn`)                                         | 18 / 1.2 / 700, body; `xl` 19px, `sm` 17px         | `text-button`                           | Yes for the default. The 19px XL size is written by hand in `components/ui/button.tsx`; small buttons use `text-label`          |
| Row title (`.row .row-main strong`)                     | 18 / 1.3 / 700, body                               | `text-item-title`                       | Yes                                                                                                                             |
| Field label (`.field label`)                            | weight 700; size and line inherit (17 / 1.5), body | `text-label` (17 / 1.3 / 700)           | Size and weight yes; line height differs                                                                                        |
| Field text (`.input`)                                   | 18, line not specified, body                       | `text-field` (18 / 1.3 / 400)           | Size yes                                                                                                                        |
| Meta (`.meta`)                                          | 17, muted; line inherits 1.5                       | `text-meta` (17 / 1.35)                 | Size yes; line height differs. Add `text-ink-muted`                                                                             |
| Venue scope (`.venue-scope`)                            | 17 / 1.3 / 500, muted, body                        | none                                    | No role                                                                                                                         |
| Meta, times, % (mono: `.scope-label`, `.q-state`)       | 17 / 1.3 or 1.2 / 600, tabular, mono               | `text-mono` with `font-mono` (17 / 1.3) | Size and line yes; the role sets no weight                                                                                      |
| State chip (`.chip`)                                    | 17 / 1.2 / 700, body                               | `text-chip`                             | Yes                                                                                                                             |
| Complete chip (`.chip.complete`)                        | 17 / 1.2 / 800, caps, +0.06em, Figtree             | `type-stamp` beside `text-chip`         | Yes. `type-stamp` sets the lettering only; the chip gives the size                                                              |
| Complete stamp (`.stamp`)                               | 21 / 1.1 / 800, caps, +0.08em, Figtree             | none                                    | No role                                                                                                                         |
| Kicker (`.kicker`), table head                          | 17 / 1.2 (table head 1.3) / 600, body, muted       | none                                    | No role                                                                                                                         |
| Quote, reviewer's reason (`.quote`, `.reason-text`)     | 18 / 1.45 / 700, body                              | none                                    | No role                                                                                                                         |
| Brand mark (`.brand-mark`)                              | 30 / 1 / 800, -0.02em, Figtree (24px in a top bar) | none                                    | No role. The shells write the 24px wordmark by hand; first run and the error screen use `type-page-title`                       |
| Caption on a photo (`.ph-tag`)                          | 15 / 1.25 / 500, body                              | `text-caption` (15 / 1.25)              | Size and line yes; the role sets no weight                                                                                      |

`text-xs`, `text-sm` and `text-base` are Tailwind's names lifted to 17px as a guard. They are not roles and the discipline test forbids them in source.

Names that no longer exist: the seven `-touch` names (each repeated the role it was paired with), `text-body-sm` (use `text-body`; line height 1.45 became 1.5), `text-meta-strong` (use `text-label`), `text-count-sm`, `text-card-title`, `text-page-title-compact`, `font-heading` and the `wdth-*` utilities.

Three of these changed what a screen draws, and are the type changes of Batch 1: seven card titles went from 24 / 1.15 / 750 to 21 / 1.25 / 700; nine headings (the sign-in title, the Naba-Lens wordmark on first run, on its loading screen and on the error screen, the task and profile names, and three in the dev preview) went from 24 to 26; and each place that used `text-body-sm` gained 0.05 of line height.

### Radius, edges, elevation, motion, sizes

| Spec token and value                                                                                                                                                | Name in code and value                                                                                                                                                                      | Same?                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `--r-ctl` 8px (control: button, field)                                                                                                                              | `--radius-control` 0.5rem, `rounded-control`                                                                                                                                                | Yes                                                   |
| `--r-card` 12px (card, post, row)                                                                                                                                   | `--radius-card` 0.75rem, `rounded-card`                                                                                                                                                     | Yes                                                   |
| `--r-sheet` 16px (sheet top, dialog)                                                                                                                                | `--radius-sheet` 1rem, `rounded-sheet`                                                                                                                                                      | Yes                                                   |
| `--r-square` 4px (square state)                                                                                                                                     | `--radius-square` 0.25rem, `rounded-square`                                                                                                                                                 | Yes                                                   |
| `--r-stamp` 2px (stamp)                                                                                                                                             | `--radius-stamp` 2px, `rounded-stamp`                                                                                                                                                       | Yes                                                   |
| Pills: literal `999px` (no token)                                                                                                                                   | `--radius-round` 9999px, `rounded-round`                                                                                                                                                    | Same effect, different literal                        |
| Field and grey control boundary: 1px border-strong                                                                                                                  | `edge-strong` (1px inset); also `edge` (1px `line`), `edge-selected` (1.5px accent-text), `edge-invalid` (2px warn-fg), `edge-accent` (the primary button) and `ring-selected` (3px select) | Yes. Edges are drawn inside the box and take no space |
| Tone bar on a card or notice: 4px                                                                                                                                   | `rail-start-ok`, `rail-start-warn`, `rail-start-info`; along the top of a lead card `rail-top-ok`, `rail-top-warn`, `rail-top-info`                                                         | Yes                                                   |
| Focus outline: 3px solid focus, 2px offset, 6px radius (offset -3px inside lists, posts and the lead card)                                                          | `focus-ring` (3px, 2px offset), `focus-ring-inset` (-3px offset), `focus-ring-within` (a wrapper whose child holds focus). The base layer gives every outline the full focus colour         | Width, colour and offset yes; no radius               |
| `--shadow` light `0 1px 2px oklch(0.2 0.01 250 / .12), 0 0 0 1px oklch(0.2 0.01 250 / .04)`; dark `0 0 0 1px oklch(1 0 0 / .06)`                                    | `--elevation-card`, used as `shadow-card`                                                                                                                                                   | Yes                                                   |
| `--shadow-lg` light `0 12px 28px oklch(0.2 0.01 250 / .18), 0 2px 4px oklch(0.2 0.01 250 / .1)`; dark `0 12px 28px oklch(0 0 0 / .5), 0 0 0 1px oklch(1 0 0 / .08)` | `--elevation-float`, used as `shadow-float`                                                                                                                                                 | Yes                                                   |
| not specified                                                                                                                                                       | `--elevation-control`, used as `shadow-control`: a raised segment or switch thumb                                                                                                           | Repo only                                             |
| not specified                                                                                                                                                       | `--elevation-bar`, used as `shadow-bar`: the hairline above a bottom bar                                                                                                                    | Repo only                                             |
| `--ease` `cubic-bezier(.22,1,.36,1)`                                                                                                                                | `--ease-out`, used as `ease-out`; also the default for a bare `transition-*` utility                                                                                                        | Yes                                                   |
| Sheet rise and drawer slide: 260ms, from 24px offset and 40% opacity                                                                                                | `--transition-duration-sheet` 260ms, `duration-sheet`                                                                                                                                       | Yes (duration)                                        |
| Dialog fade: 200ms                                                                                                                                                  | none                                                                                                                                                                                        | No token                                              |
| Hover (button background): 150ms                                                                                                                                    | `--transition-duration-quick` 150ms, `duration-quick`; also the default for a bare `transition-*` utility                                                                                   | Yes                                                   |
| Press: 1px down, transform 100ms                                                                                                                                    | none                                                                                                                                                                                        | No token                                              |
| not specified                                                                                                                                                       | `--transition-duration-move` 180ms, `duration-move` (disclosure, reorder)                                                                                                                   | Repo only                                             |
| Reduced motion: `transition: none`, `animation: none`, `scroll-behavior: auto`, no press movement                                                                   | Animation and transition durations forced to 0s, one iteration                                                                                                                              | Same intent                                           |
| `--gutter` 12px (feed gutter and card gap)                                                                                                                          | `--spacing-gutter` 0.75rem, `gap-gutter`; `--spacing-page-gutter` 0.75rem, `px-page-gutter` (full bleed is `-mx-page-gutter`)                                                               | Yes                                                   |
| Tab 60px high                                                                                                                                                       | `--spacing-tabbar` 4rem, `min-h-tabbar`                                                                                                                                                     | No: 64px, the tab's 60px plus 4px                     |
| Dialog width 560px (`--dw` default)                                                                                                                                 | `--container-dialog` 35rem, `max-w-dialog`                                                                                                                                                  | Yes                                                   |
| Target 44px, button 52px, XL button 60px, small button 44px, field 56px, row 64px, icon button 48px, stepper button 48px, chip 32px                                 | none (set per component)                                                                                                                                                                    | No token                                              |
| Drawer 480px (`--drw` default), side nav 264px, phone dialog 358px                                                                                                  | none                                                                                                                                                                                        | No token                                              |
| not specified                                                                                                                                                       | Page widths `max-w-feed` 37.5rem, `max-w-reading` 40rem, `max-w-page` 75rem, `max-w-dialog-wide` 47.5rem; the narrowest photo tile `--spacing-tile-min` 10rem, with `grid-cols-tiles`       | Repo only                                             |
| not specified                                                                                                                                                       | Container-query sizes `compact` 32.5rem, `regular` 36rem, `wide` 40rem (`@compact:`, `@max-compact:`)                                                                                       | Repo only                                             |
| not specified                                                                                                                                                       | Layers, lowest first: `z-local` 10, `z-sticky` 20, `z-dock` 30, `z-nav` 40, `z-overlay` 50                                                                                                  | Repo only                                             |
| not specified                                                                                                                                                       | Safe areas: `body` pads for the notch at the sides; `w-safe` keeps a fixed sheet or dialog clear of it; bottom bars add `env(safe-area-inset-bottom)`                                       | Repo only                                             |

Names that no longer exist: the radius aliases `panel`, `touch`, `chip` and `print`; the overrides of Tailwind's `rounded-sm` to `rounded-4xl` (the stock steps are forbidden in source); `shadow-overlay` and `shadow-sheet`; `--gutter`, `--page-gutter`, `--size-*` and `--duration-*` (each now has a utility, so the `gap-(--gutter)` form is gone); and `--ease-in`.

## 11. Rules every screen meets

A review checklist. It restates §1 to §8 as ten rules a screen either meets or does not.

1. Home shows goals, not tasks: a retake note when one exists, then Our menu with what is still needed, then Your month, then Other jobs when there are any, then colleague photos as posts (§5a). It has one main action: Reshoot, else the first Still needed dish, else Open camera. No assignment, due date or Overdue for food and drink work. No likes, comments, reactions, stories, leaderboards, scores or comparisons between staff.
2. Exactly one solid blue primary button per screen (in the lead card, the action dock or a form). Everything else is a grey (secondary) button, a ghost button, a danger button or a link. Light blue is only for the active tab; accent-soft is only for a selected filter, segment or side nav item.
3. Four states are distinct by word, shape and tone: Ready, Accepted, COMPLETE and Needs setup, each drawn as its state chip. Needs another photo always shows its reason.
4. Words: Submitted, Accepted, Needs another photo, Closed. Upload states: Waiting, Uploading 42%, Processing, Uploaded, Failed, Cancelled. Never Approved, Rejected, Pending approval, Done, Published or Live, as whole words anywhere on a screen, so no "Done" button either.
5. Every venue-specific screen names the venue (in the top bar, in the side nav on wide screens, or in the page head's scope line). Managers act only on their own venue. Self-review is allowed and always flagged, with the Self-review chip and an info notice.
6. Staff and manager screens never show email addresses, original file names or "Download original". Those appear on admin screens only.
7. Overdue never blocks sending, and only service, venue-specific and amenity work can be Overdue. Food and drink work has no due date, and a needed by date is never shown as late. Not applicable stays visible and is not counted. Videos do not count toward a dish, a month or a task. Uploading is not publishing; a label is not allergen information.
8. British English, sentence case, digits and correct plurals. Dates read "2 Nov 2026", "2 Nov 2026, 14:06", "Needed by 30 Nov" ("Due 30 Nov 2026" on non-menu work only). Staff copy for food and drink work never says task, due, overdue or better photo. Errors say what happened, then what to do. No emoji, no exclamation marks, no celebration, no invented statistics.
9. Text is 17px or larger (the device status bar and 15px photo captions excepted). Targets are 44px or larger. Main buttons are 52 to 60px (60px on phones). Labels sit under icons. Controls are real links and buttons. Dialogs use the shared sheet, dialog and drawer components. Status changes use `role="status"` or `aria-live`. Nothing is swipe-only or long-press-only; nothing moves on its own. No horizontal scroll at 320px: test every dense screen at 320px wide.
10. Prototype photos are drawn stand-ins only. No other company's logo, colour or icon set.

Rule 4's ban on a "Done" button is decision D5. Rules 1, 7 and 8 follow NabaLens v0.5 since 0.4.

### How the rules are checked

The prototype folder had a script that tested every frame. The table lists each of its checks and what tests the same thing in this repo today.

| Check                   | What it tests and the threshold                                                                                                                                                                         | Repo equivalent                                                                                                                                                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Console and page errors | Any console message of type error, any uncaught page error, or a failed page load                                                                                                                       | None general. `tests/e2e/security-headers.spec.ts` listens to the console for Content Security Policy messages only                                                                                                                                                                                                          |
| Failed frames           | A frame whose screen function threw (a red `pre` holding the error)                                                                                                                                     | None (prototype only)                                                                                                                                                                                                                                                                                                        |
| Goal words (0.4)        | Staff copy for food and drink work says no task, due, overdue or better photo                                                                                                                           | `tests/unit/staff-copy-guard.test.ts` reads the string literals and JSX text of staff Home, `/staff/menu`, month, welcome, Me and `menu-photos`. Non-menu task screens are on its allow-list; files still being rebuilt are on a pending list that only shrinks                                                              |
| Banned words            | Frame text contains Approved, Rejected, Pending approval, Done, Published or Live as a whole word (case sensitive)                                                                                      | None for on-screen copy. `tests/unit/scope-guard.test.ts` bans approval-workflow terms (`/approv/i`) and other out-of-scope features in application source, not these six words in rendered text                                                                                                                             |
| Text under 17px         | Computed font size below 17px on any visible text node; skips `.status-bar`, `[aria-hidden="true"]`, `.ph`, `.ph-tag`, `.ph-state`, `.ph-video`, `.sr-only`, `.visually-hidden`                         | None found in `tests/`                                                                                                                                                                                                                                                                                                       |
| Targets under 44px      | `a, button, input, select, textarea, [role=button], [tabindex="0"]` with width or height below 44px; skips hidden and `aria-hidden` elements, checkboxes, radios and `.link-inline`                     | `tests/e2e/visual.spec.ts` (`smallTouchTargets`, 44 × 44 CSS px at phone widths, 480px and under; run by `pnpm test:visual`). Single-control height checks in `tests/e2e/better-photo.spec.ts`, `tests/e2e/staff-accounts.spec.ts`, `tests/e2e/menus-responsive.spec.ts`                                                     |
| Overflow at 320px       | In frames 330px wide or less, the scroll area's `scrollWidth` exceeds `clientWidth` by more than 1px                                                                                                    | `tests/e2e/reflow.spec.ts` (320 × 640 and 640 × 400) using `tests/e2e/helpers/overflow.ts`; also `tests/e2e/visual.spec.ts` at 360px and wider                                                                                                                                                                               |
| Staff leaks             | In non-admin frames: an email address (other than `name@example.com`), a file name ending `jpg, jpeg, png, heic, mov, mp4`, or the words "Download original" (file name and phrase matched in any case) | Per component, not across every screen: `tests/ui/people.test.tsx` (no `@`, `.jpg` or "Download original"), `tests/ui/media-viewer-colleague.test.tsx` (file names in the viewer), `tests/ui/library-gallery.test.tsx` (no file name in dialogs), `tests/ui/components.test.tsx` (no file name, no "Download original" link) |

Not checked anywhere yet: the banned words in rendered copy, the 17px floor, and one primary per screen. These are tasks DS-101 and DS-405 in [strategy.md](strategy.md).

## 12. Component values

[components.md](components.md) gives one table per component in §4: each property, the value this spec sets, the value the product ships, and whether they agree. Use it when building or changing a component. Where the two columns differ, the difference is either listed in [departures.md](departures.md) or is a defect.

## 13. Sources and history

### Superseded sources

Do not take tokens or rules from these. They are history.

| Source                                                          | What it was                                                                                                                                                                                                                       | Superseded by                                                                                      |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `research/naba-lens-common-room-2026-11-07/` (outside the repo) | The folder this spec was written in: `DESIGN.md` v0.3, the prototype CSS (`pass-rail.css`, `common-room.css`), `CONTRACT.md`, prototype screens, `rationale.html` and a checker script. Some of its files are still labelled v0.2 | This folder. Its open departures were carried into [departures.md](departures.md)                  |
| Pass Rail (`DESIGN-v1-pass-rail.md`, same folder)               | Version 1 of the design language                                                                                                                                                                                                  | Common Room v0.2, 7 Nov 2026                                                                       |
| The claude.ai "Naba-Lens" Design System artifact (2 Nov 2026)   | The token set and brand book that PR #14 was built from (Archivo and Besley)                                                                                                                                                      | Common Room, PR #20                                                                                |
| The Home prototype canvases (2 Nov and 9 Nov 2026)              | Explorations of the staff Home page. The 9 Nov canvas proposed a photo-first order that differed from §5, used real dish photos and drew chips in shapes §3 reserves                                                              | §5a (0.3.2), drawn on the "v3 · Spec v0.3.1" page of the 9 Nov canvas. Pages v1 and v2 are history |

### Changelog

- **0.4 · 15 Nov 2026.** Goals, not tasks (NabaLens v0.5; `docs/plans/goals-not-tasks.md` G-5). §3: Accepted counts toward a dish, a month or a checklist item; tasks, due dates and Overdue are for service, venue-specific and amenity work only; new goal words Still needed, Waiting for review (Submitted's shape), Being checked (Menu changed's shape) and Needed by / Needed (meta text, never a chip); task, due, overdue and better photo banned from staff food and drink copy. §4: the month roll is Progress segments with four frame states; the share box leaves Home. §5: Home shows goals in a new order, with one main action; the task thread is for non-menu work. §5a rewritten: setup notice, retake note with Later, Our menu with up to four Still needed rows, Your month, Other jobs, From the team. §6: the goal words, and "Needed by 30 Nov" in place of "Due 30 Nov 2026". §11 rules 1, 7 and 8 follow, and the goal words are checked by `staff-copy-guard.test.ts`. Code may cite "§5a". No token changed.

- **0.3.2 · 14 Nov 2026.** Added §5a Home (staff): the order, the lead card table and what each block says. §5's Home line now names Our menu and the "your month" lead, and points to §5a; rule 1 in §11 follows. No token changed.
- **0.3.1, Batch 1 · 14 Nov 2026.** §10 rewritten to the names that shipped with the Batch 1 foundations (decision D7). No rule in §1 to §9 changed. Two values now differ from §2 and are recorded in §10: the dark `--border-strong` is lighter, and the primary button has a 1px edge in dark.
- **0.3.1 · 14 Nov 2026.** Moved into the repo. No rule changed. The header now points at in-repo sources; §10 to §13 added (names in code, rules every screen meets, component values, sources). Component values were read out of the two prototype stylesheets into [components.md](components.md) so the spec no longer depends on files outside git.
- **0.3 · 7 Nov 2026.** See §9.
