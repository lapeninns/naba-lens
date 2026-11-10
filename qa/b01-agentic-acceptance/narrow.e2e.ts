import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

import {
  CARD_GEOMETRY,
  CONTROL_IN_VIEW,
  db,
  NO_HORIZONTAL_OVERFLOW,
  QUESTION,
  sessionCookies,
  world,
  type CardGeometry,
  type ControlInView,
  type PilotKey,
} from './fixture';
import { expectSentOnHome } from './home';

// The same knowledge path at 390x844 (target phone-390): staff B at venue B
// answers Are there customer toilets? with the sticky submit dock. Venue B's
// step-free question belongs to the journey suite's self-confirmation.
// Screenshots show the viewport only, so each vision judgment names just the
// cards measured wholly on screen and clear of the tab bar when it runs; the
// passes between them cover all four cards.

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

  // Every card, wherever it is on the page: inside the list and the screen's
  // width, nothing reaching outside it, no text wider than its box.
  const questions = Object.values(QUESTION) as string[];
  const all = await browser.evaluate<CardGeometry[], { questions: string[]; alignTo: null }>(CARD_GEOMETRY, {
    questions,
    alignTo: null,
  });
  expect(all.map(({ question, fitsWidth, escapes, clipped }) => ({ question, fitsWidth, escapes, clipped }))).toEqual(
    questions.map((question) => ({ question, fitsWidth: true, escapes: [], clipped: [] })),
  );

  // Then a screenful at a time, from the top card down: scroll the next
  // unjudged card into the viewport, check it is wholly on screen and clear of
  // fixed chrome, and ask about the cards that are.
  const order = [...all].sort((a, b) => a.top - b.top).map((card) => card.question);
  const judged: string[] = [];
  for (let pass = 1; judged.length < order.length; pass++) {
    if (pass > order.length) throw new Error(`Cards not judged after ${order.length} passes: ${order.filter((q) => !judged.includes(q)).join(', ')}`);
    const next = order.find((question) => !judged.includes(question))!;
    const view = await browser.evaluate<CardGeometry[], { questions: string[]; alignTo: string }>(CARD_GEOMETRY, {
      questions: order,
      alignTo: next,
    });
    const lead = view.find((card) => card.question === next)!;
    expect({ question: lead.question, onScreen: lead.onScreen, coveredBy: lead.coveredBy }).toEqual({
      question: next,
      onScreen: true,
      coveredBy: [],
    });
    await expect(list.getByRole('listitem').filter({ hasText: next })).toBeVisible();
    const shown = view
      .filter((card) => !judged.includes(card.question) && card.onScreen && card.coveredBy.length === 0)
      .map((card) => card.question);
    await app.screenshot(`390-home-cards-${pass}`);
    await agent.assert(
      `This screenshot shows these "Amenity checks" cards in full: ${shown.map((q) => `"${q}"`).join(', ')}. ` +
        'Each of those cards fits the narrow phone screen: its question and its status are readable, and none of its text is cut off, clipped at an edge, overlapping other text, or hidden under the bottom tab bar. ' +
        'Judge only the cards named here; ignore anything else on screen.',
      { vision: true },
    );
    judged.push(...shown);
  }

  await list.getByRole('link', `Answer this: ${QUESTION.guest_toilets}`).tap();
  await expect(screen.getByRole('heading', QUESTION.guest_toilets, { level: 1 })).toBeVisible();
  await screen.getByRole('radio', 'No').check();
  await screen.getByLabel('Reason').fill(`DEV FIXTURE no customer toilets (B01 acceptance ${w.tag})`);
  const submit = screen.getByRole('button', 'Submit finding');
  await expect(submit).toBeVisible();
  // The dock holds Submit finding on screen as it is, before any tap could
  // scroll it there: inside the viewport, and what a tap at its centre hits.
  expect(await browser.evaluate<ControlInView, string>(CONTROL_IN_VIEW, 'Submit finding')).toEqual({
    docked: true,
    inViewport: true,
    topmost: 'self',
  });
  expect(await browser.evaluate(NO_HORIZONTAL_OVERFLOW)).toBe(true);
  await app.screenshot('390-capture-before-send');
  await submit.tap();
  await expectSentOnHome(browser, screen, check, QUESTION.guest_toilets, 'current');
  expect(await browser.evaluate(NO_HORIZONTAL_OVERFLOW)).toBe(true);
  await app.screenshot('390-capture-sent');

  expect(db.submissions(check)).toEqual([{ answer: 'no', by: w.staffB.id }]);
  expect(db.slot(w.venueB.id, 'guest_toilets')).toMatchObject({ status: 'available', value: 'no', source_basis: 'staff' });
});
