import { basename } from 'node:path';

import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { db, DISH, json, QUESTION, setSaved, signInAs, target, uuid, world } from './fixture';

// B02-01, B02-02, B02-04 (staff feed) and B02-05 at 1280x800: one serial
// story in the staff scope (world().scopes.staff), which no manager,
// recovery or layout case touches. Each member signs in as the person it
// needs (signInAs clears the previous person's state first). Every
// important outcome is read back from the database read-only. The one
// agent.act (the shared entry's question, case 2) is pinned right after by
// its URL, its notice and its rows.
//
// Copy, routes and names are the candidate's own (app 1c538949):
// home-overview.tsx, next-actions.tsx, entry-flow.tsx / entry-copy.ts,
// capture-form.tsx, finding-sent-notice.tsx, upload-dialog.tsx,
// my-contributions.tsx and knowledge/copy.ts.

const reason = (what: string) => `DEV FIXTURE ${what} (B02 acceptance ${world().tag})`;
const capture = (checkId: string) => `/staff/tasks/amenities/${checkId}`;
const sentHome = (checkId: string) => `/staff/tasks?finding_sent=${checkId}`;
/** The Add host's own library picker; the dish button's click owns what is picked next. */
const LIBRARY = 'input[type="file"][data-photo-source="library"]';
/** A signed Storage PUT: <api>/storage/v1/object/upload/sign/media/<uid>/<assetId>/original.<ext>?token=... */
const SIGNED_PUT = /\/storage\/v1\/object\/upload\/sign\//;
const PUT_ASSET = /\/media\/[0-9a-f-]{36}\/([0-9a-f-]{36})\/original\.[a-z0-9]+(\?|$)/;
const scope = () => world().scopes.staff;

type ReplacementRows = {
  original: { state: string; reason: string | null; revision: number; requirement: string | null; author: string } | null;
  replacements: { state: string; origin: string; requirement: string | null; replaces: string; asset: string; author: string }[];
};
/**
 * Local read-only fact: the reviewed original task photo and every item that
 * replaces it (coverage_submission_items.replaces_item_id). Ids and states only.
 */
const replacementRows = (itemId: string) =>
  json<ReplacementRows>(`select json_build_object(
      'original', (select json_build_object('state', o.state, 'reason', o.decision_reason, 'revision', o.revision,
                     'requirement', o.requirement_id, 'author', o.author_id)
                   from public.coverage_submission_items o where o.id = ${uuid(itemId)}),
      'replacements', (select coalesce(json_agg(json_build_object('state', n.state, 'origin', n.origin,
                     'requirement', n.requirement_id, 'replaces', n.replaces_item_id, 'asset', n.asset_id,
                     'author', n.author_id) order by n.submitted_at, n.id), '[]')
                   from public.coverage_submission_items n where n.replaces_item_id = ${uuid(itemId)}))`);

