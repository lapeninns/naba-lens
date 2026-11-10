import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { db, longDate, periodMonth, QUESTION, sessionCookies, world, type Person, type PilotKey } from './fixture';

// B01-07 knowledge path, desktop (1280x800), one serial story on venue A
// plus the self-confirmation on venue B. Each member signs in as the person
// it needs; app.clearState() drops the previous person's session first.
// Exact assertions pin every critical outcome on screen and in the database;
// the one agent.act (the straightforward answer) is checked right after.

type App = { clearState(): Promise<void>; open(path?: string): Promise<void> };
type Cookies = { setCookies(cookies: Awaited<ReturnType<typeof sessionCookies>>): Promise<void> };

async function signInAs(app: App, browser: Cookies, who: Person) {
  await app.clearState();
  await browser.setCookies(await sessionCookies(who.email));
}

const capturePath = (checkId: string) => `/staff/tasks/amenities/${checkId}`;
const reason = (what: string) => `DEV FIXTURE ${what} (B01 acceptance ${world().tag})`;

describe('B01 knowledge path on the enabled working list', { serial: true }, () => {
  test('staff A sees the four questions on the working list, unassigned', async ({ app, browser, screen }) => {
    const w = world();
    await signInAs(app, browser, w.staffA);
    await app.open('/staff/tasks');
    await expect(screen.getByRole('heading', 'Amenity checks', { level: 2 })).toBeVisible();
    await expect(
      screen.getByText(`Questions about ${w.venueA.name}. Anyone working here can help answer them.`),
    ).toBeVisible();
    const list = screen.getByRole('list', 'Amenity checks');
    await expect(list.getByRole('listitem')).toHaveCount(4);
    for (const key of Object.keys(QUESTION) as PilotKey[]) {
      await expect(list.getByRole('link', `Answer this: ${QUESTION[key]}`)).toBeVisible();
    }
    const row = (key: PilotKey) => list.getByRole('listitem').filter({ hasText: QUESTION[key] });
    await expect(row('onsite_parking').getByText('No one is assigned. What you send becomes the answer.')).toBeVisible();
    await expect(row('step_free_entrance').getByText('No one is assigned. Your manager confirms answers to this one.')).toBeVisible();
  });

  test('a saved Couldn\'t-establish draft is not sent until staff A sends it, and earns no credit', async ({ app, browser, screen }) => {
    const w = world();
    const check = w.checks.A.onsite_parking;
    const tried = reason('asked the duty manager; the car park sign was covered');
    await signInAs(app, browser, w.staffA);
    await app.open(capturePath(check));
    await expect(screen.getByRole('heading', QUESTION.onsite_parking, { level: 1 })).toBeVisible();
    await expect(
      screen.getByText('No one needs to confirm this question. What you send becomes the venue\'s answer straight away.'),
    ).toBeVisible();
    await screen.getByRole('radio', 'Couldn\'t establish').check();
    await screen.getByRole('radio', 'No one could say for sure').check();
    await screen.getByLabel('What did you try?').fill(tried);

    // Saved: on the account only, nothing sent.
    await screen.getByRole('button', 'Save for later').tap();
    await expect(screen.getByText('Saved for later. Not sent yet. Finish it from Home or Me.')).toBeVisible();
    expect(db.drafts(check)).toBe(1);
    expect(db.contributions(check)).toEqual([]);
    await app.open('/staff/tasks');
    const home = screen.getByRole('list', 'Amenity checks');
    const homeRow = home.getByRole('listitem').filter({ hasText: QUESTION.onsite_parking });
    await expect(homeRow.getByText(/^Not sent yet\. Saved \d{1,2} [A-Z][a-z]{2,3} \d{4}, \d{2}:\d{2}\.$/)).toBeVisible();
    await app.open('/staff');
    const mine = screen.getByRole('list', 'Your findings');
    const meRow = mine.getByRole('listitem').filter({ hasText: QUESTION.onsite_parking });
    await expect(meRow.getByText('Not sent yet. Only you can see it.')).toBeVisible();
    await expect(meRow.getByRole('link', `Finish: ${QUESTION.onsite_parking}`)).toBeVisible();

    // Finished from Home: the saved answer comes back, then it is sent.
    await app.open('/staff/tasks');
    await home.getByRole('link', `Finish: ${QUESTION.onsite_parking}`).tap();
    await expect(screen.getByRole('heading', QUESTION.onsite_parking, { level: 1 })).toBeVisible();
    await expect(screen.getByText(/^You saved this on .+\. It hasn't been sent\.$/)).toBeVisible();
    await expect(screen.getByRole('radio', 'Couldn\'t establish')).toBeChecked();
    await expect(screen.getByRole('radio', 'No one could say for sure')).toBeChecked();
    await expect(screen.getByLabel('What did you try?')).toHaveValue(tried);
    await screen.getByRole('button', 'Submit finding').tap();
    await expect(screen.getByText('Recorded: couldn\'t establish. The question stays open.')).toBeVisible();
    await expect(screen.getByText('Couldn\'t-establish findings don\'t count toward targets.')).toBeVisible();

    // Sent: recorded, never adopted, never a submission (no credit).
    expect(db.drafts(check)).toBe(0);
    expect(db.contributions(check)).toEqual([{ by: w.staffA.id, kind: 'finding', answer: 'unknown', outcome: 'recorded' }]);
    expect(db.submissions(check)).toEqual([]);
    expect(db.slot(w.venueA.id, 'onsite_parking')).toMatchObject({
      status: 'unavailable',
      reason: 'unknown',
      detail: 'unable_to_establish',
      current_submission_id: null,
    });
    await app.open('/staff/tasks');
    await expect(
      home.getByRole('listitem').filter({ hasText: QUESTION.onsite_parking }).getByText(
        'To check. Last try: couldn\'t establish (no one could say for sure). No one is assigned. What you send becomes the answer.',
      ),
    ).toBeVisible();
  });

  test('a straightforward No from staff A is the venue\'s current answer at once (agent.act)', async ({ app, browser, screen, agent }) => {
    const w = world();
    const check = w.checks.A.guest_toilets;
    const why = reason('no customer toilets on site');
    await signInAs(app, browser, w.staffA);
    await app.open(capturePath(check));
    await expect(screen.getByRole('heading', QUESTION.guest_toilets, { level: 1 })).toBeVisible();
    await expect(screen.getByText('This becomes the venue\'s answer when you send it.')).toBeVisible();

    await agent.act('Answer this question with No, type {reason} in the Reason box, then press "Submit finding".', {
      params: { reason: why },
    });
    await expect(screen.getByText('Finding sent. It\'s now the venue\'s answer.')).toBeVisible();
    await expect(screen.getByText(`Counted in your ${periodMonth(w.targetPeriod)} target.`)).toBeVisible();

    expect(db.contributions(check)).toEqual([{ by: w.staffA.id, kind: 'finding', answer: 'no', outcome: 'current' }]);
    expect(db.submissions(check)).toEqual([{ answer: 'no', by: w.staffA.id }]);
    const slot = db.slot(w.venueA.id, 'guest_toilets');
    expect(slot).toMatchObject({ status: 'available', value: 'no', source_basis: 'staff', confirmation_state: 'not_required', reason_text: why });

    await app.open('/staff/tasks');
    const row = screen.getByRole('list', 'Amenity checks').getByRole('listitem').filter({ hasText: QUESTION.guest_toilets });
    await expect(row.getByRole('link', `Report a change: ${QUESTION.guest_toilets}`)).toBeVisible();
    await expect(row.getByText(`Current answer: No. Recorded ${longDate(String(slot.saved_at))}.`)).toBeVisible();
  });

  test('a sensitive step-free claim from staff A waits for manager confirmation', async ({ app, browser, screen }) => {
    const w = world();
    const check = w.checks.A.step_free_entrance;
    await signInAs(app, browser, w.staffA);
    await app.open(capturePath(check));
    await expect(screen.getByRole('heading', QUESTION.step_free_entrance, { level: 1 })).toBeVisible();
    await expect(screen.getByText('Your manager confirms answers to this question before they\'re used.')).toBeVisible();
    await expect(screen.getByText('Your manager confirms this before it\'s used.')).toBeVisible();
    await screen.getByRole('radio', 'No').check();
    await screen.getByLabel('Reason').fill(reason('two steps at every entrance'));
    await screen.getByRole('button', 'Submit finding').tap();
    await expect(screen.getByText('Finding sent. Your manager confirms it before it\'s used.')).toBeVisible();

    expect(db.contributions(check)).toEqual([{ by: w.staffA.id, kind: 'finding', answer: 'no', outcome: 'awaiting_confirmation' }]);
    expect(db.submissions(check)).toEqual([]);
    expect(db.slot(w.venueA.id, 'step_free_entrance')).toMatchObject({
      status: 'unavailable',
      reason: 'not_confirmed',
      detail: 'pending',
      value: null,
    });
    await app.open('/staff/tasks');
    const row = screen.getByRole('list', 'Amenity checks').getByRole('listitem').filter({ hasText: QUESTION.step_free_entrance });
    await expect(row.getByText('You sent a finding. Your manager confirms it before it\'s used.')).toBeVisible();
    await expect(row.getByRole('link', `View: ${QUESTION.step_free_entrance}`)).toBeVisible();
  });

  test('venue manager A confirms the step-free claim', async ({ app, browser, screen }) => {
    const w = world();
    const check = w.checks.A.step_free_entrance;
    await signInAs(app, browser, w.managerA);
    await app.open(`/manager/amenities/${check}`);
    const toConfirm = screen.getByRole('region', /^To confirm/);
    await expect(toConfirm.getByText('Readers are told it\'s awaiting confirmation.')).toBeVisible();
    const card = toConfirm.getByRole('listitem', `Finding from ${w.staffA.name}`);
    await expect(card).toBeVisible();
    await card.getByRole('button', 'Confirm').tap();
    await expect(screen.getByText(`Confirmed. This is now the answer for ${w.venueA.name}.`)).toBeVisible();

    expect(db.submissions(check)).toEqual([{ answer: 'no', by: w.staffA.id }]);
    expect(db.slot(w.venueA.id, 'step_free_entrance')).toMatchObject({
      status: 'available',
      value: 'no',
      confirmation_state: 'confirmed',
      confirmation_basis: 'venue_manager',
      confirmation_self: false,
    });
  });

  test('staff A2 reports a conflicting change and the manager keeps the answer in use', async ({ app, browser, screen }) => {
    const w = world();
    const check = w.checks.A.guest_toilets;
    const changed = reason('a portable toilet was added for events');
    const notNow = reason('the portable toilet is not for customers');
    await signInAs(app, browser, w.staffA2);
    await app.open('/staff/tasks');
    const list = screen.getByRole('list', 'Amenity checks');
    await list.getByRole('link', `Report a change: ${QUESTION.guest_toilets}`).tap();
    await expect(screen.getByRole('heading', QUESTION.guest_toilets, { level: 1 })).toBeVisible();
    await expect(
      screen.getByText(/^Current answer: No, recorded .+\. If you send a different answer, it's marked as being checked until your manager decides\./),
    ).toBeVisible();
    await screen.getByLabel('What changed?').fill(changed);
    await screen.getByRole('radio', 'Not applicable').check();
    await screen.getByLabel('Reason').fill(changed);
    await screen.getByRole('button', 'Send change report').tap();
    await expect(
      screen.getByText('Change report sent. Until your manager decides, the recorded answer is marked as being checked.'),
    ).toBeVisible();
    expect(db.slot(w.venueA.id, 'guest_toilets')).toMatchObject({ status: 'unavailable', reason: 'disputed', detail: 'conflict', open_dispute: true });
    await app.open('/staff/tasks');
    await expect(
      list.getByRole('listitem').filter({ hasText: QUESTION.guest_toilets }).getByText('Recorded answer: No. Being checked: a finding disagrees with it.'),
    ).toBeVisible();

    await signInAs(app, browser, w.managerA);
    await app.open(`/manager/amenities/${check}`);
    const toConfirm = screen.getByRole('region', /^To confirm/);
    await expect(
      toConfirm.getByText(
        'While this is undecided, readers are told the answer is being checked. Confirm the change, keep the answer in use, or reopen the question.',
      ),
    ).toBeVisible();
    const card = toConfirm.getByRole('listitem', `Change report from ${w.staffA2.name}`);
    await card.getByRole('button', 'Keep the answer in use').tap();
    const dialog = screen.getByRole('dialog');
    await expect(dialog).toHaveAccessibleName('Keep the answer in use?');
    await dialog.getByLabel('Why not?').fill(notNow);
    await dialog.getByRole('button', 'Keep the answer in use').tap();
    await expect(screen.getByRole('dialog')).toHaveCount(0);
    await expect(screen.getByText(/^Not confirmed\. .+ will see why\.$/)).toBeVisible();

    expect(db.submissions(check)).toEqual([{ answer: 'no', by: w.staffA.id }]);
    expect(db.slot(w.venueA.id, 'guest_toilets')).toMatchObject({ status: 'available', value: 'no', open_dispute: false });
    expect(db.contributions(check).map((c) => [c.by, c.kind, c.answer])).toEqual([
      [w.staffA.id, 'finding', 'no'],
      [w.staffA2.id, 'change_report', 'not_applicable'],
    ]);
  });

  test('staff A and A2 each see their own findings history', async ({ app, browser, screen }) => {
    const w = world();
    const month = periodMonth(w.targetPeriod);
    await signInAs(app, browser, w.staffA);
    await app.open('/staff');
    const mine = screen.getByRole('list', 'Your findings');
    await expect(mine.getByRole('listitem')).toHaveCount(3);
    const row = (key: PilotKey) => mine.getByRole('listitem').filter({ hasText: QUESTION[key] });
    for (const key of ['guest_toilets', 'step_free_entrance'] as const) {
      await expect(row(key).getByText('Answer: No')).toBeVisible();
      await expect(row(key).getByText('In use as the venue\'s answer.')).toBeVisible();
      await expect(row(key).getByText(`Counted in your ${month} target.`)).toBeVisible();
    }
    await expect(row('onsite_parking').getByText('Answer: Couldn\'t establish')).toBeVisible();
    await expect(row('onsite_parking').getByText('Recorded as Couldn\'t establish. The question stays open.')).toBeVisible();
    await expect(row('onsite_parking').getByText('Couldn\'t-establish findings don\'t count toward targets.')).toBeVisible();
    await expect(mine.getByText('Not sent yet. Only you can see it.')).toHaveCount(0);

    await signInAs(app, browser, w.staffA2);
    await app.open('/staff');
    const theirs = screen.getByRole('list', 'Your findings');
    await expect(theirs.getByRole('listitem')).toHaveCount(1);
    const report = theirs.getByRole('listitem').filter({ hasText: QUESTION.guest_toilets });
    await expect(report.getByText('Answer: Not applicable')).toBeVisible();
    await expect(report.getByText(`Your manager didn't use this: ${reason('the portable toilet is not for customers')}`)).toBeVisible();
    await expect(theirs.getByText(QUESTION.onsite_parking)).toHaveCount(0);
  });

  test('venue manager B explicitly confirms their own step-free finding', async ({ app, browser, screen }) => {
    const w = world();
    const check = w.checks.B.step_free_entrance;
    await signInAs(app, browser, w.managerB);
    await app.open(`/manager/amenities/${check}/capture`);
    await expect(screen.getByRole('heading', QUESTION.step_free_entrance, { level: 1 })).toBeVisible();
    await expect(
      screen.getByText('Answers to this question need confirming. You can confirm your own, or leave it for another manager or an admin.'),
    ).toBeVisible();
    await expect(screen.getByRole('radio', 'Leave it for another manager or an admin')).toBeVisible();
    await screen.getByRole('radio', 'No').check();
    await screen.getByLabel('Reason').fill(reason('a step at the only entrance'));
    await screen.getByRole('radio', 'I confirm it now').check();
    await screen.getByRole('button', 'Submit and confirm').tap();
    await expect(screen.getByText('Finding sent and confirmed by you. It\'s now the venue\'s answer.')).toBeVisible();

    expect(db.contributions(check)).toEqual([{ by: w.managerB.id, kind: 'finding', answer: 'no', outcome: 'current' }]);
    expect(db.slot(w.venueB.id, 'step_free_entrance')).toMatchObject({
      status: 'available',
      value: 'no',
      source_basis: 'venue_manager',
      confirmation_state: 'confirmed',
      confirmation_self: true,
    });
  });
});
