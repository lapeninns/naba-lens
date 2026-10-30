# Release checklist

No production release or physical-device certification is claimed. The fanout status file describes earlier integration evidence and can lag the code; use current source and final-head checks.

- [ ] Complete every owner-authorised production setup item in [setup](setup.md): confirmed venues, Supabase, disabled public sign-up, templates, SMTP, hosting, secrets, cleanup and backups.
- [ ] Select two owner-confirmed pilot venues and named participants without using DEV FIXTURE data. Invite separate staff identities and an admin; verify sign-in, upload, persistent portfolio, automatic admin visibility and byte-identical original download.
- [ ] On physical iPhone Safari and Android Chrome, record device/OS/browser, camera/gallery selection, JPEG/HEIC/HEIF conversion, MP4/MOV/WebM behavior, interruption/retry and codec fallback. Browser emulation is separate evidence.
- [ ] Recheck HEIC with a real route in the production build: worker chunks and deployment trace, Linux native dependencies, decoder memory and concurrency. Synthetic local decode evidence does not certify real phones or hosted processing.
- [ ] Verify combined filters, pagination, profile/avatar edits, invitations/resend failures, venue transfer, deactivate/reactivate, retained media and removal/cleanup retries.
- [ ] Verify cross-staff denial through UI, API and Storage, privilege escalation protection, signed-link expiry and removed-asset denial. Preserve RLS and assertions.
- [ ] Run final-head typecheck, lint, unit, integration, security, lifecycle and applicable browser/mobile checks; retain actual output and report missing prerequisites. Follow the installed QA/e2e workflow for a QA request.
- [ ] Confirm hosting request/response limits and timeouts with full-size photos/videos, email delivery in the target environment, monitored cleanup reports and isolated backup restoration.
- [ ] Owner reviews the two-venue pilot, remaining failures and publishing-permission guidance before expanding to all ten venues.

Current external blockers: physical-phone evidence, target-platform HEIC verification, owner-confirmed venue data, production email, hosting and authorised provider configuration. No provider write or deployment was performed by the docs track.