describe('B02 staff Home, shared entry, photo sets and contributions', { serial: true }, () => {
  test('Home leads with a requested replacement and returns from it; then orders the label card before the assigned check, and labelling it updates To do and the badge', async ({ app, browser, screen }) => {
    const w = world();
    const s = scope();
    const toilets = QUESTION.guest_toilets;

    // ---- Replacement (staffReplacement, the only actor with the request) ------
    // The seed's genuine needs_another_photo decision on one task photo:
    // Home's lead card leads to that task with ?replaces=, the task explains
    // the request, a new photo is sent once through the real task upload, and
    // the request leaves To do. The candidate acknowledges on the task page;
    // Home can parse a ?replaced= banner, but no send path emits that query,
    // so no Home banner is reachable (an acceptance gap, reported, not faked:
    // the harness never builds a success URL).
    const r = w.seeded.replacement;
    const replaceHref = `/staff/tasks/${r.requirementId}?replaces=${r.itemId}`;
    const original = { state: 'needs_another_photo', reason: r.reason, revision: r.revision, requirement: r.requirementId, author: w.staffReplacement.id };
    expect(replacementRows(r.itemId)).toEqual({ original, replacements: [] });
    await signInAs(app, browser, w.staffReplacement);
    await app.open('/staff/tasks');
    const ownTodo = screen.getByRole('region', /^To do, \d+ things? to do$/);
    const lead = ownTodo.getByRole('listitem').first();
    // The card names the reviewer (never the task) in its heading; the task title and reason follow.
    await expect(lead.getByRole('heading', { level: 3 })).toHaveText(/^.+ asked for another photo$/);
    await expect(lead.getByText(`For: ${r.title}`, { exact: true })).toBeVisible();
    await expect(lead.getByText(`Reason: ${r.reason}`, { exact: true })).toBeVisible();
    const sendAnother = lead.getByRole('link', `Send another photo for ${r.title}`);
    await expect(sendAnother).toHaveAttribute('href', replaceHref);
    await sendAnother.tap();
    await expect(browser).toHaveURL(replaceHref);
    await expect(screen.getByRole('heading', 'Send another photo', { level: 1 })).toBeVisible();
    const asked = screen.getByRole('region', 'What your reviewer asked for');
    await expect(asked).toContainText(r.reason);
    await expect(asked.getByText('The photos you send now replace this one.', { exact: true })).toBeVisible();

    // The real task upload: the shell's own library picker, then one send.
    const replacementFile = basename(w.media.replacement);
    expect(db.assets(w.staffReplacement.id, replacementFile)).toEqual([]);
    await screen.getByRole('button', 'Choose from your photos').tap();
    await browser.locator(LIBRARY).setInputFiles(w.media.replacement);
    const replacementSheet = screen.getByRole('dialog', 'Saving 1 photo');
    await expect(replacementSheet.getByRole('status')).toHaveText('1 saved', { timeout: 120000 });
    await replacementSheet.getByRole('button', 'Done', { exact: true }).tap();
    const picked = db.assets(w.staffReplacement.id, replacementFile);
    expect(picked.map(({ mediaType, state, role, venue, deleted }) => ({ mediaType, state, role, venue, deleted }))).toEqual([
      { mediaType: 'image', state: 'ready', role: 'staff', venue: s.venue.id, deleted: false },
    ]);
    await expect(screen.getByText('1 new photo selected.', { exact: true })).toBeVisible({ timeout: 30000 });
    await screen.getByRole('button', 'Send another photo').tap();
    const ack = screen.getByRole('status').filter({ hasText: 'Your new photo is waiting for review' });
    await expect(ack).toBeVisible({ timeout: 30000 });
    await expect(ack).toContainText(/Sent\. .+ reviews it next\. Your earlier photo stays in Photos and on your profile\./);
    // One replacement, submitted, for the same requirement and original; the
    // original keeps its decision, reason and revision.
    await expect
      .poll(() => replacementRows(r.itemId), { timeout: 30000 })
      .toEqual({
        original,
        replacements: [{ state: 'submitted', origin: 'submitted', requirement: r.requirementId, replaces: r.itemId, asset: picked[0]!.id, author: w.staffReplacement.id }],
      });

    // Back through the task page's own Home control: the request has left To do.
    await screen.getByRole('main').getByRole('link', 'Home', { exact: true }).tap();
    await expect(browser).toHaveURL('/staff/tasks');
    await expect(screen.getByRole('heading', 'Home', { level: 1 })).toBeVisible();
    await expect(screen.getByRole('link', `Send another photo for ${r.title}`)).toHaveCount(0);
    await expect(screen.getByRole('heading', /asked for another photo$/, { level: 3 })).toHaveCount(0);
    expect(replacementRows(r.itemId).replacements).toHaveLength(1);

    // ---- Labels card and assigned check (staffSet): To do 2 -> 1 -> 0 ----------
    await signInAs(app, browser, w.staffSet);

    // -- Badge and list agree, seen from Me (the badge never shows on Home itself).
    await app.open('/staff');
    const nav = screen.getByRole('navigation', 'Staff');
    await expect(nav.getByRole('link', /^Home ?, ?2 things to do$/)).toBeVisible();

    // -- To do, in the approved order: labels (rank 5) before an assigned check (rank 6).
    await app.open('/staff/tasks');
    await expect(screen.getByRole('heading', 'Home', { level: 1 })).toBeVisible();
    const todo = screen.getByRole('region', 'To do, 2 things to do');
    await expect(todo.getByRole('heading', { level: 3 })).toHaveText(['1 photo needs labels', toilets]);
    await expect(todo.getByRole('link', `Start check: ${toilets}`)).toBeVisible();
    // A card in To do leaves the working list below (only counted there).
    await expect(screen.getByRole('list', 'Amenity checks').getByRole('link', `Start check: ${toilets}`)).toHaveCount(0);

    // -- The label card leads to Me's Needs labels, then the label editor.
    await todo.getByRole('link', 'Label these').tap();
    await expect(browser).toHaveURL('/staff#needs-labels-heading');
    await screen.getByRole('button', 'Label this photo').tap();
    const editor = screen.getByRole('dialog', 'Labels');
    await expect(editor).toBeVisible();
    await editor.getByRole('combobox', /^Menu item at /).pressSequentially('Garlic');
    await editor.getByRole('option', new RegExp(`^${DISH.naan}`)).tap();
    await editor.getByRole('button', /^Save labels/).tap();
    await expect(editor).toBeHidden({ timeout: 30000 });
    await expect.poll(() => db.labelItems(w.seeded.unlabelledAsset), { timeout: 30000 }).toEqual([DISH.naan]);
    // Labelling is not review: no decision row, no credit.
    expect(db.photoRows(w.seeded.unlabelledAsset)).toEqual([]);
    expect(db.credit(s.venue.id, w.staffSet.id)).toEqual({ menu: 0, checks: 0 });

    // -- Home now leads with the check; badge follows.
    await app.open('/staff/tasks');
    const after = screen.getByRole('region', 'To do, 1 thing to do');
    await expect(after.getByRole('heading', { level: 3 })).toHaveText([toilets]);
    await expect(after.getByText('1 photo needs labels')).toHaveCount(0);
    await app.open('/staff');
    await expect(screen.getByRole('navigation', 'Staff').getByRole('link', /^Home ?, ?1 thing to do$/)).toBeVisible();
  });

  test('the shared entry answers a venue question from Home and returns there with the acknowledgement and history (agent.act)', async ({ app, browser, screen, agent }) => {
    const w = world();
    const s = scope();
    const check = s.checks.guest_toilets;
    const toilets = QUESTION.guest_toilets;
    const why = reason('no customer toilets on site');
    await signInAs(app, browser, w.staffSet);
    await app.open('/staff/tasks');

    // -- Add: the venue strip comes before any choice; staff see the question intent.
    await screen.getByRole('button', 'Add photos').tap();
    const entry = screen.getByRole('dialog', 'What are you adding?');
    await expect(entry.getByText(`For ${s.venue.name}`)).toBeVisible();
    await expect(entry.getByText('A dish or drink', { exact: true })).toBeVisible();
    await expect(entry.getByText('Just photos', { exact: true })).toBeVisible();
    await entry.getByRole('button', /^Answer a venue question/).tap();
    await expect(screen.getByRole('heading', 'Which question?')).toBeVisible();
    await expect(screen.getByText('Your manager sees this.')).toBeVisible();

    // -- The agent finishes the user's goal from the question list.
    await agent.act(
      'In the "Which question?" list choose {question}. On that question\'s page answer No, type {reason} in the Reason box, then press "Submit finding".',
      { params: { question: toilets, reason: why } },
    );

    // -- Return route and acknowledgement: from=home goes back to Home for this check.
    await expect(browser).toHaveURL(sentHome(check), { timeout: 30000 });
    const notice = screen.getByRole('status').filter({ hasText: 'Finding sent' });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(`${toilets} It's now the venue's answer.`);
    await notice.getByRole('button', 'Dismiss').tap();
    await expect(browser).toHaveURL('/staff/tasks');
    await expect(screen.getByRole('heading', 'To do', { level: 2 })).toBeFocused();
    await expect(screen.getByText('Nothing to do right now.')).toBeVisible();

    // -- Persisted: one finding, current, and the one submission that can earn check credit.
    expect(db.contributions(check)).toEqual([{ by: w.staffSet.id, kind: 'finding', answer: 'no', outcome: 'current' }]);
    expect(db.submissions(check)).toEqual([{ answer: 'no', by: w.staffSet.id }]);
    expect(db.drafts(check)).toBe(0);
    expect(db.slot(s.venue.id, 'guest_toilets')).toMatchObject({ status: 'available', value: 'no', confirmation_state: 'not_required' });
    expect(db.credit(s.venue.id, w.staffSet.id)).toEqual({ menu: 0, checks: 1 });

    // -- History on Me: the finding and the photo labelled in case 1, no drafts.
    await app.open('/staff');
    await expect(screen.getByRole('region', 'My contributions')).toBeVisible();
    const feed = screen.getByRole('list', 'My contributions');
    // The inner heading is page-relative (screen): filter({ has }) resolves it
    // from each candidate row, so it must not restate the outer list.
    const finding = feed.getByRole('listitem').filter({ has: screen.getByRole('heading', toilets, { level: 3 }) });
    await expect(finding.getByText('Answer: No')).toBeVisible();
    await expect(finding.getByText('In use as the venue\'s answer.')).toBeVisible();
    await expect(finding).toHaveCount(1);
    const photo = feed.getByRole('listitem').filter({ has: screen.getByRole('heading', DISH.naan, { level: 3 }) });
    await expect(photo).toHaveCount(1);
    await expect(photo.getByText('Upload: Saved')).toBeVisible();
    await expect(photo.getByText('Labels: Labelled')).toBeVisible();
    await expect(photo.getByText(`${DISH.naan}: Waiting`)).toBeVisible();
    await expect(screen.getByRole('list', 'Drafts')).toHaveCount(0);
  });

  test('a three-photo dish set survives one member\'s failed transfer and a re-pick of that file: one group, three members, no duplicate and no credit', async ({ app, browser, screen }) => {
    const w = world();
    const s = scope();
    const names = w.media.set.map((p) => basename(p));
    const failing = names[1]!;
    const prefix = names[0]!.replace(/-1-.*/, '-');
    await signInAs(app, browser, w.staffSet);
    await app.open('/staff/menu');
    await expect(screen.getByRole('heading', 'Our menu', { level: 1 })).toBeVisible();
    const dish = screen.getByRole('article', DISH.tandoor);
    // Optional guidance is offered, closed, next to the dishes: the one disclosure group holding the tips
    // (its summary text also names the group, so a bare text query matches both).
    const tips = screen.getByRole('main').getByRole('group').filter({ hasText: 'What a useful photo shows' });
    await expect(tips).toHaveCount(1);
    await expect(tips).toBeVisible();

    // -- Every PUT of the second member's reservation is dropped at the network
    // level (the transport retries 6 times, then reports it). Only that
    // asset's real PUT at the guarded loopback storage origin is intercepted
    // (the asset is known from the URL, so only that member fails, whatever
    // the order); the route is released in finally, pass or fail.
    const storage = target().api;
    let drops = 0;
    await browser.route(SIGNED_PUT, async (route) => {
      const url = route.request.url;
      const asset = PUT_ASSET.exec(url)?.[1];
      const failingPut =
        route.request.method === 'PUT' &&
        new URL(url).origin === storage &&
        asset !== undefined &&
        db.assets(w.staffSet.id, failing).some((a) => a.id === asset);
      if (failingPut) {
        drops++;
        await route.abort();
      } else await route.continue();
    });
    let routed = true;
    const release = async () => {
      if (routed) await browser.unroute(SIGNED_PUT);
      routed = false;
    };
    try {
      await dish.getByRole('button', 'Choose from photos').tap();
      await browser.locator(LIBRARY).setInputFiles([...w.media.set]);
      // The sheet's name counts its rows ("Saving N photos"), which the re-pick changes.
      const sheet = screen.getByRole('dialog', /^Saving \d+ photos$/);
      await expect(sheet).toHaveAccessibleName('Saving 3 photos');
      const row = (name: string) => sheet.getByRole('list', 'Files').getByRole('listitem').filter({ hasText: name });
      await expect(row(failing)).toContainText('Needs attention', { timeout: 90000 });
      await expect(row(failing).getByText('The connection was interrupted.', { exact: true })).toBeVisible();
      for (const ok of [names[0]!, names[2]!]) {
        await expect(row(ok).getByText(`Saved · ${DISH.tandoor} · waiting for manager review`)).toBeVisible({ timeout: 60000 });
      }
      await expect(sheet.getByRole('status')).toHaveText('2 saved · 1 need attention', { timeout: 60000 });
      await expect(sheet.getByText(setSaved(2, DISH.tandoor))).toBeVisible();
      await expect(sheet.getByText(`${failing}: The connection was interrupted.`)).toBeVisible();
      expect(drops).toBe(6);

      // -- Persisted before recovery: three reservations, the failed one not
      // finished, already a member of the one set.
      const before = db.assets(w.staffSet.id, prefix);
      expect(before).toHaveLength(3);
      const failedAsset = db.assets(w.staffSet.id, failing);
      expect(failedAsset.map(({ state, role, deleted }) => ({ state, role, deleted }))).toEqual([{ state: 'uploading', role: 'staff', deleted: false }]);
      const ids = before.map((a) => a.id).sort();
      await expect.poll(() => db.groupsOf(ids).map((g) => g.members.length), { timeout: 30000 }).toEqual([3]);
      const groupId = db.groupsOf(ids)[0]!.id;
      // Ordered membership before recovery: the failed member already holds its position.
      const ordered = db.groupsOf(ids)[0]!.members.map((m) => ({ asset: m.asset, position: m.position }));
      expect(ordered.map((m) => m.position)).toEqual([1, 2, 3]);
      expect(ordered.map((m) => m.asset)).toContain(failedAsset[0]!.id);

      // -- Recovery by re-pick: the same file chosen again through the sheet's
      // own "Add more to this set" (a candidate path that joins the same set).
      // The device's upload key (name, size, type, modified time) finds the
      // unfinished reservation, so the same asset finishes. This is a real
      // re-pick of the file from disk, not Retry of the in-memory File; the
      // single-photo page-close re-pick is charter B02-06-A.
      await release();
      await sheet.getByRole('button', 'Add more to this set').tap();
      // The sheet's own library input (its camera input is a second file input).
      await sheet.getByLabel(/^Choose photos( or videos)?$/).setInputFiles(w.media.set[1]);
      await expect(sheet).toHaveAccessibleName('Saving 4 photos');
      await expect(row(failing)).toHaveCount(2);
      const repicked = row(failing).filter({ hasText: `Saved · ${DISH.tandoor} · waiting for manager review` });
      await expect(repicked).toHaveCount(1, { timeout: 60000 });
      await expect.poll(() => db.assets(w.staffSet.id, failing).map(({ id, state }) => ({ id, state })), { timeout: 30000 }).toEqual([
        { id: failedAsset[0]!.id, state: 'ready' },
      ]);
      // The earlier attempt's row stays in the sheet (the queue does not merge a
      // re-pick into it), so the summary still counts it. It is left alone:
      // Remove on it discards the dish labels held for the shared asset id
      // (upload-dialog.tsx remove -> labels.discard), which would clear the
      // re-picked member's label. That is reported as a candidate defect, not
      // exercised or asserted around here. Done only hides the queue.
      await expect(sheet.getByRole('status')).toHaveText('3 saved · 1 need attention', { timeout: 60000 });
      await expect(sheet.getByText(setSaved(3, DISH.tandoor))).toBeVisible();
      const stale = row(failing).filter({ hasText: 'Needs attention' });
      await expect(stale).toHaveCount(1);
      await expect(stale.getByRole('button', `Retry ${failing}`)).toBeVisible();
      await expect(stale.getByRole('button', `Remove ${failing}`)).toBeVisible();
      await expect(sheet.getByRole('button', /^Retry /)).toHaveCount(1);
      await sheet.getByRole('button', 'Done', { exact: true }).tap();
      await expect(sheet).toBeHidden();

      const assets = db.assets(w.staffSet.id, prefix);
      expect(assets.map(({ filename, state, role, venue, deleted }) => ({ filename, state, role, venue, deleted }))).toEqual(
        expect.arrayContaining(names.map((filename) => ({ filename, state: 'ready', role: 'staff', venue: s.venue.id, deleted: false }))),
      );
      expect(assets).toHaveLength(3);
      expect(assets.map((a) => a.id).sort()).toEqual(ids);
      expect(db.assets(w.staffSet.id, failing)[0]!.id).toBe(failedAsset[0]!.id);
      const groups = db.groupsOf(ids);
      expect(groups).toHaveLength(1);
      expect(groups[0]).toMatchObject({ id: groupId, createdBy: w.staffSet.id, venue: s.venue.id, subjectKind: 'menu_item', subjectId: s.items.tandoor });
      // The same set, membership and order: the re-picked file finished the same member.
      expect(groups[0]!.members.map((m) => ({ asset: m.asset, position: m.position }))).toEqual(ordered);
      expect(groups[0]!.members.map((m) => m.state)).toEqual(['ready', 'ready', 'ready']);
      for (const id of ids) {
        await expect.poll(() => db.labelItems(id), { timeout: 30000 }).toEqual([DISH.tandoor]);
        expect(db.photoRows(id)).toEqual([]);
      }
      // No credit widening: the set waits for review; checks credit is case 2's one answer.
      expect(db.acceptedEvents(s.venue.id, w.staffSet.id)).toBe(0);
      expect(db.credit(s.venue.id, w.staffSet.id)).toEqual({ menu: 0, checks: 1 });

      // -- Per-member state in My contributions and on the dish.
      await app.open('/staff');
      const feed = screen.getByRole('list', 'My contributions');
      await expect(feed.getByText('One of a set of 3')).toHaveCount(3);
      await expect(feed.getByText(`${DISH.tandoor}: Waiting`)).toHaveCount(3);
      await expect(feed.getByRole('heading', DISH.tandoor, { level: 3 })).toHaveCount(3);
      await app.open('/staff/menu');
      await expect(screen.getByRole('article', DISH.tandoor).getByText('3 of your photos are waiting for review')).toBeVisible();
    } finally {
      await release();
    }
  });

  test('front of house reports a change and records Couldn\'t establish from Me; the bartender\'s drink photo reaches My contributions', async ({ app, browser, screen }) => {
    const w = world();
    const s = scope();
    const toilets = s.checks.guest_toilets;
    const parking = s.checks.onsite_parking;

    // -- Front of house continues the staff set's answer: Report a change from Add on Home.
    await signInAs(app, browser, w.staffFoh);
    await app.open('/staff/tasks');
    await screen.getByRole('button', 'Add photos').tap();
    const entry = screen.getByRole('dialog', 'What are you adding?');
    await expect(entry.getByText(`For ${s.venue.name}`)).toBeVisible();
    await entry.getByRole('button', /^Report a change/).tap();
    await expect(screen.getByRole('heading', 'Which answer has changed?')).toBeVisible();
    await screen.getByRole('link', QUESTION.guest_toilets).tap();
    await expect(browser).toHaveURL(`${capture(toilets)}?from=home`);
    await expect(screen.getByRole('heading', QUESTION.guest_toilets, { level: 1 })).toBeVisible();
    await expect(screen.getByText(/Current answer: No, recorded .+\. If you send a different answer, it's marked as being checked until your manager decides\./)).toBeVisible();
    const changed = reason('a portable toilet was added for events');
    await screen.getByLabel('What changed?').fill(changed);
    await screen.getByRole('radio', 'Not applicable').check();
    await screen.getByLabel('Reason').fill(changed);
    await screen.getByRole('button', 'Send change report').tap();
    await expect(browser).toHaveURL(sentHome(toilets), { timeout: 30000 });
    const notice = screen.getByRole('status').filter({ hasText: 'Change report sent' });
    await expect(notice).toContainText(`${QUESTION.guest_toilets} Until your manager decides, the recorded answer is marked as being checked.`);
    expect(db.contributions(toilets)).toEqual([
      { by: w.staffSet.id, kind: 'finding', answer: 'no', outcome: 'current' },
      { by: w.staffFoh.id, kind: 'change_report', answer: 'not_applicable', outcome: 'awaiting_confirmation' },
    ]);
    expect(db.submissions(toilets)).toEqual([{ answer: 'no', by: w.staffSet.id }]);
    expect(db.slot(s.venue.id, 'guest_toilets')).toMatchObject({ status: 'unavailable', reason: 'disputed', open_dispute: true });

    // -- Started from Me: the question returns to Me, with no Home notice.
    await app.open('/staff');
    await screen.getByRole('button', 'Add photos').tap();
    await screen.getByRole('dialog', 'What are you adding?').getByRole('button', /^Answer a venue question/).tap();
    await expect(screen.getByRole('heading', 'Which question?')).toBeVisible();
    await screen.getByRole('link', QUESTION.onsite_parking).tap();
    await expect(browser).toHaveURL(`${capture(parking)}?from=me`);
    await expect(screen.getByRole('heading', QUESTION.onsite_parking, { level: 1 })).toBeVisible();
    const tried = reason('asked the duty manager; the car park sign was covered');
    await screen.getByRole('radio', 'Couldn\'t establish').check();
    await screen.getByRole('radio', 'No one could say for sure').check();
    await screen.getByLabel('What did you try?').fill(tried);
    await screen.getByRole('button', 'Submit finding').tap();
    await expect(browser).toHaveURL('/staff', { timeout: 30000 });
    expect(db.contributions(parking)).toEqual([{ by: w.staffFoh.id, kind: 'finding', answer: 'unknown', outcome: 'recorded' }]);
    expect(db.submissions(parking)).toEqual([]);
    expect(db.credit(s.venue.id, w.staffFoh.id)).toEqual({ menu: 0, checks: 0 });
    const fohFeed = screen.getByRole('list', 'My contributions');
    const fohRow = (q: string) => fohFeed.getByRole('listitem').filter({ has: screen.getByRole('heading', q, { level: 3 }) });
    await expect(fohRow(QUESTION.onsite_parking)).toHaveCount(1);
    await expect(fohRow(QUESTION.guest_toilets)).toHaveCount(1);
    await expect(fohRow(QUESTION.onsite_parking).getByText('Answer: Couldn\'t establish')).toBeVisible();
    await expect(fohRow(QUESTION.guest_toilets).getByText('Answer: Not applicable')).toBeVisible();

    // -- Bartender: one drink photo from Our menu, labelled by the dish preset.
    await signInAs(app, browser, w.staffBar);
    await app.open('/staff/menu');
    const lager = screen.getByRole('article', DISH.lager);
    await lager.getByRole('button', 'Choose from photos').tap();
    await browser.locator(LIBRARY).setInputFiles(w.media.bar);
    const sheet = screen.getByRole('dialog', 'Saving 1 photo');
    const file = basename(w.media.bar);
    await expect(sheet.getByRole('list', 'Files').getByRole('listitem').filter({ hasText: file }).getByText(`Saved · ${DISH.lager} · waiting for manager review`)).toBeVisible({ timeout: 60000 });
    await expect(sheet.getByRole('status')).toHaveText('1 saved');
    await sheet.getByRole('button', 'Done', { exact: true }).tap();
    const [bar] = db.assets(w.staffBar.id, file);
    expect(db.assets(w.staffBar.id, file).map(({ state, role, venue }) => ({ state, role, venue }))).toEqual([{ state: 'ready', role: 'staff', venue: s.venue.id }]);
    await expect.poll(() => db.labelItems(bar!.id), { timeout: 30000 }).toEqual([DISH.lager]);
    expect(db.groupsOf([bar!.id])).toEqual([]);
    expect(db.photoRows(bar!.id)).toEqual([]);
    expect(db.credit(s.venue.id, w.staffBar.id)).toEqual({ menu: 0, checks: 0 });
    await app.open('/staff');
    const barFeed = screen.getByRole('list', 'My contributions');
    const barRow = barFeed.getByRole('listitem').filter({ has: screen.getByRole('heading', DISH.lager, { level: 3 }) });
    await expect(barRow).toHaveCount(1);
    await expect(barRow.getByText('Upload: Saved')).toBeVisible();
    await expect(barRow.getByText('Labels: Labelled')).toBeVisible();
    await expect(barRow.getByText(`${DISH.lager}: Waiting`)).toBeVisible();
    await expect(barFeed.getByText('One of a set of', { exact: false })).toHaveCount(0);
  });
});
