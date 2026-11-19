import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

const dataDir = path.resolve(process.cwd(), 'server', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'aice_franchise_system.sqlite');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role_id INTEGER NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT,
      contact_number TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      is_test INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (role_id) REFERENCES roles(id)
    );

    CREATE TABLE IF NOT EXISTS warehouses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      contact_person TEXT NOT NULL,
      contact_number TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS franchisees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      agent_id INTEGER NOT NULL,
      owner_name TEXT NOT NULL,
      store_name TEXT NOT NULL,
      address TEXT NOT NULL,
      contact_number TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending',
      rejection_reason TEXT,
      approved_by INTEGER,
      approved_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id),
      FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      sku TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      flavor TEXT NOT NULL,
      size TEXT NOT NULL,
      price REAL NOT NULL,
      low_stock_threshold INTEGER NOT NULL DEFAULT 20,
      image_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      warehouse_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(warehouse_id, product_id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT NOT NULL UNIQUE,
      franchisee_id INTEGER NOT NULL,
      warehouse_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'Placed',
      total_amount REAL NOT NULL DEFAULT 0.00,
      requested_delivery_datetime TEXT,
      notes TEXT,
      stock_deducted INTEGER NOT NULL DEFAULT 0,
      cancel_reason TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (franchisee_id) REFERENCES franchisees(id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      warehouse_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      movement_type TEXT NOT NULL,
      quantity_change INTEGER NOT NULL,
      previous_qty INTEGER NOT NULL,
      new_qty INTEGER NOT NULL,
      reference_order_id INTEGER,
      notes TEXT,
      performed_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (reference_order_id) REFERENCES orders(id) ON DELETE SET NULL,
      FOREIGN KEY (performed_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      subtotal REAL NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS order_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      notes TEXT,
      changed_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL UNIQUE,
      delivery_staff_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'Assigned',
      accepted_at TEXT,
      picked_up_at TEXT,
      out_for_delivery_at TEXT,
      arrived_at TEXT,
      delivered_at TEXT,
      proof_note TEXT,
      proof_image_url TEXT,
      near_notified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (delivery_staff_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS delivery_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      delivery_id INTEGER NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      recorded_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS commissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER NOT NULL,
      recruits_count INTEGER NOT NULL DEFAULT 0,
      amount REAL NOT NULL,
      period_label TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending',
      notes TEXT,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (agent_id) REFERENCES agents(id),
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'info',
      related_id INTEGER,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  // Seed roles (mirrors database/seed.sql)
  const insertRole = db.prepare('INSERT OR IGNORE INTO roles (id, name) VALUES (?, ?)');
  insertRole.run(1, 'admin');
  insertRole.run(2, 'agent');
  insertRole.run(3, 'franchisee');
  insertRole.run(4, 'delivery');

  const adminHash = bcrypt.hashSync('Admin@1234', 10);
  const testHash = bcrypt.hashSync('Test@1234', 10);

  // Seed production Admin from seed.sql
  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (role_id, username, password_hash, full_name, email, contact_number, is_active, must_change_password, is_test)
    VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?)
  `);
  insertUser.run(1, 'admin', adminHash, 'System Administrator', 'admin@aicehub.local', '09170000001', 0);

  // Seed test accounts from seed_test.sql (with is_test = 1, must_change_password = 0)
  // NOTE: Do NOT seed any warehouse, products, or orders so first-run Warehouse Setup lock works out of the box!
  insertUser.run(1, 'admin_test', testHash, 'Test Admin', 'admin_test@aicehub.local', '09171111111', 1);
  insertUser.run(2, 'agent_test', testHash, 'Maria Santos (Test Agent)', 'agent_test@aicehub.local', '09172222222', 1);
  insertUser.run(3, 'franchisee_test', testHash, 'Juan Dela Cruz', 'franchisee_test@aicehub.local', '09173333333', 1);
  insertUser.run(3, 'franchisee_pending_test', testHash, 'Pedro Reyes', 'pending_test@aicehub.local', '09174444444', 1);
  insertUser.run(4, 'delivery_test', testHash, 'Carlo Mendoza (Test Rider)', 'delivery_test@aicehub.local', '09175555555', 1);

  const adminTestUser = db.prepare("SELECT id FROM users WHERE username = 'admin_test'").get() as { id: number } | undefined;
  const agentTestUser = db.prepare("SELECT id FROM users WHERE username = 'agent_test'").get() as { id: number } | undefined;
  const frApprovedUser = db.prepare("SELECT id FROM users WHERE username = 'franchisee_test'").get() as { id: number } | undefined;
  const frPendingUser = db.prepare("SELECT id FROM users WHERE username = 'franchisee_pending_test'").get() as { id: number } | undefined;

  if (agentTestUser && adminTestUser) {
    db.prepare('INSERT OR IGNORE INTO agents (user_id, created_by) VALUES (?, ?)').run(agentTestUser.id, adminTestUser.id);
    const agentRow = db.prepare('SELECT id FROM agents WHERE user_id = ?').get(agentTestUser.id) as { id: number } | undefined;

    if (agentRow && frApprovedUser) {
      db.prepare(`
        INSERT OR IGNORE INTO franchisees (user_id, agent_id, owner_name, store_name, address, contact_number, lat, lng, status, approved_by, approved_at)
        VALUES (?, ?, 'Juan Dela Cruz', 'AICE Sampaloc Corner Store', '124 Espana Blvd, Sampaloc, Manila', '09173333333', 14.6042000, 120.9921000, 'Approved', ?, datetime('now'))
      `).run(frApprovedUser.id, agentRow.id, adminTestUser.id);
    }

    if (agentRow && frPendingUser) {
      db.prepare(`
        INSERT OR IGNORE INTO franchisees (user_id, agent_id, owner_name, store_name, address, contact_number, lat, lng, status)
        VALUES (?, ?, 'Pedro Reyes', 'AICE Cubao Ice Cream Mart', '88 Aurora Blvd, Cubao, Quezon City', '09174444444', 14.6191000, 121.0537000, 'Pending')
      `).run(frPendingUser.id, agentRow.id);
    }
  }
}

export default db;
