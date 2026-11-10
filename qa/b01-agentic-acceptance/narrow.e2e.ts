import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { db, NO_HORIZONTAL_OVERFLOW, QUESTION, sessionCookies, world, type PilotKey } from './fixture';

// The same knowledge path at 390x844 (target phone-390): staff B at venue B
// answers Are there customer toilets? with the sticky submit dock. Venue B's
// step-free question belongs to the journey suite's self-confirmation.

test('390px: staff B sees the four questions and sends a finding from the sticky dock', async ({ app, browser, screen, agent }) => {
  const w = world();
  const check = w.checks.B.guest_toilets;
  await browser.setCookies(await sessionCookies(w.staffB.email));
  await app.open('/staff/tasks');
  const list = screen.getByRole('list', 'Amenity checks');
  await expect(list.getByRole('listitem')).toHaveCount(4);
  for (const key of Object.keys(QUESTION) as PilotKey[]) {
    await expect(list.getByRole('link', new RegExp(`: ${QUESTION[key].replace(/[?]/g, '\\?')}$`))).toBeAttached();
  }
  expect(await browser.evaluate(NO_HORIZONTAL_OVERFLOW)).toBe(true);
  await app.screenshot('390-home-working-list');
  await agent.assert(
    'The "Amenity checks" cards fit the narrow phone screen: no text is cut off or overlapping, and each card shows its question and status in readable text.',
    { vision: true },
  );

  await list.getByRole('link', `Answer this: ${QUESTION.guest_toilets}`).tap();
  await expect(screen.getByRole('heading', QUESTION.guest_toilets, { level: 1 })).toBeVisible();
  await screen.getByRole('radio', 'No').check();
  await screen.getByLabel('Reason').fill(`DEV FIXTURE no customer toilets (B01 acceptance ${w.tag})`);
  const submit = screen.getByRole('button', 'Submit finding');
  await expect(submit).toBeVisible();
  expect(await browser.evaluate(NO_HORIZONTAL_OVERFLOW)).toBe(true);
  await app.screenshot('390-capture-before-send');
  await submit.tap();
  await expect(screen.getByText('Finding sent. It\'s now the venue\'s answer.')).toBeVisible();
  expect(await browser.evaluate(NO_HORIZONTAL_OVERFLOW)).toBe(true);
  await app.screenshot('390-capture-sent');

  expect(db.submissions(check)).toEqual([{ answer: 'no', by: w.staffB.id }]);
  expect(db.slot(w.venueB.id, 'guest_toilets')).toMatchObject({ status: 'available', value: 'no', source_basis: 'staff' });
});
