# Operations

Capture only when safe and without interrupting service. Do not photograph hazards while handling food, equipment or guests. Keep private paperwork, payment details, screens and personal information out of frame. Obtain permission before capturing identifiable people, including staff and customers. Follow the organisation's safeguarding rules. Presence in the library is not publishing clearance: the person publishing must check permission and intended use separately.

Check upload failures per file, storage quota, provider size caps, email delivery and server processing logs. Do not log credentials, signed URLs or private content. Confirm that originals and derivatives remain private and that a different staff account cannot retrieve an asset. Escalate repeated processing failures rather than weakening validation. Native video preview is not universal transcoding.

`lib/config/media.ts` defines the limits: ten files, two transfers, 20 MiB photos, 200 MiB videos, 5 MiB avatars, 60-second signed reads and a 24-hour abandoned-upload window. These are code settings, not environment variables. Ready media has no automatic age-based expiry; the owner must approve retention and removal policy. Deactivation retains ready assets.

Run `pnpm cleanup` with the authorised service environment, or schedule POST `/api/internal/cleanup` with `Authorization: Bearer <CLEANUP_SECRET>`. The secret must be at least 32 characters. Inspect the JSON report, including failures, skipped lock and remaining work. The script exits 1 on removal failures and 2 on errors. HTTP 200 alone does not prove every object was removed. Retry failed removals through later runs. See [cleanup](cleanup.md) for batches, leases and active-transfer protection. No scheduler is configured by this documentation.

Deletion hides the asset immediately and blocks new grants, while physical removal can remain pending. Already issued signed links can remain usable until expiry; already downloaded or otherwise saved copies cannot be revoked. Keep exported files in approved storage and apply the organisation's retention policy there too. Backups need their own authorised retention and restore process.
