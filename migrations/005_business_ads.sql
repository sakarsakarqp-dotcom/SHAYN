-- SHAYN migration 005: business and organization advertising fields.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS entity_name VARCHAR(160);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS entity_kind VARCHAR(32);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS website VARCHAR(300);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(40);
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid='listings'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%type%'
  LOOP
    EXECUTE format('ALTER TABLE listings DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE listings ADD CONSTRAINT listings_type_check
  CHECK (type IN ('job','project','service','market','business'));
