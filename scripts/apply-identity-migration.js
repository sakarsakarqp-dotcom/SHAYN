require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required; configure it in the private environment.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: '-c search_path=shayn',
  ssl: process.env.DATABASE_SSL === 'false'
    ? false
    : (process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined)
});

async function main() {
  await pool.query('CREATE SCHEMA IF NOT EXISTS shayn');
  const base = await pool.query("SELECT to_regclass('shayn.users') AS users");
  if (!base.rows[0].users) {
    throw new Error('Base SHAYN schema is missing. Initialize the existing application schema before applying migration 007.');
  }

  const migrationPath = path.join(__dirname, '..', 'migrations', '007_identity_organizations.sql');
  const migration = fs.readFileSync(migrationPath, 'utf8');
  await pool.query(migration);

  const verified = await pool.query(
    "SELECT COUNT(*)::int AS total FROM information_schema.tables " +
    "WHERE table_schema='shayn' AND table_type='BASE TABLE' " +
    "AND table_name = ANY($1::text[])",
    [['user_roles','organizations','organization_memberships','organization_invitations','organization_audit_logs']]
  );
  if (verified.rows[0].total !== 5) {
    throw new Error('Migration 007 did not create all five expected identity tables.');
  }
  console.log('SHAYN identity and organization migration 007 applied and verified.');
}

main()
  .catch(error => {
    console.error('SHAYN identity migration failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
