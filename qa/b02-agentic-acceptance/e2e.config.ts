import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { chatgpt } from 'e2e/oauth/chatgpt';

import { LAYOUT_TARGETS, RUN_ID, runDir, target, VIEWPORT, type LayoutTarget } from './fixture';

// B02 agentic acceptance for the candidate in candidate.json on the
// coordinator-owned spare6 stack (README.md). One suite per run, chosen by
// B02_SUITE, each with its own new output directory under
// .results/<B02_RUN_ID>/. run.mjs checks every report against its plan
// (exact instances per target and live agent work). The Playwright charters
// have their own config (charters.config.ts) and no server of their own.
// Viewports are Chromium emulation; each test measures the page's actual
// viewport rather than trusting the target's name.
const { app: url } = target();
const app = { url, readyUrl: `${url}/login`, environment: 'test' as const };
const at = (name: LayoutTarget) => ({ name, engine: web({ viewport: VIEWPORT[name] }), app });
const desktop = at('desktop');

// Own names only: an inherited name such as "toString" or "__proto__" is not a suite.
const suites: Record<string, { tests: string; targets: ReturnType<typeof at>[] }> = Object.assign(Object.create(null), {
  staff: { tests: 'staff.e2e.ts', targets: [desktop] },
  manager: { tests: 'manager.e2e.ts', targets: [desktop] },
  recovery: { tests: 'recovery.e2e.ts', targets: [desktop] },
  layout: { tests: 'layout.e2e.ts', targets: LAYOUT_TARGETS.map(at) },
});
const name = process.env.B02_SUITE ?? '';
if (!Object.hasOwn(suites, name)) throw new Error('B02_SUITE must be staff, manager, recovery or layout.');
const suite = suites[name]!;

const runId = process.env.B02_RUN_ID ?? '';
if (!RUN_ID.test(runId)) throw new Error('B02_RUN_ID must be one plain segment (run.mjs sets it).');
const listOnly = process.env.B02_LIST_ONLY === '1';
// A real run is bound to its own world directory (.results/<B02_RUN_ID>/world).
if (!listOnly) runDir();

// Redacted wherever the runner writes; never filled or shown to the model.
// The service key mints fixture sign-in links; the database URL serves the
// read-only psql read-back. Nothing else from the stack reaches this process.
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const databaseUrl = process.env.E2E_DB_URL ?? '';
if (serviceKey.length < 8) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required (run.mjs passes spare6 env).');
if (databaseUrl.length < 8) throw new Error('E2E_DB_URL is required (run.mjs passes spare6 env).');

export default {
  projectId: `nabalens-b02-agentic-${name}`,
  tests: suite.tests,
  timeout: 300000,
  actionTimeout: 30000,
  assertionTimeout: 20000,
  workers: 1,
  retries: 0,
  cache: 'off',
  trace: 'off',
  video: 'off',
  output: `.results/${runId}/${name}`,
  reporters: ['list', 'markdown'],
  agents: {
    default: {
      // The standalone installation's ChatGPT subscription (~/e2e.config.ts).
      model: chatgpt('gpt-6-luna'),
      maxSteps: 12,
      maxModelCalls: 12,
      system:
        'You test the NabaLens staff and manager app in an isolated local DEV FIXTURE environment. Do only the goal you are given, using the controls on screen. Never upload or pick files, never delete anything, never open or answer the Wi-Fi question, never sign out, and never navigate away from the page unless the goal asks.',
      context:
        'Staff add photos and answer venue questions. "Add" opens "What are you adding?" with choices such as "A dish or drink", "Answer a venue question", "Report a change" and "Just photos". "Our menu" lists dishes; a dish has buttons to add photos of it. Answers to a venue question are Yes, No, Not applicable or "Couldn\'t establish"; No and Not applicable need a Reason. "Submit finding" sends it. Managers review photos and confirm findings.',
    },
  },
  secrets: { 'supabase-service-role': serviceKey, 'spare6-database-url': databaseUrl },
  targets: suite.targets,
} satisfies E2EConfig;
