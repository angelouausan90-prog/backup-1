import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { seedDemoData } from './seed_demo.ts';

const isProductionRuntime =
  process.env.NODE_ENV === 'production' ||
  Boolean(process.env.K_SERVICE) ||
  Boolean(process.argv[1]?.replace(/\\/g, '/').endsWith('dist/server.js'));

const defaultDbPath = isProductionRuntime
  ? '/tmp/aice.db'
  : path.resolve(process.cwd(), 'server', 'data', 'aice_franchise_system.sqlite');

export const dbPath = (process.env.DB_PATH || '').trim()
  ? path.resolve((process.env.DB_PATH || '').trim())
  : defaultDbPath;

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

let dbInitialized = false;

export function initDatabase() {
  if (dbInitialized) return;
  dbInitialized = true;
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

    CREATE TABLE IF NOT EXISTS promos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      promo_type TEXT NOT NULL,
      tier_basis TEXT NOT NULL DEFAULT 'quantity',
      discount_type TEXT NOT NULL DEFAULT 'percent',
      discount_value REAL NOT NULL DEFAULT 0,
      min_order_amount REAL NOT NULL DEFAULT 0,
      min_quantity INTEGER NOT NULL DEFAULT 0,
      buy_quantity INTEGER NOT NULL DEFAULT 0,
      free_quantity INTEGER NOT NULL DEFAULT 0,
      free_product_id INTEGER,
      free_delivery INTEGER NOT NULL DEFAULT 0,
      max_discount_cap REAL,
      scope TEXT NOT NULL DEFAULT 'all_products',
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      recurring_monthly INTEGER NOT NULL DEFAULT 0,
      usage_limit_total INTEGER,
      usage_limit_per_franchisee INTEGER,
      stackable INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Draft',
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS promo_products (
      promo_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      PRIMARY KEY (promo_id, product_id),
      FOREIGN KEY (promo_id) REFERENCES promos(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS promo_categories (
      promo_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      PRIMARY KEY (promo_id, category_id),
      FOREIGN KEY (promo_id) REFERENCES promos(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS promo_tiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      promo_id INTEGER NOT NULL,
      min_quantity_or_amount REAL NOT NULL,
      discount_value REAL NOT NULL,
      FOREIGN KEY (promo_id) REFERENCES promos(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS promo_targets (
      promo_id INTEGER NOT NULL,
      franchisee_id INTEGER NOT NULL,
      PRIMARY KEY (promo_id, franchisee_id),
      FOREIGN KEY (promo_id) REFERENCES promos(id) ON DELETE CASCADE,
      FOREIGN KEY (franchisee_id) REFERENCES franchisees(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS promo_redemptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      promo_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL,
      franchisee_id INTEGER NOT NULL,
      discount_amount REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (promo_id) REFERENCES promos(id) ON DELETE CASCADE,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (franchisee_id) REFERENCES franchisees(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS promo_dismissals (
      user_id INTEGER NOT NULL,
      promo_id INTEGER NOT NULL,
      dismissed_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, promo_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (promo_id) REFERENCES promos(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS faqs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      keywords TEXT DEFAULT '',
      audience TEXT NOT NULL DEFAULT 'all',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_ai_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      tokens_in INTEGER,
      tokens_out INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_unanswered (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      question TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Open',
      resolved_faq_id INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS franchisee_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_no TEXT NOT NULL UNIQUE,
      franchisee_id INTEGER NOT NULL UNIQUE,
      user_id INTEGER NOT NULL UNIQUE,
      agent_id INTEGER NOT NULL,
      date_applied TEXT NOT NULL DEFAULT (date('now')),
      first_name TEXT NOT NULL,
      middle_name TEXT DEFAULT '',
      last_name TEXT NOT NULL,
      complete_name TEXT NOT NULL,
      contact_number TEXT NOT NULL,
      store_name TEXT NOT NULL,
      street TEXT NOT NULL,
      barangay TEXT NOT NULL,
      city_municipality TEXT NOT NULL,
      province TEXT NOT NULL,
      full_address TEXT NOT NULL,
      landmark TEXT DEFAULT '',
      facebook_account TEXT DEFAULT '',
      email TEXT NOT NULL,
      remarks TEXT DEFAULT '',
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      store_photo_url TEXT,
      status TEXT NOT NULL DEFAULT 'Pending Admin Review',
      rejection_reason TEXT,
      approved_by INTEGER,
      approved_at TEXT,
      assigned_delivery_user_id INTEGER,
      assigned_at TEXT,
      date_delivered TEXT,
      delivered_at TEXT,
      activated_at TEXT,
      cashier_name TEXT DEFAULT '',
      collector_name TEXT DEFAULT '',
      delivery_team_name TEXT DEFAULT '',
      driver_name TEXT DEFAULT '',
      customer_printed_name TEXT DEFAULT '',
      noted_by_name TEXT DEFAULT '',
      freezer_no TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (franchisee_id) REFERENCES franchisees(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id),
      FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (assigned_delivery_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS franchisee_equipment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER NOT NULL,
      item TEXT NOT NULL,
      condition TEXT NOT NULL DEFAULT 'NOT_ISSUED',
      quantity INTEGER NOT NULL DEFAULT 0,
      freezer_no TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(application_id, item),
      FOREIGN KEY (application_id) REFERENCES franchisee_applications(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS franchisee_signatures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      printed_name TEXT NOT NULL,
      signature_image TEXT NOT NULL,
      signed_by_user_id INTEGER,
      signed_at TEXT DEFAULT (datetime('now')),
      UNIQUE(application_id, role),
      FOREIGN KEY (application_id) REFERENCES franchisee_applications(id) ON DELETE CASCADE,
      FOREIGN KEY (signed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    DROP TABLE IF EXISTS customer_order_locations;
    DROP TABLE IF EXISTS customer_order_items;
    DROP TABLE IF EXISTS customer_orders;
    DROP TABLE IF EXISTS store_inventory;
    DROP TABLE IF EXISTS store_qr_codes;
  `);

  // Safe migrations on franchisees & franchisee_applications for store_code and is_open
  const franchiseeCols = (
    db.prepare('PRAGMA table_info(franchisees)').all() as { name: string }[]
  ).map((c) => c.name);
  if (!franchiseeCols.includes('store_code')) {
    db.exec('ALTER TABLE franchisees ADD COLUMN store_code TEXT');
  }
  if (!franchiseeCols.includes('is_open')) {
    db.exec('ALTER TABLE franchisees ADD COLUMN is_open INTEGER NOT NULL DEFAULT 1');
  }

  const appCols = (
    db.prepare('PRAGMA table_info(franchisee_applications)').all() as { name: string }[]
  ).map((c) => c.name);
  if (!appCols.includes('store_code')) {
    db.exec('ALTER TABLE franchisee_applications ADD COLUMN store_code TEXT');
  }
  if (!appCols.includes('is_open')) {
    db.exec('ALTER TABLE franchisee_applications ADD COLUMN is_open INTEGER NOT NULL DEFAULT 1');
  }

  // Safe migrations on existing orders & order_items tables without resetting data
  const orderCols = (db.prepare('PRAGMA table_info(orders)').all() as { name: string }[]).map(
    (c) => c.name
  );
  if (!orderCols.includes('subtotal')) {
    db.exec('ALTER TABLE orders ADD COLUMN subtotal REAL NOT NULL DEFAULT 0.00');
    db.exec('UPDATE orders SET subtotal = total_amount WHERE subtotal = 0 AND total_amount > 0');
  }
  if (!orderCols.includes('discount_amount')) {
    db.exec('ALTER TABLE orders ADD COLUMN discount_amount REAL NOT NULL DEFAULT 0.00');
  }
  if (!orderCols.includes('delivery_fee')) {
    db.exec('ALTER TABLE orders ADD COLUMN delivery_fee REAL NOT NULL DEFAULT 0.00');
  }
  if (!orderCols.includes('promo_id')) {
    db.exec('ALTER TABLE orders ADD COLUMN promo_id INTEGER');
  }
  if (!orderCols.includes('applied_promos_json')) {
    db.exec('ALTER TABLE orders ADD COLUMN applied_promos_json TEXT');
  }

  const orderItemCols = (
    db.prepare('PRAGMA table_info(order_items)').all() as { name: string }[]
  ).map((c) => c.name);
  if (!orderItemCols.includes('discount_amount')) {
    db.exec('ALTER TABLE order_items ADD COLUMN discount_amount REAL NOT NULL DEFAULT 0.00');
  }
  if (!orderItemCols.includes('is_free_item')) {
    db.exec('ALTER TABLE order_items ADD COLUMN is_free_item INTEGER NOT NULL DEFAULT 0');
  }

  const promoCols = (
    db.prepare('PRAGMA table_info(promos)').all() as { name: string }[]
  ).map((c) => c.name);
  if (!promoCols.includes('tier_basis')) {
    db.exec("ALTER TABLE promos ADD COLUMN tier_basis TEXT NOT NULL DEFAULT 'quantity'");
  }
  if (!promoCols.includes('free_product_id')) {
    db.exec('ALTER TABLE promos ADD COLUMN free_product_id INTEGER');
  }
  if (!promoCols.includes('recurring_monthly')) {
    db.exec('ALTER TABLE promos ADD COLUMN recurring_monthly INTEGER NOT NULL DEFAULT 0');
  }

  const faqCols = (
    db.prepare('PRAGMA table_info(faqs)').all() as { name: string }[]
  ).map((c) => c.name);
  if (!faqCols.includes('keywords')) {
    db.exec("ALTER TABLE faqs ADD COLUMN keywords TEXT DEFAULT ''");
  }

  // Seed default system_settings if not already present (editable by Admin)
  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)'
  );
  insertSetting.run(
    'show_public_prices',
    process.env.PUBLIC_SHOW_PRICES === '1' ? '1' : '0'
  );
  insertSetting.run(
    'contact_email',
    process.env.PUBLIC_CONTACT_EMAIL || 'franchising@aicehub.local'
  );
  insertSetting.run(
    'contact_phone',
    process.env.PUBLIC_CONTACT_PHONE || '+63 (02) 8888-2423'
  );

  // Seed initial public FAQs (visible to "all") if the faqs table is empty
  const faqCountRow = db
    .prepare('SELECT COUNT(*) AS cnt FROM faqs')
    .get() as { cnt: number };
  if (faqCountRow.cnt === 0) {
    const insertFaq = db.prepare(
      'INSERT INTO faqs (question, answer, audience, sort_order, is_active) VALUES (?, ?, ?, ?, 1)'
    );
    insertFaq.run(
      'How do approved franchisees place stock-replenishment orders?',
      'Approved franchisees sign in to their store workspace, select an active origin warehouse, add AICE cartons to their replenishment cart, choose a preferred delivery schedule, and submit online. Eligible volume or bundle discounts apply automatically at checkout.',
      'all',
      1
    );
    insertFaq.run(
      'How can I apply to become an AICE franchisee?',
      'There is no public self sign-up or online application form. All new franchisee applications are evaluated and registered on-site by accredited AICE field agents, who pin the verified store coordinates and submit the application for Admin approval.',
      'all',
      2
    );
    insertFaq.run(
      'When is warehouse inventory deducted for an order?',
      'Placing an order online reserves the requested cartons with a Placed status. Warehouse stock is formally deducted once an Admin reviews and confirms the replenishment order.',
      'all',
      3
    );
    insertFaq.run(
      'How does live delivery tracking work?',
      'Once an order is confirmed and assigned to a delivery rider, franchisees can open the live tracking map to see the origin warehouse, destination store pin, current rider GPS coordinates, 7-stage progress timeline, and estimated arrival time.',
      'all',
      4
    );
    insertFaq.run(
      'How are payments handled for replenishment orders?',
      'The platform coordinates stock reservations, automated promotional discounts, warehouse dispatch, and live delivery proof. Settlement is handled offline according to your franchise agreement without an online payment gateway.',
      'all',
      5
    );
  }

  // Seed roles (mirrors database/seed.sql) and remove legacy customer role
  const insertRole = db.prepare('INSERT OR IGNORE INTO roles (id, name) VALUES (?, ?)');
  insertRole.run(1, 'admin');
  insertRole.run(2, 'agent');
  insertRole.run(3, 'franchisee');
  insertRole.run(4, 'delivery');
  db.prepare('DELETE FROM users WHERE role_id = 5').run();
  db.prepare("DELETE FROM roles WHERE id = 5 OR name = 'customer'").run();

  // Seed or update the real default Admin account (username "admin")
  // Password is set from ADMIN_INITIAL_PASSWORD (defaults to Admin@1234 if unset) and must be changed at first login (must_change_password = 1, is_test = 0)
  const adminInitialPassword = (process.env.ADMIN_INITIAL_PASSWORD || '').trim() || 'Admin@1234';
  const existingAdmin = db
    .prepare(
      "SELECT id, password_hash, must_change_password, is_test FROM users WHERE username = 'admin'"
    )
    .get() as
    | { id: number; password_hash: string; must_change_password: number; is_test: number }
    | undefined;

  if (!existingAdmin) {
    const initialHash = bcrypt.hashSync(adminInitialPassword, 10);
    db.prepare(`
      INSERT INTO users (
        role_id, username, password_hash, full_name, email, contact_number,
        is_active, must_change_password, is_test
      )
      VALUES (1, 'admin', ?, 'System Administrator', 'admin@aicecotabato.ph', '09170000001', 1, 1, 0)
    `).run(initialHash);
  } else {
    const hasEmptyPassword = bcrypt.compareSync('', existingAdmin.password_hash);
    if (
      (process.env.ADMIN_INITIAL_PASSWORD || '').trim() ||
      existingAdmin.must_change_password === 1 ||
      hasEmptyPassword
    ) {
      const initialHash = bcrypt.hashSync(adminInitialPassword, 10);
      db.prepare(
        "UPDATE users SET password_hash = ?, full_name = 'System Administrator', must_change_password = 1, is_test = 0 WHERE id = ?"
      ).run(initialHash, existingAdmin.id);
    } else if (existingAdmin.is_test !== 0) {
      db.prepare(
        "UPDATE users SET full_name = 'System Administrator', is_test = 0 WHERE id = ?"
      ).run(existingAdmin.id);
    }
  }

  // Seed default product categories if the categories table is empty
  const categoryCountRow = db
    .prepare('SELECT COUNT(*) AS cnt FROM categories')
    .get() as { cnt: number };
  if (categoryCountRow.cnt === 0) {
    const insertCategory = db.prepare(
      'INSERT OR IGNORE INTO categories (name, description) VALUES (?, ?)'
    );
    insertCategory.run('Ice Cream Stick', 'Classic and chocolate-coated AICE stick treats');
    insertCategory.run('Crispy Cone', 'Crunchy wafer cones with rich AICE fillings');
    insertCategory.run('Ice Cream Cup', 'Refreshing sundae and fruit-flavored cups');
    insertCategory.run('Mochi Series', 'Soft chewy rice cake exterior with creamy ice cream center');
  }

  // Only load demo accounts, demo franchisees, and demo orders when SEED_DEMO_DATA=true
  if (process.env.SEED_DEMO_DATA === 'true') {
    seedDemoData(db);
  }

  // Idempotent data cleanup for any existing rows in the SQLite database:
  // Fixes display names and Cotabato City addresses directly in the database
  db.prepare(
    "UPDATE users SET full_name = 'System Administrator' WHERE full_name = 'Test Admin'"
  ).run();
  db.prepare(
    "UPDATE users SET full_name = 'Maria Santos' WHERE full_name = 'Maria Santos (Test Agent)'"
  ).run();
  db.prepare(
    "UPDATE users SET full_name = 'Carlo Mendoza' WHERE full_name = 'Carlo Mendoza (Test Rider)'"
  ).run();
  db.prepare(
    "UPDATE users SET full_name = 'User' WHERE TRIM(COALESCE(full_name, '')) = ''"
  ).run();

  db.prepare(
    `UPDATE warehouses
     SET address = REPLACE(address, 'Quezon Avenue', 'Sinsuat Avenue')
     WHERE address LIKE '%Quezon Avenue%'`
  ).run();
  db.prepare(
    `UPDATE warehouses
     SET lat = 7.2236000, lng = 124.2464000
     WHERE lat > 13.0`
  ).run();

  db.prepare(
    `UPDATE franchisees
     SET store_name = 'AICE Notre Dame Avenue Corner Store',
         address = '124 Notre Dame Ave, Brgy. Poblacion VI, Cotabato City, Maguindanao del Norte',
         lat = 7.2215000,
         lng = 124.2482000
     WHERE store_name = 'AICE Sampaloc Corner Store' OR address LIKE '%Sampaloc%'`
  ).run();

  db.prepare(
    `UPDATE franchisees
     SET store_name = 'AICE Awang Supermart',
         address = '88 Sinsuat Ave, Brgy. Awang, Datu Odin Sinsuat, Maguindanao del Norte',
         lat = 7.1812000,
         lng = 124.2294000
     WHERE store_name = 'AICE Cubao Ice Cream Mart' OR address LIKE '%Cubao%'`
  ).run();

  db.prepare(
    `UPDATE franchisees
     SET address = REPLACE(address, 'Quezon Ave', 'Sinsuat Ave')
     WHERE address LIKE '%Quezon Ave%'`
  ).run();

  db.prepare(
    `UPDATE franchisees
     SET lat = 7.2236000, lng = 124.2464000
     WHERE lat > 13.0`
  ).run();

  db.prepare(
    `UPDATE franchisee_applications
     SET store_name = 'AICE Notre Dame Avenue Corner Store',
         street = '124 Notre Dame Ave',
         barangay = 'Poblacion VI',
         city_municipality = 'Cotabato City',
         province = 'Maguindanao del Norte',
         full_address = '124 Notre Dame Ave, Brgy. Poblacion VI, Cotabato City, Maguindanao del Norte',
         landmark = 'Across Notre Dame University Main Gate, beside pharmacy',
         lat = 7.2215000,
         lng = 124.2482000
     WHERE store_name = 'AICE Sampaloc Corner Store' OR full_address LIKE '%Sampaloc%'`
  ).run();

  db.prepare(
    `UPDATE franchisee_applications
     SET store_name = 'AICE Awang Supermart',
         street = '88 Sinsuat Ave',
         barangay = 'Awang',
         city_municipality = 'Datu Odin Sinsuat',
         province = 'Maguindanao del Norte',
         full_address = '88 Sinsuat Ave, Brgy. Awang, Datu Odin Sinsuat, Maguindanao del Norte',
         landmark = 'Near Awang Airport Junction along Sinsuat National Highway',
         facebook_account = 'fb.com/pedroreyes.awang',
         lat = 7.1812000,
         lng = 124.2294000
     WHERE store_name = 'AICE Cubao Ice Cream Mart' OR full_address LIKE '%Cubao%'`
  ).run();

  db.prepare(
    `UPDATE franchisee_applications
     SET street = REPLACE(street, 'Quezon Ave', 'Sinsuat Ave'),
         full_address = REPLACE(full_address, 'Quezon Ave', 'Sinsuat Ave')
     WHERE street LIKE '%Quezon Ave%' OR full_address LIKE '%Quezon Ave%'`
  ).run();

  db.prepare(
    `UPDATE franchisee_applications
     SET driver_name = 'Carlo Mendoza'
     WHERE driver_name = 'Carlo Mendoza (Test Rider)'`
  ).run();

  db.prepare(
    `UPDATE franchisee_applications
     SET noted_by_name = 'System Administrator'
     WHERE noted_by_name = 'Test Admin'`
  ).run();

  db.prepare(
    `UPDATE franchisee_signatures
     SET printed_name = 'Maria Santos'
     WHERE printed_name = 'Maria Santos (Test Agent)'`
  ).run();

  db.prepare(
    `UPDATE franchisee_signatures
     SET printed_name = 'Carlo Mendoza'
     WHERE printed_name = 'Carlo Mendoza (Test Rider)'`
  ).run();

  db.prepare(
    `UPDATE franchisee_signatures
     SET printed_name = 'System Administrator',
         signature_image = REPLACE(signature_image, 'Test%20Admin', 'System%20Administrator')
     WHERE printed_name = 'Test Admin' OR signature_image LIKE '%Test%20Admin%'`
  ).run();

  db.prepare(
    `UPDATE notifications
     SET title = REPLACE(REPLACE(title, 'AICE Sampaloc Corner Store', 'AICE Notre Dame Avenue Corner Store'), 'AICE Cubao Ice Cream Mart', 'AICE Awang Supermart'),
         message = REPLACE(
           REPLACE(
             REPLACE(
               REPLACE(
                 REPLACE(message, 'AICE Sampaloc Corner Store', 'AICE Notre Dame Avenue Corner Store'),
                 'AICE Cubao Ice Cream Mart', 'AICE Awang Supermart'
               ),
               'Maria Santos (Test Agent)', 'Maria Santos'
             ),
             'Carlo Mendoza (Test Rider)', 'Carlo Mendoza'
           ),
           'Test Admin', 'System Administrator'
         )`
  ).run();

  db.prepare(
    `UPDATE activity_logs
     SET details = REPLACE(
       REPLACE(
         REPLACE(
           REPLACE(
             REPLACE(details, 'AICE Sampaloc Corner Store', 'AICE Notre Dame Avenue Corner Store'),
             'AICE Cubao Ice Cream Mart', 'AICE Awang Supermart'
           ),
           'Maria Santos (Test Agent)', 'Maria Santos'
         ),
         'Carlo Mendoza (Test Rider)', 'Carlo Mendoza'
       ),
       'Test Admin', 'System Administrator'
     )
     WHERE details IS NOT NULL`
  ).run();
}

export default db;



