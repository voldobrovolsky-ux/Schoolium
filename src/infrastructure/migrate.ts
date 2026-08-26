import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for migrations");

const pool = new Pool({ connectionString });
const migrations = [
  `CREATE SCHEMA IF NOT EXISTS core`,
  `CREATE SCHEMA IF NOT EXISTS credentials`,
  `CREATE SCHEMA IF NOT EXISTS profile`,
  `CREATE SCHEMA IF NOT EXISTS groups`,
  `CREATE SCHEMA IF NOT EXISTS audit`,
  `CREATE SCHEMA IF NOT EXISTS schoolium`,
  `CREATE TABLE IF NOT EXISTS core.identity (id uuid PRIMARY KEY, status text NOT NULL CHECK (status IN ('active', 'blocked', 'archived', 'deleted')), created_at timestamptz NOT NULL DEFAULT now(), status_changed_at timestamptz NOT NULL DEFAULT now(), retention_until timestamptz)`,
  `CREATE TABLE IF NOT EXISTS credentials.credential (id uuid PRIMARY KEY, identity_id uuid NOT NULL REFERENCES core.identity(id), type text NOT NULL CHECK (type IN ('password', 'totp', 'webauthn')), secret bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz)`,
  `CREATE TABLE IF NOT EXISTS profile.profile (identity_id uuid PRIMARY KEY REFERENCES core.identity(id), encrypted_payload bytea NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS groups.group_record (id uuid PRIMARY KEY, tag text NOT NULL, created_by_client_id text NOT NULL, audience text[] NOT NULL, status text NOT NULL CHECK (status IN ('active', 'dissolved')), created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS groups.membership (id uuid PRIMARY KEY, group_id uuid NOT NULL REFERENCES groups.group_record(id), identity_id uuid NOT NULL REFERENCES core.identity(id), role text NOT NULL, status text NOT NULL CHECK (status IN ('pending', 'active', 'rejected', 'revoked')), joined_at timestamptz)`,
  `CREATE TABLE IF NOT EXISTS audit.event (id uuid PRIMARY KEY, occurred_at timestamptz NOT NULL DEFAULT now(), type text NOT NULL, actor_identity_id uuid, target_identity_id uuid, client_id text, outcome text NOT NULL CHECK (outcome IN ('success', 'failure')), detail jsonb NOT NULL DEFAULT '{}'::jsonb)`,
  `CREATE TABLE IF NOT EXISTS schoolium.workspace (id uuid PRIMARY KEY, title text NOT NULL, status text NOT NULL CHECK (status IN ('creating', 'created', 'deleted')), created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS schoolium.workspace_membership (workspace_id uuid NOT NULL REFERENCES schoolium.workspace(id), identity_id uuid NOT NULL, role text NOT NULL, status text NOT NULL CHECK (status IN ('active', 'revoked')), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (workspace_id, identity_id))`,
];

try {
  for (const statement of migrations) await pool.query(statement);
  console.log(`Applied ${migrations.length} schema statements.`);
} finally {
  await pool.end();
}
