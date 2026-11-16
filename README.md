# The Reading Room

An invite-only, silent study room: synchronized 25-minute focus / 5-minute break clock, owner timer controls, initials tiles, optional text chat, and a separate owner usage desk. Never requests camera or microphone access.

**Status:** implemented and locally tested; not deployed or connected to a Supabase project. Production intentionally fails closed until current built-in provider readings and warning email credentials are configured. Unknown/late meters are labeled; this app is not a guarantee of a cutoff below 98%.

## Stack

- Cloudflare Workers Free serves static assets and the authenticated API. One SQLite Durable Object serializes budget reservations and stores only guard/owner/invite metadata.
- Supabase Free stores timer, chat, and memberships. Postgres Changes delivers state to authenticated room members. All writes go through server-only database transactions; clients have SELECT only under RLS. PostgreSQL row locks serialize simultaneous changes independently of the usage coordinator.
- Resend Free delivers owner warnings. No billing or upgrade API is used.

## Local start

```sh
npm install
cp .dev.vars.example .dev.vars
npm run build
npm run dev
```

Open http://localhost:8787. The unconnected interface and owner desk can be inspected. The example key unlocks **local settings only**; replace it with a long random value. Never deploy that example key. Local mode skips provider readiness checks but still requires Supabase for joins and real-time data. There is no fake participant roster or simulated working chat in the interface.

To connect a development Supabase project:

1. Create a project on a **Free organization**. Enable anonymous sign-ins in Authentication. No email login is needed for study guests. Keep anonymous auth rate limits; consider Supabase CAPTCHA before sharing widely (the UI does not yet integrate a CAPTCHA widget).
2. Run `supabase/migrations/001_study_room.sql` once in its SQL editor. This creates the locked mutation RPC, private memberships, read policy and real-time publication. Use a dedicated project for this room.
3. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in the ignored `.dev.vars`. The service key stays server-only. The publishable key is intentionally public.
4. Open Room settings, enter the owner key, click Review & resume, then copy the invitation. The database starts paused. Open the invite and take a seat. Only someone with the owner cookie can control the clock. Guests receive anonymous Supabase identities.

Members refresh a lease every two minutes and disappear after three minutes without a refresh. Background timer throttling on phones can make presence expire; rejoin to renew it. The focus timer itself uses a shared absolute end timestamp, so late joins see the same remaining time. Completion waits for the owner to choose the next mode.

## Deploy when accounts and metering are ready

The Sites hosting manifest does not expose the arbitrary Durable Object class binding needed by this budget coordinator, so this project uses direct Cloudflare deployment. No Site has been registered or published.

