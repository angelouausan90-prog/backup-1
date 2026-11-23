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

    CREATE TABLE IF NOT EXISTS store_qr_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL UNIQUE,
      store_code TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (store_id) REFERENCES franchisees(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS store_inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(store_id, product_id),
      FOREIGN KEY (store_id) REFERENCES franchisees(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS customer_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no TEXT NOT NULL UNIQUE,
      store_id INTEGER NOT NULL,
      customer_user_id INTEGER,
      customer_name TEXT NOT NULL,
      contact_no TEXT NOT NULL,
      address TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      notes TEXT,
      payment_method TEXT NOT NULL DEFAULT 'Cash on Delivery',
      status TEXT NOT NULL DEFAULT 'Placed',
      rejection_reason TEXT,
      delivery_staff_id INTEGER,
      stock_deducted INTEGER NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0.00,
      accepted_at TEXT,
      preparing_at TEXT,
      out_for_delivery_at TEXT,
      delivered_at TEXT,
      cancelled_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (store_id) REFERENCES franchisees(id) ON DELETE CASCADE,
      FOREIGN KEY (customer_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (delivery_staff_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS customer_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      FOREIGN KEY (order_id) REFERENCES customer_orders(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS customer_order_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      recorded_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES customer_orders(id) ON DELETE CASCADE
    );
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

  // Seed roles (mirrors database/seed.sql)
  const insertRole = db.prepare('INSERT OR IGNORE INTO roles (id, name) VALUES (?, ?)');
  insertRole.run(1, 'admin');
  insertRole.run(2, 'agent');
  insertRole.run(3, 'franchisee');
  insertRole.run(4, 'delivery');
  insertRole.run(5, 'customer');

  const adminHash = bcrypt.hashSync('Admin@1234', 10);
  const testHash = bcrypt.hashSync('Test@1234', 10);

  // Seed production Admin from seed.sql
  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (role_id, username, password_hash, full_name, email, contact_number, is_active, must_change_password, is_test)
    VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?)
  `);
  insertUser.run(1, 'admin', adminHash, 'System Administrator', 'admin@aicehub.local', '09170000001', 0);

  // Seed test accounts from seed_test.sql (with is_test = 1, must_change_password = 0)
  insertUser.run(1, 'admin_test', testHash, 'Test Admin', 'admin_test@aicehub.local', '09171111111', 1);
  insertUser.run(2, 'agent_test', testHash, 'Maria Santos (Test Agent)', 'agent_test@aicehub.local', '09172222222', 1);
  insertUser.run(3, 'franchisee_test', testHash, 'Juan Dela Cruz', 'franchisee_test@aicehub.local', '09173333333', 1);
  insertUser.run(3, 'franchisee_pending_test', testHash, 'Pedro Reyes', 'pending_test@aicehub.local', '09174444444', 1);
  insertUser.run(4, 'delivery_test', testHash, 'Carlo Mendoza (Test Rider)', 'delivery_test@aicehub.local', '09175555555', 1);
  insertUser.run(3, 'franchisee_delivery_test', testHash, 'Siti Aminah Sinsuat', 'siti_delivery@aicehub.local', '09176666666', 1);
  insertUser.run(3, 'franchisee_approved_test', testHash, 'Ramonito Mangelen', 'ramonito_approved@aicehub.local', '09177777777', 1);
  insertUser.run(5, 'customer_test', testHash, 'Angela Villanueva (Customer)', 'customer_test@aicehub.local', '09178888888', 1);

  const adminTestUser = db.prepare("SELECT id FROM users WHERE username = 'admin_test'").get() as { id: number } | undefined;
  const agentTestUser = db.prepare("SELECT id FROM users WHERE username = 'agent_test'").get() as { id: number } | undefined;
  const deliveryTestUser = db.prepare("SELECT id FROM users WHERE username = 'delivery_test'").get() as { id: number } | undefined;
  const customerTestUser = db.prepare("SELECT id FROM users WHERE username = 'customer_test'").get() as { id: number } | undefined;
  const frApprovedUser = db.prepare("SELECT id FROM users WHERE username = 'franchisee_test'").get() as { id: number } | undefined;
  const frPendingUser = db.prepare("SELECT id FROM users WHERE username = 'franchisee_pending_test'").get() as { id: number } | undefined;
  const frForDeliveryUser = db.prepare("SELECT id FROM users WHERE username = 'franchisee_delivery_test'").get() as { id: number } | undefined;
  const frJustApprovedUser = db.prepare("SELECT id FROM users WHERE username = 'franchisee_approved_test'").get() as { id: number } | undefined;

  if (agentTestUser && adminTestUser) {
    db.prepare('INSERT OR IGNORE INTO agents (user_id, created_by) VALUES (?, ?)').run(agentTestUser.id, adminTestUser.id);
    const agentRow = db.prepare('SELECT id FROM agents WHERE user_id = ?').get(agentTestUser.id) as { id: number } | undefined;

    if (agentRow && frApprovedUser) {
      db.prepare(`
        INSERT OR IGNORE INTO franchisees (user_id, agent_id, owner_name, store_name, address, contact_number, lat, lng, status, approved_by, approved_at)
        VALUES (?, ?, 'Juan Dela Cruz', 'AICE Sampaloc Corner Store', '124 Espana Blvd, Brgy. 455, Sampaloc, Manila', '09173333333', 14.6042000, 120.9921000, 'Approved', ?, datetime('now'))
      `).run(frApprovedUser.id, agentRow.id, adminTestUser.id);
    }

    if (agentRow && frPendingUser) {
      db.prepare(`
        INSERT OR IGNORE INTO franchisees (user_id, agent_id, owner_name, store_name, address, contact_number, lat, lng, status)
        VALUES (?, ?, 'Pedro Reyes', 'AICE Cubao Ice Cream Mart', '88 Aurora Blvd, Brgy. Socorro, Cubao, Quezon City', '09174444444', 14.6191000, 121.0537000, 'Pending')
      `).run(frPendingUser.id, agentRow.id);
    }

    if (agentRow && frForDeliveryUser) {
      db.prepare(`
        INSERT OR IGNORE INTO franchisees (user_id, agent_id, owner_name, store_name, address, contact_number, lat, lng, status, approved_by, approved_at)
        VALUES (?, ?, 'Siti Aminah Sinsuat', 'AICE Cotabato Rosary Heights Mart', '45 Sinsuat Ave, Brgy. Rosary Heights II, Cotabato City, Maguindanao del Norte', '09176666666', 7.2167000, 124.2500000, 'Approved', ?, datetime('now'))
      `).run(frForDeliveryUser.id, agentRow.id, adminTestUser.id);
    }

    if (agentRow && frJustApprovedUser) {
      db.prepare(`
        INSERT OR IGNORE INTO franchisees (user_id, agent_id, owner_name, store_name, address, contact_number, lat, lng, status, approved_by, approved_at)
        VALUES (?, ?, 'Ramonito Mangelen', 'AICE Sinsuat Avenue Corner', '102 Quezon Ave, Brgy. Poblacion V, Cotabato City, Maguindanao del Norte', '09177777777', 7.2236000, 124.2464000, 'Approved', ?, datetime('now'))
      `).run(frJustApprovedUser.id, agentRow.id, adminTestUser.id);
    }
  }

  // Ensure every row in franchisees has a corresponding franchisee_applications record and 6 equipment rows
  const standardItems = [
    'Freezer',
    'Lock & Key',
    'Scraper',
    'Baskets',
    'Manual',
    'Freezer Cover',
  ];
  const sampleSigSvgDataUrl = (label: string) =>
    `data:image/svg+xml;utf8,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="80" viewBox="0 0 280 80"><path d="M20 55 Q 55 18 90 50 T 165 45 T 250 38" fill="none" stroke="#1e293b" stroke-width="2.5" stroke-linecap="round"/><text x="24" y="72" font-family="monospace" font-size="11" fill="#475569">${label}</text></svg>`
    )}`;

  const allFranchisees = db
    .prepare(
      `SELECT f.*, u.username, u.email
       FROM franchisees f
       JOIN users u ON u.id = f.user_id
       ORDER BY f.id ASC`
    )
    .all() as any[];

  for (const fr of allFranchisees) {
    const existingApp = db
      .prepare('SELECT id, status FROM franchisee_applications WHERE franchisee_id = ?')
      .get(fr.id) as { id: number; status: string } | undefined;

    if (!existingApp) {
      const appNo = `FR-2026-${String(fr.id).padStart(4, '0')}`;
      const nameParts = String(fr.owner_name || '').trim().split(/\s+/);
      const firstName = nameParts[0] || 'Applicant';
      const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : 'Owner';
      const middleName =
        nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : '';

      let appStatus = 'Pending Admin Review';
      let assignedDeliveryId: number | null = null;
      let dateDelivered: string | null = null;
      let deliveredAt: string | null = null;
      let activatedAt: string | null = null;
      let cashierName = '';
      let collectorName = '';
      let deliveryTeamName = '';
      let driverName = '';
      let customerPrinted = fr.owner_name;
      let notedByName = '';
      let freezerNo = '';
      let landmark = 'Near main intersection / commercial strip';
      let fbAccount = `fb.com/${fr.username}`;
      let street = '124 Espana Blvd';
      let barangay = 'Sampaloc';
      let city = 'Manila';
      let province = 'Metro Manila';

      if (fr.username === 'franchisee_test') {
        appStatus = 'Active';
        assignedDeliveryId = deliveryTestUser?.id || null;
        dateDelivered = '2026-11-18';
        deliveredAt = '2026-11-18 14:30:00';
        activatedAt = '2026-11-18 15:00:00';
        cashierName = 'Lorna Mae Dizon';
        collectorName = 'Arnel P. Gutierrez';
        deliveryTeamName = 'JCDL Cold-Chain Team Alpha';
        driverName = 'Carlo Mendoza (Test Rider)';
        notedByName = 'Test Admin';
        freezerNo = 'FZ-COT-2026-0088';
        landmark = 'Across UST Gate 2, beside pharmacy';
      } else if (fr.username === 'franchisee_pending_test') {
        appStatus = 'Pending Admin Review';
        street = '88 Aurora Blvd';
        barangay = 'Socorro';
        city = 'Quezon City';
        province = 'Metro Manila';
        landmark = 'Near Araneta Center LRT-2 Cubao Station';
      } else if (fr.username === 'franchisee_delivery_test') {
        appStatus = 'For Delivery';
        assignedDeliveryId = deliveryTestUser?.id || null;
        cashierName = 'Lorna Mae Dizon';
        collectorName = 'Arnel P. Gutierrez';
        notedByName = 'Test Admin';
        street = '45 Sinsuat Ave';
        barangay = 'Rosary Heights II';
        city = 'Cotabato City';
        province = 'Maguindanao del Norte';
        landmark = 'Beside Cotabato City Plaza & Southseas Mall';
      } else if (fr.username === 'franchisee_approved_test') {
        appStatus = 'Approved';
        cashierName = 'Lorna Mae Dizon';
        street = '102 Quezon Ave';
        barangay = 'Poblacion V';
        city = 'Cotabato City';
        province = 'Maguindanao del Norte';
        landmark = 'In front of Public Market Entrance';
      } else if (fr.status === 'Approved') {
        appStatus = 'Active';
      } else if (fr.status === 'Rejected') {
        appStatus = 'Rejected';
      }

      const appRes = db
        .prepare(
          `INSERT INTO franchisee_applications (
            application_no, franchisee_id, user_id, agent_id, date_applied,
            first_name, middle_name, last_name, complete_name, contact_number,
            store_name, street, barangay, city_municipality, province, full_address,
            landmark, facebook_account, email, remarks, lat, lng,
            status, rejection_reason, approved_by, approved_at,
            assigned_delivery_user_id, assigned_at, date_delivered, delivered_at, activated_at,
            cashier_name, collector_name, delivery_team_name, driver_name,
            customer_printed_name, noted_by_name, freezer_no
          ) VALUES (
            ?, ?, ?, ?, date('now'),
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?
          )`
        )
        .run(
          appNo,
          fr.id,
          fr.user_id,
          fr.agent_id,
          firstName,
          middleName,
          lastName,
          fr.owner_name,
          fr.contact_number,
          fr.store_name,
          street,
          barangay,
          city,
          province,
          fr.address,
          landmark,
          fbAccount,
          fr.email || `${fr.username}@aicehub.local`,
          'Verified electrical outlet and covered store front for AICE chest freezer.',
          fr.lat,
          fr.lng,
          appStatus,
          fr.rejection_reason || null,
          fr.approved_by || null,
          fr.approved_at || null,
          assignedDeliveryId,
          assignedDeliveryId ? '2026-11-18 09:00:00' : null,
          dateDelivered,
          deliveredAt,
          activatedAt,
          cashierName,
          collectorName,
          deliveryTeamName,
          driverName,
          customerPrinted,
          notedByName,
          freezerNo
        );

      const appId = Number(appRes.lastInsertRowid);
      const insertEq = db.prepare(
        `INSERT OR IGNORE INTO franchisee_equipment (application_id, item, condition, quantity, freezer_no)
         VALUES (?, ?, ?, ?, ?)`
      );

      for (const itemName of standardItems) {
        if (appStatus === 'Active') {
          insertEq.run(
            appId,
            itemName,
            'NEW',
            itemName === 'Baskets' ? 4 : 1,
            itemName === 'Freezer' ? freezerNo : ''
          );
        } else {
          insertEq.run(appId, itemName, 'NOT_ISSUED', 0, '');
        }
      }

      const insertSig = db.prepare(
        `INSERT OR IGNORE INTO franchisee_signatures (application_id, role, printed_name, signature_image, signed_by_user_id)
         VALUES (?, ?, ?, ?, ?)`
      );
      insertSig.run(
        appId,
        'sales_agent',
        'Maria Santos (Test Agent)',
        sampleSigSvgDataUrl('Maria Santos'),
        agentTestUser?.id || null
      );

      if (appStatus === 'Active') {
        insertSig.run(
          appId,
          'customer',
          fr.owner_name,
          sampleSigSvgDataUrl(fr.owner_name),
          fr.user_id
        );
        insertSig.run(
          appId,
          'delivery_team',
          deliveryTeamName,
          sampleSigSvgDataUrl('JCDL Delivery Team'),
          deliveryTestUser?.id || null
        );
        insertSig.run(
          appId,
          'driver',
          driverName,
          sampleSigSvgDataUrl('Carlo Mendoza'),
          deliveryTestUser?.id || null
        );
        insertSig.run(
          appId,
          'collector',
          collectorName,
          sampleSigSvgDataUrl(collectorName),
          adminTestUser?.id || null
        );
        insertSig.run(
          appId,
          'noted_by',
          notedByName,
          sampleSigSvgDataUrl('Test Admin'),
          adminTestUser?.id || null
        );
      } else if (appStatus === 'For Delivery') {
        insertSig.run(
          appId,
          'noted_by',
          notedByName,
          sampleSigSvgDataUrl('Test Admin'),
          adminTestUser?.id || null
        );
      }
    }
  }

  // Ensure every store in franchisees has a unique, non-guessable store_code in store_qr_codes, franchisees, and franchisee_applications
  const deterministicCodesByUsername: Record<string, string> = {
    franchisee_test: 'sampaloc-a8f3k9m2',
    franchisee_pending_test: 'cubao-p4x7n2q8',
    franchisee_delivery_test: 'rosary-d3v9k1w4',
    franchisee_approved_test: 'sinsuat-m5r2t8z6',
  };

  const storesForCodes = db
    .prepare(
      `SELECT f.id, f.store_name, f.store_code, u.username, fa.status AS app_status
       FROM franchisees f
       JOIN users u ON u.id = f.user_id
       LEFT JOIN franchisee_applications fa ON fa.franchisee_id = f.id`
    )
    .all() as any[];

  for (const st of storesForCodes) {
    const existingQr = db
      .prepare('SELECT store_code FROM store_qr_codes WHERE store_id = ?')
      .get(st.id) as { store_code: string } | undefined;

    let code = existingQr?.store_code || st.store_code || deterministicCodesByUsername[st.username];
    if (!code) {
      const slug = String(st.store_name || 'store')
        .toLowerCase()
        .replace(/^aice\s+/i, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 10);
      const token = Math.random().toString(36).slice(2, 10);
      code = `${slug || 'st'}-${token}`;
    }

    db.prepare(
      'INSERT OR IGNORE INTO store_qr_codes (store_id, store_code) VALUES (?, ?)'
    ).run(st.id, code);
    db.prepare('UPDATE franchisees SET store_code = ? WHERE id = ? AND (store_code IS NULL OR store_code = \'\')').run(
      code,
      st.id
    );
    db.prepare(
      'UPDATE franchisee_applications SET store_code = ? WHERE franchisee_id = ? AND (store_code IS NULL OR store_code = \'\')'
    ).run(code, st.id);
  }

  // Seed initial store_inventory for Active stores if they have no store_inventory rows yet
  const activeProducts = db
    .prepare('SELECT id, price FROM products WHERE is_active = 1 ORDER BY id ASC')
    .all() as { id: number; price: number }[];

  const activeStores = db
    .prepare(
      `SELECT f.id, f.lat, f.lng, u.username
       FROM franchisees f
       JOIN users u ON u.id = f.user_id
       JOIN franchisee_applications fa ON fa.franchisee_id = f.id
       WHERE fa.status = 'Active'`
    )
    .all() as { id: number; lat: number; lng: number; username: string }[];

  if (activeProducts.length > 0 && activeStores.length > 0) {
    const insertStoreInv = db.prepare(
      'INSERT OR IGNORE INTO store_inventory (store_id, product_id, quantity) VALUES (?, ?, ?)'
    );
    for (const store of activeStores) {
      const countRow = db
        .prepare('SELECT COUNT(*) AS cnt FROM store_inventory WHERE store_id = ?')
        .get(store.id) as { cnt: number };
      if (countRow.cnt === 0) {
        for (const prod of activeProducts) {
          insertStoreInv.run(store.id, prod.id, 30);
        }
      }
    }
  }

  // Seed sample customer QR orders on the Active test store if customer_orders is empty
  const qrOrdersCount = (
    db.prepare('SELECT COUNT(*) AS cnt FROM customer_orders').get() as { cnt: number }
  ).cnt;
  const sampalocStore = activeStores.find((s) => s.username === 'franchisee_test') || activeStores[0];

  if (qrOrdersCount === 0 && sampalocStore && activeProducts.length >= 2) {
    const p1 = activeProducts[0];
    const p2 = activeProducts[1];
    const total1 = Number((2 * p1.price + 1 * p2.price).toFixed(2));

    const res1 = db
      .prepare(
        `INSERT INTO customer_orders (
          order_no, store_id, customer_user_id, customer_name, contact_no,
          address, latitude, longitude, notes, payment_method, status,
          delivery_staff_id, stock_deducted, total,
          accepted_at, preparing_at, out_for_delivery_at, delivered_at, created_at, updated_at
        ) VALUES (
          'QRO-2026-0001', ?, ?, 'Angela Villanueva', '09178888888',
          '1580 Dapitan St, Sampaloc, Manila', 14.6095, 120.9898,
          'Call upon arrival at the dorm lobby.', 'Cash on Delivery', 'Delivered',
          ?, 1, ?,
          datetime('now', '-2 hours'), datetime('now', '-100 minutes'),
          datetime('now', '-80 minutes'), datetime('now', '-55 minutes'),
          datetime('now', '-2 hours'), datetime('now', '-55 minutes')
        )`
      )
      .run(
        sampalocStore.id,
        customerTestUser?.id || null,
        deliveryTestUser?.id || null,
        total1
      );
    const order1Id = Number(res1.lastInsertRowid);
    const insertQrItem = db.prepare(
      'INSERT INTO customer_order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)'
    );
    insertQrItem.run(order1Id, p1.id, 2, p1.price);
    insertQrItem.run(order1Id, p2.id, 1, p2.price);
    db.prepare(
      'INSERT INTO customer_order_locations (order_id, lat, lng) VALUES (?, ?, ?)'
    ).run(order1Id, 14.6095, 120.9898);
  }
}

export default db;



