-- SHAYN migration 004: optional product image URL for commerce listings.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS image_url TEXT;
