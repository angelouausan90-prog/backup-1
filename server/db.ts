import bcrypt from 'bcryptjs';
import type pg from 'pg';
import { pool, db as drizzleDb } from '../src/db/index.ts';
import { seedDemoData } from './seed_demo.ts';
import { seedRestockingDemoDataIfEmpty } from './services/restockingService.ts';

export interface DbExecutor {
  query<T extends pg.QueryResultRow = any>(
    sqlText: string,
    params?: any[]
  ): Promise<pg.QueryResult<T>>;
  queryOne<T extends pg.QueryResultRow = any>(
    sqlText: string,
    params?: any[]
  ): Promise<T | undefined>;
  queryAll<T extends pg.QueryResultRow = any>(sqlText: string, params?: any[]): Promise<T[]>;
  execute(sqlText: string, params?: any[]): Promise<{ rowCount: number; rows: any[] }>;
}

function wrapQueryable(queryable: pg.Pool | pg.PoolClient): DbExecutor {
  return {
    async query<T extends pg.QueryResultRow = any>(sqlText: string, params: any[] = []) {
      return queryable.query<T>(sqlText, params);
    },
    async queryOne<T extends pg.QueryResultRow = any>(sqlText: string, params: any[] = []) {
      const res = await queryable.query<T>(sqlText, params);
      return res.rows[0];
    },
    async queryAll<T extends pg.QueryResultRow = any>(sqlText: string, params: any[] = []) {
      const res = await queryable.query<T>(sqlText, params);
      return res.rows;
    },
    async execute(sqlText: string, params: any[] = []) {
      const res = await queryable.query(sqlText, params);
      return { rowCount: res.rowCount ?? 0, rows: res.rows };
    },
  };
}

const poolExecutor = wrapQueryable(pool);

export const query = poolExecutor.query;
export const queryOne = poolExecutor.queryOne;
export const queryAll = poolExecutor.queryAll;
export const execute = poolExecutor.execute;

export async function withTransaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tx = wrapQueryable(client);
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[Cloud SQL] Rollback failed:', rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

export const db: DbExecutor & {
  transaction: typeof withTransaction;
  pool: pg.Pool;
  drizzle: typeof drizzleDb;
} = {
  ...poolExecutor,
  transaction: withTransaction,
  pool,
  drizzle: drizzleDb,
};

export function isUniqueViolation(err: any): boolean {
  return err?.code === '23505';
}

function isRetryableDbError(err: any): boolean {
  const pgCode = String(err?.code || '');
  // Never retry auth errors (28*), schema/syntax errors (42*), or constraint errors (23*)
  if (pgCode.startsWith('28') || pgCode.startsWith('42') || pgCode.startsWith('23')) {
    return false;
  }
  // Retry transient connection/startup codes
  if (
    pgCode === '57P03' || // cannot_connect_now (DB starting up)
    pgCode === '57P01' || // admin_shutdown
    pgCode.startsWith('08') || // connection exception
    pgCode === 'ECONNREFUSED' ||
    pgCode === 'ENOENT' ||
    pgCode === 'ETIMEDOUT' ||
    pgCode === 'ECONNRESET'
  ) {
    return true;
  }
  const msg = String(err?.message || '').toLowerCase();
  return (
    msg.includes('timeout') ||
    msg.includes('connection terminated') ||
    msg.includes('econnrefused') ||
    msg.includes('starting up')
  );
}

async function withBoundedRetry<T>(
  operation: () => Promise<T>,
  label: string,
  maxAttempts = 3
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err: any) {
      lastError = err;
      const canRetry = attempt < maxAttempts && isRetryableDbError(err);
      console.error(
        `[Cloud SQL] ${label} failed (attempt ${attempt}/${maxAttempts}): ${err?.message || err}`
      );
      if (!canRetry) {
        throw err;
      }
      const baseDelayMs = Math.min(4000, 500 * Math.pow(2, attempt - 1));
      const jitterMs = Math.floor(Math.random() * 250);
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs + jitterMs));
    }
  }
  throw lastError;
}

let dbInitialized = false;
let initPromise: Promise<void> | null = null;

export function isDatabaseInitialized(): boolean {
  return dbInitialized;
}

