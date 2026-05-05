# Operations

## PostgreSQL Vector Extension

Telegram Search uses the standard `pgvector/pgvector:pg17` image for Docker Compose deployments. The database initialization script creates the standard `vector` extension:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Do not introduce new runtime or schema dependencies on the legacy `pgvecto-rs` `vectors` extension. Vector columns should use `public.vector(...)`, and vector indexes should use standard pgvector HNSW syntax:

```sql
CREATE INDEX ... USING hnsw (... vector_cosine_ops);
```

## Migrating From `pgvecto-rs`

Before switching an existing deployment from `pgvecto-rs` / `vectors` to standard pgvector:

1. Stop the app container to prevent new writes.
2. Create a fresh `pg_dump -Fc` backup.
3. Restore into a new PostgreSQL volume using `pgvector/pgvector:pg17`.
4. Convert `vectors.vector(...)` column definitions to `public.vector(...)`.
5. Exclude legacy `USING vectors` indexes during restore.
6. Recreate standard HNSW indexes with `vector_cosine_ops`.
7. Start the app and verify message reads, message writes, vector search, and photo reads.

Keep the old Docker volume and the latest dump until the deployment has been validated.

## ViewPulse Read-Only Access

`pg_dump` does not include role passwords. After restoring or migrating the database, recreate or reset the ViewPulse read-only role password:

```bash
VIEWPULSE_RO_PASSWORD=<password> ./scripts/setup-telegram-search-readonly.sh
```

ViewPulse should connect with a read-only connection string like:

```text
postgresql://viewpulse_ro:<password>@127.0.0.1:5435/postgres
```

Validation checklist for ViewPulse:

1. Confirm `viewpulse_ro` can connect with the configured password.
2. Confirm SELECT queries work against the restored tables.
3. Confirm no `password authentication failed for user "viewpulse_ro"` entries appear in PostgreSQL logs.
4. Do not delete the old database volume until ViewPulse and the main app are both stable.
