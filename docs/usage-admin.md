# Admin guide

Sign in at `/login` with your invited admin email. Content (`/admin`) shows ready media newest first. Combine Venue, Staff member and media-type filters, clear them to broaden results, and use pagination for more items. Venue filtering describes the upload-time venue. The foreground library refreshes about every 15 seconds and on focus.

Open an item to preview it or download its original individually. Video playback depends on browser/codec support; use the original-download option when preview is unavailable. Check privacy and permission before using it outside NabaLens: library presence is not publishing clearance.

Open Staff (`/admin/staff`) to find a contributor and open their portfolio. Invite staff with their name, email, job title and venue. Read the result carefully: account creation and email delivery can fail separately. Use resend invitation when appropriate; do not create duplicate accounts to repair delivery.

Edit account details to change name, job title, photo or current venue. A transfer affects future uploads; historical media keeps its original venue. Deactivate a departing staff member to block protected operations, including existing sessions. Their retained media remains available to admins. Reactivate only when authorised. Creating additional admins requires the controlled operator bootstrap procedure in [setup](setup.md).

Remove an asset from its viewer and confirm: it disappears from both library and portfolio. Failed physical deletion is retried by cleanup. Deactivation does not delete media. Existing short-lived signed links and downloaded copies cannot be instantly recalled.
