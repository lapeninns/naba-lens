# DecisionBar

The manager’s actions on the photo being reviewed, fixed to the bottom of the review screen.

- Order is fixed: **Approve for public use** (the one primary), Fix label, Keep as reference, Ask for another photo, then More (Mark duplicate, Archive, Select as main photo).
- “Ask for another photo” opens a `Sheet` of retake reasons as `PickChip`s plus an optional note. The reasons are: Whole item not visible, Not enough light, Out of focus, Not how we serve it now, Route not shown, Background not suitable for public use.
- “Fix label” is its own action because a wrong label is not a bad photo. Fixing a label and approving can be done in one step.
- For a batch, the bar shows the count (“Approve 4 for public use”) and the action opens a confirmation `Sheet` that shows exactly those thumbnails.
- If someone else has decided meanwhile, replace the bar with an attention `Notice` showing their decision and a “Review again” button.
- You provide: the handlers, the selected count and whether each action is permitted. Hide actions the person may not take; don’t show them disabled.
