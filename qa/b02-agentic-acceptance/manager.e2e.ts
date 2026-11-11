import { basename } from 'node:path';

import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { acceptedFor, db, DISH, json, QUESTION, SELF_REVIEW, setSaved, signInAs, uuid, world } from './fixture';

// B02-03 and B02-04 at 1280x800: one serial story at venue A, plus the solo
// venue and the revoked account at B. Manager fixtures only (venueA,
// items.A, checks.A, checks.solo); the staff scope is never touched here.
// Each member signs in as the person it needs (signInAs clears the previous
// person's state first). Every important outcome is read back from the
// database read-only, or under RLS as the viewer it is about.
//
// Copy, routes and names are the candidate's own (app 1c538949):
// manager/overview/triage-card.tsx, manager/copy.ts, manager/menu,
// app/manager/uploads/my-uploads.tsx, manager/review (review-copy.ts,
// card-model.ts, triage-views.tsx), upload-dialog.tsx, entry-flow.tsx,
// knowledge-fields.tsx and venue-access-unavailable.tsx. Policy: B02-c
// migrations 20261110090145 through 20261110095911.
//
// Counts, as the SQL builds them (manager_triage_summary):
// - "Menu photos to review" is photo x item tuples of ready images waiting
//   at the venue; a manager account never counts its own (either era), a
//   staff grant holder and an admin count every active uploader's, and a
//   video never waits.
// - "N of your earlier photos ... waiting for an admin" is the manager
//   account's own waiting tuples of both eras: its staff-era Garlic Naan
//   photo plus the two Kingfisher Lager photos of case 1 = 3.
// - "Findings to confirm" is venue-wide, the same for MO, SG and AD.

const MENU_PHOTOS = /^Menu photos to review: (\d+)(, oldest .+)?$/;
const FINDINGS = /^Findings to confirm: (\d+)(, oldest .+)?$/;
const count = (n: number, re: RegExp) => new RegExp(re.source.replace('(\\d+)', String(n)));
const OWN_WAITING = '3 of your earlier photos are waiting for an admin';
const reason = (what: string) => `DEV FIXTURE ${what} (B02 acceptance ${world().tag})`;
/** The Add host's own library picker; the dish button's click owns what is picked next. */
const LIBRARY = 'input[type="file"][data-photo-source="library"]';
/**
 * Local read-only fact: a check's contributions with each attached evidence
 * asset (knowledge_contribution_assets), its author, outcome and venue, and
 * the asset's own uploader, role and venue. Ids and states only.
 */
const evidenceOf = (checkId: string) =>
  json<{ asset: string; kind: string; by: string; answer: string; outcome: string; venue: string; assetVenue: string; uploader: string; role: string | null }[]>(
    `select coalesce(json_agg(json_build_object('asset', ca.asset_id, 'kind', ca.evidence_kind, 'by', c.contributed_by,
        'answer', c.answer, 'outcome', c.initial_outcome, 'venue', c.venue_id, 'assetVenue', a.venue_id,
        'uploader', a.uploader_id, 'role', a.uploader_role) order by c.created_at, ca.asset_id), '[]')
      from public.knowledge_contributions c
      join public.knowledge_contribution_assets ca on ca.contribution_id = c.id and ca.venue_id = c.venue_id
      join public.media_assets a on a.id = ca.asset_id
      where c.check_id = ${uuid(checkId)}`,
  );

