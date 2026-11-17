# Trader Samz’ Study Room

An invite-only browser study room hosted on GitHub Pages, with Supabase for room data, real-time updates, authentication and private server controls.

## Features

- A shared focus/break clock with owner-configurable durations.
- Twelve selectable seats around a circular table, guest LED colors and a pink owner LED.
- An owner-published study-group schedule, shown in each visitor’s local time.
- Optional text notes and a shared YouTube queue with personal, opt-in playback.
- An owner-only usage dashboard, warning email outbox and a server-enforced pause.
- No camera or microphone access.

## Public website

https://0xsamantha.github.io/sam-study-room/

The interface is a static site. Its requests go to the `study-api` Supabase Edge Function. GitHub Pages does not execute backend code or read private environment files.

## Build and preview

```sh
npm install
npm run build
npm run dev
```

Use Node 22 LTS (see `.nvmrc`). Open http://localhost:8787/sam-study-room/. This previews the same nested path used by GitHub Pages. The backend remains Supabase. To use the backend from this local preview, add `http://localhost:8787` to the server’s comma-separated `ALLOWED_ORIGINS` setting and redeploy it.

The build reads `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` from `.dev.vars` or the environment and writes only these two public values into `public/config.js` and `docs/config.js`. The publishable key is intended for browser use; row-level security and server authorization protect private operations. Never put the service-role key, owner password, or email API key in public configuration. No private environment values are substituted into the frontend bundle.

## Existing Supabase installation

Migrations 001–003 create the room, seating, schedule, YouTube queue and custom timers. If already applied, do not replay them.

Migration 004 adds the database-backed usage guard and service-only gateway RPC. It preserves existing website tables and room data, pauses the room during the backend migration, and is safe to reapply without resetting quota counters or changing the invite. Reopening always requires owner review.

The project can share the `samantha personal website` Supabase database. Auth settings, capacity and billing allowances are shared, so database size includes the website. All new private tables use `study_private`; existing website tables are not modified.

## Deploy the backend

1. Keep your existing `.dev.vars` private. It needs `SUPABASE_URL` and a unique 32+ character `OWNER_SECRET`. Supabase automatically provides the Edge Function’s server-side project credentials.
2. Configure `RESEND_API_KEY`, `EMAIL_FROM`, and `OWNER_EMAIL` in `.dev.vars` for usage warnings. Use a verified sender and stay on Resend Free. Production resume is blocked until warning delivery is configured.
3. Sign in using the official CLI:

   ```sh
   npx --yes supabase login
   ```

4. Deploy:

   ```sh
   npm run deploy:backend
   ```

The deploy script applies only migration 004 through the authenticated Management API, uploads a strict allowlist of server settings using a temporary permission-restricted file, deletes that file, and deploys `study-api`. It does not replay migrations 001–003 or reset your database. The room stays paused for review after deployment.

`ALLOWED_ORIGINS` defaults to `https://0xsamantha.github.io`. Origin restrictions are additional protection; the server independently validates every owner token, invite and user session. Public status requests and owner login require `verify_jwt = false` at the Edge Function gateway; user JWTs are verified against Supabase Auth inside the function. Only the function’s service-role identity can execute the mutation gateway.

`ALLOW_TEST_WITHOUT_EMAIL=true` is a server-only development escape hatch. The deploy script deliberately does not upload it. Do not use it for the published room.

## Publish to GitHub Pages

The build output is `docs/`. All assets use relative URLs so the site works under `/sam-study-room/`, and invite links stay on the same page rather than relying on server routes.

The included GitHub Actions workflow builds and publishes `docs/`. In the repository’s Settings → Pages, select GitHub Actions as the publishing source. Alternatively, publish `main` → `/docs` using the legacy branch workflow. Use one publishing method at a time.

The checked-in `public/config.js` is enough for builds when public settings are unchanged. Optional repository variables `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` override those values in Actions. Never add private backend secrets as Pages build variables.

## Open the room

Visit the website, open Room settings and enter your owner password. The server returns a signed 24-hour owner token, stored in this browser; the password itself is not saved in browser storage. Owner access therefore works across tabs without relying on cross-site cookies. Rotating the server owner password invalidates existing tokens.

Review usage and warning delivery readiness, then choose Review & resume. Copy the newly generated invitation: the migrated backend uses a new invite, so old local-server invites no longer work. Friends open it, enter a display name, select a seat/color and join through an anonymous Supabase identity.

Saving timer durations resets and pauses the active clock. Scheduling does not automatically start a timer. Guest video additions and owner schedule/timer edits all go through server checks. Videos load only on Watch and are not synchronized across devices.

## Usage protection and limitations

A locked database guard serializes reservations before admitting room operations. Defaults are warning at 90%, nominal pause at 97% and a 2 percentage point reserve, so the effective pause begins at 95%. The owner can lower thresholds or increase the reserve; nominal pause cannot exceed 97%.

Daily app budgets reserve 10,000 API requests, 10,000 database writes, 20,000 Realtime deliveries, 100 MB egress and 20 warning email attempts. A room request reserves twelve deliveries and 2 MiB fanout bytes. These are conservative app allocations, not provider-wide billing counters. Database capacity is measured with `pg_database_size` and compared to the Free plan’s 500 MB allowance. Capacity does not reset; daily allocations reset at midnight UTC. A reset never automatically clears a pause. Resume also checks room for the next admission, avoiding immediate reopen/pause loops.

At a cutoff the transaction latches the guard closed, publishes the room pause once, and rejects joins and writes. Already paused guest requests do not rewrite guard or room storage. Clients unsubscribe, stop presence/auth refresh and unload the video on pause. A small guest preflight can redirect to the script-free paused page before loading the app or connecting to Realtime. Static hosting and that preflight still consume resources.

Warnings are unique per quota/reset and claimed atomically, so two requests cannot send the same warning. Resend uses a stable idempotency key. Failed or uncertain delivery is shown for owner review. An attempt interrupted after claiming remains `sending`; it is not silently retried after the provider’s idempotency window. Email attempts have a separate reserve.

The app cannot measure or stop all GitHub Pages bandwidth/build usage, direct Supabase Auth/subscription traffic, failed function invocations, shared-project egress/MAU, delayed provider billing or unrelated website activity. Those limits are explicitly labeled in the dashboard. There is no claim of a guaranteed cutoff below 98% for unmeasurable or unstoppable traffic. A room pause cannot forcibly terminate every underlying Supabase client socket; it blocks writes and tells cooperating clients to unsubscribe.

No quota-consuming timer ticks or periodic background worker are scheduled. Active clients renew presence every two minutes, which also causes usage to be checked. Supabase database growth from another app may not be noticed until the next room request. Guests expire after three minutes without a lease refresh.

Use Supabase Free, GitHub Pages Free and Resend Free. The app does not enable upgrades, add-ons or overages. Provider plan restrictions protect billing; the app guard protects room activity. A provider’s paid-plan spend cap is not assumed to cover every cost.

## Checks

```sh
npm test
npm run check
npm run build
```

Tests use embedded PostgreSQL for migrations, RLS, ownership checks, concurrent admissions, quota pauses, rollover, schedule/seating, timers and queue permissions. Edge Function tests cover cross-origin access, signed owner tokens, user verification and invalid inputs. The static smoke check (`node scripts/smoke.mjs` while preview runs) checks the nested Pages path and paused page without sending email or using Realtime.
