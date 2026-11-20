import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import db, { initDatabase } from './server/db';
import {
  haversineKm,
  estimateEtaMinutes,
  buildFranchiseeUsernameBase,
  isValidCoords,
  requiresForcedPasswordChange,
  computeStockTransition,
  calculateDemandForecast,
  computeSalesKpiSummary,
  validatePromoPayload,
  formatPromoHowItWorks,
  evaluatePromosForCart,
  isPromoDateValid,
  isPromoEligibleForFranchisee,
  filterEligiblePopupPromos,
  formatPromoLimitNote,
  hasPromoRulesOrDatesChanged,
  PromoDefinition,
} from './src/utils/domainRules';

// Initialize schema, seed.sql, and seed_test.sql accounts
initDatabase();

const JWT_SECRET = process.env.JWT_SECRET || 'aice_franchise_secret_key_2026';

// Ensure upload directories exist inside server/uploads/products/ and server/uploads/proofs/
const productsUploadDir = path.resolve(process.cwd(), 'server', 'uploads', 'products');
const proofsUploadDir = path.resolve(process.cwd(), 'server', 'uploads', 'proofs');
fs.mkdirSync(productsUploadDir, { recursive: true });
fs.mkdirSync(proofsUploadDir, { recursive: true });

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];
const MAX_UPLOAD_SIZE = 5 * 1024 * 1024; // 5 MB

