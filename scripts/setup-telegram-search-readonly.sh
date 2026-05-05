#!/usr/bin/env bash
set -euo pipefail

: "${VIEWPULSE_RO_PASSWORD:?set VIEWPULSE_RO_PASSWORD before running this script}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

docker compose -f "$ROOT_DIR/docker/docker-compose.yml" exec -T pgvector \
  psql -v ON_ERROR_STOP=1 -v ro_password="$VIEWPULSE_RO_PASSWORD" -U postgres -d postgres <<'SQL'
SELECT format('CREATE ROLE viewpulse_ro WITH LOGIN PASSWORD %L', :'ro_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'viewpulse_ro') \gexec
ALTER ROLE viewpulse_ro WITH LOGIN PASSWORD :'ro_password';
GRANT CONNECT ON DATABASE postgres TO viewpulse_ro;
GRANT USAGE ON SCHEMA public TO viewpulse_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO viewpulse_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO viewpulse_ro;
SQL