1. Verify Workers is on Free, Supabase organization is on Free, and Resend is on Free. Keep paid upgrades, add-ons and paid overages disabled. Never infer billing protection from app settings.
2. `npx wrangler login` for your own Cloudflare account.
3. Use `npx wrangler secret put NAME` for `OWNER_SECRET`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `OWNER_EMAIL`, `EMAIL_FROM`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ANALYTICS_TOKEN`. Use a verified Resend sender and your recipient email. Create a read-only Cloudflare Analytics token scoped to this account; no billing/write permissions are needed. Keep private keys in server secrets and out of source control.
4. **Do not set LOCAL_DEMO in production.** It is absent from wrangler.jsonc and only lives in ignored `.dev.vars` locally.
5. `npm run build`, `npm test`, `npm run check`, then `npm run deploy`. Wrangler does not select or upgrade a paid plan. Review the actual account plan before deploying.
6. Open settings, refresh provider readings, review delivery readiness and thresholds, then resume. Production remains paused if required data is missing or older than five minutes.

The production app is not connected to any provider account here. Account provisioning, live quota telemetry, and actual email delivery have not been verified.

## Budget and pause behavior

Defaults: warn at 90%; nominal pause at 97%; a configurable 2 percentage point reserve makes the effective pause 95%. Warning must remain below the effective pause; nominal pause cannot exceed 97%. Provider delays may require a larger reserve, and no fixed reserve can guarantee staying below 98% under unbounded external traffic.

Daily app budgets: 10,000 routed requests, 10,000 write reservations, 20,000 real-time delivery reservations, 100 MB egress reservations, 20 warning emails. Each admitted action conservatively reserves 4 database/guard writes, 12 deliveries (the maximum room size), and 1 MiB fanout traffic. These are **app budgets**, not account-wide provider counters. They deliberately sacrifice capacity for margin. Warnings and guard cleanup consume their own reserved headroom. Provider snapshots are separately displayed.

Reservations happen before auth/database activity, are persisted, and are not refunded if an operation fails. One Durable Object serializes them across requests. Quota crossing latches the API closed, removes its periodic usage alarm, and attempts a final Supabase pause transaction. No subsequent room API write is allowed. Already paused requests do not write guard storage. Owner review actions and warning delivery remain possible, consuming some resources. Provider accounts must be dedicated or include unrelated consumption in usage snapshots.

Clients receiving the paused state unsubscribe, disconnect Supabase Realtime, stop their presence heartbeat, and stop auth refresh. The invitation then serves a small HTML/CSS paused page with no JavaScript or Supabase connection. If the final database pause notification fails, API writes are still blocked; previously connected clients may remain subscribed. Supabase does not offer an app-level guarantee of forcibly closing every underlying client socket. Use Supabase Dashboard → Realtime settings to disable Realtime for a dedicated project when needed; changing settings disconnects clients. This is a documented manual fallback, not an implemented automatic management API integration.

RLS gates reads to members. All direct client mutations and the mutation RPC are denied to anon/authenticated roles. Invite rotation removes memberships and pauses the room. A stale member token cannot mutate through the API or read future room changes. Auth identities remain in Supabase and count toward provider usage; automatic cleanup is deliberately not enabled.

Pause is latched across daily rollover. Resume requires explicit owner action and readings below the buffered threshold. The host still receives traffic and static asset requests during pause. Malicious clients may call public Supabase Auth endpoints or retain low-level subscriptions; app budgets cannot prevent all such provider usage.

## Provider usage and unknown limits

The built-in collector calls the server-only `study_usage()` RPC to measure Supabase database capacity, then reads account-wide Worker and Durable Object request totals through Cloudflare GraphQL. It checks every minute while open. Failed, invalid or older-than-five-minute observations latch the room closed. Supabase database capacity is shown with no reset; Cloudflare daily requests reset at 00:00 UTC. Analytics is delayed/adaptive and cannot establish a precise cutoff.

No complete automatic billing feed is assumed for Supabase real-time messages, egress or MAU, Resend account-wide emails, or Cloudflare DO duration and SQLite row/storage accounting. The owner desk lists these explicitly as unknown, with their plan limits and caveats. Room fanout/egress/writes and warning attempts have conservative app budgets; they exclude direct service traffic, reconnects and unrelated account consumption. The Supabase Management API's API request counts are not treated as billable real-time message totals. Keep dedicated free accounts/projects and check provider dashboards as well.

An optional trusted HTTPS adapter can supplement/replace the collector using `USAGE_SNAPSHOT_URL` and `USAGE_SNAPSHOT_TOKEN`. It must return `{checked: <epoch milliseconds>, meters: [...]}` with at least `workerRequests`, `doRequests`, `supabaseDatabase`. Each meter has `key`, `name`, `used`, `limit`, `resets` (ISO date or null for capacity), `checked` (original measurement time), and `note` describing delay/scope. It may also include `unknown` labels and further provider quotas. Billing resets must come from the provider, not an assumed calendar month. Missing/invalid required observations fail closed. Never manufacture fresh zeros for unavailable usage.

The owner dashboard shows reservations, percentages, resets, last check, reporting limitations, thresholds and warning delivery states. Warnings use a persisted per-quota/per-reset identifier, including monthly provider cycles, plus a Resend idempotency key. A failed/uncertain delivery is surfaced for review rather than described as sent. The app can protect the room; **the providers' Free plans protect the bill**. A Pro spend cap is not a universal dollar cap.

## Provider verification (2026-11-12)

- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/): Free has 100,000 requests/day, reset at 00:00 UTC. Static assets and rejected API requests have different accounting; the app request counter is not account-wide hosting usage.
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/): SQLite on Free; 100,000 requests/day, 13,000 GB-s/day, 5 million row reads/day, 100,000 row writes/day, 5 GB total SQL storage. Free operations fail at limits; no paid overage without moving to Paid. Daily limits reset at 00:00 UTC. Capacity does not reset.
- [Cloudflare analytics](https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/): GraphQL is available, with delayed/adaptive reporting and special WebSocket accounting.
- [Supabase pricing](https://supabase.com/pricing) and [billing](https://supabase.com/docs/guides/platform/billing-on-supabase): Free includes 500 MB database, 5 GB egress, 50,000 MAU and 2 million real-time messages. Free projects may pause after a week of inactivity. No file storage is used here.
- [Supabase real-time limits](https://supabase.com/docs/guides/realtime/limits): Free includes 200 concurrent connections and 100 messages/sec. App room limit is 12 people. Per-second limits and subscription/auth traffic are not fully accounted for by room action reservations.
- [Supabase cost control](https://supabase.com/docs/guides/platform/cost-control): Free is not charged; exceeding quotas can lead to restrictions. Pro's spend cap has exclusions and is not a zero-spend guarantee. Keep this project on Free.
- [Supabase email](https://supabase.com/docs/guides/auth/auth-smtp): built-in email is restricted Auth testing (currently two/hour, team recipients); it does not replace a transactional warning sender.
- [Resend quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits): Free rejects above 100 emails/UTC day or 3,000/month, counting inbound and outbound. Paid pricing supports automatic overages, so use Free and do not upgrade.

## Verification

`npm test` uses embedded PostgreSQL (PGlite) for the real migration, timer persistence, pause enforcement and access policies, plus simulated coordinator budgets, concurrent joins near the limit, monthly warning deduplication, stale telemetry, cycle rollover and safe resume. It does not consume live provider quota. Supabase publication delivery itself is not simulated by PGlite.

`npm run build` bundles the Supabase client locally. `npm run check` checks server and source JS. Optional `SMOKE_OWNER_KEY=... node scripts/smoke.mjs` checks the running local HTTP app without Supabase/email calls. Rendered desktop/mobile QA could not be performed because the browser-control host was unavailable. Live Supabase auth/realtime, account-specific Cloudflare GraphQL permissions/schema and real email require account configuration and remain unverified. Built-in collectors are tested against simulated provider responses; unsupported analytics schemas fail closed.
