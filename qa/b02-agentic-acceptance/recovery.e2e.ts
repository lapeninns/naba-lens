import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { db, QUESTION, readOnly, signInAs, text, uuid, world } from './fixture';

// B02-06 recovery at 1280x800, deterministic: no agent step. Both cases run in
// the shared recovery scope (world().scopes.recovery), each as its own person.
//
// 1. A dropped transfer, shaped with browser.route + route.abort() on the
//    signed PUT. That is a refused request with the browser still online, not
//    offline: offline and closing the tab are the Playwright charters
//    (charters.playwright.ts), which have the methods this fixture lacks.
// 2. Draft validation and state: an empty Reason is refused in place, Save for
//    later stores exactly one account draft, another device restores it, and
//    the send records one finding and leaves no draft behind.
//
// Copy is the candidate's: upload-dialog.tsx (rows, summary, Retry),
// lib/upload/signed-put.ts (the interrupted message), shell/entry-copy.ts
// (the chooser), capture/validate.ts, knowledge/copy.ts and capture-form.tsx.

const SIGNED_PUT = /\/storage\/v1\/object\/upload\/sign\//;
const UPLOAD_SHEET = /^(Upload photos or videos|Saving \d+ photos?)$/;
const name = (path: string) => path.split('/').at(-1)!;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const draftKey = (userId: string, checkId: string) => `nabalens.amenity-draft.v2:${userId}:${checkId}`;
/** localStorage's copy of a draft key, or null (a callable source: the fixture's convention). */
const LOCAL_DRAFT = '(key) => window.localStorage.getItem(key)';

/** The one account draft row for (user, check): the author, answer, reason and revision only. */
function accountDraft(userId: string, checkId: string) {
  const out = readOnly(`select coalesce(json_agg(json_build_object(
      'user', user_id, 'answer', payload->>'answer', 'reason', payload->>'reason', 'revision', draft_revision)), '[]')
    from public.knowledge_drafts where user_id = ${uuid(userId)} and check_id = ${uuid(checkId)}`);
  return JSON.parse(out || '[]') as { user: string; answer: string; reason: string; revision: number }[];
}

test('a photo whose transfer keeps dropping fails with Retry; Retry finishes the same asset once', async ({ app, browser, screen }) => {
  const w = world();
  const who = w.staffRecover;
  const file = name(w.media.recover);
  // Every PUT is refused until released: the transport's own five retries
  // (0, 3, 5, 10, 20 s; lib/upload/uploader.ts) then the failure. The route is
  // in place before the pick, since uploads start on pick.
  let refuse = true;
  let puts = 0;
  await browser.route(SIGNED_PUT, async (route) => {
    puts++;
    if (refuse) await route.abort();
    else await route.continue();
  });

  await signInAs(app, browser, who);
  await app.open('/staff/tasks');
  await screen.getByRole('banner').getByRole('button', 'Add photos').tap();
  const chooser = screen.getByRole('dialog', 'What are you adding?');
  await chooser.getByRole('button', /^Just photos/).tap();
  await expect(screen.getByRole('dialog', 'Upload photos or videos')).toBeVisible();
  await screen.getByRole('dialog', 'Upload photos or videos').getByLabel('Choose photos or videos').setInputFiles([w.media.recover]);

  const sheet = screen.getByRole('dialog', UPLOAD_SHEET);
  await expect(sheet).toHaveAccessibleName('Saving 1 photo');
  const row = sheet.getByRole('list', 'Files').getByRole('listitem').filter({ hasText: file });
  await expect(row).toContainText('Needs attention', { timeout: 90000 });
  await expect(row.getByText('The connection was interrupted.')).toBeVisible();
  await expect(sheet.getByRole('status')).toHaveText('0 saved · 1 need attention');
  await expect(sheet.getByRole('button', `Retry ${file}`)).toBeVisible();
  expect(puts).toBe(6);

  // Reserved, never finished: one row, still uploading, at the recovery venue.
  const reserved = db.assets(who.id, file);
  expect(reserved.map(({ filename, state, venue, deleted }) => ({ filename, state, venue, deleted }))).toEqual([
    { filename: file, state: 'uploading', venue: w.scopes.recovery.venue.id, deleted: false },
  ]);

  refuse = false;
  await sheet.getByRole('button', `Retry ${file}`).tap();
  await expect(sheet.getByRole('status')).toHaveText('1 saved', { timeout: 60000 });
  await expect(row).toContainText('Saved');
  await expect(sheet.getByRole('button', `Retry ${file}`)).toHaveCount(0);
  expect(puts).toBe(7);
  // The same asset finished, once: no second row, nothing deleted.
  await expect.poll(() => db.assets(who.id, file).map(({ id, state, deleted }) => ({ id, state, deleted })), { timeout: 30000 }).toEqual([
    { id: reserved[0]!.id, state: 'ready', deleted: false },
  ]);
  await sheet.getByRole('button', 'Done', { exact: true }).tap();
  await browser.unroute(SIGNED_PUT);
});