function makeUploader(destDir: string, prefix: string) {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, destDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const unique = `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
      cb(null, unique);
    },
  });

  return multer({
    storage,
    limits: { fileSize: MAX_UPLOAD_SIZE },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!ALLOWED_MIMES.includes(file.mimetype) || !ALLOWED_EXTS.includes(ext)) {
        return cb(new Error('Only JPG, PNG, and WEBP image files (max 5 MB) are allowed.'));
      }
      cb(null, true);
    },
  });
}

const uploadProductImage = makeUploader(productsUploadDir, 'prod');
const uploadProofImage = makeUploader(proofsUploadDir, 'proof');

function deleteUploadedFile(imageUrl: string | null | undefined) {
  if (!imageUrl) return;
  const rel = imageUrl.replace(/^\//, '');
  const fullPath = path.resolve(process.cwd(), 'server', rel);
  if (fs.existsSync(fullPath)) {
    try {
      fs.unlinkSync(fullPath);
    } catch {
      // ignore cleanup error
    }
  }
}

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$';
  let pwd = '';
  const bytes = crypto.randomBytes(10);
  for (let i = 0; i < 10; i++) {
    pwd += chars[bytes[i] % chars.length];
  }
  return pwd;
}

function generateFranchiseeUsername(ownerName: string, storeName: string): string {
  const base = buildFranchiseeUsernameBase(ownerName, storeName);
  for (let i = 0; i < 15; i++) {
    const suffix = Math.floor(100 + Math.random() * 900);
    const candidate = `fr_${base}_${suffix}`;
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(candidate);
    if (!existing) return candidate;
  }
  return `fr_${base}_${Date.now().toString().slice(-5)}`;
}

function parsePagination(query: Record<string, any>) {
  const page = Math.max(1, parseInt(String(query.page || '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit || '10'), 10) || 10));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

function logActivity(
  userId: number | null,
  action: string,
  entityType: string,
  entityId: number | string | null,
  details: string | null
) {
  db.prepare(
    'INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, action, entityType, entityId !== null ? Number(entityId) : null, details);
}

function notifyUser(
  userId: number | null | undefined,
  title: string,
  message: string,
  type = 'info',
  relatedId: number | null = null
) {
  if (!userId) return;
  db.prepare(
    'INSERT INTO notifications (user_id, title, message, type, related_id) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, title, message, type, relatedId);
}

function notifyAdmins(title: string, message: string, type = 'info', relatedId: number | null = null) {
  const admins = db
    .prepare(
      "SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'admin' AND u.is_active = 1"
    )
    .all() as { id: number }[];
  for (const admin of admins) {
    notifyUser(admin.id, title, message, type, relatedId);
  }
}

interface AuthenticatedUser {
  id: number;
  username: string;
  full_name: string;
  email: string | null;
  contact_number: string | null;
  is_active: number;
  must_change_password: number;
  is_test: number;
  role: 'admin' | 'agent' | 'franchisee' | 'delivery';
  franchiseeId?: number;
  storeName?: string;
  agentId?: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      res.status(401).json({ message: 'Authentication required.' });
      return;
    }

    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number; role: string };
    const user = db
      .prepare(
        `SELECT u.id, u.username, u.full_name, u.email, u.contact_number, u.is_active,
                u.must_change_password, u.is_test, r.name AS role
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE u.id = ?`
      )
      .get(decoded.userId) as AuthenticatedUser | undefined;

    if (!user) {
      res.status(401).json({ message: 'User account not found.' });
      return;
    }
    if (!user.is_active) {
      res.status(403).json({ message: 'This account has been deactivated.' });
      return;
    }

    if (user.role === 'franchisee') {
      const fr = db
        .prepare('SELECT id, status, store_name FROM franchisees WHERE user_id = ?')
        .get(user.id) as { id: number; status: string; store_name: string } | undefined;
      if (!fr || fr.status !== 'Approved') {
        res.status(403).json({ message: 'Franchisee account is not approved.' });
        return;
      }
      user.franchiseeId = fr.id;
      user.storeName = fr.store_name;
    }

    if (user.role === 'agent') {
      const ag = db.prepare('SELECT id FROM agents WHERE user_id = ?').get(user.id) as
        | { id: number }
        | undefined;
      if (ag) user.agentId = ag.id;
    }

    req.user = user;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired session token.' });
  }
}

function authorize(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      res.status(403).json({ message: 'Forbidden: insufficient role permissions.' });
      return;
    }
    next();
  };
}

function requirePasswordUpdated(req: Request, res: Response, next: NextFunction) {
  if (req.user && requiresForcedPasswordChange(req.user)) {
    res.status(403).json({
      message: 'You must change your temporary/initial password before continuing.',
      mustChangePassword: true,
    });
    return;
  }
  next();
}

function requireWarehouse(_req: Request, res: Response, next: NextFunction) {
  const row = db
    .prepare('SELECT COUNT(*) AS cnt FROM warehouses WHERE is_active = 1')
    .get() as { cnt: number };
  if (!row || row.cnt === 0) {
    res.status(423).json({
      message: 'System locked: Admin must register at least one warehouse first.',
      warehouseLocked: true,
    });
    return;
  }
  next();
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // Serve product photos and proof of delivery photos statically from server/uploads/
  app.use('/uploads', express.static(path.resolve(process.cwd(), 'server', 'uploads')));

  const api = express.Router();

  // ===== PUBLIC ENDPOINTS =====
  api.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'AICE Franchisee Hub API' });
  });

  api.get('/system/status', (_req, res) => {
    const row = db
      .prepare('SELECT COUNT(*) AS cnt FROM warehouses WHERE is_active = 1')
      .get() as { cnt: number };
    res.json({ hasWarehouse: row.cnt > 0, warehouseCount: row.cnt });
  });

  api.post('/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ message: 'Username and password are required.' });
      return;
    }

    const user = db
      .prepare(
        `SELECT u.*, r.name AS role
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE u.username = ?`
      )
      .get(String(username).trim()) as any;

    if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
      res.status(401).json({ message: 'Invalid username or password.' });
      return;
    }

    if (!user.is_active) {
      res.status(403).json({ message: 'This account has been deactivated by the Admin.' });
      return;
    }

    let franchisee: any = null;
    if (user.role === 'franchisee') {
      const fr = db.prepare('SELECT * FROM franchisees WHERE user_id = ?').get(user.id) as any;
      if (!fr) {
        res.status(403).json({ message: 'Franchisee profile missing.' });
        return;
      }
      if (fr.status === 'Pending') {
        res.status(403).json({
          message: 'Your franchisee account is currently Pending Admin approval and cannot log in yet.',
        });
        return;
      }
      if (fr.status === 'Rejected') {
        res.status(403).json({
          message: `Your franchisee registration was Rejected: ${fr.rejection_reason || 'Please contact your recruiting agent.'}`,
        });
        return;
      }
      franchisee = fr;
    }

    const wh = db
      .prepare('SELECT COUNT(*) AS cnt FROM warehouses WHERE is_active = 1')
      .get() as { cnt: number };

    const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, {
      expiresIn: '12h',
    });

    const mustChange = requiresForcedPasswordChange(user);
    logActivity(user.id, 'LOGIN', 'user', user.id, `Logged in as ${user.role}`);

    res.json({
      token,
      hasWarehouse: wh.cnt > 0,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        email: user.email,
        contact_number: user.contact_number,
        role: user.role,
        must_change_password: mustChange,
        is_test: Boolean(user.is_test),
        franchisee: franchisee
          ? {
              id: franchisee.id,
              store_name: franchisee.store_name,
              address: franchisee.address,
              lat: franchisee.lat,
              lng: franchisee.lng,
            }
          : null,
      },
    });
  });

  // ===== AUTHENTICATED ROUTES (Allowed even before first-login password change) =====
  api.get('/auth/me', authenticate, (req, res) => {
    const wh = db
      .prepare('SELECT COUNT(*) AS cnt FROM warehouses WHERE is_active = 1')
      .get() as { cnt: number };

    let franchisee: any = null;
    if (req.user!.role === 'franchisee') {
      franchisee =
        db
          .prepare(
            'SELECT id, owner_name, store_name, address, contact_number, lat, lng, status FROM franchisees WHERE user_id = ?'
          )
          .get(req.user!.id) || null;
    }

    res.json({
      hasWarehouse: wh.cnt > 0,
      user: {
        ...req.user,
        must_change_password: requiresForcedPasswordChange(req.user!),
        is_test: Boolean(req.user!.is_test),
        franchisee,
      },
    });
  });

  api.post('/auth/change-password', authenticate, (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      res.status(400).json({ message: 'New password must be at least 8 characters long.' });
      return;
    }

    const row = db
      .prepare('SELECT password_hash FROM users WHERE id = ?')
      .get(req.user!.id) as { password_hash: string };

    if (!bcrypt.compareSync(currentPassword || '', row.password_hash)) {
      res.status(400).json({ message: 'Current password is incorrect.' });
      return;
    }

    if (bcrypt.compareSync(newPassword, row.password_hash)) {
      res.status(400).json({ message: 'New password must be different from your current password.' });
      return;
    }

    const hash = bcrypt.hashSync(newPassword, 10);
    db.prepare(
      "UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = ?"
    ).run(hash, req.user!.id);

    logActivity(req.user!.id, 'PASSWORD_CHANGED', 'user', req.user!.id, 'User updated password');
    res.json({ message: 'Password updated successfully.' });
  });

  // All routes below require authentication and first-login password change completed
  api.use(authenticate, requirePasswordUpdated);

  api.put('/auth/profile', (req, res) => {
    const { full_name, email, contact_number } = req.body;
    if (!full_name || !String(full_name).trim()) {
      res.status(400).json({ message: 'Full name is required.' });
      return;
    }
    db.prepare(
      "UPDATE users SET full_name = ?, email = ?, contact_number = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(String(full_name).trim(), email || null, contact_number || null, req.user!.id);

    if (req.user!.role === 'franchisee' && contact_number) {
      db.prepare('UPDATE franchisees SET contact_number = ?, owner_name = ? WHERE user_id = ?').run(
        String(contact_number).trim(),
        String(full_name).trim(),
        req.user!.id
      );
    }
    logActivity(req.user!.id, 'PROFILE_UPDATED', 'user', req.user!.id, 'Updated user profile');
    res.json({ message: 'Profile updated successfully.' });
  });

  // ===== NOTIFICATIONS =====
  api.get('/notifications', (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const totalRow = db
      .prepare('SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?')
      .get(req.user!.id) as { total: number };
    const unreadRow = db
      .prepare('SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND is_read = 0')
      .get(req.user!.id) as { unread: number };
    const rows = db
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?')
      .all(req.user!.id, limit, offset);

    res.json({
      data: rows,
      unreadCount: unreadRow.unread,
      pagination: {
        page,
        limit,
        total: totalRow.total,
        totalPages: Math.ceil(totalRow.total / limit) || 1,
      },
    });
  });

  api.patch('/notifications/:id/read', (req, res) => {
    const { id } = req.params;
    if (id === 'all') {
      db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user!.id);
    } else {
      db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(
        Number(id),
        req.user!.id
      );
    }
    res.json({ message: 'Marked as read.' });
  });

  // ===== WAREHOUSES (Available even when locked so Admin can complete Warehouse Setup) =====
  api.get('/warehouses', (_req, res) => {
    const rows = db.prepare('SELECT * FROM warehouses ORDER BY id ASC').all();
    res.json({ data: rows });
  });

  api.post('/warehouses', authorize('admin'), (req, res) => {
    const { name, address, contact_person, contact_number, lat, lng } = req.body;
    if (!name || !address || !contact_person || !contact_number) {
      res.status(400).json({ message: 'Name, address, contact person, and contact number are required.' });
      return;
    }
    if (!isValidCoords(lat, lng)) {
      res.status(400).json({ message: 'Please pin a valid warehouse location on the map.' });
      return;
    }

    const result = db
      .prepare(
        'INSERT INTO warehouses (name, address, contact_person, contact_number, lat, lng, is_active, created_by) VALUES (?, ?, ?, ?, ?, ?, 1, ?)'
      )
      .run(
        String(name).trim(),
        String(address).trim(),
        String(contact_person).trim(),
        String(contact_number).trim(),
        Number(lat),
        Number(lng),
        req.user!.id
      );

    logActivity(
      req.user!.id,
      'WAREHOUSE_CREATED',
      'warehouse',
      Number(result.lastInsertRowid),
      `Registered warehouse: ${String(name).trim()}`
    );
    res.status(201).json({
      message: 'Warehouse registered successfully.',
      id: Number(result.lastInsertRowid),
    });
  });

  api.put('/warehouses/:id', authorize('admin'), (req, res) => {
    const { id } = req.params;
    const { name, address, contact_person, contact_number, lat, lng, is_active } = req.body;
    if (!name || !address || !contact_person || !contact_number || !isValidCoords(lat, lng)) {
      res.status(400).json({ message: 'Complete warehouse details and valid coordinates are required.' });
      return;
    }
    db.prepare(
      'UPDATE warehouses SET name = ?, address = ?, contact_person = ?, contact_number = ?, lat = ?, lng = ?, is_active = ? WHERE id = ?'
    ).run(
      String(name).trim(),
      String(address).trim(),
      String(contact_person).trim(),
      String(contact_number).trim(),
      Number(lat),
      Number(lng),
      is_active === false || is_active === 0 ? 0 : 1,
      Number(id)
    );
    logActivity(req.user!.id, 'WAREHOUSE_UPDATED', 'warehouse', id, `Updated warehouse: ${name}`);
    res.json({ message: 'Warehouse updated.' });
  });

  // ===== STORE MAP (All 4 roles; requires Warehouse Setup) =====
  api.get('/map/stores', requireWarehouse, (req, res) => {
    const warehouses = db
      .prepare(
        'SELECT id, name, address, contact_person, contact_number, lat, lng FROM warehouses WHERE is_active = 1'
      )
      .all() as any[];

    const stores = db
      .prepare(
        `SELECT f.id, f.user_id, f.store_name, f.owner_name, f.address, f.contact_number, f.lat, f.lng
         FROM franchisees f
         JOIN users u ON u.id = f.user_id
         WHERE f.status = 'Approved' AND u.is_active = 1`
      )
      .all() as any[];

    let myStore: any = null;
    let nearbyStores: any[] = [];
    if (req.user!.role === 'franchisee') {
      myStore = stores.find((s) => s.user_id === req.user!.id) || null;
      if (myStore) {
        nearbyStores = stores
          .filter((s) => s.id !== myStore.id)
          .map((s) => ({
            ...s,
            distance_km: Number(
              haversineKm(Number(myStore.lat), Number(myStore.lng), Number(s.lat), Number(s.lng)).toFixed(2)
            ),
          }))
          .sort((a, b) => a.distance_km - b.distance_km);
      }
    }

    res.json({ warehouses, stores, myStore, nearbyStores });
  });

  // ===== ADMIN DASHBOARD & REPORTS =====
  api.get('/admin/dashboard', authorize('admin'), requireWarehouse, (_req, res) => {
    const orders = db
      .prepare(
        `SELECT COUNT(*) AS total_orders,
                COALESCE(SUM(CASE WHEN status = 'Placed' THEN 1 ELSE 0 END), 0) AS pending_orders,
                COALESCE(SUM(CASE WHEN status IN ('Out for Delivery', 'Near / Arrived') THEN 1 ELSE 0 END), 0) AS in_transit,
                COALESCE(SUM(CASE WHEN status = 'Delivered' THEN 1 ELSE 0 END), 0) AS delivered_orders,
                COALESCE(SUM(CASE WHEN status IN ('Confirmed', 'Preparing', 'Assigned to Delivery', 'Out for Delivery', 'Near / Arrived', 'Delivered') THEN total_amount ELSE 0 END), 0) AS total_sales
         FROM orders`
      )
      .get() as any;

    const franchisees = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN status = 'Approved' THEN 1 ELSE 0 END), 0) AS approved,
                COALESCE(SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END), 0) AS pending,
                COALESCE(SUM(CASE WHEN status = 'Rejected' THEN 1 ELSE 0 END), 0) AS rejected
         FROM franchisees`
      )
      .get() as any;

    const lowStock = db
      .prepare(
        `SELECT COUNT(*) AS low_stock_count
         FROM products p
         WHERE p.is_active = 1
           AND COALESCE((SELECT SUM(i.quantity) FROM inventory i WHERE i.product_id = p.id), 0) <= p.low_stock_threshold`
      )
      .get() as { low_stock_count: number };

    const recentOrders = db
      .prepare(
        `SELECT o.id, o.order_number, o.status, o.total_amount, o.created_at, f.store_name
         FROM orders o
         JOIN franchisees f ON f.id = o.franchisee_id
         ORDER BY o.id DESC LIMIT 8`
      )
      .all();

    res.json({
      orders,
      franchisees,
      lowStockCount: lowStock.low_stock_count,
      recentOrders,
    });
  });

  // ===== SALES ANALYTICS (Admin Only — Real SQLite Data) =====
  api.get('/analytics/sales', authorize('admin'), requireWarehouse, (req, res) => {
    const rangeParam = String(req.query.range || '30d');
    const range = ['7d', '30d', 'month', 'custom'].includes(rangeParam) ? rangeParam : '30d';
    const warehouseId = Number(req.query.warehouse_id) || null;
    const categoryId = Number(req.query.category_id) || null;

    let startDate = '';
    let endDate = '';
    let prevStartDate = '';
    let prevEndDate = '';
    let groupBy: 'day' | 'week' | 'month' = 'day';

    if (range === '7d') {
      const d = db
        .prepare(
          `SELECT date('now', '-6 days') AS s,
                  date('now') AS e,
                  date('now', '-13 days') AS ps,
                  date('now', '-7 days') AS pe`
        )
        .get() as any;
      startDate = d.s;
      endDate = d.e;
      prevStartDate = d.ps;
      prevEndDate = d.pe;
      groupBy = 'day';
    } else if (range === 'month') {
      const d = db
        .prepare(
          `SELECT date('now', 'start of month') AS s,
                  date('now') AS e,
                  date('now', 'start of month', '-1 month') AS ps,
                  date('now', 'start of month', '-1 day') AS pe`
        )
        .get() as any;
      startDate = d.s;
      endDate = d.e;
      prevStartDate = d.ps;
      prevEndDate = d.pe;
      groupBy = 'day';
    } else if (range === 'custom' && req.query.from && req.query.to) {
      const rawFrom = String(req.query.from).trim();
      const rawTo = String(req.query.to).trim();
      const d = db
        .prepare(
          `SELECT date(?) AS s,
                  date(?) AS e,
                  CAST(MAX(1, ROUND(julianday(date(?)) - julianday(date(?)) + 1)) AS INTEGER) AS span`
        )
        .get(rawFrom, rawTo, rawTo, rawFrom) as any;
      startDate = d?.s || rawFrom;
      endDate = d?.e || rawTo;
      const span = Number(d?.span || 30);
      const prev = db
        .prepare(
          `SELECT date(?, '-' || ? || ' days') AS ps,
                  date(?, '-1 day') AS pe`
        )
        .get(startDate, span, startDate) as any;
      prevStartDate = prev.ps;
      prevEndDate = prev.pe;
      groupBy = span > 90 ? 'month' : span > 35 ? 'week' : 'day';
    } else {
      // Default: 30d
      const d = db
        .prepare(
          `SELECT date('now', '-29 days') AS s,
                  date('now') AS e,
                  date('now', '-59 days') AS ps,
                  date('now', '-30 days') AS pe`
        )
        .get() as any;
      startDate = d.s;
      endDate = d.e;
      prevStartDate = d.ps;
      prevEndDate = d.pe;
      groupBy = 'day';
    }

    const REVENUE_STATUS_SQL =
      "('Confirmed', 'Preparing', 'Assigned to Delivery', 'Out for Delivery', 'Near / Arrived', 'Delivered')";

    const whClause = warehouseId ? ` AND o.warehouse_id = ${Number(warehouseId)}` : '';
    const catExistsClause = categoryId
      ? ` AND EXISTS (
            SELECT 1 FROM order_items oi
            JOIN products p ON p.id = oi.product_id
            WHERE oi.order_id = o.id AND p.category_id = ${Number(categoryId)}
          )`
      : '';
    const orderRevenueExpr = categoryId
      ? `COALESCE((
            SELECT SUM(oi.subtotal)
            FROM order_items oi
            JOIN products p ON p.id = oi.product_id
            WHERE oi.order_id = o.id AND p.category_id = ${Number(categoryId)}
          ), 0)`
      : 'o.total_amount';

    const queryPeriodMetrics = (pStart: string, pEnd: string) => {
      return db
        .prepare(
          `SELECT
             COALESCE(SUM(CASE WHEN o.status IN ${REVENUE_STATUS_SQL} THEN ${orderRevenueExpr} ELSE 0 END), 0) AS total_revenue,
             COALESCE(SUM(CASE WHEN o.status IN ${REVENUE_STATUS_SQL} THEN 1 ELSE 0 END), 0) AS counted_orders,
             COUNT(*) AS total_orders,
             COALESCE(SUM(CASE WHEN o.status = 'Delivered' THEN 1 ELSE 0 END), 0) AS delivered_orders,
             COALESCE(SUM(CASE WHEN o.status IN ('Cancelled', 'Rejected') THEN 1 ELSE 0 END), 0) AS cancelled_orders
           FROM orders o
           WHERE date(o.created_at) >= date(?)
             AND date(o.created_at) <= date(?)
             ${whClause}
             ${catExistsClause}`
        )
        .get(pStart, pEnd) as any;
    };

    const currentRaw = queryPeriodMetrics(startDate, endDate);
    const previousRaw = queryPeriodMetrics(prevStartDate, prevEndDate);
    const kpis = computeSalesKpiSummary(currentRaw, previousRaw);

    // 3. Revenue Over Time (using SQLite strftime)
    const strftimeFmt =
      groupBy === 'month' ? '%Y-%m' : groupBy === 'week' ? '%Y-W%W' : '%Y-%m-%d';

    const revenueOverTime = db
      .prepare(
        `SELECT
           strftime('${strftimeFmt}', o.created_at) AS period_label,
           COALESCE(SUM(CASE WHEN o.status IN ${REVENUE_STATUS_SQL} THEN ${orderRevenueExpr} ELSE 0 END), 0) AS revenue,
           COALESCE(SUM(CASE WHEN o.status IN ${REVENUE_STATUS_SQL} THEN 1 ELSE 0 END), 0) AS counted_orders,
           COUNT(*) AS total_orders
         FROM orders o
         WHERE date(o.created_at) >= date(?)
           AND date(o.created_at) <= date(?)
           ${whClause}
           ${catExistsClause}
         GROUP BY strftime('${strftimeFmt}', o.created_at)
         ORDER BY period_label ASC`
      )
      .all(startDate, endDate) as any[];

    // 4. Top 5 Products by Revenue and by Boxes Sold (from Confirmed/Delivered orders)
    const itemCatClause = categoryId ? ` AND p.category_id = ${Number(categoryId)}` : '';
    const productSalesRows = db
      .prepare(
        `SELECT
           p.id AS product_id,
           p.sku,
           p.name,
           p.flavor,
           p.size,
           p.image_url,
           c.name AS category_name,
           COALESCE(SUM(oi.quantity), 0) AS boxes_sold,
           COALESCE(SUM(oi.subtotal), 0) AS revenue,
           COUNT(DISTINCT o.id) AS order_count
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         JOIN products p ON p.id = oi.product_id
         JOIN categories c ON c.id = p.category_id
         WHERE o.status IN ${REVENUE_STATUS_SQL}
           AND date(o.created_at) >= date(?)
           AND date(o.created_at) <= date(?)
           ${whClause}
           ${itemCatClause}
         GROUP BY p.id
         HAVING boxes_sold > 0 OR revenue > 0`
      )
      .all(startDate, endDate) as any[];

    const topProductsByRevenue = [...productSalesRows]
      .sort((a, b) => Number(b.revenue) - Number(a.revenue) || Number(b.boxes_sold) - Number(a.boxes_sold))
      .slice(0, 5);

    const topProductsByBoxes = [...productSalesRows]
      .sort((a, b) => Number(b.boxes_sold) - Number(a.boxes_sold) || Number(b.revenue) - Number(a.revenue))
      .slice(0, 5);

    // 5. Sales by Category
    const categoryRows = db
      .prepare(
        `SELECT
           c.id AS category_id,
           c.name AS category_name,
           COALESCE(SUM(oi.quantity), 0) AS boxes_sold,
           COALESCE(SUM(oi.subtotal), 0) AS revenue,
           COUNT(DISTINCT o.id) AS order_count
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         JOIN products p ON p.id = oi.product_id
         JOIN categories c ON c.id = p.category_id
         WHERE o.status IN ${REVENUE_STATUS_SQL}
           AND date(o.created_at) >= date(?)
           AND date(o.created_at) <= date(?)
           ${whClause}
           ${itemCatClause}
         GROUP BY c.id
         ORDER BY revenue DESC`
      )
      .all(startDate, endDate) as any[];

    const totalCatRevenue = categoryRows.reduce((s, r) => s + Number(r.revenue || 0), 0);
    const salesByCategory = categoryRows.map((r) => ({
      ...r,
      revenue: Number(r.revenue || 0),
      boxes_sold: Number(r.boxes_sold || 0),
      share_pct:
        totalCatRevenue > 0
          ? Number(((Number(r.revenue || 0) / totalCatRevenue) * 100).toFixed(1))
          : 0,
    }));

    // 6. Top Franchisees by Order Value and Number of Orders
    const franchiseeRows = db
      .prepare(
        `SELECT
           f.id AS franchisee_id,
           f.store_name,
           f.owner_name,
           f.address,
           u.username,
           COUNT(o.id) AS total_orders,
           COALESCE(SUM(CASE WHEN o.status IN ${REVENUE_STATUS_SQL} THEN 1 ELSE 0 END), 0) AS counted_orders,
           COALESCE(SUM(CASE WHEN o.status = 'Delivered' THEN 1 ELSE 0 END), 0) AS delivered_orders,
           COALESCE(SUM(CASE WHEN o.status IN ${REVENUE_STATUS_SQL} THEN ${orderRevenueExpr} ELSE 0 END), 0) AS order_value
         FROM franchisees f
         JOIN users u ON u.id = f.user_id
         JOIN orders o ON o.franchisee_id = f.id
         WHERE date(o.created_at) >= date(?)
           AND date(o.created_at) <= date(?)
           ${whClause}
           ${catExistsClause}
         GROUP BY f.id
         ORDER BY order_value DESC, total_orders DESC
         LIMIT 10`
      )
      .all(startDate, endDate) as any[];

    const topFranchisees = franchiseeRows.map((row, index) => ({
      ...row,
      rank: index + 1,
      order_value: Number(row.order_value || 0),
      total_orders: Number(row.total_orders || 0),
      counted_orders: Number(row.counted_orders || 0),
      delivered_orders: Number(row.delivered_orders || 0),
    }));

    // 7. Agent Performance (all agents, with recruits count, approved franchisees, and total order value from their franchisees in the period)
    const agentRows = db
      .prepare(
        `SELECT
           a.id AS agent_id,
           u.full_name AS agent_name,
           u.username AS agent_username,
           u.contact_number,
           (SELECT COUNT(*) FROM franchisees f WHERE f.agent_id = a.id) AS recruits_count,
           (SELECT COUNT(*) FROM franchisees f WHERE f.agent_id = a.id AND f.status = 'Approved') AS approved_franchisees,
           COALESCE((
             SELECT COUNT(o.id)
             FROM orders o
             JOIN franchisees f ON f.id = o.franchisee_id
             WHERE f.agent_id = a.id
               AND o.status IN ${REVENUE_STATUS_SQL}
               AND date(o.created_at) >= date(?)
               AND date(o.created_at) <= date(?)
               ${whClause}
               ${catExistsClause}
           ), 0) AS counted_orders,
           COALESCE((
             SELECT SUM(${orderRevenueExpr})
             FROM orders o
             JOIN franchisees f ON f.id = o.franchisee_id
             WHERE f.agent_id = a.id
               AND o.status IN ${REVENUE_STATUS_SQL}
               AND date(o.created_at) >= date(?)
               AND date(o.created_at) <= date(?)
               ${whClause}
               ${catExistsClause}
           ), 0) AS total_order_value
         FROM agents a
         JOIN users u ON u.id = a.user_id
         ORDER BY total_order_value DESC, approved_franchisees DESC, a.id ASC`
      )
      .all(startDate, endDate, startDate, endDate) as any[];

    // 8. Orders by Status (including delivery completion stats)
    const statusRows = db
      .prepare(
        `SELECT
           o.status,
           COUNT(o.id) AS order_count,
           COALESCE(SUM(${orderRevenueExpr}), 0) AS status_amount,
           COUNT(d.id) AS assigned_deliveries
         FROM orders o
         LEFT JOIN deliveries d ON d.order_id = o.id
         WHERE date(o.created_at) >= date(?)
           AND date(o.created_at) <= date(?)
           ${whClause}
           ${catExistsClause}
         GROUP BY o.status
         ORDER BY order_count DESC`
      )
      .all(startDate, endDate) as any[];

    const totalStatusOrders = statusRows.reduce((s, r) => s + Number(r.order_count || 0), 0);
    const ordersByStatus = statusRows.map((r) => ({
      status: r.status,
      order_count: Number(r.order_count || 0),
      status_amount: Number(r.status_amount || 0),
      assigned_deliveries: Number(r.assigned_deliveries || 0),
      share_pct:
        totalStatusOrders > 0
          ? Number(((Number(r.order_count || 0) / totalStatusOrders) * 100).toFixed(1))
          : 0,
    }));

    res.json({
      period: {
        range,
        startDate,
        endDate,
        prevStartDate,
        prevEndDate,
        groupBy,
      },
      kpis,
      revenueOverTime,
      topProductsByRevenue,
      topProductsByBoxes,
      salesByCategory,
      topFranchisees,
      agentPerformance: agentRows.map((a) => ({
        ...a,
        recruits_count: Number(a.recruits_count || 0),
        approved_franchisees: Number(a.approved_franchisees || 0),
        counted_orders: Number(a.counted_orders || 0),
        total_order_value: Number(a.total_order_value || 0),
      })),
      ordersByStatus,
    });
  });

  api.get('/admin/reports/sales', authorize('admin'), requireWarehouse, (req, res) => {
    const { from, to } = req.query;
    const params: any[] = [];
    let where = "WHERE o.status NOT IN ('Cancelled', 'Rejected')";
    if (from) {
      where += ' AND date(o.created_at) >= date(?)';
      params.push(String(from));
    }
    if (to) {
      where += ' AND date(o.created_at) <= date(?)';
      params.push(String(to));
    }

    const rows = db
      .prepare(
        `SELECT o.order_number,
                o.created_at AS order_date,
                f.store_name,
                w.name AS warehouse_name,
                o.status,
                COALESCE(o.subtotal, o.total_amount) AS subtotal,
                COALESCE(o.discount_amount, 0) AS discount_amount,
                (SELECT pr.name FROM promos pr WHERE pr.id = o.promo_id) AS promo_name,
                o.total_amount
         FROM orders o
         JOIN franchisees f ON f.id = o.franchisee_id
         JOIN warehouses w ON w.id = o.warehouse_id
         ${where}
         ORDER BY o.id DESC`
      )
      .all(...params) as any[];

    const totalSales = rows.reduce((sum, r) => sum + Number(r.total_amount || 0), 0);
    const totalDiscount = rows.reduce((sum, r) => sum + Number(r.discount_amount || 0), 0);
    res.json({ data: rows, summary: { count: rows.length, totalSales, totalDiscount } });
  });

  api.get('/admin/reports/inventory', authorize('admin'), requireWarehouse, (req, res) => {
    const warehouseId = req.query.warehouse_id;
    const params: any[] = [];
    let where = 'WHERE 1=1';
    if (warehouseId) {
      where += ' AND w.id = ?';
      params.push(Number(warehouseId));
    }
    const rows = db
      .prepare(
        `SELECT w.name AS warehouse_name, p.sku, p.name AS product_name, p.flavor, p.size, p.price,
                COALESCE(i.quantity, 0) AS quantity, p.low_stock_threshold,
                CASE WHEN COALESCE(i.quantity, 0) <= p.low_stock_threshold THEN 'LOW' ELSE 'OK' END AS stock_status
         FROM warehouses w
         CROSS JOIN products p
         LEFT JOIN inventory i ON i.warehouse_id = w.id AND i.product_id = p.id
         ${where}
         ORDER BY w.name, p.name`
      )
      .all(...params);
    res.json({ data: rows });
  });

  // ===== ADMIN: DEMAND FORECASTING (Based on Franchisee Most-Ordered Products) =====
  api.get('/admin/demand-forecast', authorize('admin'), requireWarehouse, (req, res) => {
    const warehouseId = req.query.warehouse_id ? Number(req.query.warehouse_id) : null;
    const categoryId = req.query.category_id ? Number(req.query.category_id) : null;
    const horizon: 7 | 30 = req.query.horizon === '7' ? 7 : 30;

    const whFilterOrder = warehouseId ? `AND o.warehouse_id = ${warehouseId}` : '';
    const whFilterInv = warehouseId ? `AND i.warehouse_id = ${warehouseId}` : '';
    const catFilter = categoryId ? `AND p.category_id = ${categoryId}` : '';

    const rawProducts = db
      .prepare(
        `SELECT
           p.id AS product_id,
           p.sku,
           p.name,
           p.flavor,
           p.size,
           p.price,
           p.image_url,
           p.low_stock_threshold,
           c.name AS category_name,
           COALESCE((SELECT SUM(i.quantity) FROM inventory i WHERE i.product_id = p.id ${whFilterInv}), 0) AS current_stock,
           COALESCE((
             SELECT SUM(oi.quantity)
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             WHERE oi.product_id = p.id
               AND o.status NOT IN ('Cancelled', 'Rejected')
               ${whFilterOrder}
           ), 0) AS total_ordered_qty,
           COALESCE((
             SELECT COUNT(DISTINCT o.id)
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             WHERE oi.product_id = p.id
               AND o.status NOT IN ('Cancelled', 'Rejected')
               ${whFilterOrder}
           ), 0) AS order_count,
           COALESCE((
             SELECT COUNT(DISTINCT o.franchisee_id)
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             WHERE oi.product_id = p.id
               AND o.status NOT IN ('Cancelled', 'Rejected')
               ${whFilterOrder}
           ), 0) AS unique_franchisees,
           COALESCE((
             SELECT SUM(oi.quantity)
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             WHERE oi.product_id = p.id
               AND o.status NOT IN ('Cancelled', 'Rejected')
               AND date(o.created_at) >= date('now', '-7 days')
               ${whFilterOrder}
           ), 0) AS recent_7d_qty,
           COALESCE((
             SELECT SUM(oi.quantity)
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             WHERE oi.product_id = p.id
               AND o.status NOT IN ('Cancelled', 'Rejected')
               AND date(o.created_at) < date('now', '-7 days')
               AND date(o.created_at) >= date('now', '-14 days')
               ${whFilterOrder}
           ), 0) AS prev_7d_qty,
           COALESCE((
             SELECT SUM(oi.quantity)
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             WHERE oi.product_id = p.id
               AND o.status NOT IN ('Cancelled', 'Rejected')
               AND date(o.created_at) >= date('now', '-30 days')
               ${whFilterOrder}
           ), 0) AS recent_30d_qty
         FROM products p
         JOIN categories c ON c.id = p.category_id
         WHERE p.is_active = 1 ${catFilter}`
      )
      .all() as any[];

    const forecastRows = calculateDemandForecast(rawProducts, horizon);

    // Top franchisee store contributors per product
    const topFranchiseesByProduct = db
      .prepare(
        `SELECT
           oi.product_id,
           f.store_name,
           SUM(oi.quantity) AS store_qty,
           COUNT(DISTINCT o.id) AS store_orders
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         JOIN franchisees f ON f.id = o.franchisee_id
         WHERE o.status NOT IN ('Cancelled', 'Rejected')
           ${whFilterOrder}
         GROUP BY oi.product_id, f.id
         ORDER BY store_qty DESC`
      )
      .all() as any[];

    const storeMap: Record<number, { store_name: string; store_qty: number; store_orders: number }[]> = {};
    for (const row of topFranchiseesByProduct) {
      if (!storeMap[row.product_id]) storeMap[row.product_id] = [];
      if (storeMap[row.product_id].length < 3) {
        storeMap[row.product_id].push({
          store_name: row.store_name,
          store_qty: Number(row.store_qty),
          store_orders: Number(row.store_orders),
        });
      }
    }

    const enrichedRows = forecastRows.map((item) => ({
      ...item,
      top_stores: storeMap[item.product_id] || [],
    }));

    const totalOrderedUnits = enrichedRows.reduce((s, r) => s + r.total_ordered_qty, 0);
    const totalProjectedUnits = enrichedRows.reduce(
      (s, r) => s + (horizon === 7 ? r.forecast_next_7d : r.forecast_next_30d),
      0
    );
    const totalRecommendedRestock = enrichedRows.reduce((s, r) => s + r.recommended_restock, 0);

    res.json({
      horizon,
      data: enrichedRows,
      summary: {
        totalProducts: enrichedRows.length,
        totalOrderedUnits,
        totalProjectedUnits,
        totalRecommendedRestock,
        topProduct: enrichedRows[0] || null,
      },
    });
  });

  api.get('/admin/activity-logs', authorize('admin'), requireWarehouse, (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const search = `%${String(req.query.search || '').trim()}%`;
    const totalRow = db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM activity_logs al
         LEFT JOIN users u ON u.id = al.user_id
         WHERE al.action LIKE ? OR COALESCE(al.details, '') LIKE ? OR COALESCE(u.username, '') LIKE ?`
      )
      .get(search, search, search) as { total: number };

    const rows = db
      .prepare(
        `SELECT al.*, u.username, u.full_name
         FROM activity_logs al
         LEFT JOIN users u ON u.id = al.user_id
         WHERE al.action LIKE ? OR COALESCE(al.details, '') LIKE ? OR COALESCE(u.username, '') LIKE ?
         ORDER BY al.id DESC LIMIT ? OFFSET ?`
      )
      .all(search, search, search, limit, offset);

    res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total: totalRow.total,
        totalPages: Math.ceil(totalRow.total / limit) || 1,
      },
    });
  });

  // ===== ADMIN: AGENT MANAGEMENT =====
  api.get('/admin/agents', authorize('admin'), requireWarehouse, (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const search = `%${String(req.query.search || '').trim()}%`;
    const status = req.query.status;
    const params: any[] = [search, search, search];
    let where = "WHERE (u.full_name LIKE ? OR u.username LIKE ? OR COALESCE(u.email, '') LIKE ?)";
    if (status === 'active') where += ' AND u.is_active = 1';
    if (status === 'inactive') where += ' AND u.is_active = 0';

    const totalRow = db
      .prepare(`SELECT COUNT(*) AS total FROM agents a JOIN users u ON u.id = a.user_id ${where}`)
      .get(...params) as { total: number };

    const rows = db
      .prepare(
        `SELECT a.id AS agent_id, u.id AS user_id, u.username, u.full_name, u.email, u.contact_number,
                u.is_active, u.must_change_password, u.created_at,
                (SELECT COUNT(*) FROM franchisees f WHERE f.agent_id = a.id) AS total_recruits,
                (SELECT COUNT(*) FROM franchisees f WHERE f.agent_id = a.id AND f.status = 'Approved') AS approved_recruits,
                (SELECT COUNT(*) FROM franchisees f WHERE f.agent_id = a.id AND f.status = 'Pending') AS pending_recruits
         FROM agents a
         JOIN users u ON u.id = a.user_id
         ${where}
         ORDER BY a.id DESC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset);

    res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total: totalRow.total,
        totalPages: Math.ceil(totalRow.total / limit) || 1,
      },
    });
  });

  api.post('/admin/agents', authorize('admin'), requireWarehouse, (req, res) => {
    const { full_name, contact_number, email, username } = req.body;
    if (!full_name || !contact_number || !email || !username) {
      res.status(400).json({ message: 'Full name, contact number, email, and username are required.' });
      return;
    }

    const cleanUser = String(username).trim().toLowerCase();
    const dup = db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUser);
    if (dup) {
      res.status(409).json({ message: 'Username already exists.' });
      return;
    }

    const tempPassword = generateTempPassword();
    const hash = bcrypt.hashSync(tempPassword, 10);

    const tx = db.transaction(() => {
      const role = db.prepare("SELECT id FROM roles WHERE name = 'agent'").get() as { id: number };
      const uRes = db
        .prepare(
          `INSERT INTO users (role_id, username, password_hash, full_name, email, contact_number, is_active, must_change_password)
           VALUES (?, ?, ?, ?, ?, ?, 1, 1)`
        )
        .run(
          role.id,
          cleanUser,
          hash,
          String(full_name).trim(),
          String(email).trim(),
          String(contact_number).trim()
        );
      const aRes = db
        .prepare('INSERT INTO agents (user_id, created_by) VALUES (?, ?)')
        .run(Number(uRes.lastInsertRowid), req.user!.id);
      logActivity(
        req.user!.id,
        'AGENT_CREATED',
        'agent',
        Number(aRes.lastInsertRowid),
        `Created agent ${cleanUser}`
      );
      return Number(aRes.lastInsertRowid);
    });

    const agentId = tx();
    res.status(201).json({
      message: 'Agent account created. Hand the one-time temporary password to the agent.',
      agentId,
      username: cleanUser,
      temporaryPassword: tempPassword,
    });
  });

  api.post('/admin/agents/:userId/reset-password', authorize('admin'), requireWarehouse, (req, res) => {
    const { userId } = req.params;
    const tempPassword = generateTempPassword();
    const hash = bcrypt.hashSync(tempPassword, 10);

    const agentUser = db
      .prepare(
        `SELECT u.id, u.username FROM users u JOIN roles r ON r.id = u.role_id
         WHERE u.id = ? AND r.name = 'agent'`
      )
      .get(Number(userId)) as { id: number; username: string } | undefined;

    if (!agentUser) {
      res.status(404).json({ message: 'Agent not found.' });
      return;
    }

    db.prepare(
      "UPDATE users SET password_hash = ?, must_change_password = 1, is_test = 0, updated_at = datetime('now') WHERE id = ?"
    ).run(hash, agentUser.id);

    logActivity(
      req.user!.id,
      'AGENT_PASSWORD_RESET',
      'user',
      agentUser.id,
      `Reset temporary password for agent @${agentUser.username}`
    );
    res.json({
      message: 'Temporary password reset.',
      username: agentUser.username,
      temporaryPassword: tempPassword,
    });
  });

  // ===== ADMIN: DELIVERY STAFF =====
  api.get('/admin/delivery-staff', authorize('admin'), requireWarehouse, (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const search = `%${String(req.query.search || '').trim()}%`;

    const totalRow = db
      .prepare(
        `SELECT COUNT(*) AS total FROM users u JOIN roles r ON r.id = u.role_id
         WHERE r.name = 'delivery' AND (u.full_name LIKE ? OR u.username LIKE ? OR COALESCE(u.contact_number, '') LIKE ?)`
      )
      .get(search, search, search) as { total: number };

    const rows = db
      .prepare(
        `SELECT u.id, u.username, u.full_name, u.email, u.contact_number, u.is_active, u.created_at,
                (SELECT COUNT(*) FROM deliveries d WHERE d.delivery_staff_id = u.id AND d.status != 'Delivered') AS active_deliveries,
                (SELECT COUNT(*) FROM deliveries d WHERE d.delivery_staff_id = u.id AND d.status = 'Delivered') AS completed_deliveries
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE r.name = 'delivery' AND (u.full_name LIKE ? OR u.username LIKE ? OR COALESCE(u.contact_number, '') LIKE ?)
         ORDER BY u.id DESC LIMIT ? OFFSET ?`
      )
      .all(search, search, search, limit, offset);

    res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total: totalRow.total,
        totalPages: Math.ceil(totalRow.total / limit) || 1,
      },
    });
  });

  api.post('/admin/delivery-staff', authorize('admin'), requireWarehouse, (req, res) => {
    const { full_name, username, contact_number, email, password } = req.body;
    if (!full_name || !username || !contact_number || !password) {
      res.status(400).json({ message: 'Full name, username, contact number, and password are required.' });
      return;
    }
    if (String(password).length < 8) {
      res.status(400).json({ message: 'Password must be at least 8 characters.' });
      return;
    }
    const cleanUser = String(username).trim().toLowerCase();
    const dup = db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUser);
    if (dup) {
      res.status(409).json({ message: 'Username already exists.' });
      return;
    }

    const role = db.prepare("SELECT id FROM roles WHERE name = 'delivery'").get() as { id: number };
    const hash = bcrypt.hashSync(String(password), 10);
    const result = db
      .prepare(
        'INSERT INTO users (role_id, username, password_hash, full_name, email, contact_number, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)'
      )
      .run(
        role.id,
        cleanUser,
        hash,
        String(full_name).trim(),
        email ? String(email).trim() : null,
        String(contact_number).trim()
      );

    logActivity(
      req.user!.id,
      'DELIVERY_STAFF_CREATED',
      'user',
      Number(result.lastInsertRowid),
      `Created delivery staff @${cleanUser}`
    );
    res.status(201).json({
      message: 'Delivery staff account created.',
      id: Number(result.lastInsertRowid),
    });
  });

  api.patch('/admin/users/:userId/toggle-status', authorize('admin'), requireWarehouse, (req, res) => {
    const targetId = Number(req.params.userId);
    if (targetId === req.user!.id) {
      res.status(400).json({ message: 'You cannot deactivate your own account.' });
      return;
    }
    const row = db
      .prepare('SELECT is_active, username FROM users WHERE id = ?')
      .get(targetId) as { is_active: number; username: string } | undefined;
    if (!row) {
      res.status(404).json({ message: 'User not found.' });
      return;
    }
    const nextState = row.is_active ? 0 : 1;
    db.prepare("UPDATE users SET is_active = ?, updated_at = datetime('now') WHERE id = ?").run(
      nextState,
      targetId
    );
    logActivity(
      req.user!.id,
      nextState ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
      'user',
      targetId,
      `Set @${row.username} active=${nextState}`
    );
    res.json({
      message: nextState ? 'Account activated.' : 'Account deactivated.',
      is_active: Boolean(nextState),
    });
  });

  // ===== AGENT: REGISTER FRANCHISEE & LIST RECRUITS =====
  api.post('/agent/franchisees', authorize('agent'), requireWarehouse, (req, res) => {
    const { owner_name, store_name, address, contact_number, email, lat, lng, initial_password } = req.body;
    if (!owner_name || !store_name || !address || !contact_number || !initial_password) {
      res.status(400).json({
        message: 'Owner name, store name, address, contact number, and initial password are required.',
      });
      return;
    }
    if (!isValidCoords(lat, lng)) {
      res.status(400).json({ message: 'Please pin a valid store location on the map.' });
      return;
    }
    if (String(initial_password).length < 8) {
      res.status(400).json({ message: 'Initial password must be at least 8 characters.' });
      return;
    }

    const username = generateFranchiseeUsername(String(owner_name), String(store_name));
    const hash = bcrypt.hashSync(String(initial_password), 10);

    const tx = db.transaction(() => {
      const role = db.prepare("SELECT id FROM roles WHERE name = 'franchisee'").get() as { id: number };
      const uRes = db
        .prepare(
          `INSERT INTO users (role_id, username, password_hash, full_name, email, contact_number, is_active, must_change_password)
           VALUES (?, ?, ?, ?, ?, ?, 1, 1)`
        )
        .run(
          role.id,
          username,
          hash,
          String(owner_name).trim(),
          email ? String(email).trim() : null,
          String(contact_number).trim()
        );

      const fRes = db
        .prepare(
          `INSERT INTO franchisees (user_id, agent_id, owner_name, store_name, address, contact_number, lat, lng, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending')`
        )
        .run(
          Number(uRes.lastInsertRowid),
          req.user!.agentId,
          String(owner_name).trim(),
          String(store_name).trim(),
          String(address).trim(),
          String(contact_number).trim(),
          Number(lat),
          Number(lng)
        );

      const fId = Number(fRes.lastInsertRowid);
      notifyAdmins(
        'New Pending Franchisee',
        `Agent ${req.user!.full_name} registered "${String(store_name).trim()}" (${String(owner_name).trim()}). Waiting for review.`,
        'approval',
        fId
      );
      logActivity(
        req.user!.id,
        'FRANCHISEE_REGISTERED',
        'franchisee',
        fId,
        `Registered pending franchisee ${String(store_name).trim()} (@${username})`
      );
      return fId;
    });

    const franchiseeId = tx();
    res.status(201).json({
      message: 'Franchisee registered as Pending and submitted for Admin approval.',
      franchiseeId,
      generatedUsername: username,
    });
  });

  api.get('/agent/recruits', authorize('agent'), requireWarehouse, (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const search = `%${String(req.query.search || '').trim()}%`;
    const status = String(req.query.status || '');
    const params: any[] = [req.user!.agentId, search, search];
    let where = 'WHERE f.agent_id = ? AND (f.store_name LIKE ? OR f.owner_name LIKE ?)';
    if (['Pending', 'Approved', 'Rejected'].includes(status)) {
      where += ' AND f.status = ?';
      params.push(status);
    }

    const totalRow = db
      .prepare(`SELECT COUNT(*) AS total FROM franchisees f ${where}`)
      .get(...params) as { total: number };

    const rows = db
      .prepare(
        `SELECT f.*, u.username, u.email, u.is_active
         FROM franchisees f
         JOIN users u ON u.id = f.user_id
         ${where}
         ORDER BY f.id DESC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset);

    const counts = db
      .prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN status = 'Approved' THEN 1 ELSE 0 END), 0) AS approved,
                COALESCE(SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END), 0) AS pending,
                COALESCE(SUM(CASE WHEN status = 'Rejected' THEN 1 ELSE 0 END), 0) AS rejected
         FROM franchisees WHERE agent_id = ?`
      )
      .get(req.user!.agentId);

    res.json({
      data: rows,
      summary: counts,
      pagination: {
        page,
        limit,
        total: totalRow.total,
        totalPages: Math.ceil(totalRow.total / limit) || 1,
      },
    });
  });

  // ===== ADMIN: FRANCHISEE APPROVAL & MANAGEMENT =====
  api.get('/admin/franchisees', authorize('admin'), requireWarehouse, (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const search = `%${String(req.query.search || '').trim()}%`;
    const status = String(req.query.status || '');
    const params: any[] = [search, search, search];
    let where = 'WHERE (f.store_name LIKE ? OR f.owner_name LIKE ? OR u.username LIKE ?)';
    if (['Pending', 'Approved', 'Rejected'].includes(status)) {
      where += ' AND f.status = ?';
      params.push(status);
    }

    const totalRow = db
      .prepare(`SELECT COUNT(*) AS total FROM franchisees f JOIN users u ON u.id = f.user_id ${where}`)
      .get(...params) as { total: number };

    const rows = db
      .prepare(
        `SELECT f.*, u.username, u.email, u.is_active, au.full_name AS agent_name, au.username AS agent_username
         FROM franchisees f
         JOIN users u ON u.id = f.user_id
         JOIN agents a ON a.id = f.agent_id
         JOIN users au ON au.id = a.user_id
         ${where}
         ORDER BY f.id DESC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset);

    res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total: totalRow.total,
        totalPages: Math.ceil(totalRow.total / limit) || 1,
      },
    });
  });

  api.post('/admin/franchisees/:id/review', authorize('admin'), requireWarehouse, (req, res) => {
    const { id } = req.params;
    const { decision, rejection_reason } = req.body;
    if (!['Approved', 'Rejected'].includes(decision)) {
      res.status(400).json({ message: 'Decision must be Approved or Rejected.' });
      return;
    }
    if (decision === 'Rejected' && (!rejection_reason || !String(rejection_reason).trim())) {
      res.status(400).json({ message: 'Please provide a rejection reason when rejecting a franchisee.' });
      return;
    }

    const fr = db
      .prepare(
        `SELECT f.*, a.user_id AS agent_user_id
         FROM franchisees f
         JOIN agents a ON a.id = f.agent_id
         WHERE f.id = ?`
      )
      .get(Number(id)) as any;

    if (!fr) {
      res.status(404).json({ message: 'Franchisee not found.' });
      return;
    }
    if (fr.status !== 'Pending') {
      res.status(400).json({ message: `Franchisee is already ${fr.status}.` });
      return;
    }

    db.prepare(
      "UPDATE franchisees SET status = ?, rejection_reason = ?, approved_by = ?, approved_at = datetime('now') WHERE id = ?"
    ).run(
      decision,
      decision === 'Rejected' ? String(rejection_reason).trim() : null,
      req.user!.id,
      Number(id)
    );

    notifyUser(
      fr.agent_user_id,
      `Franchisee ${decision}`,
      decision === 'Approved'
        ? `Your recruit "${fr.store_name}" has been Approved by Admin and can now log in.`
        : `Your recruit "${fr.store_name}" was Rejected. Reason: ${String(rejection_reason).trim()}`,
      'approval',
      fr.id
    );

    if (decision === 'Approved') {
      notifyUser(
        fr.user_id,
        'Franchisee Account Approved',
        `Welcome to AICE Franchisee Hub! Your store "${fr.store_name}" is now approved.`,
        'approval',
        fr.id
      );
    }

    logActivity(
      req.user!.id,
      `FRANCHISEE_${String(decision).toUpperCase()}`,
      'franchisee',
      fr.id,
      `${decision} ${fr.store_name}`
    );

    res.json({ message: `Franchisee ${String(decision).toLowerCase()} successfully.` });
  });

  // ===== COMMISSIONS =====
  api.get('/commissions', authorize('admin', 'agent'), requireWarehouse, (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const params: any[] = [];
    let where = 'WHERE 1=1';

    if (req.user!.role === 'agent') {
      where += ' AND c.agent_id = ?';
      params.push(req.user!.agentId);
    } else if (req.query.agent_id) {
      where += ' AND c.agent_id = ?';
      params.push(Number(req.query.agent_id));
    }

    if (req.query.status) {
      where += ' AND c.status = ?';
      params.push(String(req.query.status));
    }

    const totalRow = db
      .prepare(`SELECT COUNT(*) AS total FROM commissions c ${where}`)
      .get(...params) as { total: number };

    const rows = db
      .prepare(
        `SELECT c.*, u.full_name AS agent_name, u.username AS agent_username
         FROM commissions c
         JOIN agents a ON a.id = c.agent_id
         JOIN users u ON u.id = a.user_id
         ${where}
         ORDER BY c.id DESC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset);

    res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total: totalRow.total,
        totalPages: Math.ceil(totalRow.total / limit) || 1,
      },
    });
  });

  api.post('/commissions', authorize('admin'), requireWarehouse, (req, res) => {
    const { agent_id, amount, period_label, status, notes } = req.body;
    if (!agent_id || !amount || !period_label) {
      res.status(400).json({ message: 'Agent, amount, and period label are required.' });
      return;
    }

    const ag = db
      .prepare('SELECT id, user_id FROM agents WHERE id = ?')
      .get(Number(agent_id)) as { id: number; user_id: number } | undefined;
    if (!ag) {
      res.status(404).json({ message: 'Agent not found.' });
      return;
    }

    const cntRow = db
      .prepare("SELECT COUNT(*) AS cnt FROM franchisees WHERE agent_id = ? AND status = 'Approved'")
      .get(ag.id) as { cnt: number };

    const result = db
      .prepare(
        'INSERT INTO commissions (agent_id, recruits_count, amount, period_label, status, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        ag.id,
        cntRow.cnt,
        Number(amount),
        String(period_label).trim(),
        status === 'Paid' ? 'Paid' : 'Pending',
        notes ? String(notes).trim() : null,
        req.user!.id
      );

    notifyUser(
      ag.user_id,
      'New Commission Record',
      `Admin recorded a commission of PHP ${Number(amount).toFixed(2)} for ${String(period_label).trim()} (${cntRow.cnt} approved recruits).`,
      'commission',
      Number(result.lastInsertRowid)
    );
    logActivity(
      req.user!.id,
      'COMMISSION_CREATED',
      'commission',
      Number(result.lastInsertRowid),
      `Agent #${ag.id}: PHP ${Number(amount).toFixed(2)}`
    );

    res.status(201).json({ message: 'Commission created.', id: Number(result.lastInsertRowid) });
  });

  api.patch('/commissions/:id/paid', authorize('admin'), requireWarehouse, (req, res) => {
    const { id } = req.params;
    db.prepare("UPDATE commissions SET status = 'Paid' WHERE id = ?").run(Number(id));
    logActivity(req.user!.id, 'COMMISSION_PAID', 'commission', id, 'Marked commission as Paid');
    res.json({ message: 'Commission marked as Paid.' });
  });

  // ===== CATEGORIES & PRODUCTS =====
  api.get('/categories', requireWarehouse, (_req, res) => {
    const rows = db.prepare('SELECT * FROM categories ORDER BY name ASC').all();
    res.json({ data: rows });
  });

  api.post('/categories', authorize('admin'), requireWarehouse, (req, res) => {
    const { name, description } = req.body;
    if (!name || !String(name).trim()) {
      res.status(400).json({ message: 'Category name is required.' });
      return;
    }
    try {
      const result = db
        .prepare('INSERT INTO categories (name, description) VALUES (?, ?)')
        .run(String(name).trim(), description ? String(description).trim() : null);
      res.status(201).json({ message: 'Category created.', id: Number(result.lastInsertRowid) });
    } catch (err: any) {
      if (String(err.message).includes('UNIQUE')) {
        res.status(409).json({ message: 'Category already exists.' });
        return;
      }
      throw err;
    }
  });

  api.get('/products', requireWarehouse, (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const search = `%${String(req.query.search || '').trim()}%`;
    const categoryId = req.query.category_id;
    const warehouseId = req.query.warehouse_id;
    const activeOnly = req.query.active_only === '1' || req.user!.role === 'franchisee';

    const params: any[] = [search, search, search];
    let where = 'WHERE (p.name LIKE ? OR p.flavor LIKE ? OR p.sku LIKE ?)';
    if (categoryId) {
      where += ' AND p.category_id = ?';
      params.push(Number(categoryId));
    }
    if (activeOnly) {
      where += ' AND p.is_active = 1';
    }

    const totalRow = db
      .prepare(`SELECT COUNT(*) AS total FROM products p ${where}`)
      .get(...params) as { total: number };

    const stockExpr = warehouseId
      ? 'COALESCE((SELECT i.quantity FROM inventory i WHERE i.product_id = p.id AND i.warehouse_id = ?), 0)'
      : 'COALESCE((SELECT SUM(i.quantity) FROM inventory i WHERE i.product_id = p.id), 0)';

    const selectParams = warehouseId
      ? [Number(warehouseId), ...params, limit, offset]
      : [...params, limit, offset];

    const rows = db
      .prepare(
        `SELECT p.*, c.name AS category_name, ${stockExpr} AS stock_qty
         FROM products p
         JOIN categories c ON c.id = p.category_id
         ${where}
         ORDER BY p.id DESC
         LIMIT ? OFFSET ?`
      )
      .all(...selectParams);

    res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total: totalRow.total,
        totalPages: Math.ceil(totalRow.total / limit) || 1,
      },
    });
  });

  api.post(
    '/products',
    authorize('admin'),
    requireWarehouse,
    uploadProductImage.single('image'),
    (req, res) => {
      const { category_id, sku, name, flavor, size, price, low_stock_threshold } = req.body;
      if (!category_id || !sku || !name || !flavor || !size || price === undefined) {
        if (req.file) deleteUploadedFile(`/uploads/products/${req.file.filename}`);
        res.status(400).json({ message: 'Category, SKU, name, flavor, size, and price are required.' });
        return;
      }

      const numPrice = Number(price);
      if (Number.isNaN(numPrice) || numPrice <= 0) {
        if (req.file) deleteUploadedFile(`/uploads/products/${req.file.filename}`);
        res.status(400).json({ message: 'Price must be greater than 0.' });
        return;
      }

      const imageUrl = req.file ? `/uploads/products/${req.file.filename}` : null;
      try {
        const result = db
          .prepare(
            `INSERT INTO products (category_id, sku, name, flavor, size, price, low_stock_threshold, image_url)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            Number(category_id),
            String(sku).trim(),
            String(name).trim(),
            String(flavor).trim(),
            String(size).trim(),
            numPrice,
            Number(low_stock_threshold || 20),
            imageUrl
          );

        logActivity(
          req.user!.id,
          'PRODUCT_CREATED',
          'product',
          Number(result.lastInsertRowid),
          `Created product ${String(name).trim()} (${String(sku).trim()})`
        );
        res.status(201).json({
          message: 'Product created.',
          id: Number(result.lastInsertRowid),
          image_url: imageUrl,
        });
      } catch (err: any) {
        if (req.file) deleteUploadedFile(`/uploads/products/${req.file.filename}`);
        if (String(err.message).includes('UNIQUE')) {
          res.status(409).json({ message: 'A product with that SKU already exists.' });
          return;
        }
        throw err;
      }
    }
  );

  api.put(
    '/products/:id',
    authorize('admin'),
    requireWarehouse,
    uploadProductImage.single('image'),
    (req, res) => {
      const { id } = req.params;
      const cur = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(id)) as any;
      if (!cur) {
        if (req.file) deleteUploadedFile(`/uploads/products/${req.file.filename}`);
        res.status(404).json({ message: 'Product not found.' });
        return;
      }

      let imageUrl: string | null = cur.image_url;
      if (req.body.remove_image === 'true') {
        deleteUploadedFile(cur.image_url);
        imageUrl = null;
      }
      if (req.file) {
        deleteUploadedFile(cur.image_url);
        imageUrl = `/uploads/products/${req.file.filename}`;
      }

      db.prepare(
        `UPDATE products
         SET category_id = ?, sku = ?, name = ?, flavor = ?, size = ?, price = ?, low_stock_threshold = ?,
             image_url = ?, is_active = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        Number(req.body.category_id || cur.category_id),
        String(req.body.sku || cur.sku).trim(),
        String(req.body.name || cur.name).trim(),
        String(req.body.flavor || cur.flavor).trim(),
        String(req.body.size || cur.size).trim(),
        Number(req.body.price ?? cur.price),
        Number(req.body.low_stock_threshold ?? cur.low_stock_threshold),
        imageUrl,
        req.body.is_active === 'false' || req.body.is_active === false ? 0 : 1,
        Number(id)
      );

      logActivity(
        req.user!.id,
        'PRODUCT_UPDATED',
        'product',
        id,
        `Updated product ${req.body.name || cur.name}`
      );
      res.json({ message: 'Product updated.', image_url: imageUrl });
    }
  );

  // ===== WAREHOUSE INVENTORY (Admin) =====
  api.get('/inventory', authorize('admin'), requireWarehouse, (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    let selectedWh = Number(req.query.warehouse_id) || null;
    if (!selectedWh) {
      const firstWh = db
        .prepare('SELECT id FROM warehouses WHERE is_active = 1 ORDER BY id ASC LIMIT 1')
        .get() as { id: number } | undefined;
      selectedWh = firstWh?.id || null;
    }
    if (!selectedWh) {
      res.json({ data: [], pagination: { page: 1, limit, total: 0, totalPages: 1 } });
      return;
    }

    const search = `%${String(req.query.search || '').trim()}%`;
    const lowOnly = req.query.low_only === '1';
    const params: any[] = [selectedWh, search, search, search];
    let where = 'WHERE (p.name LIKE ? OR p.sku LIKE ? OR p.flavor LIKE ?)';
    if (lowOnly) {
      where += ' AND COALESCE(i.quantity, 0) <= p.low_stock_threshold';
    }

    const totalRow = db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM products p
         LEFT JOIN inventory i ON i.product_id = p.id AND i.warehouse_id = ?
         ${where}`
      )
      .get(...params) as { total: number };

    const rows = db
      .prepare(
        `SELECT p.id AS product_id, p.sku, p.name, p.flavor, p.size, p.price, p.low_stock_threshold, p.image_url,
                c.name AS category_name, ? AS warehouse_id, COALESCE(i.quantity, 0) AS quantity,
                CASE WHEN COALESCE(i.quantity, 0) <= p.low_stock_threshold THEN 1 ELSE 0 END AS is_low_stock,
                i.updated_at
         FROM products p
         JOIN categories c ON c.id = p.category_id
         LEFT JOIN inventory i ON i.product_id = p.id AND i.warehouse_id = ?
         ${where}
         ORDER BY is_low_stock DESC, p.name ASC
         LIMIT ? OFFSET ?`
      )
      .all(selectedWh, ...params, limit, offset);

    res.json({
      warehouse_id: selectedWh,
      data: rows,
      pagination: {
        page,
        limit,
        total: totalRow.total,
        totalPages: Math.ceil(totalRow.total / limit) || 1,
      },
    });
  });

  api.post('/inventory/movement', authorize('admin'), requireWarehouse, (req, res) => {
    const { warehouse_id, product_id, movement_type, quantity_change, notes } = req.body;
    if (!warehouse_id || !product_id || !['STOCK_IN', 'ADJUSTMENT'].includes(movement_type)) {
      res.status(400).json({ message: 'Valid warehouse, product, and movement type are required.' });
      return;
    }

    const delta = parseInt(String(quantity_change), 10);
    const inv = db
      .prepare('SELECT id, quantity FROM inventory WHERE warehouse_id = ? AND product_id = ?')
      .get(Number(warehouse_id), Number(product_id)) as { id: number; quantity: number } | undefined;

    const prevQty = inv ? inv.quantity : 0;
    const transition = computeStockTransition(prevQty, movement_type, delta);
    if (!transition.ok) {
      res.status(400).json({ message: transition.error });
      return;
    }

    const tx = db.transaction(() => {
      if (inv) {
        db.prepare("UPDATE inventory SET quantity = ?, updated_at = datetime('now') WHERE id = ?").run(
          transition.newQty,
          inv.id
        );
      } else {
        db.prepare('INSERT INTO inventory (warehouse_id, product_id, quantity) VALUES (?, ?, ?)').run(
          Number(warehouse_id),
          Number(product_id),
          transition.newQty
        );
      }

      db.prepare(
        `INSERT INTO stock_movements (warehouse_id, product_id, movement_type, quantity_change, previous_qty, new_qty, notes, performed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        Number(warehouse_id),
        Number(product_id),
        movement_type,
        delta,
        prevQty,
        transition.newQty,
        notes ? String(notes).trim() : null,
        req.user!.id
      );

      const prod = db
        .prepare('SELECT name, low_stock_threshold FROM products WHERE id = ?')
        .get(Number(product_id)) as { name: string; low_stock_threshold: number } | undefined;
      if (prod && transition.newQty <= prod.low_stock_threshold) {
        notifyAdmins(
          'Low Stock Alert',
          `${prod.name} is low in stock (${transition.newQty} remaining).`,
          'low_stock',
          Number(product_id)
        );
      }

      logActivity(
        req.user!.id,
        movement_type,
        'inventory',
        Number(product_id),
        `Warehouse #${warehouse_id}: ${prevQty} -> ${transition.newQty}`
      );
    });

    tx();
    res.json({
      message: 'Inventory updated.',
      previous_qty: prevQty,
      new_qty: transition.newQty,
    });
  });

  api.get('/inventory/movements', authorize('admin'), requireWarehouse, (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const warehouseId = req.query.warehouse_id;
    const params: any[] = [];
    let where = 'WHERE 1=1';
    if (warehouseId) {
      where += ' AND sm.warehouse_id = ?';
      params.push(Number(warehouseId));
    }

    const totalRow = db
      .prepare(`SELECT COUNT(*) AS total FROM stock_movements sm ${where}`)
      .get(...params) as { total: number };

    const rows = db
      .prepare(
        `SELECT sm.*, p.name AS product_name, p.sku, w.name AS warehouse_name, u.full_name AS performed_by_name
         FROM stock_movements sm
         JOIN products p ON p.id = sm.product_id
         JOIN warehouses w ON w.id = sm.warehouse_id
         LEFT JOIN users u ON u.id = sm.performed_by
         ${where}
         ORDER BY sm.id DESC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset);

    res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total: totalRow.total,
        totalPages: Math.ceil(totalRow.total / limit) || 1,
      },
    });
  });

  // ===== PROMOTIONS (Admin CRUD, Franchisee & Agent Active List, Server-Side Cart Evaluation) =====
  const getTodaySqlDate = (): string => {
    const row = db.prepare("SELECT date('now') AS d").get() as { d: string };
    return row.d;
  };

  const notifyTargetedFranchiseesForPromo = (
    promoId: number,
    title: string,
    message: string
  ) => {
    const targets = db
      .prepare('SELECT franchisee_id FROM promo_targets WHERE promo_id = ?')
      .all(promoId) as { franchisee_id: number }[];

    let franchiseeUsers: { user_id: number }[] = [];
    if (targets.length === 0) {
      franchiseeUsers = db
        .prepare("SELECT user_id FROM franchisees WHERE status = 'Approved'")
        .all() as { user_id: number }[];
    } else {
      const ids = targets.map((t) => Number(t.franchisee_id));
      const placeholders = ids.map(() => '?').join(',');
      franchiseeUsers = db
        .prepare(
          `SELECT user_id FROM franchisees WHERE status = 'Approved' AND id IN (${placeholders})`
        )
        .all(...ids) as { user_id: number }[];
    }

    for (const fu of franchiseeUsers) {
      notifyUser(fu.user_id, title, message, 'promo', promoId);
    }
  };

  const syncPromosLifecycle = () => {
    // 1. Auto-expire non-recurring promos whose end_date has passed
    db.prepare(
      `UPDATE promos
       SET status = 'Expired', updated_at = datetime('now')
       WHERE status IN ('Active', 'Paused')
         AND COALESCE(recurring_monthly, 0) = 0
         AND date(end_date) < date('now')`
    ).run();

    // 2. Send 3-day-before-end reminder notification once per targeted franchisee
    const endingSoon = db
      .prepare(
        `SELECT id, name, end_date,
                CAST(ROUND(julianday(date(end_date)) - julianday(date('now'))) AS INTEGER) AS days_left
         FROM promos
         WHERE status = 'Active'
           AND julianday(date(end_date)) - julianday(date('now')) BETWEEN 0 AND 3`
      )
      .all() as { id: number; name: string; end_date: string; days_left: number }[];

    for (const p of endingSoon) {
      const targets = db
        .prepare('SELECT franchisee_id FROM promo_targets WHERE promo_id = ?')
        .all(p.id) as { franchisee_id: number }[];

      let franchiseeUsers: { user_id: number }[] = [];
      if (targets.length === 0) {
        franchiseeUsers = db
          .prepare("SELECT user_id FROM franchisees WHERE status = 'Approved'")
          .all() as { user_id: number }[];
      } else {
        const ids = targets.map((t) => Number(t.franchisee_id));
        const placeholders = ids.map(() => '?').join(',');
        franchiseeUsers = db
          .prepare(
            `SELECT user_id FROM franchisees WHERE status = 'Approved' AND id IN (${placeholders})`
          )
          .all(...ids) as { user_id: number }[];
      }

      const reminderTitle = `Promo Ending Soon: ${p.name}`;
      for (const fu of franchiseeUsers) {
        const alreadySent = db
          .prepare(
            "SELECT id FROM notifications WHERE user_id = ? AND type = 'promo' AND related_id = ? AND title = ?"
          )
          .get(fu.user_id, p.id, reminderTitle);
        if (!alreadySent) {
          const dayText =
            p.days_left <= 0
              ? 'ends today'
              : `ends in ${p.days_left} day${p.days_left === 1 ? '' : 's'} (${p.end_date})`;
          notifyUser(
            fu.user_id,
            reminderTitle,
            `Reminder: "${p.name}" ${dayText}. Place your replenishment order before it expires!`,
            'promo',
            p.id
          );
        }
      }
    }
  };

  const loadHydratedPromos = (franchiseeId?: number): (PromoDefinition & Record<string, any>)[] => {
    syncPromosLifecycle();
    const rawPromos = db
      .prepare(
        `SELECT p.*,
                (SELECT COUNT(*) FROM promo_redemptions pr WHERE pr.promo_id = p.id) AS total_redemptions,
                COALESCE((SELECT SUM(pr.discount_amount) FROM promo_redemptions pr WHERE pr.promo_id = p.id), 0) AS total_discount_given,
                CAST(ROUND(julianday(date(p.end_date)) - julianday(date('now'))) AS INTEGER) AS days_remaining
         FROM promos p
         ORDER BY p.id DESC`
      )
      .all() as any[];

    return rawPromos.map((p) => {
      const productRows = db
        .prepare(
          `SELECT pp.product_id, pr.name AS product_name, pr.sku
           FROM promo_products pp
           JOIN products pr ON pr.id = pp.product_id
           WHERE pp.promo_id = ?`
        )
        .all(p.id) as any[];

      const categoryRows = db
        .prepare(
          `SELECT pc.category_id, c.name AS category_name
           FROM promo_categories pc
           JOIN categories c ON c.id = pc.category_id
           WHERE pc.promo_id = ?`
        )
        .all(p.id) as any[];

      const tiers = db
        .prepare(
          `SELECT min_quantity_or_amount, discount_value
           FROM promo_tiers
           WHERE promo_id = ?
           ORDER BY min_quantity_or_amount ASC`
        )
        .all(p.id) as { min_quantity_or_amount: number; discount_value: number }[];

      const targetRows = db
        .prepare(
          `SELECT pt.franchisee_id, f.store_name, f.owner_name
           FROM promo_targets pt
           JOIN franchisees f ON f.id = pt.franchisee_id
           WHERE pt.promo_id = ?`
        )
        .all(p.id) as any[];

      let franchiseeRedemptions = 0;
      if (franchiseeId) {
        const frRow = db
          .prepare(
            'SELECT COUNT(*) AS cnt FROM promo_redemptions WHERE promo_id = ? AND franchisee_id = ?'
          )
          .get(p.id, franchiseeId) as { cnt: number };
        franchiseeRedemptions = frRow.cnt;
      }

      const def: PromoDefinition & Record<string, any> = {
        ...p,
        discount_value: Number(p.discount_value || 0),
        min_order_amount: Number(p.min_order_amount || 0),
        min_quantity: Number(p.min_quantity || 0),
        buy_quantity: Number(p.buy_quantity || 0),
        free_quantity: Number(p.free_quantity || 0),
        free_delivery: Number(p.free_delivery || 0),
        max_discount_cap: p.max_discount_cap !== null ? Number(p.max_discount_cap) : null,
        recurring_monthly: Number(p.recurring_monthly || 0),
        usage_limit_total: p.usage_limit_total !== null ? Number(p.usage_limit_total) : null,
        usage_limit_per_franchisee:
          p.usage_limit_per_franchisee !== null ? Number(p.usage_limit_per_franchisee) : null,
        stackable: Number(p.stackable || 0),
        total_redemptions: Number(p.total_redemptions || 0),
        total_discount_given: Number(p.total_discount_given || 0),
        franchisee_redemptions: franchiseeRedemptions,
        days_remaining: Number(p.days_remaining ?? 0),
        product_ids: productRows.map((r) => Number(r.product_id)),
        products_list: productRows,
        category_ids: categoryRows.map((r) => Number(r.category_id)),
        categories_list: categoryRows,
        tiers: tiers.map((t) => ({
          min_quantity_or_amount: Number(t.min_quantity_or_amount),
          discount_value: Number(t.discount_value),
        })),
        target_franchisee_ids: targetRows.map((r) => Number(r.franchisee_id)),
        targets_list: targetRows,
      };
      def.how_it_works = formatPromoHowItWorks(def);
      def.limit_note = formatPromoLimitNote(def);
      return def;
    });
  };

  api.get('/promos', authorize('admin', 'agent', 'franchisee'), requireWarehouse, (req, res) => {
    const statusFilter = String(req.query.status || '').trim();
    const todayStr = getTodaySqlDate();
    const allPromos = loadHydratedPromos(req.user!.franchiseeId);

    if (req.user!.role === 'admin') {
      const filtered = statusFilter
        ? allPromos.filter((p) => p.status === statusFilter)
        : allPromos;
      res.json({ data: filtered });
      return;
    }

    if (req.user!.role === 'franchisee') {
      const activeForFranchisee = allPromos.filter((p) =>
        isPromoEligibleForFranchisee(p, {
          franchiseeId: Number(req.user!.franchiseeId),
          todayStr,
        })
      );
      res.json({ data: activeForFranchisee });
      return;
    }

    // Agent role: read-only list of active promos so agents can inform their franchisees
    const activePromos = allPromos.filter(
      (p) =>
        p.status === 'Active' &&
        isPromoDateValid(p.start_date, p.end_date, todayStr, Boolean(p.recurring_monthly))
    );
    res.json({ data: activePromos });
  });

  api.get('/promos/popup', authorize('franchisee'), requireWarehouse, (req, res) => {
    const todayStr = getTodaySqlDate();
    const allPromos = loadHydratedPromos(req.user!.franchiseeId);
    const dismissedRows = db
      .prepare('SELECT promo_id FROM promo_dismissals WHERE user_id = ?')
      .all(req.user!.id) as { promo_id: number }[];
    const dismissedPromoIds = dismissedRows.map((r) => Number(r.promo_id));

    const eligiblePopupPromos = filterEligiblePopupPromos(allPromos, {
      franchiseeId: Number(req.user!.franchiseeId),
      todayStr,
      dismissedPromoIds,
    });

    res.json({ data: eligiblePopupPromos });
  });

  api.post('/promos/:id/dismiss', authorize('franchisee'), (req, res) => {
    const promoId = Number(req.params.id);
    const promo = db.prepare('SELECT id FROM promos WHERE id = ?').get(promoId);
    if (!promo) {
      res.status(404).json({ message: 'Promotion not found.' });
      return;
    }

    if (req.body && req.body.dismissed === false) {
      db.prepare('DELETE FROM promo_dismissals WHERE user_id = ? AND promo_id = ?').run(
        req.user!.id,
        promoId
      );
      res.json({ message: 'Promotion dismissal removed.', promoId });
      return;
    }

    db.prepare(
      `INSERT OR REPLACE INTO promo_dismissals (user_id, promo_id, dismissed_at)
       VALUES (?, ?, datetime('now'))`
    ).run(req.user!.id, promoId);

    res.json({ message: 'Promotion dismissal saved.', promoId });
  });

  api.delete('/promos/:id/dismiss', authorize('franchisee'), (req, res) => {
    const promoId = Number(req.params.id);
    db.prepare('DELETE FROM promo_dismissals WHERE user_id = ? AND promo_id = ?').run(
      req.user!.id,
      promoId
    );
    res.json({ message: 'Promotion dismissal removed.', promoId });
  });

  api.get('/promos/:id', authorize('admin'), requireWarehouse, (req, res) => {
    const promoId = Number(req.params.id);
    const allPromos = loadHydratedPromos();
    const promo = allPromos.find((p) => p.id === promoId);
    if (!promo) {
      res.status(404).json({ message: 'Promotion not found.' });
      return;
    }

    const redemptions = db
      .prepare(
        `SELECT pr.*, o.order_number, o.subtotal AS order_subtotal, o.total_amount AS order_total, o.status AS order_status,
                f.store_name, f.owner_name
         FROM promo_redemptions pr
         JOIN orders o ON o.id = pr.order_id
         JOIN franchisees f ON f.id = pr.franchisee_id
         WHERE pr.promo_id = ?
         ORDER BY pr.id DESC`
      )
      .all(promoId);

    res.json({ promo, redemptions });
  });

  const savePromoRelations = (promoId: number, body: any) => {
    db.prepare('DELETE FROM promo_products WHERE promo_id = ?').run(promoId);
    db.prepare('DELETE FROM promo_categories WHERE promo_id = ?').run(promoId);
    db.prepare('DELETE FROM promo_tiers WHERE promo_id = ?').run(promoId);
    db.prepare('DELETE FROM promo_targets WHERE promo_id = ?').run(promoId);

    if (Array.isArray(body.product_ids)) {
      const ins = db.prepare(
        'INSERT OR IGNORE INTO promo_products (promo_id, product_id) VALUES (?, ?)'
      );
      for (const pid of body.product_ids) {
        if (Number(pid) > 0) ins.run(promoId, Number(pid));
      }
    }
    if (Array.isArray(body.category_ids)) {
      const ins = db.prepare(
        'INSERT OR IGNORE INTO promo_categories (promo_id, category_id) VALUES (?, ?)'
      );
      for (const cid of body.category_ids) {
        if (Number(cid) > 0) ins.run(promoId, Number(cid));
      }
    }
    if (Array.isArray(body.tiers)) {
      const ins = db.prepare(
        'INSERT INTO promo_tiers (promo_id, min_quantity_or_amount, discount_value) VALUES (?, ?, ?)'
      );
      for (const t of body.tiers) {
        if (Number(t.min_quantity_or_amount) > 0 && Number(t.discount_value) > 0) {
          ins.run(promoId, Number(t.min_quantity_or_amount), Number(t.discount_value));
        }
      }
    }
    if (Array.isArray(body.target_franchisee_ids)) {
      const ins = db.prepare(
        'INSERT OR IGNORE INTO promo_targets (promo_id, franchisee_id) VALUES (?, ?)'
      );
      for (const fid of body.target_franchisee_ids) {
        if (Number(fid) > 0) ins.run(promoId, Number(fid));
      }
    }
  };

  api.post('/promos', authorize('admin'), requireWarehouse, (req, res) => {
    const body = req.body;
    const validation = validatePromoPayload(body);
    if (!validation.ok) {
      res.status(400).json({ message: validation.error });
      return;
    }

    // Check for overlapping duplicate promo with same name and overlapping dates
    const dup = db
      .prepare(
        `SELECT id FROM promos
         WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))
           AND status != 'Expired'
           AND date(start_date) <= date(?)
           AND date(end_date) >= date(?)`
      )
      .get(
        String(body.name).trim(),
        String(body.end_date).slice(0, 10),
        String(body.start_date).slice(0, 10)
      );
    if (dup) {
      res.status(409).json({
        message: 'An overlapping promotion with the same name already exists in this date range.',
      });
      return;
    }

    const status = ['Draft', 'Active', 'Paused'].includes(body.status) ? body.status : 'Draft';

    const tx = db.transaction(() => {
      const result = db
        .prepare(
          `INSERT INTO promos (
             name, description, promo_type, tier_basis, discount_type, discount_value,
             min_order_amount, min_quantity, buy_quantity, free_quantity, free_product_id,
             free_delivery, max_discount_cap, scope, start_date, end_date, recurring_monthly,
             usage_limit_total, usage_limit_per_franchisee, stackable, status, created_by
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          String(body.name).trim(),
          body.description ? String(body.description).trim() : null,
          String(body.promo_type),
          body.tier_basis === 'amount' ? 'amount' : 'quantity',
          body.discount_type === 'fixed' ? 'fixed' : 'percent',
          Number(body.discount_value || 0),
          Number(body.min_order_amount || 0),
          Number(body.min_quantity || 0),
          Number(body.buy_quantity || 0),
          Number(body.free_quantity || 0),
          body.free_product_id ? Number(body.free_product_id) : null,
          body.free_delivery ? 1 : 0,
          body.max_discount_cap && Number(body.max_discount_cap) > 0
            ? Number(body.max_discount_cap)
            : null,
          ['all_products', 'category', 'product'].includes(body.scope)
            ? body.scope
            : 'all_products',
          String(body.start_date).slice(0, 10),
          String(body.end_date).slice(0, 10),
          body.recurring_monthly ? 1 : 0,
          body.usage_limit_total && Number(body.usage_limit_total) > 0
            ? Number(body.usage_limit_total)
            : null,
          body.usage_limit_per_franchisee && Number(body.usage_limit_per_franchisee) > 0
            ? Number(body.usage_limit_per_franchisee)
            : null,
          body.stackable ? 1 : 0,
          status,
          req.user!.id
        );

      const promoId = Number(result.lastInsertRowid);
      savePromoRelations(promoId, body);

      logActivity(
        req.user!.id,
        'PROMO_CREATED',
        'promo',
        promoId,
        `Created promo "${String(body.name).trim()}" (${status})`
      );

      if (status === 'Active') {
        const preview = formatPromoHowItWorks(body);
        notifyTargetedFranchiseesForPromo(
          promoId,
          `New Active Promo: ${String(body.name).trim()}`,
          `${preview}. Valid until ${String(body.end_date).slice(0, 10)}. Discount applies automatically at checkout!`
        );
      }

      return promoId;
    });

    const promoId = tx();
    res.status(201).json({ message: 'Promotion created successfully.', id: promoId });
  });

  api.put('/promos/:id', authorize('admin'), requireWarehouse, (req, res) => {
    const promoId = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM promos WHERE id = ?').get(promoId) as any;
    if (!existing) {
      res.status(404).json({ message: 'Promotion not found.' });
      return;
    }

    const body = req.body;
    const validation = validatePromoPayload(body);
    if (!validation.ok) {
      res.status(400).json({ message: validation.error });
      return;
    }

    const dup = db
      .prepare(
        `SELECT id FROM promos
         WHERE id != ?
           AND LOWER(TRIM(name)) = LOWER(TRIM(?))
           AND status != 'Expired'
           AND date(start_date) <= date(?)
           AND date(end_date) >= date(?)`
      )
      .get(
        promoId,
        String(body.name).trim(),
        String(body.end_date).slice(0, 10),
        String(body.start_date).slice(0, 10)
      );
    if (dup) {
      res.status(409).json({
        message: 'An overlapping promotion with the same name already exists in this date range.',
      });
      return;
    }

    const status = ['Draft', 'Active', 'Paused', 'Expired'].includes(body.status)
      ? body.status
      : existing.status;

    const existingHydrated = loadHydratedPromos().find((p) => p.id === promoId);
    const rulesOrDatesChanged = existingHydrated
      ? hasPromoRulesOrDatesChanged(existingHydrated, body)
      : true;

    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE promos
         SET name = ?, description = ?, promo_type = ?, tier_basis = ?, discount_type = ?, discount_value = ?,
             min_order_amount = ?, min_quantity = ?, buy_quantity = ?, free_quantity = ?, free_product_id = ?,
             free_delivery = ?, max_discount_cap = ?, scope = ?, start_date = ?, end_date = ?, recurring_monthly = ?,
             usage_limit_total = ?, usage_limit_per_franchisee = ?, stackable = ?, status = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        String(body.name).trim(),
        body.description ? String(body.description).trim() : null,
        String(body.promo_type),
        body.tier_basis === 'amount' ? 'amount' : 'quantity',
        body.discount_type === 'fixed' ? 'fixed' : 'percent',
        Number(body.discount_value || 0),
        Number(body.min_order_amount || 0),
        Number(body.min_quantity || 0),
        Number(body.buy_quantity || 0),
        Number(body.free_quantity || 0),
        body.free_product_id ? Number(body.free_product_id) : null,
        body.free_delivery ? 1 : 0,
        body.max_discount_cap && Number(body.max_discount_cap) > 0
          ? Number(body.max_discount_cap)
          : null,
        ['all_products', 'category', 'product'].includes(body.scope)
          ? body.scope
          : 'all_products',
        String(body.start_date).slice(0, 10),
        String(body.end_date).slice(0, 10),
        body.recurring_monthly ? 1 : 0,
        body.usage_limit_total && Number(body.usage_limit_total) > 0
          ? Number(body.usage_limit_total)
          : null,
        body.usage_limit_per_franchisee && Number(body.usage_limit_per_franchisee) > 0
          ? Number(body.usage_limit_per_franchisee)
          : null,
        body.stackable ? 1 : 0,
        status,
        promoId
      );

      savePromoRelations(promoId, body);

      // Reset dismissals when the promo's rules or dates change
      if (rulesOrDatesChanged) {
        db.prepare('DELETE FROM promo_dismissals WHERE promo_id = ?').run(promoId);
      }

      logActivity(
        req.user!.id,
        'PROMO_UPDATED',
        'promo',
        promoId,
        `Updated promo "${String(body.name).trim()}" (${status})${rulesOrDatesChanged ? ' [dismissals reset]' : ''}`
      );

      if (existing.status !== 'Active' && status === 'Active') {
        const preview = formatPromoHowItWorks(body);
        notifyTargetedFranchiseesForPromo(
          promoId,
          `New Active Promo: ${String(body.name).trim()}`,
          `${preview}. Valid until ${String(body.end_date).slice(0, 10)}. Discount applies automatically at checkout!`
        );
      }
    });

    tx();
    res.json({ message: 'Promotion updated successfully.' });
  });

  api.patch('/promos/:id/status', authorize('admin'), requireWarehouse, (req, res) => {
    const promoId = Number(req.params.id);
    const { status } = req.body;
    if (!['Draft', 'Active', 'Paused', 'Expired'].includes(status)) {
      res.status(400).json({ message: 'Invalid promo status.' });
      return;
    }

    const existing = db.prepare('SELECT * FROM promos WHERE id = ?').get(promoId) as any;
    if (!existing) {
      res.status(404).json({ message: 'Promotion not found.' });
      return;
    }

    db.prepare("UPDATE promos SET status = ?, updated_at = datetime('now') WHERE id = ?").run(
      status,
      promoId
    );

    const actionLabel =
      status === 'Paused'
        ? 'PROMO_PAUSED'
        : status === 'Active'
        ? 'PROMO_ACTIVATED'
        : status === 'Expired'
        ? 'PROMO_ENDED'
        : 'PROMO_STATUS_CHANGED';

    logActivity(
      req.user!.id,
      actionLabel,
      'promo',
      promoId,
      `${existing.name} -> ${status}`
    );

    if (existing.status !== 'Active' && status === 'Active') {
      const hydrated = loadHydratedPromos().find((p) => p.id === promoId);
      if (hydrated) {
        notifyTargetedFranchiseesForPromo(
          promoId,
          `New Active Promo: ${hydrated.name}`,
          `${hydrated.how_it_works}. Valid until ${hydrated.end_date}. Discount applies automatically at checkout!`
        );
      }
    }

    res.json({ message: `Promotion status changed to ${status}.` });
  });

  api.post('/promos/:id/duplicate', authorize('admin'), requireWarehouse, (req, res) => {
    const promoId = Number(req.params.id);
    const hydrated = loadHydratedPromos().find((p) => p.id === promoId);
    if (!hydrated) {
      res.status(404).json({ message: 'Promotion not found.' });
      return;
    }

    const copyName = `${hydrated.name} (Copy ${Date.now().toString().slice(-4)})`;
    const tx = db.transaction(() => {
      const result = db
        .prepare(
          `INSERT INTO promos (
             name, description, promo_type, tier_basis, discount_type, discount_value,
             min_order_amount, min_quantity, buy_quantity, free_quantity, free_product_id,
             free_delivery, max_discount_cap, scope, start_date, end_date, recurring_monthly,
             usage_limit_total, usage_limit_per_franchisee, stackable, status, created_by
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Draft', ?)`
        )
        .run(
          copyName,
          hydrated.description || null,
          hydrated.promo_type,
          hydrated.tier_basis || 'quantity',
          hydrated.discount_type,
          hydrated.discount_value,
          hydrated.min_order_amount,
          hydrated.min_quantity,
          hydrated.buy_quantity,
          hydrated.free_quantity,
          hydrated.free_product_id || null,
          hydrated.free_delivery ? 1 : 0,
          hydrated.max_discount_cap,
          hydrated.scope,
          hydrated.start_date,
          hydrated.end_date,
          hydrated.recurring_monthly ? 1 : 0,
          hydrated.usage_limit_total,
          hydrated.usage_limit_per_franchisee,
          hydrated.stackable ? 1 : 0,
          req.user!.id
        );
      const newId = Number(result.lastInsertRowid);
      savePromoRelations(newId, {
        product_ids: hydrated.product_ids,
        category_ids: hydrated.category_ids,
        tiers: hydrated.tiers,
        target_franchisee_ids: hydrated.target_franchisee_ids,
      });

      logActivity(
        req.user!.id,
        'PROMO_DUPLICATED',
        'promo',
        newId,
        `Duplicated promo #${promoId} as "${copyName}"`
      );
      return newId;
    });

    const newId = tx();
    res.status(201).json({ message: 'Promotion duplicated as Draft.', id: newId });
  });

  api.post('/promos/evaluate-cart', authorize('franchisee'), requireWarehouse, (req, res) => {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      res.json({
        subtotal: 0,
        discount_amount: 0,
        delivery_fee: 0,
        free_delivery_applied: false,
        final_total: 0,
        primary_promo_id: null,
        applied_promos: [],
        free_items: [],
        item_discounts: {},
        hints: [],
      });
      return;
    }

    const cartEvalItems: {
      product_id: number;
      category_id: number;
      name: string;
      quantity: number;
      unit_price: number;
    }[] = [];

    for (const item of items) {
      const qty = parseInt(String(item.quantity), 10);
      if (!item.product_id || Number.isNaN(qty) || qty <= 0) continue;
      const prod = db
        .prepare('SELECT id, category_id, name, price FROM products WHERE id = ? AND is_active = 1')
        .get(Number(item.product_id)) as
        | { id: number; category_id: number; name: string; price: number }
        | undefined;
      if (prod) {
        cartEvalItems.push({
          product_id: prod.id,
          category_id: prod.category_id,
          name: prod.name,
          quantity: qty,
          unit_price: Number(prod.price),
        });
      }
    }

    const promos = loadHydratedPromos(req.user!.franchiseeId);
    const evaluation = evaluatePromosForCart(cartEvalItems, promos, {
      franchiseeId: Number(req.user!.franchiseeId),
      todayStr: getTodaySqlDate(),
    });

    res.json(evaluation);
  });

  // ===== ORDERS (Franchisee & Admin — With Server-Side Promo Calculation & Stock Deduction) =====
  api.post('/orders', authorize('franchisee'), requireWarehouse, (req, res) => {
    const { warehouse_id, requested_delivery_datetime, notes, items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ message: 'Order must contain at least one item.' });
      return;
    }

    let whId = Number(warehouse_id);
    if (!whId) {
      const firstWh = db
        .prepare('SELECT id FROM warehouses WHERE is_active = 1 ORDER BY id ASC LIMIT 1')
        .get() as { id: number } | undefined;
      whId = firstWh?.id || 0;
    }
    if (!whId) {
      res.status(423).json({ message: 'No active warehouse available.' });
      return;
    }

    const normalizedItems: {
      product_id: number;
      category_id: number;
      name: string;
      quantity: number;
      unit_price: number;
      subtotal: number;
      stock: number;
    }[] = [];

    for (const item of items) {
      const qty = parseInt(String(item.quantity), 10);
      if (!item.product_id || Number.isNaN(qty) || qty <= 0) {
        res.status(400).json({ message: 'Invalid item quantity.' });
        return;
      }

      const prod = db
        .prepare(
          `SELECT p.id, p.category_id, p.name, p.price, COALESCE(i.quantity, 0) AS stock
           FROM products p
           LEFT JOIN inventory i ON i.product_id = p.id AND i.warehouse_id = ?
           WHERE p.id = ? AND p.is_active = 1`
        )
        .get(whId, Number(item.product_id)) as
        | { id: number; category_id: number; name: string; price: number; stock: number }
        | undefined;

      if (!prod) {
        res.status(404).json({ message: `Product #${item.product_id} not found.` });
        return;
      }
      if (prod.stock < qty) {
        res.status(400).json({
          message: `Insufficient stock for ${prod.name} (available: ${prod.stock}).`,
        });
        return;
      }

      const subtotal = Number((Number(prod.price) * qty).toFixed(2));
      normalizedItems.push({
        product_id: prod.id,
        category_id: prod.category_id,
        name: prod.name,
        quantity: qty,
        unit_price: Number(prod.price),
        subtotal,
        stock: prod.stock,
      });
    }

    // Server-side promo evaluation (never trust client discount values)
    const promos = loadHydratedPromos(req.user!.franchiseeId);
    const promoEval = evaluatePromosForCart(normalizedItems, promos, {
      franchiseeId: Number(req.user!.franchiseeId),
      todayStr: getTodaySqlDate(),
    });

    // Verify warehouse stock also covers any Buy X Get Y free items
    for (const fi of promoEval.free_items) {
      const paidItem = normalizedItems.find((n) => n.product_id === fi.product_id);
      const totalNeeded = (paidItem ? paidItem.quantity : 0) + fi.free_qty;
      const stockRow = db
        .prepare('SELECT COALESCE(quantity, 0) AS stock FROM inventory WHERE warehouse_id = ? AND product_id = ?')
        .get(whId, fi.product_id) as { stock: number } | undefined;
      const avail = stockRow ? stockRow.stock : 0;
      if (avail < totalNeeded) {
        res.status(400).json({
          message: `Insufficient warehouse stock to include ${fi.free_qty} free box(es) of ${fi.name} (needed: ${totalNeeded}, available: ${avail}).`,
        });
        return;
      }
    }

    const orderNumber = `AICE-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

    const tx = db.transaction(() => {
      const oRes = db
        .prepare(
          `INSERT INTO orders (
             order_number, franchisee_id, warehouse_id, status,
             subtotal, discount_amount, delivery_fee, total_amount,
             promo_id, applied_promos_json, requested_delivery_datetime, notes
           ) VALUES (?, ?, ?, 'Placed', ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          orderNumber,
          req.user!.franchiseeId,
          whId,
          promoEval.subtotal,
          promoEval.discount_amount,
          promoEval.delivery_fee,
          promoEval.final_total,
          promoEval.primary_promo_id,
          promoEval.applied_promos.length > 0
            ? JSON.stringify(promoEval.applied_promos)
            : null,
          requested_delivery_datetime || null,
          notes ? String(notes).trim() : null
        );

      const orderId = Number(oRes.lastInsertRowid);
      const insertItem = db.prepare(
        `INSERT INTO order_items (
           order_id, product_id, quantity, unit_price, subtotal, discount_amount, is_free_item
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      );

      for (const ni of normalizedItems) {
        const itemDisc = Number(promoEval.item_discounts[ni.product_id] || 0);
        insertItem.run(
          orderId,
          ni.product_id,
          ni.quantity,
          ni.unit_price,
          ni.subtotal,
          itemDisc,
          0
        );
      }

      // Insert Buy X Get Y free items into order_items so they are delivered and deducted from warehouse stock
      for (const fi of promoEval.free_items) {
        insertItem.run(
          orderId,
          fi.product_id,
          fi.free_qty,
          0,
          0,
          fi.free_value,
          1
        );
      }

      // Record promo redemptions
      const insertRedemption = db.prepare(
        `INSERT INTO promo_redemptions (promo_id, order_id, franchisee_id, discount_amount)
         VALUES (?, ?, ?, ?)`
      );
      for (const ap of promoEval.applied_promos) {
        const recordedDiscount = Number(
          (Number(ap.discount_amount || 0) + Number(ap.free_items_value || 0)).toFixed(2)
        );
        insertRedemption.run(
          ap.promo_id,
          orderId,
          req.user!.franchiseeId,
          recordedDiscount
        );
      }

      const promoSummaryNote =
        promoEval.applied_promos.length > 0
          ? ` (Promo applied: ${promoEval.applied_promos.map((p) => p.name).join(', ')})`
          : '';

      db.prepare(
        'INSERT INTO order_status_history (order_id, status, notes, changed_by) VALUES (?, ?, ?, ?)'
      ).run(
        orderId,
        'Placed',
        `Order placed by franchisee${promoSummaryNote}`,
        req.user!.id
      );

      notifyAdmins(
        'New Replenishment Order',
        `${req.user!.storeName} placed order ${orderNumber} (Total PHP ${promoEval.final_total.toFixed(2)}${promoSummaryNote}).`,
        'order',
        orderId
      );
      logActivity(
        req.user!.id,
        'ORDER_PLACED',
        'order',
        orderId,
        `Placed ${orderNumber} totaling PHP ${promoEval.final_total.toFixed(2)}${promoSummaryNote}`
      );
      return orderId;
    });

    const orderId = tx();
    res.status(201).json({
      message: 'Order placed successfully.',
      id: orderId,
      order_number: orderNumber,
      promo_evaluation: promoEval,
    });
  });

  api.get('/orders', authorize('admin', 'franchisee'), requireWarehouse, (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const search = `%${String(req.query.search || '').trim()}%`;
    const status = String(req.query.status || '');
    const params: any[] = [search, search];
    let where = 'WHERE (o.order_number LIKE ? OR f.store_name LIKE ?)';

    if (req.user!.role === 'franchisee') {
      where += ' AND o.franchisee_id = ?';
      params.push(req.user!.franchiseeId);
    }
    if (status) {
      where += ' AND o.status = ?';
      params.push(status);
    }

    const totalRow = db
      .prepare(`SELECT COUNT(*) AS total FROM orders o JOIN franchisees f ON f.id = o.franchisee_id ${where}`)
      .get(...params) as { total: number };

    const rows = db
      .prepare(
        `SELECT o.*,
                COALESCE(o.subtotal, o.total_amount) AS subtotal,
                COALESCE(o.discount_amount, 0) AS discount_amount,
                (SELECT pr.name FROM promos pr WHERE pr.id = o.promo_id) AS promo_name,
                f.store_name, f.owner_name, f.address AS store_address, f.contact_number AS store_contact,
                w.name AS warehouse_name, d.id AS delivery_id, du.full_name AS delivery_staff_name
         FROM orders o
         JOIN franchisees f ON f.id = o.franchisee_id
         JOIN warehouses w ON w.id = o.warehouse_id
         LEFT JOIN deliveries d ON d.order_id = o.id
         LEFT JOIN users du ON du.id = d.delivery_staff_id
         ${where}
         ORDER BY o.id DESC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as any[];

    for (const r of rows) {
      r.items = db
        .prepare(
          `SELECT oi.*, p.name AS product_name, p.flavor, p.size, p.image_url
           FROM order_items oi
           JOIN products p ON p.id = oi.product_id
           WHERE oi.order_id = ?`
        )
        .all(r.id);
    }

    res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total: totalRow.total,
        totalPages: Math.ceil(totalRow.total / limit) || 1,
      },
    });
  });

  api.post('/orders/:id/cancel', authorize('franchisee'), requireWarehouse, (req, res) => {
    const orderId = Number(req.params.id);
    const { reason } = req.body;
    const order = db
      .prepare('SELECT * FROM orders WHERE id = ? AND franchisee_id = ?')
      .get(orderId, req.user!.franchiseeId) as any;

    if (!order) {
      res.status(404).json({ message: 'Order not found.' });
      return;
    }
    if (order.status !== 'Placed') {
      res.status(400).json({ message: 'Only Placed orders can be cancelled by the franchisee.' });
      return;
    }

    const tx = db.transaction(() => {
      db.prepare(
        "UPDATE orders SET status = 'Cancelled', cancel_reason = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(reason || 'Cancelled by franchisee', orderId);
      db.prepare('DELETE FROM promo_redemptions WHERE order_id = ?').run(orderId);
      db.prepare(
        "INSERT INTO order_status_history (order_id, status, notes, changed_by) VALUES (?, 'Cancelled', ?, ?)"
      ).run(orderId, reason || 'Cancelled by franchisee (promo redemption reversed)', req.user!.id);
      logActivity(
        req.user!.id,
        'ORDER_CANCELLED',
        'order',
        orderId,
        `Cancelled ${order.order_number} and restored promo usage`
      );
    });

    tx();
    res.json({ message: 'Order cancelled and promotion usage restored.' });
  });

  api.patch('/orders/:id/status', authorize('admin'), requireWarehouse, (req, res) => {
    const orderId = Number(req.params.id);
    const { status, notes } = req.body;
    const allowed = ['Confirmed', 'Preparing', 'Cancelled', 'Rejected'];
    if (!allowed.includes(status)) {
      res.status(400).json({ message: 'Invalid status transition.' });
      return;
    }

    const order = db
      .prepare(
        `SELECT o.*, f.user_id AS franchisee_user_id, f.store_name
         FROM orders o JOIN franchisees f ON f.id = o.franchisee_id
         WHERE o.id = ?`
      )
      .get(orderId) as any;

    if (!order) {
      res.status(404).json({ message: 'Order not found.' });
      return;
    }

    const items = db
      .prepare('SELECT * FROM order_items WHERE order_id = ?')
      .all(orderId) as any[];

    try {
      const tx = db.transaction(() => {
        // Deduct stock from warehouse when Admin confirms order (includes Buy X Get Y free items)
        if (status === 'Confirmed' && !order.stock_deducted) {
          for (const it of items) {
            const inv = db
              .prepare('SELECT id, quantity FROM inventory WHERE warehouse_id = ? AND product_id = ?')
              .get(order.warehouse_id, it.product_id) as { id: number; quantity: number } | undefined;
            const curQty = inv ? inv.quantity : 0;
            if (curQty < it.quantity) {
              throw new Error(
                `Insufficient warehouse stock for product #${it.product_id} (available: ${curQty}, needed: ${it.quantity}).`
              );
            }
            const newQty = curQty - it.quantity;
            db.prepare("UPDATE inventory SET quantity = ?, updated_at = datetime('now') WHERE id = ?").run(
              newQty,
              inv!.id
            );
            db.prepare(
              `INSERT INTO stock_movements (warehouse_id, product_id, movement_type, quantity_change, previous_qty, new_qty, reference_order_id, notes, performed_by)
               VALUES (?, ?, 'ORDER_DEDUCT', ?, ?, ?, ?, ?, ?)`
            ).run(
              order.warehouse_id,
              it.product_id,
              -it.quantity,
              curQty,
              newQty,
              order.id,
              `Confirmed ${order.order_number}${it.is_free_item ? ' (Promo Free Item)' : ''}`,
              req.user!.id
            );

            const prod = db
              .prepare('SELECT name, low_stock_threshold FROM products WHERE id = ?')
              .get(it.product_id) as { name: string; low_stock_threshold: number } | undefined;
            if (prod && newQty <= prod.low_stock_threshold) {
              notifyAdmins(
                'Low Stock Alert',
                `${prod.name} reached low stock (${newQty} left) after confirming ${order.order_number}.`,
                'low_stock',
                it.product_id
              );
            }
          }
          db.prepare('UPDATE orders SET stock_deducted = 1 WHERE id = ?').run(orderId);
        }

        // Restore stock and reverse promo redemptions if order is Cancelled or Rejected
        if (status === 'Cancelled' || status === 'Rejected') {
          db.prepare('DELETE FROM promo_redemptions WHERE order_id = ?').run(orderId);

          if (order.stock_deducted) {
            for (const it of items) {
              const inv = db
                .prepare('SELECT id, quantity FROM inventory WHERE warehouse_id = ? AND product_id = ?')
                .get(order.warehouse_id, it.product_id) as { id: number; quantity: number } | undefined;
              const curQty = inv ? inv.quantity : 0;
              const newQty = curQty + it.quantity;
              if (inv) {
                db.prepare("UPDATE inventory SET quantity = ?, updated_at = datetime('now') WHERE id = ?").run(
                  newQty,
                  inv.id
                );
              } else {
                db.prepare('INSERT INTO inventory (warehouse_id, product_id, quantity) VALUES (?, ?, ?)').run(
                  order.warehouse_id,
                  it.product_id,
                  newQty
                );
              }
              db.prepare(
                `INSERT INTO stock_movements (warehouse_id, product_id, movement_type, quantity_change, previous_qty, new_qty, reference_order_id, notes, performed_by)
                 VALUES (?, ?, 'ORDER_RESTORE', ?, ?, ?, ?, ?, ?)`
              ).run(
                order.warehouse_id,
                it.product_id,
                it.quantity,
                curQty,
                newQty,
                order.id,
                `${status} ${order.order_number}`,
                req.user!.id
              );
            }
            db.prepare('UPDATE orders SET stock_deducted = 0, cancel_reason = ? WHERE id = ?').run(
              notes || null,
              orderId
            );
          }
        }

        db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(
          status,
          orderId
        );
        db.prepare(
          'INSERT INTO order_status_history (order_id, status, notes, changed_by) VALUES (?, ?, ?, ?)'
        ).run(orderId, status, notes || `Status changed to ${status}`, req.user!.id);

        notifyUser(
          order.franchisee_user_id,
          `Order ${order.order_number} ${status}`,
          `Your order status is now: ${status}.`,
          'order',
          order.id
        );
        logActivity(
          req.user!.id,
          'ORDER_STATUS_UPDATED',
          'order',
          orderId,
          `${order.order_number} -> ${status}`
        );
      });

      tx();
      res.json({ message: `Order updated to ${status}.` });
    } catch (err: any) {
      res.status(400).json({ message: err.message || 'Failed to update order status.' });
    }
  });

  api.post('/orders/:id/assign-delivery', authorize('admin'), requireWarehouse, (req, res) => {
    const orderId = Number(req.params.id);
    const { delivery_staff_id } = req.body;
    if (!delivery_staff_id) {
      res.status(400).json({ message: 'Please select a delivery staff member.' });
      return;
    }

    const order = db
      .prepare(
        `SELECT o.*, f.user_id AS franchisee_user_id, f.store_name
         FROM orders o JOIN franchisees f ON f.id = o.franchisee_id
         WHERE o.id = ?`
      )
      .get(orderId) as any;

    if (!order) {
      res.status(404).json({ message: 'Order not found.' });
      return;
    }
    if (!['Confirmed', 'Preparing', 'Assigned to Delivery'].includes(order.status)) {
      res.status(400).json({
        message: 'Order must be Confirmed or Preparing before assigning delivery staff.',
      });
      return;
    }

    const tx = db.transaction(() => {
      const existing = db
        .prepare('SELECT id FROM deliveries WHERE order_id = ?')
        .get(orderId) as { id: number } | undefined;

      if (existing) {
        db.prepare(
          "UPDATE deliveries SET delivery_staff_id = ?, status = 'Assigned', updated_at = datetime('now') WHERE order_id = ?"
        ).run(Number(delivery_staff_id), orderId);
      } else {
        db.prepare(
          "INSERT INTO deliveries (order_id, delivery_staff_id, status) VALUES (?, ?, 'Assigned')"
        ).run(orderId, Number(delivery_staff_id));
      }

      db.prepare(
        "UPDATE orders SET status = 'Assigned to Delivery', updated_at = datetime('now') WHERE id = ?"
      ).run(orderId);
      db.prepare(
        "INSERT INTO order_status_history (order_id, status, notes, changed_by) VALUES (?, 'Assigned to Delivery', ?, ?)"
      ).run(orderId, `Assigned to delivery staff #${delivery_staff_id}`, req.user!.id);

      notifyUser(
        Number(delivery_staff_id),
        'New Delivery Assigned',
        `Order ${order.order_number} for ${order.store_name} is assigned to you.`,
        'delivery',
        order.id
      );
      notifyUser(
        order.franchisee_user_id,
        'Delivery Staff Assigned',
        `Order ${order.order_number} has been assigned to a delivery rider.`,
        'order',
        order.id
      );
      logActivity(
        req.user!.id,
        'DELIVERY_ASSIGNED',
        'order',
        orderId,
        `Assigned rider #${delivery_staff_id} to ${order.order_number}`
      );
    });

    tx();
    res.json({ message: 'Delivery staff assigned.' });
  });

  api.get('/orders/:id/tracking', authorize('admin', 'franchisee'), requireWarehouse, (req, res) => {
    const orderId = Number(req.params.id);
    const order = db
      .prepare(
        `SELECT o.*,
                COALESCE(o.subtotal, o.total_amount) AS subtotal,
                COALESCE(o.discount_amount, 0) AS discount_amount,
                (SELECT pr.name FROM promos pr WHERE pr.id = o.promo_id) AS promo_name,
                f.store_name, f.address AS store_address, f.contact_number AS store_contact, f.lat AS store_lat, f.lng AS store_lng,
                w.name AS warehouse_name, w.address AS warehouse_address, w.lat AS warehouse_lat, w.lng AS warehouse_lng,
                d.id AS delivery_id, d.status AS delivery_status, d.proof_note, d.proof_image_url, d.near_notified,
                du.full_name AS delivery_staff_name, du.contact_number AS delivery_staff_contact
         FROM orders o
         JOIN franchisees f ON f.id = o.franchisee_id
         JOIN warehouses w ON w.id = o.warehouse_id
         LEFT JOIN deliveries d ON d.order_id = o.id
         LEFT JOIN users du ON du.id = d.delivery_staff_id
         WHERE o.id = ?`
      )
      .get(orderId) as any;

    if (!order) {
      res.status(404).json({ message: 'Order not found.' });
      return;
    }
    if (req.user!.role === 'franchisee' && order.franchisee_id !== req.user!.franchiseeId) {
      res.status(403).json({ message: 'Forbidden.' });
      return;
    }

    const items = db
      .prepare(
        `SELECT oi.*, p.name AS product_name, p.flavor, p.size, p.image_url
         FROM order_items oi JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = ?`
      )
      .all(orderId);

    const history = db
      .prepare(
        `SELECT osh.*, u.full_name AS changed_by_name
         FROM order_status_history osh
         LEFT JOIN users u ON u.id = osh.changed_by
         WHERE osh.order_id = ?
         ORDER BY osh.id ASC`
      )
      .all(orderId);

    let liveLocation: any = null;
    let etaMinutes: number | null = null;

    if (order.delivery_id) {
      const loc = db
        .prepare(
          'SELECT lat, lng, recorded_at FROM delivery_locations WHERE delivery_id = ? ORDER BY id DESC LIMIT 1'
        )
        .get(order.delivery_id) as { lat: number; lng: number; recorded_at: string } | undefined;

      if (loc) {
        liveLocation = loc;
        const km = haversineKm(
          Number(loc.lat),
          Number(loc.lng),
          Number(order.store_lat),
          Number(order.store_lng)
        );
        etaMinutes = estimateEtaMinutes(km);
      } else {
        // Estimate baseline warehouse -> store ETA before rider sends live GPS ping
        const km = haversineKm(
          Number(order.warehouse_lat),
          Number(order.warehouse_lng),
          Number(order.store_lat),
          Number(order.store_lng)
        );
        etaMinutes = estimateEtaMinutes(km);
      }
    }

    res.json({ order, items, history, liveLocation, etaMinutes });
  });

  // ===== DELIVERIES (Delivery Staff) =====
  api.get('/deliveries', authorize('delivery'), requireWarehouse, (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const mode = req.query.mode;
    const params: any[] = [req.user!.id];
    let where = 'WHERE d.delivery_staff_id = ?';
    if (mode === 'active') where += " AND d.status != 'Delivered'";
    if (mode === 'history') where += " AND d.status = 'Delivered'";

    const totalRow = db
      .prepare(`SELECT COUNT(*) AS total FROM deliveries d ${where}`)
      .get(...params) as { total: number };

    const rows = db
      .prepare(
        `SELECT d.*,
                o.order_number,
                COALESCE(o.subtotal, o.total_amount) AS subtotal,
                COALESCE(o.discount_amount, 0) AS discount_amount,
                (SELECT pr.name FROM promos pr WHERE pr.id = o.promo_id) AS promo_name,
                o.total_amount, o.status AS order_status, o.notes AS order_notes, o.requested_delivery_datetime,
                f.store_name, f.owner_name, f.address AS store_address, f.contact_number AS store_contact, f.lat AS store_lat, f.lng AS store_lng,
                w.name AS warehouse_name, w.address AS warehouse_address, w.lat AS warehouse_lat, w.lng AS warehouse_lng
         FROM deliveries d
         JOIN orders o ON o.id = d.order_id
         JOIN franchisees f ON f.id = o.franchisee_id
         JOIN warehouses w ON w.id = o.warehouse_id
         ${where}
         ORDER BY d.id DESC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as any[];

    for (const r of rows) {
      r.items = db
        .prepare(
          `SELECT oi.*, p.name AS product_name, p.flavor, p.size, p.image_url
           FROM order_items oi
           JOIN products p ON p.id = oi.product_id
           WHERE oi.order_id = ?`
        )
        .all(r.order_id);
    }

    res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total: totalRow.total,
        totalPages: Math.ceil(totalRow.total / limit) || 1,
      },
    });
  });

  api.patch(
    '/deliveries/:id/status',
    authorize('delivery'),
    requireWarehouse,
    uploadProofImage.single('proof_image'),
    (req, res) => {
      const deliveryId = Number(req.params.id);
      const { status, proof_note } = req.body;
      const allowed = ['Picked Up', 'Out for Delivery', 'Near / Arrived', 'Delivered'];
      if (!allowed.includes(status)) {
        res.status(400).json({ message: 'Invalid delivery status.' });
        return;
      }

      const del = db
        .prepare(
          `SELECT d.*, o.order_number, f.user_id AS franchisee_user_id
           FROM deliveries d
           JOIN orders o ON o.id = d.order_id
           JOIN franchisees f ON f.id = o.franchisee_id
           WHERE d.id = ? AND d.delivery_staff_id = ?`
        )
        .get(deliveryId, req.user!.id) as any;

      if (!del) {
        res.status(404).json({ message: 'Delivery not found.' });
        return;
      }

      const proofImageUrl = req.file ? `/uploads/proofs/${req.file.filename}` : del.proof_image_url;
      let orderStatus = 'Assigned to Delivery';
      let timestampUpdate = '';

      if (status === 'Picked Up') {
        timestampUpdate = ", accepted_at = COALESCE(accepted_at, datetime('now')), picked_up_at = datetime('now')";
        orderStatus = 'Assigned to Delivery';
      } else if (status === 'Out for Delivery') {
        timestampUpdate = ", accepted_at = COALESCE(accepted_at, datetime('now')), out_for_delivery_at = datetime('now')";
        orderStatus = 'Out for Delivery';
      } else if (status === 'Near / Arrived') {
        timestampUpdate = ", arrived_at = datetime('now'), near_notified = 1";
        orderStatus = 'Near / Arrived';
      } else if (status === 'Delivered') {
        timestampUpdate = ", delivered_at = datetime('now')";
        orderStatus = 'Delivered';
      }

      const tx = db.transaction(() => {
        db.prepare(
          `UPDATE deliveries
           SET status = ?, proof_note = COALESCE(?, proof_note), proof_image_url = ?, updated_at = datetime('now') ${timestampUpdate}
           WHERE id = ?`
        ).run(status, proof_note || null, proofImageUrl, deliveryId);

        db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(
          orderStatus,
          del.order_id
        );

        db.prepare(
          'INSERT INTO order_status_history (order_id, status, notes, changed_by) VALUES (?, ?, ?, ?)'
        ).run(
          del.order_id,
          orderStatus,
          proof_note || `Delivery updated: ${status}`,
          req.user!.id
        );

        notifyUser(
          del.franchisee_user_id,
          `Delivery Update: ${status}`,
          `Order ${del.order_number} is now ${status}.`,
          'delivery',
          del.order_id
        );

        logActivity(
          req.user!.id,
          'DELIVERY_STATUS_UPDATED',
          'delivery',
          deliveryId,
          `${del.order_number} -> ${status}`
        );
      });

      tx();
      res.json({ message: `Delivery status updated to ${status}.` });
    }
  );

  api.post('/deliveries/:id/location', authorize('delivery'), requireWarehouse, (req, res) => {
    const deliveryId = Number(req.params.id);
    const { lat, lng } = req.body;
    if (!isValidCoords(lat, lng)) {
      res.status(400).json({ message: 'Invalid GPS coordinates.' });
      return;
    }

    const del = db
      .prepare("SELECT id FROM deliveries WHERE id = ? AND delivery_staff_id = ? AND status != 'Delivered'")
      .get(deliveryId, req.user!.id);
    if (!del) {
      res.status(404).json({ message: 'Active delivery not found.' });
      return;
    }

    db.prepare('INSERT INTO delivery_locations (delivery_id, lat, lng) VALUES (?, ?, ?)').run(
      deliveryId,
      Number(lat),
      Number(lng)
    );
    res.json({ message: 'Location recorded.' });
  });

  api.post('/deliveries/:id/notify-near', authorize('delivery'), requireWarehouse, (req, res) => {
    const deliveryId = Number(req.params.id);
    const del = db
      .prepare(
        `SELECT d.*, o.order_number, f.user_id AS franchisee_user_id
         FROM deliveries d
         JOIN orders o ON o.id = d.order_id
         JOIN franchisees f ON f.id = o.franchisee_id
         WHERE d.id = ? AND d.delivery_staff_id = ?`
      )
      .get(deliveryId, req.user!.id) as any;

    if (!del) {
      res.status(404).json({ message: 'Delivery not found.' });
      return;
    }

    db.prepare('UPDATE deliveries SET near_notified = 1 WHERE id = ?').run(deliveryId);
    notifyUser(
      del.franchisee_user_id,
      'Delivery Rider Nearby!',
      `Your rider (${req.user!.full_name}) is near your store with order ${del.order_number}. Please prepare your freezer to receive the stock.`,
      'near',
      del.order_id
    );
    res.json({ message: 'Franchisee notified that you are near.' });
  });

  app.use('/api', api);

  // Error handler for Multer & API errors
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ message: 'Image must be 5 MB or smaller.' });
        return;
      }
      res.status(400).json({ message: err.message });
      return;
    }
    if (err && err.message && String(err.message).includes('Only JPG, PNG, and WEBP')) {
      res.status(400).json({ message: err.message });
      return;
    }
    console.error('[API ERROR]', err);
    res.status(500).json({ message: err.message || 'Internal server error.' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AICE Franchisee Hub running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
