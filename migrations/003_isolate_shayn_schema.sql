-- SHAYN schema isolation migration.
-- Run only through the explicit "npm run db:init" task.
-- Moves the six known legacy SHAYN tables together, preserving their rows,
-- indexes, constraints, and owned sequences. It never drops or truncates data.
BEGIN;

CREATE SCHEMA IF NOT EXISTS shayn;

DO $migration$
DECLARE
  legacy_count integer;
  target_count integer;
BEGIN
  SELECT count(*) INTO legacy_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE'
    AND table_name IN ('users','listings','applications','messages','reviews','reports');

  SELECT count(*) INTO target_count
  FROM information_schema.tables
  WHERE table_schema = 'shayn'
    AND table_type = 'BASE TABLE'
    AND table_name IN ('users','listings','applications','messages','reviews','reports');

  IF legacy_count = 0 THEN
    RAISE NOTICE 'No legacy SHAYN tables found in public; keeping existing shayn tables if present.';
  ELSIF legacy_count <> 6 THEN
    RAISE EXCEPTION
      'Refusing partial SHAYN migration: found % of 6 expected legacy tables in public. No tables were moved.',
      legacy_count;
  ELSIF target_count <> 0 THEN
    RAISE EXCEPTION
      'Refusing SHAYN migration: target schema already contains one or more expected tables. No tables were moved.';
  ELSE
    IF EXISTS (
      SELECT 1
      FROM (VALUES
        ('users','password_hash'), ('users','role'),
        ('listings','user_id'), ('listings','title'), ('listings','type'),
        ('applications','listing_id'), ('applications','user_id'),
        ('messages','sender_id'), ('messages','recipient_id'), ('messages','body'),
        ('reviews','reviewer_id'), ('reviews','reviewed_user_id'), ('reviews','rating'),
        ('reports','reporter_id'), ('reports','reason')
      ) AS required(table_name,column_name)
      WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = required.table_name
          AND c.column_name = required.column_name
      )
    ) THEN
      RAISE EXCEPTION
        'Refusing to move public tables: their columns do not match the expected SHAYN structure. No tables were moved.';
    END IF;

    ALTER TABLE public.users SET SCHEMA shayn;
    ALTER TABLE public.listings SET SCHEMA shayn;
    ALTER TABLE public.applications SET SCHEMA shayn;
    ALTER TABLE public.messages SET SCHEMA shayn;
    ALTER TABLE public.reviews SET SCHEMA shayn;
    ALTER TABLE public.reports SET SCHEMA shayn;
    RAISE NOTICE 'Moved all six legacy SHAYN tables into schema shayn.';
  END IF;
END
$migration$;

COMMIT;
