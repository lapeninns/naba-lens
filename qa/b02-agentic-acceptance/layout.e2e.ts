import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

import {
  CONTROL_IN_VIEW,
  LAYOUT_TARGETS,
  NO_HORIZONTAL_OVERFLOW,
  QUESTION,
  signInAs,
  VIEWPORT,
  VIEWPORT_SIZE,
  world,
  type ControlInView,
  type LayoutTarget,
} from './fixture';

// B02 narrow layout and accessible focus. The config runs this one test at
// each layout target (320x568, 375x667, 390x844, 1280x800, Chromium
// emulation), each as its own staffLayout person in the shared layout scope.
// The page's actual viewport is measured first and must be the target's.
//
// On Home with a two-digit To do count (world().layoutTodoCount), one photo's
// transfer is refused (browser.route + route.abort(): a dropped request while
// online, not offline) so the failed row, its Retry and Home's "didn't finish"
// card are real. Then the capture page's submit control is measured as it
// stands, before any tap could scroll it: docked and uncovered on phones.
// Keyboard focus is checked with the skip link, the To do card's button and
// Submit finding. One vision judgment, after the cards it names are scrolled
// into view and measured on screen.
//
// Copy and structure are the candidate's: tasks/next-actions.tsx (To do
// heading, "didn't finish saving" card), status-chip.tsx CountBadge,
// upload-dialog.tsx, shell/entry-copy.ts, app-shell.tsx (skip link,
// [data-slot="tabbar"]), capture-form.tsx (the dock).

const SIGNED_PUT = /\/storage\/v1\/object\/upload\/sign\//;
const FAILED_CARD = "1 photo didn't finish saving";
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const things = (n: number) => `${n} ${n === 1 ? 'thing' : 'things'} to do`;

// ---- Page sources for browser.evaluate --------------------------------------
// Function expressions, never called here: browser.evaluate invokes each one
// itself, with its one JSON argument where it takes one.

/** The To do heading's count badge: its visible digits, and whether it fits and is clipped. */
const TODO_BADGE = `() => {
  const badge = document.querySelector('#todo-heading [data-slot="count"]')
  if (!badge) return null
  const r = badge.getBoundingClientRect()
  const digits = Array.from(badge.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('').trim()
  return {
    digits,
    fitsWidth: r.left >= 0 && r.right <= document.documentElement.clientWidth,
    clipped: badge.scrollWidth > badge.clientWidth + 1 || badge.scrollHeight > badge.clientHeight + 1,
  }
}`;
type TodoBadge = { digits: string; fitsWidth: boolean; clipped: boolean } | null;

/** The widest horizontal overflow of any open dialog, in CSS pixels (0 when none overflows). */
const DIALOG_OVERFLOW = `() => Math.max(0, ...Array.from(document.querySelectorAll('[role="dialog"],[role="alertdialog"]')).map((d) => d.scrollWidth - d.clientWidth))`;

/** Scrolls the one h3 whose trimmed text is exactly the argument to the viewport's centre, instantly. */
const CENTRE_H3 = `(text) => {
  const found = Array.from(document.querySelectorAll('h3')).filter((h) => (h.textContent ?? '').trim() === text)
  if (found.length !== 1) throw new Error(found.length + ' h3 elements read "' + text + '".')
  found[0].scrollIntoView({ block: 'center', behavior: 'instant' })
  return window.scrollY
}`;

/**
 * Where the element matching the CSS selector argument is, without scrolling:
 * wholly inside the viewport, and whether the phone tab bar overlaps it.
 */
const ON_SCREEN = `(selector) => {
  const found = document.querySelectorAll(selector)
  if (found.length !== 1) throw new Error(found.length + ' elements match ' + selector + '.')
  const r = found[0].getBoundingClientRect()
  const bar = Array.from(document.querySelectorAll('[data-slot="tabbar"]')).map((b) => b.getBoundingClientRect()).find((b) => b.width > 0 && b.height > 0)
  return {
    onScreen: r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= document.documentElement.clientWidth,
    underTabbar: Boolean(bar) && bar.left < r.right && bar.right > r.left && bar.top < r.bottom && bar.bottom > r.top,
  }
}`;
type OnScreen = { onScreen: boolean; underTabbar: boolean };

