# Roadmap

## Current phase

IssueOps #28 narrows the production Mac mini boundary while preserving Telegram
Search on the existing Tailscale Serve root `:443`.

## Completed

- PostgreSQL is published only on `127.0.0.1:5435`.
- MinIO has no host-published ports.
- The existing root Serve handler points to `http://127.0.0.1:3333`.
- The Compose change publishes the app only on `127.0.0.1:3333`.
- The Tailnet boundary regression test, full workspace tests, typecheck, lint, and
  Compose validation pass.

## In progress

- Publish and merge the code/documentation PR, including the already-running
  standard pgvector production commit.

## Blocked

- The production cutover requires an exact ACL change in the admin console:
  replace `3333` with `443` in the existing MacBook-to-Mac-mini rule only. Runtime
  deployment must not proceed until that control-plane change is explicitly
  approved and root HTTPS is verified from the authorized peer.

## Next

- Fast-forward the Mac mini checkout after merge.
- Recreate only the app container and preserve pgvector, MinIO, and all volumes.
- Verify HTTPS, health, WebSocket, search, media, ViewPulse, and raw-port denial.
- Update the private port registry only after the live boundary is verified.
- Post the structured IssueOps #28 handoff.

## Latest validation

- 2026-07-19: Tailnet boundary Vitest passed, 3 tests.
- 2026-07-19: full Vitest suite passed, 58 files and 350 tests.
- 2026-07-19: TypeScript/Turbo typecheck passed, 14 tasks.
- 2026-07-19: `pnpm run lint:fix` passed without unrelated tracked changes.
- 2026-07-19: `docker compose config --quiet` passed.