export async function initDatabase(): Promise<void> {
  if (dbInitialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    await withBoundedRetry(async () => {
      await pool.query('SELECT 1');
    }, 'initial connection ping');

    // 1. Seed roles idempotently (Admin, Agent, Franchisee, Delivery)
    const defaultRoles: Array<[number, string]> = [
      [1, 'admin'],
      [2, 'agent'],
      [3, 'franchisee'],
      [4, 'delivery'],
    ];
    for (const [id, name] of defaultRoles) {
      await execute(
        `INSERT INTO roles (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
        [id, name]
      );
    }

    // 2. Seed default system_settings idempotently (never overwrites admin edits)
    const defaultSettings: Array<[string, string]> = [
      ['show_public_prices', process.env.PUBLIC_SHOW_PRICES === '1' ? '1' : '0'],
      ['contact_email', process.env.PUBLIC_CONTACT_EMAIL || 'franchising@aicecotabato.ph'],
      ['contact_phone', process.env.PUBLIC_CONTACT_PHONE || '+63 (02) 8888-2423'],
      ['restock_lead_time_days', '7'],
    ];
    for (const [key, value] of defaultSettings) {
      await execute(
        `INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
        [key, value]
      );
    }

    // 3. Seed initial public FAQs ONLY when the faqs table is empty
    const faqCountRow = await queryOne<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM faqs');
    if ((faqCountRow?.cnt ?? 0) === 0) {
      const initialFaqs: Array<[string, string, string, number]> = [
        [
          'How do approved franchisees place stock-replenishment orders?',
          'Approved franchisees sign in to their store workspace, select an active origin warehouse, add AICE cartons to their replenishment cart, choose a preferred delivery schedule, and submit online. Eligible volume or bundle discounts apply automatically at checkout.',
          'all',
          1,
        ],
        [
          'How can I apply to become an AICE franchisee?',
          'There is no public self sign-up or online application form. All new franchisee applications are evaluated and registered on-site by accredited AICE field agents, who pin the verified store coordinates and submit the application for Admin approval.',
          'all',
          2,
        ],
        [
          'When is warehouse inventory deducted for an order?',
          'Placing an order online reserves the requested cartons with a Placed status. Warehouse stock is formally deducted once an Admin reviews and confirms the replenishment order.',
          'all',
          3,
        ],
        [
          'How does live delivery tracking work?',
          'Once an order is confirmed and assigned to a delivery rider, franchisees can open the live tracking map to see the origin warehouse, destination store pin, current rider GPS coordinates, 7-stage progress timeline, and estimated arrival time.',
          'all',
          4,
        ],
        [
          'How are payments handled for replenishment orders?',
          'The platform coordinates stock reservations, automated promotional discounts, warehouse dispatch, and live delivery proof. Settlement is handled offline according to your franchise agreement without an online payment gateway.',
          'all',
          5,
        ],
      ];
      for (const [question, answer, audience, sortOrder] of initialFaqs) {
        await execute(
          `INSERT INTO faqs (question, answer, audience, sort_order, is_active)
           VALUES ($1, $2, $3, $4, 1)`,
          [question, answer, audience, sortOrder]
        );
      }
    }

    // 4. Seed default Admin account idempotently (username "admin")
    // Uses ADMIN_INITIAL_PASSWORD (fallback Admin@1234). Once the admin changes their password
    // (must_change_password = 0), restarts NEVER overwrite it.
    const envAdminPassword = (process.env.ADMIN_INITIAL_PASSWORD || '').trim();
    const adminInitialPassword = envAdminPassword || 'Admin@1234';
    const existingAdmin = await queryOne<{
      id: number;
      password_hash: string;
      must_change_password: number;
      is_test: number;
    }>(
      "SELECT id, password_hash, must_change_password, is_test FROM users WHERE username = 'admin'"
    );

    if (!existingAdmin) {
      const initialHash = await bcrypt.hash(adminInitialPassword, 10);
      await execute(
        `INSERT INTO users (
          role_id, username, password_hash, full_name, email, contact_number,
          is_active, must_change_password, is_test
        )
        VALUES (1, 'admin', $1, 'System Administrator', 'admin@aicecotabato.ph', '09170000001', 1, 1, 0)
        ON CONFLICT (username) DO NOTHING`,
        [initialHash]
      );
    } else if (existingAdmin.must_change_password === 1 && envAdminPassword) {
      const initialHash = await bcrypt.hash(adminInitialPassword, 10);
      await execute(
        `UPDATE users
         SET password_hash = $1, full_name = 'System Administrator', is_test = 0, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [initialHash, existingAdmin.id]
      );
    }

    // 5. Seed default product categories ONLY when the categories table is empty
    const categoryCountRow = await queryOne<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM categories'
    );
    if ((categoryCountRow?.cnt ?? 0) === 0) {
      const defaultCategories: Array<[string, string]> = [
        ['Ice Cream Stick', 'Classic and chocolate-coated AICE stick treats'],
        ['Crispy Cone', 'Crunchy wafer cones with rich AICE fillings'],
        ['Ice Cream Cup', 'Refreshing sundae and fruit-flavored cups'],
        ['Mochi Series', 'Soft chewy rice cake exterior with creamy ice cream center'],
      ];
      for (const [name, description] of defaultCategories) {
        await execute(
          `INSERT INTO categories (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING`,
          [name, description]
        );
      }
    }

    // 6. Optional demo data seeding ONLY when SEED_DEMO_DATA=true
    if (process.env.SEED_DEMO_DATA === 'true') {
      await seedDemoData(db);
    }

    // 7. Seed Warehouse Restocking demo products & sample requests ONLY if products table is empty
    await seedRestockingDemoDataIfEmpty();

    dbInitialized = true;
    console.log('[Cloud SQL] PostgreSQL database initialized and ready.');
  })().catch((err) => {
    initPromise = null;
    throw err;
  });

  return initPromise;
}

export default db;
