-- SHAYN migration 006: basic order flow (manual payment / seller fulfilment).
CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  buyer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seller_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  buyer_name VARCHAR(120) NOT NULL,
  buyer_phone VARCHAR(40) NOT NULL,
  delivery_address TEXT NOT NULL,
  total NUMERIC(12,2) NOT NULL CHECK (total >= 0),
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','preparing','shipped','completed','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS orders_buyer_created_idx ON orders(buyer_id,created_at DESC);
CREATE INDEX IF NOT EXISTS orders_seller_created_idx ON orders(seller_id,created_at DESC);
CREATE TABLE IF NOT EXISTS order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  listing_id BIGINT REFERENCES listings(id) ON DELETE SET NULL,
  product_title VARCHAR(180) NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 50),
  line_total NUMERIC(12,2) NOT NULL CHECK (line_total >= 0)
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id);