/**
 * The To do card holding the one h3 whose trimmed text is exactly the
 * argument (its list item), measured like ON_SCREEN, without scrolling.
 */
const CARD_ON_SCREEN = `(text) => {
  const found = Array.from(document.querySelectorAll('section[aria-labelledby="todo-heading"] h3')).filter((h) => (h.textContent ?? '').trim() === text)
  if (found.length !== 1) throw new Error(found.length + ' To do h3 elements read "' + text + '".')
  const card = found[0].closest('li')
  if (!card) throw new Error('"' + text + '" is not in a To do card.')
  const r = card.getBoundingClientRect()
  const bar = Array.from(document.querySelectorAll('[data-slot="tabbar"]')).map((b) => b.getBoundingClientRect()).find((b) => b.width > 0 && b.height > 0)
  return {
    onScreen: r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= document.documentElement.clientWidth,
    underTabbar: Boolean(bar) && bar.left < r.right && bar.right > r.left && bar.top < r.bottom && bar.bottom > r.top,
  }
}`;

/**
 * The focused element after keyboard navigation: tag, accessible text, a
 * visible focus outline (the app's focus-visible outline, at least 2px), and
 * whether it is wholly in the viewport and clear of the phone tab bar (unless
 * it is in the bar).
 */
const FOCUS_STATE = `() => {
  const el = document.activeElement
  if (!el || el === document.body) return { tag: 'body', name: '', ring: false, inViewport: false, underTabbar: false }
  const s = getComputedStyle(el)
  const ring = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2
  const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\\s+/g, ' ')
  const r = el.getBoundingClientRect()
  const inViewport = r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= document.documentElement.clientWidth
  const bar = el.closest('[data-slot="tabbar"]') ? null : Array.from(document.querySelectorAll('[data-slot="tabbar"]')).map((b) => b.getBoundingClientRect()).find((b) => b.width > 0 && b.height > 0)
  const underTabbar = Boolean(bar) && bar.left < r.right && bar.right > r.left && bar.top < r.bottom && bar.bottom > r.top
  return { tag: el.tagName.toLowerCase(), name, ring, inViewport, underTabbar }
}`;
type FocusState = { tag: string; name: string; ring: boolean; inViewport: boolean; underTabbar: boolean };

