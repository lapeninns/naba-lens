import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { chatgpt } from 'e2e/oauth/chatgpt';

import { readerCredential, target } from './fixture';

// B01 agentic acceptance for candidate a41cc6b4 on the coordinator-owned
// spare6 stack (README.md). One suite per run, chosen by B01_SUITE, each
// with its own output directory under .results/<B01_RUN_ID>/.
const { app: url } = target();
const app = { url, readyUrl: `${url}/login`, environment: 'test' as const };
const desktop = { name: 'desktop', engine: web({ viewport: { width: 1280, height: 800 } }), app };
const phone = { name: 'phone-390', engine: web({ viewport: { width: 390, height: 844 } }), app };

const suites = {
  journey: { tests: 'journey.e2e.ts', targets: [desktop] },
  reader: { tests: 'reader.e2e.ts', targets: [desktop] },
  narrow: { tests: 'narrow.e2e.ts', targets: [phone] },
};
const name = process.env.B01_SUITE ?? '';
if (!(name in suites)) throw new Error('B01_SUITE must be journey, reader or narrow.');
const suite = suites[name as keyof typeof suites];
const runId = process.env.B01_RUN_ID ?? '';
if (!/^[A-Za-z0-9._-]{1,64}$/.test(runId)) throw new Error('B01_RUN_ID is required.');

// Static values are redacted wherever the runner writes; neither is ever
// filled or shown to the model.
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (serviceKey.length < 6) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required (source spare6 env.sh).');
const credential = readerCredential();

export default {
  projectId: `nabalens-b01-agentic-${name}`,
  tests: suite.tests,
  timeout: 240000,
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
        'You test the NabaLens staff app in an isolated local DEV FIXTURE environment. Do only the goal you are given, using the controls on screen. Never upload files, never open or answer the Wi-Fi question, never use Save for later unless asked, and never navigate away from the page unless asked.',
      context:
        'Staff answer amenity questions about their venue. An answer is chosen with the Yes, No, Not applicable or "Couldn\'t establish" options; No and Not applicable need a Reason. "Submit finding" sends it.',
    },
  },
  secrets: {
    'supabase-service-role': serviceKey,
    ...(credential ? { 'reader-credential': credential } : {}),
  },
  targets: suite.targets,
} satisfies E2EConfig;
