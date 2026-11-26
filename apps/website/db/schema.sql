-- Apply once per Neon database: psql "$DATABASE_URL" -f db/schema.sql
CREATE TABLE IF NOT EXISTS counters (
  name  text PRIMARY KEY,
  value bigint NOT NULL DEFAULT 0
);