describe('B02 manager scope and triage', { serial: true }, () => {
  test('a dedicated manager adds two photos of one dish as a set; they stay private to it until review', async ({ app, browser, screen }) => {
    const w = world();
    await signInAs(app, browser, w.managerA);
    await app.open('/manager/menu');
    // Manager menu rows are unnamed articles holding an h3 with the dish's link.
    const row = screen.getByRole('article').filter({ has: screen.getByRole('heading', DISH.lager, { level: 3 }) });
    // The dish's library button opens Add's own picker with the dish as the
    // preset (images only); the picker is a hidden input, given the files directly.
    await row.getByRole('button', 'Choose from photos').tap();
    await browser.locator(LIBRARY).setInputFiles([...w.media.manager]);
    const sheet = screen.getByRole('dialog', 'Saving 2 photos');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(setSaved(2, DISH.lager))).toBeVisible({ timeout: 120000 });
    await expect(sheet.getByRole('status')).toHaveText('2 saved', { timeout: 60000 });
    await sheet.getByRole('button', 'Done', { exact: true }).tap();

    const prefix = basename(w.media.manager[0]).replace(/-1-.*/, '-');
    const assets = db.assets(w.managerA.id, prefix);
    expect(assets.map(({ state, role, venue, deleted }) => ({ state, role, venue, deleted }))).toEqual([
      { state: 'ready', role: 'manager', venue: w.venueA.id, deleted: false },
      { state: 'ready', role: 'manager', venue: w.venueA.id, deleted: false },
    ]);
    const ids = assets.map((a) => a.id).sort();
    await expect.poll(() => db.groupsOf(ids).map((g) => g.members.length), { timeout: 30000 }).toEqual([2]);
    const groups = db.groupsOf(ids);
    expect(groups[0]).toMatchObject({ createdBy: w.managerA.id, venue: w.venueA.id, subjectKind: 'menu_item', subjectId: w.items.A.lager });
    expect(groups[0]!.members.map((m) => m.position)).toEqual([1, 2]);
    expect(groups[0]!.members.map((m) => m.asset).sort()).toEqual(ids);
    for (const id of ids) {
      await expect.poll(() => db.labelItems(id), { timeout: 30000 }).toEqual([DISH.lager]);
      expect(db.photoRows(id)).toEqual([]);
    }
    // Private until reviewed: the uploader and an admin read them; a
    // colleague, Photos and another venue's manager do not.
    expect(db.rlsVisible(w.managerA.id, ids)).toEqual(ids);
    expect(db.rlsVisible(w.admin.id, ids)).toEqual(ids);
    expect(db.rlsVisible(w.staffTriage.id, ids)).toEqual([]);
    expect(db.communityReadable(w.staffTriage.id, ids)).toEqual([]);
    expect(db.rlsVisible(w.managerB.id, ids)).toEqual([]);
    expect(db.acceptedEvents(w.venueA.id, w.managerA.id)).toBe(0);

    // The same group through the actor-scoped read (public.contribution_group
    // as each viewer): the uploader and an admin get the exact group, venue,
    // subject and both ready image members in position order, with owner-
    // relative mine flags; an ordinary colleague, another venue's staff and
    // another venue's manager get not-found from that same read.
    const groupId = groups[0]!.id;
    const ordered = groups[0]!.members.map((m) => m.asset);
    const seenAs = (mine: boolean) => ({
      groupId,
      venueId: w.venueA.id,
      mine,
      subject: { kind: 'menu_item', id: w.items.A.lager, name: DISH.lager },
      members: ordered.map((assetId, i) => ({ assetId, position: i + 1, mediaType: 'image', uploadState: 'ready', mine })),
    });
    expect(db.groupFor(w.managerA.id, groupId)).toMatchObject(seenAs(true));
    expect(db.groupFor(w.managerA.id, groupId)!.members).toHaveLength(2);
    expect(db.groupFor(w.admin.id, groupId)).toMatchObject(seenAs(false));
    expect(db.groupFor(w.admin.id, groupId)!.members).toHaveLength(2);
    for (const outsider of [w.staffTriage, w.staffB, w.managerB]) {
      expect(db.groupFor(outsider.id, groupId)).toBeNull();
    }

    // My uploads lists the two; its staff-era photo (Garlic Naan) stays hidden.
    await app.open('/manager/uploads');
    await expect(screen.getByRole('heading', 'My uploads', { level: 1 })).toBeVisible();
    const mine = screen.getByRole('list', 'My uploads');
    await expect(mine.getByRole('heading', DISH.lager, { level: 3 })).toHaveCount(2);
    await expect(mine.getByRole('heading', DISH.naan, { level: 3 })).toHaveCount(0);
    expect(db.rlsVisible(w.managerA.id, [w.seeded.staffEraAsset])).toEqual([]);
  });

  test('the manager captures a short video, labels it as its own, and it stays out of review and of colleagues\' reach', async ({ app, browser, screen }) => {
    const w = world();
    const file = basename(w.media.managerVideo);
    await signInAs(app, browser, w.managerA);
    await app.open('/manager');

    // -- Add: the venue strip, the manager's intents (no task photos), then Just photos.
    await screen.getByRole('button', 'Add photos').tap();
    const entry = screen.getByRole('dialog', 'What are you adding?');
    await expect(entry.getByText(`For ${w.venueA.name}`)).toBeVisible();
    await expect(entry.getByText('A dish or drink', { exact: true })).toBeVisible();
    await expect(entry.getByText('Photos for a task', { exact: true })).toHaveCount(0);
    await entry.getByRole('button', /^Just photos/).tap();
    const upload = screen.getByRole('dialog', 'Upload photos or videos');
    await expect(upload).toBeVisible();
    await upload.getByLabel('Choose photos or videos').setInputFiles(w.media.managerVideo);
    const sheet = screen.getByRole('dialog', 'Saving 1 file');
    await expect(sheet.getByRole('status')).toHaveText('1 saved', { timeout: 120000 });
    await sheet.getByRole('button', 'Done', { exact: true }).tap();

    const [video] = db.assets(w.managerA.id, file);
    // Stored as a video (the shared row's mediaType), in the manager role, at venue A.
    expect(db.assets(w.managerA.id, file).map(({ mediaType, state, role, venue, deleted }) => ({ mediaType, state, role, venue, deleted }))).toEqual([
      { mediaType: 'video', state: 'ready', role: 'manager', venue: w.venueA.id, deleted: false },
    ]);
    expect(db.groupsOf([video!.id])).toEqual([]);

    // -- Own label, from My uploads.
    await app.open('/manager/uploads');
    const mine = screen.getByRole('list', 'My uploads');
    // Page-relative inner heading: filter({ has }) resolves it from each row.
    const row = mine.getByRole('listitem').filter({ has: screen.getByRole('heading', 'Video', { level: 3 }) });
    await expect(row).toHaveCount(1);
    await expect(row.getByText('Labels: Needs labels')).toBeVisible();
    await row.getByRole('button', 'Add labels').tap();
    const editor = screen.getByRole('dialog', 'Labels');
    await editor.getByRole('combobox', /^Menu item at /).pressSequentially('Kingfisher');
    await editor.getByRole('option', new RegExp(`^${DISH.lager}`)).tap();
    await editor.getByRole('button', /^Save labels/).tap();
    await expect(editor).toBeHidden({ timeout: 30000 });
    await expect.poll(() => db.labelItems(video!.id), { timeout: 30000 }).toEqual([DISH.lager]);
    // A row is titled by its menu decisions, else by its kind (b02-ui-design §6.1): a video never waits
    // for menu review, so it keeps its kind as its title once labelled; only the set's two photos read
    // the dish. ("Video" rather than §6.1's "Photo" fallback is the app's wording, owner to confirm.)
    await expect(row).toHaveCount(1);
    await expect(row.getByText('Labels: Labelled')).toBeVisible();
    await expect(mine.getByRole('heading', DISH.lager, { level: 3 })).toHaveCount(2);

    // -- Private: uploader and admin only; a video never waits for menu review.
    expect(db.rlsVisible(w.managerA.id, [video!.id])).toEqual([video!.id]);
    expect(db.rlsVisible(w.admin.id, [video!.id])).toEqual([video!.id]);
    expect(db.rlsVisible(w.staffTriage.id, [video!.id])).toEqual([]);
    expect(db.communityReadable(w.staffTriage.id, [video!.id])).toEqual([]);
    expect(db.rlsVisible(w.managerB.id, [video!.id])).toEqual([]);
    expect(db.photoRows(video!.id)).toEqual([]);
    await app.open('/manager');
    const triage = screen.getByRole('region', 'Triage');
    await expect(triage.getByRole('link', OWN_WAITING)).toBeVisible();
  });

  test('the manager may not decide its own photos, of either era; its staff-era photo waits for an admin', async ({ app, browser, screen }) => {
    const w = world();
    await signInAs(app, browser, w.managerA);
    await app.open('/manager/review');
    const queue = screen.getByRole('list', 'Photos to review');
    // Only the colleague's photo; none of its own, none of venue B's.
    await expect(queue.getByRole('article')).toHaveCount(1);
    await expect(queue.getByRole('article').filter({ hasText: w.staffTriage.name })).toHaveCount(1);
    await expect(queue.getByText(SELF_REVIEW)).toHaveCount(0);
    await expect(queue.getByRole('article').filter({ hasText: w.staffB.name })).toHaveCount(0);

    await app.open('/manager/review?status=mine');
    await expect(screen.getByRole('button', 'Your photos', { pressed: true })).toBeVisible();
    const own = screen.getByRole('list', 'Photos to review');
    // The staff-era Garlic Naan photo and the two manager-era Kingfisher Lager photos.
    await expect(own.getByText(SELF_REVIEW)).toHaveCount(3);
    await expect(own.getByRole('article').filter({ hasText: DISH.naan }).getByText(SELF_REVIEW)).toBeVisible();
    for (const action of ['Accept for this item', 'Accept and set as menu photo', 'Ask for another photo']) {
      await expect(own.getByRole('button', action)).toHaveCount(0);
    }
    expect(db.photoRows(w.seeded.staffEraAsset)).toEqual([]);
    // Approved restriction: the manager account doesn't read its staff-era
    // upload; an admin does (the one who decides it).
    expect(db.rlsVisible(w.managerA.id, [w.seeded.staffEraAsset])).toEqual([]);
    expect(db.rlsVisible(w.admin.id, [w.seeded.staffEraAsset])).toEqual([w.seeded.staffEraAsset]);
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
    const notice = screen.getByRole('status').filter({ hasText: 'Finding sent' });
    await expect(notice).toContainText(`${QUESTION.step_free_entrance} Your manager confirms it before it's used.`);
    expect(db.contributions(check)).toEqual([{ by: w.staffTriage.id, kind: 'finding', answer: 'no', outcome: 'awaiting_confirmation' }]);
    expect(db.submissions(check)).toEqual([]);
  });

  test('Triage keeps photos and findings apart; a selected photo review leaves the other queue and venue B alone', async ({ app, browser, screen }) => {
    const w = world();
    await signInAs(app, browser, w.managerA);
    await app.open('/manager');
    const triage = screen.getByRole('region', 'Triage');
    await expect(triage.getByRole('link', count(1, MENU_PHOTOS))).toBeVisible();
    await expect(triage.getByRole('link', count(1, FINDINGS))).toBeVisible();
    await expect(triage.getByRole('link', OWN_WAITING)).toBeVisible();
    // Not a manager account's queue: omitted, never shown as 0.
    await expect(triage.getByText(/^Checklist photos to review/)).toHaveCount(0);

    const show = screen.getByRole('navigation', 'Show');
    await app.open('/manager/review?kind=findings');
    await expect(show.getByRole('link', 'Findings')).toHaveAttribute('aria-current', 'page');
    const findings = screen.getByRole('list', 'Findings');
    await expect(findings.getByRole('listitem')).toHaveCount(1);
    await expect(findings.getByText(`Finding from ${w.staffTriage.name}`)).toBeVisible();

    await app.open('/manager/review?kind=all');
    await expect(show.getByRole('link', 'All')).toHaveAttribute('aria-current', 'page');
    const all = screen.getByRole('list', 'All');
    await expect(all.getByRole('listitem')).toHaveCount(2);
    await expect(all.getByText(`Finding from ${w.staffTriage.name}`)).toBeVisible();
    await expect(all.getByText(`From ${w.staffTriage.name}`)).toBeVisible();
    await expect(all.getByText(w.staffB.name, { exact: false })).toHaveCount(0);

    await show.getByRole('link', 'Photos').tap();
    await expect(browser).toHaveURL('/manager/review');
    const card = screen.getByRole('list', 'Photos to review').getByRole('article').filter({ hasText: w.staffTriage.name });
    await card.getByRole('button', 'Accept for this item', { exact: true }).tap();
    await expect(screen.getByText(acceptedFor(DISH.curry))).toBeVisible();

    expect(db.photoRows(w.seeded.waitingPhotoA)).toEqual([
      { item: w.items.A.curry, state: 'accepted', decidedBy: w.managerA.id, author: w.staffTriage.id },
    ]);
    // Existing target credit: the colleague's accepted photo counts once; the finding earns nothing yet.
    expect(db.acceptedEvents(w.venueA.id, w.staffTriage.id)).toBe(1);
    expect(db.credit(w.venueA.id, w.staffTriage.id)).toEqual({ menu: 1, checks: 0 });
    expect(db.photoRows(w.seeded.waitingPhotoB)).toEqual([]);
    expect(db.contributions(w.checks.A.step_free_entrance).map((c) => c.outcome)).toEqual(['awaiting_confirmation']);

    await app.open('/manager');
    const after = screen.getByRole('region', 'Triage');
    await expect(after.getByRole('link', count(0, MENU_PHOTOS))).toBeVisible();
    await expect(after.getByRole('link', count(1, FINDINGS))).toBeVisible();
    await expect(after.getByRole('link', OWN_WAITING)).toBeVisible();
  });

  test('the staff grant holder and the admin see the same venue A queues, each counting the manager\'s waiting photos', async ({ app, browser, screen }) => {
    const w = world();
    // After case 5: the manager account's three waiting photos (staff-era
    // Garlic Naan, two Kingfisher Lager) are reviewable by anyone else with
    // the venue; the video never counts; the finding still waits.
    await signInAs(app, browser, w.staffGrant);
    await app.open('/staff/manage');
    const sg = screen.getByRole('region', 'Triage');
    await expect(sg.getByRole('link', count(3, MENU_PHOTOS))).toBeVisible();
    await expect(sg.getByRole('link', count(1, FINDINGS))).toBeVisible();
    await expect(sg.getByText(/of your earlier photos/)).toHaveCount(0);

    await signInAs(app, browser, w.admin);
    await app.open(`/admin/coverage/${w.venueA.id}`);
    const ad = screen.getByRole('region', 'Triage');
    await expect(ad.getByRole('link', count(3, MENU_PHOTOS))).toBeVisible();
    await expect(ad.getByRole('link', count(1, FINDINGS))).toBeVisible();
    await expect(ad.getByText(/of your earlier photos/)).toHaveCount(0);
  });

  test('the one-account venue\'s manager confirms its own step-free finding, and answers Yes for toilets only with its own new photo', async ({ app, browser, screen }) => {
    const w = world();
    const check = w.checks.solo.step_free_entrance;
    await signInAs(app, browser, w.managerSolo);
    await app.open(`/manager/amenities/${check}/capture`);
    await expect(screen.getByRole('heading', QUESTION.step_free_entrance, { level: 1 })).toBeVisible();
    await expect(
      screen.getByText('Answers to this question need confirming. You can confirm your own, or leave it for another manager or an admin.'),
    ).toBeVisible();
    await screen.getByRole('radio', 'No').check();
    await screen.getByLabel('Reason').fill(reason('a step at the only entrance'));
    await screen.getByRole('radio', 'I confirm it now').check();
    await screen.getByRole('button', 'Submit and confirm').tap();
    await expect(browser).toHaveURL(`/manager/amenities/${check}?finding_sent=${check}`, { timeout: 30000 });
    const notice = screen.getByRole('status').filter({ hasText: 'Finding sent' });
    await expect(notice).toContainText('Confirmed by you. It\'s now the venue\'s answer.');

    expect(db.contributions(check)).toEqual([{ by: w.managerSolo.id, kind: 'finding', answer: 'no', outcome: 'current' }]);
    expect(db.slot(w.venueSolo.id, 'step_free_entrance')).toMatchObject({
      status: 'available',
      value: 'no',
      confirmation_state: 'confirmed',
      confirmation_basis: 'venue_manager',
      confirmation_self: true,
    });
    // The submission is the manager's own; a manager account is no target
    // participant, so no staff completion credit follows from it.
    expect(db.submissions(check)).toEqual([{ answer: 'no', by: w.managerSolo.id }]);
    expect(evidenceOf(check)).toEqual([]);

    // -- An eligible check with actual manager-era evidence: guest toilets.
    // Its catalogue rule needs a photo for Yes (any role) and no confirmation,
    // so a manager's Yes is current at once (amenity_catalogue.csv; B01
    // question policy). The file is the run's own fixture, uploaded here by
    // this account for the first time (a unique actor and file name).
    const toilets = w.checks.solo.guest_toilets;
    const photo = w.media.manager[1];
    const photoName = basename(photo);
    expect(db.assets(w.managerSolo.id, photoName)).toEqual([]);
    await app.open(`/manager/amenities/${toilets}/capture`);
    await expect(screen.getByRole('heading', QUESTION.guest_toilets, { level: 1 })).toBeVisible();
    await expect(screen.getByText('What you send becomes the venue\'s answer straight away.')).toBeVisible();
    await expect(screen.getByRole('radio', 'I confirm it now')).toHaveCount(0);
    await screen.getByRole('radio', 'Yes').check();

    // Refused without evidence, in place: nothing is sent or persisted.
    await screen.getByRole('button', 'Submit finding').tap();
    await expect(screen.getByText('Add a photo to answer Yes. Required: Photo.', { exact: true })).toBeVisible();
    await expect(browser).toHaveURL(`/manager/amenities/${toilets}/capture`);
    expect(db.contributions(toilets)).toEqual([]);
    expect(db.submissions(toilets)).toEqual([]);
    expect(db.drafts(toilets)).toBe(0);
    expect(evidenceOf(toilets)).toEqual([]);

    // The manager's own new photo, uploaded from the form; ready, it is selected.
    await screen.getByRole('button', 'Choose from your photos').tap();
    await browser.locator(LIBRARY).setInputFiles(photo);
    const sheet = screen.getByRole('dialog', 'Saving 1 photo');
    await expect(sheet.getByRole('status')).toHaveText('1 saved', { timeout: 120000 });
    await sheet.getByRole('button', 'Done', { exact: true }).tap();
    const uploaded = db.assets(w.managerSolo.id, photoName);
    expect(uploaded.map(({ mediaType, state, role, venue, deleted }) => ({ mediaType, state, role, venue, deleted }))).toEqual([
      { mediaType: 'image', state: 'ready', role: 'manager', venue: w.venueSolo.id, deleted: false },
    ]);
    const evidence = uploaded[0]!.id;
    const picker = screen.getByRole('list', 'Your photos and videos');
    await expect(picker.getByRole('checkbox', /^Photo added /)).toHaveCount(1);
    await expect(picker.getByRole('checkbox', /^Photo added /)).toBeChecked({ timeout: 30000 });
    // The visible rule line (an sr-only live region repeats the same words).
    await expect(screen.getByTestId('evidence-rule-status')).toHaveText('Evidence rule met: Photo.');

    // Sent once, with that exact photo as its evidence.
    await screen.getByRole('button', 'Submit finding').tap();
    await expect(browser).toHaveURL(`/manager/amenities/${toilets}?finding_sent=${toilets}`, { timeout: 30000 });
    const sent = screen.getByRole('status').filter({ hasText: 'Finding sent' });
    await expect(sent).toContainText(`${QUESTION.guest_toilets} It's now the venue's answer.`);
    expect(db.contributions(toilets)).toEqual([{ by: w.managerSolo.id, kind: 'finding', answer: 'yes', outcome: 'current' }]);
    expect(evidenceOf(toilets)).toEqual([
      {
        asset: evidence,
        kind: 'photo',
        by: w.managerSolo.id,
        answer: 'yes',
        outcome: 'current',
        venue: w.venueSolo.id,
        assetVenue: w.venueSolo.id,
        uploader: w.managerSolo.id,
        role: 'manager',
      },
    ]);
    expect(db.submissions(toilets)).toEqual([{ answer: 'yes', by: w.managerSolo.id }]);
    expect(db.slot(w.venueSolo.id, 'guest_toilets')).toMatchObject({ status: 'available', value: 'yes', confirmation_state: 'not_required' });

    // Nothing waits at a venue with no one else.
    await app.open('/manager');
    const triage = screen.getByRole('region', 'Triage');
    await expect(triage.getByRole('link', count(0, FINDINGS))).toBeVisible();
    await expect(triage.getByRole('link', count(0, MENU_PHOTOS))).toBeVisible();
    await expect(triage.getByText(/of your earlier photos/)).toHaveCount(0);
  });

  test('after its grant is revoked a manager account has no workspace and no Add, but still reads its own upload', async ({ app, browser, screen }) => {
    const w = world();
    await signInAs(app, browser, w.managerRevoked);
    await app.open('/manager');
    await expect(screen.getByRole('heading', 'Venue access unavailable', { level: 1 })).toBeVisible();
    await expect(screen.getByText('Your venue access has ended.')).toBeVisible();
    await expect(screen.getByRole('button', 'Sign out')).toBeVisible();
    await expect(screen.getByRole('navigation', 'Venue workspace')).toHaveCount(0);
    await expect(screen.getByRole('button', /^Add( photos)?(,|$)/)).toHaveCount(0);
    await expect(browser.locator('input[type="file"]')).toHaveCount(0);
    await app.open('/manager/uploads');
    await expect(screen.getByRole('heading', 'Venue access unavailable', { level: 1 })).toBeVisible();
    // Its manager-era upload stays its own to read, and out of colleagues' Photos.
    expect(db.rlsVisible(w.managerRevoked.id, [w.seeded.revokedAsset])).toEqual([w.seeded.revokedAsset]);
    expect(db.communityReadable(w.staffB.id, [w.seeded.revokedAsset])).toEqual([]);
    expect(db.rlsVisible(w.managerB.id, [w.seeded.revokedAsset])).toEqual([]);
  });
});
