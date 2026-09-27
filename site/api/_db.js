// Neon Postgres (added through the Vercel integration, which sets DATABASE_URL).
import { neon } from '@neondatabase/serverless';

let ready = null;
export function db() {
  if (!process.env.DATABASE_URL) return null;
  const sql = neon(process.env.DATABASE_URL);
  ready ||= sql`CREATE TABLE IF NOT EXISTS signups (
      id bigserial PRIMARY KEY,
      email text NOT NULL,
      file text,
      updates boolean NOT NULL DEFAULT false,
      ref text,
      country text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`.then(() => sql`CREATE INDEX IF NOT EXISTS signups_email ON signups (lower(email))`);
  return { sql, ready };
}