test('B02 narrow layout: real viewport, no sideways scroll, failed upload, two-digit To do, sticky submit and visible focus', async ({ app, browser, screen, agent }) => {
  const w = world();

  // ---- The actual viewport, and which target this is --------------------------
  // Measured on the signed-out login page, before choosing whose session to use.
  await app.open('/login');
  const size = await browser.evaluate<{ width: number; height: number }>(VIEWPORT_SIZE);
  const t = LAYOUT_TARGETS.find((name) => VIEWPORT[name].width === size.width) as LayoutTarget | undefined;
  if (!t) throw new Error(`The page is ${size.width}x${size.height}, not a layout target's width.`);
  expect(size).toEqual(VIEWPORT[t]);
  const phone = t !== 'desktop';
  const who = w.staffLayout[t];
  await signInAs(app, browser, who);
  expect(await browser.evaluate<{ width: number; height: number }>(VIEWPORT_SIZE)).toEqual(VIEWPORT[t]);
  // A file still transferring arms the page's leave prompt; accept it on the way out.
  await browser.onDialog('accept');

  // ---- Home: two-digit To do, skip link focus ----------------------------------
  const n = w.layoutTodoCount;
  expect(n).toBeGreaterThanOrEqual(10);
  expect(n).toBeLessThanOrEqual(99);
  await app.open('/staff/tasks');
  await expect(browser).toHaveURL('/staff/tasks');
  await expect(screen.getByRole('heading', `To do, ${things(n)}`, { level: 2 })).toBeVisible();
  expect(await browser.evaluate<TodoBadge>(TODO_BADGE)).toEqual({ digits: String(n), fitsWidth: true, clipped: false });
  expect(await browser.evaluate(NO_HORIZONTAL_OVERFLOW)).toBe(true);

  await browser.keyboard.press('Tab');
  expect(await browser.evaluate<FocusState>(FOCUS_STATE)).toEqual({
    tag: 'a',
    name: 'Skip to content',
    ring: true,
    inViewport: true,
    underTabbar: false,
  });

  // ---- A failed upload, visible in the sheet -----------------------------------
  await browser.route(SIGNED_PUT, async (route) => {
    await route.abort();
  });
  const file = w.media.layout.split('/').at(-1)!;
  if (phone) {
    await screen.getByRole('navigation', 'Staff', { visible: true }).getByRole('button', 'Add').tap();
  } else {
    await screen.getByRole('banner').getByRole('button', 'Add photos').tap();
  }
  await screen.getByRole('dialog', 'What are you adding?').getByRole('button', /^Just photos/).tap();
  if (phone) {
    await expect(screen.getByRole('dialog', 'Add photos')).toBeVisible();
    // The sheet's own hidden library input (photo-source.tsx), inside the open dialog.
    await browser.locator('[role="dialog"] input[data-photo-source="library"]').setInputFiles([w.media.layout]);
  } else {
    await expect(screen.getByRole('dialog', 'Upload photos or videos')).toBeVisible();
    await screen.getByRole('dialog', 'Upload photos or videos').getByLabel('Choose photos or videos').setInputFiles([w.media.layout]);
  }
  const sheet = screen.getByRole('dialog', 'Saving 1 photo');
  const row = sheet.getByRole('list', 'Files').getByRole('listitem').filter({ hasText: file });
  await expect(row).toContainText('Needs attention', { timeout: 90000 });
  await expect(row.getByText('The connection was interrupted.')).toBeVisible();
  await expect(sheet.getByRole('status')).toHaveText('0 saved · 1 need attention');
  const retry = sheet.getByRole('button', `Retry ${file}`);
  await retry.scrollIntoView();
  const box = (await retry.boundingBox())!;
  expect({ left: box.x >= 0, right: box.x + box.width <= size.width, top: box.y >= 0, bottom: box.y + box.height <= size.height }).toEqual({
    left: true,
    right: true,
    top: true,
    bottom: true,
  });
  expect(await browser.evaluate<number>(DIALOG_OVERFLOW)).toBe(0);
  expect(await browser.evaluate(NO_HORIZONTAL_OVERFLOW)).toBe(true);
  await app.screenshot(`${t}-failed-upload`);
  await sheet.getByRole('button', 'Done', { exact: true }).tap();
  await expect(screen.getByRole('dialog', 'Saving 1 photo')).toHaveCount(0);

  // ---- Home counts the failure; the card and badge in view, then judged --------
  const heading = screen.getByRole('heading', `To do, ${things(n + 1)}`, { level: 2 });
  await expect(heading).toBeVisible();
  await expect(screen.getByRole('heading', FAILED_CARD, { level: 3 })).toBeVisible();
  expect(await browser.evaluate<TodoBadge>(TODO_BADGE)).toEqual({ digits: String(n + 1), fitsWidth: true, clipped: false });
  await browser.evaluate<number, string>(CENTRE_H3, FAILED_CARD);
  // Everything the judgment names is measured in view first: the heading
  // with its badge, the whole card, and the card's button (five-point hit).
  expect(await browser.evaluate<OnScreen, string>(ON_SCREEN, '#todo-heading')).toEqual({ onScreen: true, underTabbar: false });
  expect(await browser.evaluate<OnScreen, string>(CARD_ON_SCREEN, FAILED_CARD)).toEqual({ onScreen: true, underTabbar: false });
  expect(await browser.evaluate<ControlInView, string>(CONTROL_IN_VIEW, 'See them')).toMatchObject({
    inViewport: true,
    topmost: 'self',
  });
  expect(await browser.evaluate(NO_HORIZONTAL_OVERFLOW)).toBe(true);
  await app.screenshot(`${t}-home-todo`);
  await agent.assert(
    `This screenshot shows a "To do" heading with the number ${n + 1} in a dark round badge beside it, and below it a card that says "${FAILED_CARD}" with a "See them" button. ` +
      `The two-digit number ${n + 1} is fully readable inside its badge, and the card's text and its button fit the screen: nothing is cut off at an edge, overlapping other text, or hidden under a bar at the bottom of the screen. ` +
      'Judge only the heading, its badge and that card; ignore anything else on screen.',
    { vision: true, timeout: 60000 },
  );

  // Keyboard: from the heading, Tab reaches the card's button with a visible outline, in view.
  await heading.focus();
  let focused: FocusState | null = null;
  for (let presses = 0; presses < 10 && focused?.name !== 'See them'; presses++) {
    await browser.keyboard.press('Tab');
    focused = await browser.evaluate<FocusState>(FOCUS_STATE);
  }
  expect(focused).toEqual({ tag: 'button', name: 'See them', ring: true, inViewport: true, underTabbar: false });
  await browser.unroute(SIGNED_PUT);

  // ---- The capture page's submit control, as it stands -------------------------
  const check = w.scopes.layout.checks.onsite_parking;
  const question = QUESTION.onsite_parking;
  await screen.getByRole('main').getByRole('link', new RegExp(`^[A-Z][a-z]+( [a-z]+)*: ${escape(question)}$`)).first().tap();
  await expect(browser).toHaveURL(new RegExp(`/staff/tasks/amenities/${check}(\\?.*)?$`));
  await expect(screen.getByRole('heading', question, { level: 1 })).toBeVisible();
  await screen.getByRole('radio', 'No').check();
  // Typed, never sent: four targets share this check and none of them submits.
  await screen.getByLabel('Reason').fill(`DEV FIXTURE layout reason, not sent (B02 ${t} ${w.tag})`);
  await expect(screen.getByRole('button', 'Submit finding')).toBeVisible();
  expect(await browser.evaluate(NO_HORIZONTAL_OVERFLOW)).toBe(true);
  if (!phone) await screen.getByRole('button', 'Submit finding').scrollIntoView();
  // Phones: the dock holds Submit finding on screen and uncovered as it is,
  // before any tap could scroll it there. Desktop: the form's own static row.
  const submit = await browser.evaluate<ControlInView, string>(CONTROL_IN_VIEW, 'Submit finding');
  expect({ docked: submit.docked, inViewport: submit.inViewport, topmost: submit.topmost }).toEqual({
    docked: phone,
    inViewport: true,
    topmost: 'self',
  });
  expect(submit.height).toBeGreaterThanOrEqual(24);
  expect(submit.width).toBeGreaterThanOrEqual(24);
  await app.screenshot(`${t}-capture-dock`);

  // Keyboard: from Reason, Tab reaches Submit finding with a visible outline, clear of the tab bar.
  await screen.getByLabel('Reason').focus();
  focused = null;
  for (let presses = 0; presses < 6 && focused?.name !== 'Submit finding'; presses++) {
    await browser.keyboard.press('Tab');
    focused = await browser.evaluate<FocusState>(FOCUS_STATE);
  }
  expect(focused).toEqual({ tag: 'button', name: 'Submit finding', ring: true, inViewport: true, underTabbar: false });
  expect(await browser.evaluate(NO_HORIZONTAL_OVERFLOW)).toBe(true);
});