test('an empty reason is refused in place; Save for later keeps one account draft another device restores; the send leaves none', async ({ app, browser, screen }) => {
  const w = world();
  const who = w.recoveryDraft;
  const check = w.scopes.recovery.checks.guest_toilets;
  const question = QUESTION.guest_toilets;
  const reason = `DEV FIXTURE no customer toilets (B02 recovery ${w.tag})`;
  const card = (action: RegExp) => screen.getByRole('list', 'Amenity checks').getByRole('link', new RegExp(`^${action.source}: ${escape(question)}$`));

  await signInAs(app, browser, who);
  await app.open('/staff/tasks');
  await card(/(Answer this|Start check)/).tap();
  await expect(screen.getByRole('heading', question, { level: 1 })).toBeVisible();
  const page = await browser.url();

  // Validation: No with no reason stays on the page, names the missing reason
  // on the field itself and puts focus there. Nothing reaches the server.
  await screen.getByRole('radio', 'No').check();
  await screen.getByRole('button', 'Submit finding').tap();
  const field = screen.getByLabel('Reason');
  await expect(screen.getByText('Say why, so your manager knows.')).toBeVisible();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toBeFocused();
  await expect(browser).toHaveURL(page);
  expect(db.contributions(check)).toEqual([]);
  expect(accountDraft(who.id, check)).toEqual([]);

  // Typed text is kept on this device as it is typed; the account copy only
  // comes from the explicit Save for later.
  await field.fill(reason);
  await expect.poll(async () => JSON.parse((await browser.evaluate<string | null, string>(LOCAL_DRAFT, draftKey(who.id, check))) ?? '{}').reason).toBe(reason);
  expect(accountDraft(who.id, check)).toEqual([]);
  await screen.getByRole('button', 'Save for later').tap();
  await expect(screen.getByText('Saved for later. Not sent yet. Finish it from Home or Me.')).toBeVisible();
  await expect.poll(() => accountDraft(who.id, check), { timeout: 15000 }).toEqual([{ user: who.id, answer: 'no', reason, revision: 1 }]);
  expect(db.drafts(check)).toBe(1);
  expect(db.contributions(check)).toEqual([]);

  // Another device: cleared storage, so only the account copy can restore it.
  await signInAs(app, browser, who);
  expect(await browser.evaluate<string | null, string>(LOCAL_DRAFT, draftKey(who.id, check))).toBeNull();
  await app.open('/staff/tasks');
  await card(/Finish/).tap();
  await expect(screen.getByRole('heading', question, { level: 1 })).toBeVisible();
  await expect(screen.getByText(/^You saved this on .+\. It hasn't been sent\.$/)).toBeVisible();
  await expect(screen.getByRole('radio', 'No')).toBeChecked();
  await expect(screen.getByLabel('Reason')).toHaveValue(reason);

  // One send: one finding, and the server and this device drop the draft.
  await screen.getByRole('button', 'Submit finding').tap();
  await expect(browser).toHaveURL(`/staff/tasks?finding_sent=${check}`, { timeout: 30000 });
  const sent = db.contributions(check);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ by: who.id, kind: 'finding', answer: 'no' });
  expect(accountDraft(who.id, check)).toEqual([]);
  expect(db.drafts(check)).toBe(0);
  expect(await browser.evaluate<string | null, string>(LOCAL_DRAFT, draftKey(who.id, check))).toBeNull();

  // Reopened from Home, the sent draft does not come back.
  await card(/[A-Z][a-z]+( [a-z]+)*/).tap();
  await expect(screen.getByRole('heading', question, { level: 1 })).toBeVisible();
  await expect(screen.getByText(/^(Restored from this phone|You saved this on )/)).toHaveCount(0);
  await expect(screen.getByRole('radio', 'No')).not.toBeChecked();
  expect(db.contributions(check)).toHaveLength(1);
  expect(readOnly(`select count(*) from public.knowledge_drafts where check_id = ${uuid(check)} and payload->>'reason' = ${text(reason)}`)).toBe('0');
});
