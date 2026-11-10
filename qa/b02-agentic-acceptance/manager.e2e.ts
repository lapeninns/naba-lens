import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { acceptedFor, db, DISH, QUESTION, SELF_REVIEW, setSaved, signInAs, world } from './fixture';

// B02-03 and B02-04 at 1280x800, one serial story at venue A plus the
// solo venue and the revoked account at B. Each member signs in as the
// person it needs (signInAs clears the previous person's state first).
// Every important outcome is read back from the database read-only, or
// under RLS as the viewer it is about.

const MENU_PHOTOS = /^Menu photos to review: (\d+)(, oldest .+)?$/;
const FINDINGS = /^Findings to confirm: (\d+)(, oldest .+)?$/;
const count = (n: number, re: RegExp) => new RegExp(re.source.replace('(\\d+)', String(n)));
const reason = (what: string) => `DEV FIXTURE ${what} (B02 acceptance ${world().tag})`;
const libraryInput = 'input[data-photo-source="library"]';

describe('B02 manager scope and triage', { serial: true }, () => {
  test('a dedicated manager adds two photos of one dish as a set; they stay private to it until review', async ({ app, browser, screen }) => {
    const w = world();
    await signInAs(app, browser, w.managerA);
    await app.open('/manager/menu');
    const row = screen.getByRole('article').filter({ has: screen.getByRole('heading', DISH.lager, { level: 3 }) });
    // The dish's library button opens Add's own picker with the dish as the
    // preset; the picker is a hidden input, given the files directly.
    await row.getByRole('button', 'Choose from photos').tap();
    await browser.locator(libraryInput).setInputFiles([...w.media.manager]);
    const sheet = screen.getByRole('dialog', 'Saving 2 photos');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(setSaved(2, DISH.lager))).toBeVisible({ timeout: 120000 });
    await sheet.getByRole('button', 'Done', { exact: true }).tap();

    const prefix = w.media.manager[0].split('/').at(-1)!.replace(/-1-.*/, '-');
    const assets = db.assets(w.managerA.id, prefix);
    expect(assets.map(({ state, role, venue, deleted }) => ({ state, role, venue, deleted }))).toEqual([
      { state: 'ready', role: 'manager', venue: w.venueA.id, deleted: false },
      { state: 'ready', role: 'manager', venue: w.venueA.id, deleted: false },
    ]);
    const ids = assets.map((a) => a.id);
    const groups = db.groupsOf(ids);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ createdBy: w.managerA.id, venue: w.venueA.id, subjectKind: 'menu_item', subjectId: w.items.A.lager });
    expect(groups[0]!.members.map((m) => m.position)).toEqual([1, 2]);
    expect([...groups[0]!.members.map((m) => m.asset)].sort()).toEqual([...ids].sort());
    for (const id of ids) {
      await expect.poll(() => db.labelItems(id), { timeout: 30000 }).toEqual([DISH.lager]);
      expect(db.photoRows(id)).toEqual([]);
    }
    // Private until reviewed: the uploader reads them; a colleague, Photos
    // and another venue's manager do not.
    const sorted = [...ids].sort();
    expect(db.rlsVisible(w.managerA.id, ids)).toEqual(sorted);
    expect(db.rlsVisible(w.staffTriage.id, ids)).toEqual([]);
    expect(db.communityReadable(w.staffTriage.id, ids)).toEqual([]);
    expect(db.rlsVisible(w.managerB.id, ids)).toEqual([]);
    expect(db.acceptedEvents(w.venueA.id, w.managerA.id)).toBe(0);

    // My uploads lists them; its staff-era photo (labelled Garlic Naan) is not its upload here.
    await app.open('/manager/uploads');
    const mine = screen.getByRole('list', 'My uploads');
    await expect(mine.getByText(DISH.lager).first()).toBeVisible();
    await expect(mine.getByText(DISH.naan)).toHaveCount(0);
  });

  test('the manager may not decide its own photos, of either era; its staff-era photo waits for an admin', async ({ app, browser, screen }) => {
    const w = world();
    await signInAs(app, browser, w.managerA);
    await app.open('/manager/review');
    const queue = screen.getByRole('list', 'Photos to review');
    await expect(queue.getByRole('article').filter({ hasText: w.staffTriage.name })).toHaveCount(1);
    await expect(queue.getByRole('article').filter({ hasText: w.managerA.name })).toHaveCount(0);
    // Venue B's waiting photo is never in venue A's queue.
    await expect(queue.getByRole('article').filter({ hasText: w.staffB.name })).toHaveCount(0);

    await app.open('/manager/review?status=mine');
    const own = screen.getByRole('list', 'Photos to review');
    await expect(own.getByText(SELF_REVIEW).first()).toBeVisible();
    await expect(own.getByRole('article').filter({ hasText: DISH.naan })).toHaveCount(1);
    await expect(own.getByRole('article').filter({ hasText: DISH.naan }).getByText(SELF_REVIEW)).toBeVisible();
    for (const action of ['Accept for this item', 'Accept and set as menu photo', 'Ask for another photo']) {
      await expect(own.getByRole('button', action)).toHaveCount(0);
    }
    expect(db.photoRows(w.seeded.staffEraAsset)).toEqual([]);
    // Approved restriction: a manager account doesn't read its staff-era upload.
    expect(db.rlsVisible(w.managerA.id, [w.seeded.staffEraAsset])).toEqual([]);
  });

  test('a colleague\'s step-free finding waits for confirmation', async ({ app, browser, screen }) => {
    const w = world();
    const check = w.checks.A.step_free_entrance;
    await signInAs(app, browser, w.staffTriage);
    await app.open(`/staff/tasks/amenities/${check}`);
    await expect(screen.getByRole('heading', QUESTION.step_free_entrance, { level: 1 })).toBeVisible();
    await screen.getByRole('radio', 'No').check();
    await screen.getByLabel('Reason').fill(reason('two steps at every entrance'));
    await screen.getByRole('button', 'Submit finding').tap();
    await expect(browser).toHaveURL(`/staff/tasks?finding_sent=${check}`, { timeout: 30000 });
    expect(db.contributions(check)).toEqual([{ by: w.staffTriage.id, kind: 'finding', answer: 'no', outcome: 'awaiting_confirmation' }]);
  });

  test('Triage keeps photos and findings apart; a selected photo review leaves the other queue and venue B alone', async ({ app, browser, screen }) => {
    const w = world();
    await signInAs(app, browser, w.managerA);
    await app.open('/manager');
    const triage = screen.getByRole('region', 'Triage');
    await expect(triage.getByText(count(1, MENU_PHOTOS))).toBeVisible();
    await expect(triage.getByText(count(1, FINDINGS))).toBeVisible();
    await expect(triage.getByText(/^Checklist photos to review/)).toHaveCount(0);
    await expect(triage.getByText(/of your earlier photos (is|are) waiting for an admin$/)).toBeVisible();

    await app.open('/manager/review?kind=findings');
    const findings = screen.getByRole('list', 'Findings');
    await expect(findings.getByRole('listitem')).toHaveCount(1);
    await expect(findings.getByText(`Finding from ${w.staffTriage.name}`)).toBeVisible();
    await expect(screen.getByRole('link', 'Findings')).toHaveAttribute('aria-current', 'page');

    await app.open('/manager/review?kind=all');
    const all = screen.getByRole('list', 'All');
    await expect(all.getByRole('listitem')).toHaveCount(2);
    await expect(all.getByText(`Finding from ${w.staffTriage.name}`)).toBeVisible();
    await expect(all.getByText(`From ${w.staffTriage.name}`)).toBeVisible();
    await expect(all.getByText(w.staffB.name, { exact: false })).toHaveCount(0);

    await screen.getByRole('link', 'Photos').tap();
    await expect(browser).toHaveURL('/manager/review');
    const card = screen.getByRole('list', 'Photos to review').getByRole('article').filter({ hasText: w.staffTriage.name });
    await card.getByRole('button', 'Accept for this item', { exact: true }).tap();
    await expect(screen.getByText(acceptedFor(DISH.curry))).toBeVisible();

    expect(db.photoRows(w.seeded.waitingPhotoA)).toEqual([
      { item: w.items.A.curry, state: 'accepted', decidedBy: w.managerA.id, author: w.staffTriage.id },
    ]);
    // Existing target credit: the colleague's accepted photo counts once.
    expect(db.acceptedEvents(w.venueA.id, w.staffTriage.id)).toBe(1);
    expect(db.photoRows(w.seeded.waitingPhotoB)).toEqual([]);

    await app.open('/manager');
    const after = screen.getByRole('region', 'Triage');
    await expect(after.getByText(count(0, MENU_PHOTOS))).toBeVisible();
    await expect(after.getByText(count(1, FINDINGS))).toBeVisible();
  });

  test('the staff grant holder and the admin see the same findings count for venue A', async ({ app, browser, screen }) => {
    const w = world();
    await signInAs(app, browser, w.staffGrant);
    await app.open('/staff/manage');
    await expect(screen.getByRole('region', 'Triage').getByText(count(1, FINDINGS))).toBeVisible();

    await signInAs(app, browser, w.admin);
    await app.open(`/admin/coverage/${w.venueA.id}`);
    await expect(screen.getByRole('region', 'Triage').getByText(count(1, FINDINGS))).toBeVisible();
  });

  test('the one-account venue\'s manager confirms its own step-free finding', async ({ app, browser, screen }) => {
    const w = world();
    const check = w.checks.solo.step_free_entrance;
    await signInAs(app, browser, w.managerSolo);
    await app.open(`/manager/amenities/${check}/capture`);
    await expect(screen.getByRole('heading', QUESTION.step_free_entrance, { level: 1 })).toBeVisible();
    await screen.getByRole('radio', 'No').check();
    await screen.getByLabel('Reason').fill(reason('a step at the only entrance'));
    await screen.getByRole('radio', 'I confirm it now').check();
    await screen.getByRole('button', 'Submit and confirm').tap();
    await expect(browser).toHaveURL(new RegExp(`/manager/amenities/${check}(\\?.*)?$`), { timeout: 30000 });
    expect(db.contributions(check)).toEqual([{ by: w.managerSolo.id, kind: 'finding', answer: 'no', outcome: 'current' }]);
    expect(db.slot(w.venueSolo.id, 'step_free_entrance')).toMatchObject({
      status: 'available',
      value: 'no',
      confirmation_state: 'confirmed',
      confirmation_self: true,
    });
    // No target or credit for a manager account.
    expect(db.submissions(check).map((s) => s.by)).toEqual([w.managerSolo.id]);
  });

  test('after its grant is revoked a manager account has no workspace and no Add, but still reads its own upload', async ({ app, browser, screen }) => {
    const w = world();
    await signInAs(app, browser, w.managerRevoked);
    await app.open('/manager');
    await expect(screen.getByRole('heading', 'Venue access unavailable', { level: 1 })).toBeVisible();
    await expect(screen.getByText('Your venue access has ended.')).toBeVisible();
    await expect(browser.locator('input[type="file"]')).toHaveCount(0);
    await expect(screen.getByRole('button', /^Add( photos)?(,|$)/)).toHaveCount(0);
    expect(db.rlsVisible(w.managerRevoked.id, [w.seeded.revokedAsset])).toEqual([w.seeded.revokedAsset]);
    expect(db.communityReadable(w.staffB.id, [w.seeded.revokedAsset])).toEqual([]);
  });
});
