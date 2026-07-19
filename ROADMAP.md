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

## In progress

- None for IssueOps #28.

## Blocked

- None for IssueOps #28.

## Next

- Advance the Tailnet epic to twitter-db #4.
- Keep the full Mac mini reboot continuity test in IssueOps #27 Phase 4, after
  the remaining Tailnet projects have been migrated.

## Latest validation

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
