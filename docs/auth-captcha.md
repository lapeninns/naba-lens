# Sign-in CAPTCHA

NabaLens can require Cloudflare Turnstile through Supabase Auth's native CAPTCHA
validation. The browser obtains a token; the sign-in Server Function forwards it
once in `signInWithOtp`'s `options.captchaToken`. Supabase validates it. The app
does not call Siteverify separately, because the token is single-use.

## Deployment sequence

1. Create a Turnstile widget restricted to the exact HTTPS application hostname,
   including the initial Vercel hostname if no custom domain exists yet.
2. Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` to the widget's public site key and
   `AUTH_CAPTCHA_ENABLED=true` in that application's build/runtime environment.
   Rebuild: Next.js inlines public environment values and the CSP is built from
   this configuration.
3. In the matching Supabase project's Auth bot-protection settings, select
   Turnstile and save its secret. The secret belongs only to Supabase Auth;
   never put it in browser environment variables, logs or this repository.
4. Verify the deployed widget, successful invited-user sign-in, expired/failed
   challenge retry and neutral unknown-email behavior before opening access.
   Both sides must be configured together; enabling provider CAPTCHA before
   deploying this frontend prevents sign-in.

Either a nonempty site key or `AUTH_CAPTCHA_ENABLED=true` makes the app require
verification. The server marker with a missing public key blocks requests with
an unavailable message. Missing, non-string, empty and oversized tokens are
rejected before Auth is called. Supabase's `captcha_failed` response returns a
recoverable verification error; known and unknown accounts otherwise retain the
same neutral response. Tokens are cleared after every attempted submission.
Next.js development Server Function argument logging is disabled so tokens and
email addresses are not written to the local terminal by the framework.

The widget handles loading, success, expiry, timeout and error states. A failed
widget can be reset; a failed script load offers a page reload. Its compact size
fits narrow sign-in cards. The script loads on the login page after hydration.

When enabled, CSP permits `https://challenges.cloudflare.com` in `script-src` and
`frame-src` only. It does not add a wildcard or alter the existing Auth/Storage
connection allowances.

## Local fixtures and evidence

Leave both settings empty for isolated fixture suites; no challenge is loaded or
required. The existing email-only local calls continue to work. For configured
browser checks, use Cloudflare's official test site keys with a disposable local
Auth target; never use testing secrets on a hosted production project.

Unit/UI tests cover token forwarding, missing configuration, missing/invalid
tokens, CAPTCHA failure, expiry and retries. They do not establish that the
hosted widget hostname, Supabase secret or real email delivery is configured.

Primary references: [Supabase Auth CAPTCHA](https://supabase.com/docs/guides/auth/auth-captcha),
[Cloudflare rendering/lifecycle](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/),
[CSP](https://developers.cloudflare.com/turnstile/reference/content-security-policy/) and
[official test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/).
