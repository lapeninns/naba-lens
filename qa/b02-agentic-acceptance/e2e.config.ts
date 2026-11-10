import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { chatgpt } from 'e2e/oauth/chatgpt';

import { LAYOUT_TARGETS, target, VIEWPORT, type LayoutTarget } from './fixture';

// B02 agentic acceptance for the candidate in candidate.json on the
// coordinator-owned spare6 stack (README.md). One suite per run, chosen by
// B02_SUITE, each with its own output directory under .results/<B02_RUN_ID>/.
// Viewports are Chromium emulation; each test measures the page's actual
// viewport rather than trusting the target's name.
const { app: url } = target();
const app = { url, readyUrl: `${url}/login`, environment: 'test' as const };
const at = (name: LayoutTarget) => ({ name, engine: web({ viewport: VIEWPORT[name] }), app });
const desktop = at('desktop');

const suites = {
  staff: { tests: 'staff.e2e.ts', targets: [desktop] },
  manager: { tests: 'manager.e2e.ts', targets: [desktop] },
  recovery: { tests: 'recovery.e2e.ts', targets: [desktop] },
  layout: { tests: 'layout.e2e.ts', targets: LAYOUT_TARGETS.map(at) },
};
const name = process.env.B02_SUITE ?? '';
if (!(name in suites)) throw new Error('B02_SUITE must be staff, manager, recovery or layout.');
const suite = suites[name as keyof typeof suites];
const runId = process.env.B02_RUN_ID ?? '';
if (!/^[A-Za-z0-9._-]{1,64}$/.test(runId) || runId.startsWith('.')) throw new Error('B02_RUN_ID is required.');

// Redacted wherever the runner writes; never filled or shown to the model.
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (serviceKey.length < 6) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required (run.mjs passes spare6 env).');

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
  secrets: { 'supabase-service-role': serviceKey },
  targets: suite.targets,
} satisfies E2EConfig;
