import type { Browser } from '@e2e-dev/web';
import { expect, type Locator, type Screen } from 'e2e';

import { homeAfterSend, SENT, type SentOutcome } from './fixture';

/**
 * A successful staff send lands on Home for that exact check, which shows the
 * outcome in a status notice: the title on its own line, then the question
 * and the outcome body in one text block (finding-sent-notice.tsx). The body
 * is checked by scoped containment after the question, not as its own node.
 * Returns the notice for any further scoped checks.
 */
export async function expectSentOnHome(
  browser: Browser,
  screen: Screen,
  checkId: string,
  question: string,
  outcome: SentOutcome,
): Promise<Locator> {
  await expect(browser).toHaveURL(homeAfterSend(checkId), { timeout: 30000 });
  const notice = screen.getByRole('status').filter({ has: screen.getByText(question) });
  await expect(notice).toBeVisible();
  const { title, body } = SENT[outcome];
  await expect(notice.getByText(title)).toBeVisible();
  await expect(notice).toContainText(`${question} ${body}`);
  return notice;
}
