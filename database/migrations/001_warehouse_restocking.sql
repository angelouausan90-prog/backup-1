-- Migration 001: Warehouse Restocking (Supplier -> Warehouse)
-- Compatible with PostgreSQL (Cloud SQL) and synchronized with src/db/schema.ts

-- 1. Warehouse capacity limit
ALTER TABLE warehouses
  ADD COLUMN IF NOT EXISTS capacity_limit INTEGER NOT NULL DEFAULT 1000;

-- 2. Product target quantity, safety stock, and optional per-franchisee reservation cap
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS target_quantity INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS safety_stock INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS max_reservation_qty INTEGER;

-- 3. Supplier-to-warehouse restock requests (distinct from franchisee replenishment orders)
CREATE TABLE IF NOT EXISTS restock_requests (
  id SERIAL PRIMARY KEY,
  request_number TEXT NOT NULL UNIQUE,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL DEFAULT 'low_stock', -- 'monthly' | 'low_stock' | 'no_stock'
  priority TEXT NOT NULL DEFAULT 'normal',        -- 'normal' | 'high'
  status TEXT NOT NULL DEFAULT 'Draft',           -- 'Draft' | 'Approved/In Transit' | 'Received' | 'Rejected' | 'Cancelled'
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMP,
  expected_arrival_date TEXT,                     -- YYYY-MM-DD
  received_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  received_at TIMESTAMP,
  rejection_reason TEXT,
  remarks TEXT,
  overdue_notified INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restock_requests_wh_status
  ON restock_requests (warehouse_id, status);

CREATE INDEX IF NOT EXISTS idx_restock_requests_status_eta
  ON restock_requests (status, expected_arrival_date);

CREATE INDEX IF NOT EXISTS idx_restock_requests_priority
  ON restock_requests (priority);

-- 4. Line items for each restock request with stock calculation snapshots
CREATE TABLE IF NOT EXISTS restock_request_items (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES restock_requests(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  target_qty_snapshot INTEGER NOT NULL DEFAULT 100,
  physical_stock_snapshot INTEGER NOT NULL DEFAULT 0,
  reserved_stock_snapshot INTEGER NOT NULL DEFAULT 0,
  available_stock_snapshot INTEGER NOT NULL DEFAULT 0,
  reorder_point_snapshot INTEGER NOT NULL DEFAULT 0,
  avg_daily_orders_snapshot DOUBLE PRECISION NOT NULL DEFAULT 0,
  suggested_qty INTEGER NOT NULL DEFAULT 0,
  approved_qty INTEGER NOT NULL DEFAULT 0,
  received_qty INTEGER,
  difference_qty INTEGER,
  difference_remark TEXT,
  CONSTRAINT restock_request_items_req_prod_uniq UNIQUE (request_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_restock_request_items_product
  ON restock_request_items (product_id);

-- 5. Default delivery lead time setting (7 days)
INSERT INTO system_settings (key, value)
VALUES ('restock_lead_time_days', '7')
ON CONFLICT (key) DO NOTHING;
