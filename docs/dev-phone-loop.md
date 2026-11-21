# Local phone development

## Start once, then edit and refresh

Start Docker Desktop. Connect the Mac and both phones to the same trusted Wi-Fi.
From the Naba-Lens checkout, use Node 24.16.0 and pnpm 10.30.1, as in the
[setup runbook](setup.md#1-prerequisites-and-dependency-policy).

```sh
cd '/Users/amankumarshrestha/LapenInns Project/platform/nabalens'
pnpm install --frozen-lockfile
docker ps --format 'table {{.Names}}\t{{.Ports}}'
lsof -nP -iTCP:3479 -iTCP:61421 -iTCP:61422 -iTCP:61424 -sTCP:LISTEN
pnpm dev:phone --setup 61400 3479
```

If `pnpm --version` reports 11 on this Mac, run `export PATH=/opt/homebrew/bin:$PATH`
to select the installed 10.30.1 before running these commands.

Choose an unused 100-port block and app port. The example uses 614xx and 3479.
Setup copies the Supabase config, migrations, seed and mail templates to a
temporary workdir with its own project ID. It sets the LAN origin as Auth's
`site_url`, adds its `/auth/callback` to `additional_redirect_urls`, and starts
that stack. Later launches update the copied Auth settings and restart your stack
if the Mac's address changes. Save the **Workdir** shown by the command.

Open the printed **Phone URL** on each phone. Save code as usual and refresh
the same tab if Next's hot refresh hasn't updated it. The launcher supplies
the LAN site and API URLs and the owned stack's keys to its Next process.
It enables immediate posting to the private staff Album. If an existing
workdir predates the staff Album migration, copy the migration into that
workdir and apply it with `supabase --workdir "$PHONE_STACK" migration up --local`.

```sh
# Set this to the Workdir printed by dev:phone --setup.
PHONE_STACK='/path/from/Workdir'
pnpm dev:phone "$PHONE_STACK"

# In a second terminal, reset the owned database and reapply the copied seed.
pnpm dev:reset "$PHONE_STACK"

# After stopping Next with Ctrl-C, stop this stack when finished.
supabase --workdir "$PHONE_STACK" stop
```

The reset requires the launcher-created workdir and its running local database.
It resets database rows and retains the Docker storage volume.
If you edit migrations or seed data, create a fresh owned stack from the new
sources. Use the printed fixture URL for one-tap sign-in. It lists active seeded
accounts, with the inactive fixture disabled. Use fixture data and test photos
while the server is available on your LAN.

## Check each physical phone

1. Open the printed Phone URL in **Safari on iPhone** and **Chrome on Samsung**.
   Start signed out. Request a sign-in link for `dev-staff-a@nabalens.test` on
   one device and `dev-staff-b@nabalens.test` on the other. Open the printed
   Mailpit URL on the Mac and enter each account's newest code on its phone.
2. On each phone, tap **Add**, choose the camera and take a test photo. Confirm
   it in the camera picker, let the upload finish, then open **Photos** and
   verify the new thumbnail and full photo load. If testing a task flow, also
   complete its **Send** step and reopen the task to check the submitted photo.
3. Open `/dev/sign-in` on each phone. Tap Staff A, Manager A and Admin in turn,
   returning to the fixture URL between taps. Expect Staff Home, the manager
   workspace and the admin library respectively. Reload each landing page to
   confirm the session persists.
4. Use Console and Network in the remote inspectors to check for CSP, CORS
   and mixed-content errors. Storage upload and signed photo requests should
   use the same Mac IP as the app, on the owned Supabase API port.

**iPhone.** Turn on **Settings › Apps › Safari › Advanced › Web Inspector**
(**Settings › Safari** on older iOS). Connect by USB and trust the Mac if
prompted. On the Mac, enable **Safari › Settings › Advanced › Show features
for web developers**, then choose the iPhone and its tab from **Develop**.
[Apple's Web Inspector instructions](https://developer.apple.com/documentation/safari-developer-tools/inspecting-ios)

**Samsung.** In **Developer options**, enable **USB debugging**. Open the
app in Chrome on the phone, connect it via a USB data cable and accept the
debugging prompt. In Chrome on the Mac, open `chrome://inspect/#devices`,
enable **Discover USB devices** and click **Inspect** beside the phone tab.
Chrome handles USB discovery for this workflow without a separate `adb` command.
[Chrome DevTools remote debugging](https://developer.chrome.com/docs/devtools/remote-debugging)

## Fast checks

```sh
pnpm typecheck
pnpm exec eslint <changed-code-files>
pnpm exec vitest run --project unit <focused-test-files>
```

During iteration, use focused checks and the phone journeys. A finished batch
still ships as one PR. Rebase on the latest `main` and run `pnpm verify:release`
once on the final head. The release gate is unchanged.
