# Roadmap

## Current phase

IssueOps #28 is live on the production Mac mini: Telegram Search remains on the
existing Tailscale Serve root `:443`, while its app and database host ports are
loopback-only and MinIO has no host-published ports. The implementation is ready
for IssueOps revalidation.

## Completed

- PostgreSQL is published only on `127.0.0.1:5435`.
- MinIO has no host-published ports.
- The existing root Serve handler points to `http://127.0.0.1:3333`.
- The Compose change publishes the app only on `127.0.0.1:3333`.
- The Tailnet boundary regression test, full workspace tests, typecheck, lint, and
  Compose validation pass.
- The authorized ACL rule now exposes `443` instead of `3333`; no other policy
  entry changed.
- The Mac mini fast-forwarded to merged PR #1 and recreated only the app
  container. pgvector, MinIO, volumes, and the Serve configuration were
  preserved.
- Root HTTPS, `/health`, WebSocket connection, ViewPulse's read-only database
  path, and ViewPulse's real Telegram photo proxy pass after the cutover.
- Raw Tailnet ports `3333` and `5435` time out from the authorized MacBook.
- An app-only restart recovered to healthy without restarting pgvector or MinIO.
- The private port registry now lists only `3333` and `5435` for this project;
  stale MinIO entries `9000` and `9001` were removed.
- The authenticated search smoke test is explicitly `NOT RUN`. The user accepted
  it as a non-blocking residual because this Tailnet-only change is covered by
  HTTPS, WSS, full-suite search tests, the read-only database path, and a real
  media proxy response; no personal Telegram session was persisted for this
  acceptance run.
- ViewPulse #149 dependency now persists Telegram HTTP(S) message entity URLs in
  `chat_messages.entity_urls`, including hidden `MessageEntityTextUrl` links.
  PR #4 is merged at `db4da055`; additive migration
  `0037_add-chat-message-entity-urls` and the app image are deployed.

## In progress

- The repository-side ViewPulse #149 dependency is complete. Downstream
  acceptance is observing the four target channels through the restored live
  Telegram listener and normal schedulers; target channels have not emitted a
  post-login message yet.

## Blocked

- None for IssueOps #28.
- None for ViewPulse #149 authentication. The MacBook Pro logged in again at
  2026-08-27 06:00Z; GramJS connected and completed catch-up.

## Next

- Advance the Tailnet epic to twitter-db #4.
- Keep the full Mac mini reboot continuity test in IssueOps #27 Phase 4, after
  the remaining Tailnet projects have been migrated.

## Latest validation

- 2026-08-27: the production Telegram account listener was restored and the new
  writer produced two non-empty `entity_urls` rows in other natural channels.
  The four ViewPulse #149 target channels have not emitted a post-login message
  yet.
- 2026-08-27: a UI-equivalent incremental-sync attempt was aborted after it
  revealed that the current incremental path continues by filling historical
  gaps. Before the abort it touched about 2,700 BWETradFi rows and populated 43
  historical `entity_urls` values. Those rows are excluded from ViewPulse #149
  natural acceptance; no further unbounded incremental or historical sync will
  be used for that acceptance.
- 2026-08-27: production app image revision `db4da055` applied migration
  `0037_add-chat-message-entity-urls`; `entity_urls` is non-null JSONB with
  default `[]`, and app, pgvector, and MinIO are healthy. pgvector and MinIO were
  not recreated.
- 2026-08-27: ViewPulse #149 entity URL extraction and DB conversion tests
  passed, 9 tests.
- 2026-08-27: core Vitest passed with one worker, 30 files and 158 tests; the
  first parallel run hit four existing 5-second PGlite setup timeouts.
- 2026-08-27: TypeScript/Turbo typecheck passed, 14 tasks; `pnpm run lint:fix`
  passed without unrelated tracked changes.

- 2026-07-19: Tailnet boundary Vitest passed, 3 tests.
- 2026-07-19: full Vitest suite passed, 58 files and 350 tests.
- 2026-07-19: TypeScript/Turbo typecheck passed, 14 tasks.
- 2026-07-19: `pnpm run lint:fix` passed without unrelated tracked changes.
- 2026-07-19: `docker compose config --quiet` passed.
- 2026-07-19: root HTTPS and `/health` returned `200` with valid TLS before and
  after the app-only restart.
- 2026-07-19: WSS returned `server:connected`; a new unauthenticated session
  correctly reported `accountReady=false`.
- 2026-07-19: ViewPulse read `388238` messages and `26435` photos through its
  configured read-only database role; one real photo proxy returned JPEG `200`.
- 2026-07-19: raw Tailnet `3333` and `5435` timed out; local pgvector remained
  ready and MinIO remained unpublished.
- 2026-07-19: private acceptance evidence was archived on the Mac mini under
  `/Users/kami/.local/state/telegram-search/28/20260719T221627Z`.
- 2026-07-19: the user approved the authenticated search smoke as a non-blocking
  `NOT RUN` residual; the accidental, potentially secret-bearing inspection
  artifact was deleted and the final checksum manifest was rebuilt.
