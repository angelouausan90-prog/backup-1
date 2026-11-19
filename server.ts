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
                COALESCE(SUM(CASE WHEN status NOT IN ('Cancelled', 'Rejected') THEN total_amount ELSE 0 END), 0) AS total_sales
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
        `SELECT o.order_number, o.created_at AS order_date, f.store_name, w.name AS warehouse_name, o.status, o.total_amount
         FROM orders o
         JOIN franchisees f ON f.id = o.franchisee_id
         JOIN warehouses w ON w.id = o.warehouse_id
         ${where}
         ORDER BY o.id DESC`
      )
      .all(...params) as any[];

    const totalSales = rows.reduce((sum, r) => sum + Number(r.total_amount || 0), 0);
    res.json({ data: rows, summary: { count: rows.length, totalSales } });
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

  // ===== ORDERS (Franchisee & Admin) =====
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

    let totalAmount = 0;
    const normalizedItems: {
      product_id: number;
      quantity: number;
      unit_price: number;
      subtotal: number;
    }[] = [];

    for (const item of items) {
      const qty = parseInt(String(item.quantity), 10);
      if (!item.product_id || Number.isNaN(qty) || qty <= 0) {
        res.status(400).json({ message: 'Invalid item quantity.' });
        return;
      }

      const prod = db
        .prepare(
          `SELECT p.id, p.name, p.price, COALESCE(i.quantity, 0) AS stock
           FROM products p
           LEFT JOIN inventory i ON i.product_id = p.id AND i.warehouse_id = ?
           WHERE p.id = ? AND p.is_active = 1`
        )
        .get(whId, Number(item.product_id)) as
        | { id: number; name: string; price: number; stock: number }
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

      const subtotal = Number(prod.price) * qty;
      totalAmount += subtotal;
      normalizedItems.push({
        product_id: prod.id,
        quantity: qty,
        unit_price: Number(prod.price),
        subtotal,
      });
    }

    const orderNumber = `AICE-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

    const tx = db.transaction(() => {
      const oRes = db
        .prepare(
          `INSERT INTO orders (order_number, franchisee_id, warehouse_id, status, total_amount, requested_delivery_datetime, notes)
           VALUES (?, ?, ?, 'Placed', ?, ?, ?)`
        )
        .run(
          orderNumber,
          req.user!.franchiseeId,
          whId,
          totalAmount,
          requested_delivery_datetime || null,
          notes ? String(notes).trim() : null
        );

      const orderId = Number(oRes.lastInsertRowid);
      const insertItem = db.prepare(
        'INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal) VALUES (?, ?, ?, ?, ?)'
      );
      for (const ni of normalizedItems) {
        insertItem.run(orderId, ni.product_id, ni.quantity, ni.unit_price, ni.subtotal);
      }

      db.prepare(
        'INSERT INTO order_status_history (order_id, status, notes, changed_by) VALUES (?, ?, ?, ?)'
      ).run(orderId, 'Placed', 'Order placed by franchisee', req.user!.id);

      notifyAdmins(
        'New Replenishment Order',
        `${req.user!.storeName} placed order ${orderNumber} (PHP ${totalAmount.toFixed(2)}).`,
        'order',
        orderId
      );
      logActivity(
        req.user!.id,
        'ORDER_PLACED',
        'order',
        orderId,
        `Placed ${orderNumber} totaling PHP ${totalAmount.toFixed(2)}`
      );
      return orderId;
    });

    const orderId = tx();
    res.status(201).json({
      message: 'Order placed successfully.',
      id: orderId,
      order_number: orderNumber,
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
        `SELECT o.*, f.store_name, f.owner_name, f.address AS store_address, f.contact_number AS store_contact,
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
        // Deduct stock from warehouse when Admin confirms order
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
              `Confirmed ${order.order_number}`,
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

        // Restore stock if order is Cancelled or Rejected after deduction
        if ((status === 'Cancelled' || status === 'Rejected') && order.stock_deducted) {
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
        `SELECT o.*, f.store_name, f.address AS store_address, f.contact_number AS store_contact, f.lat AS store_lat, f.lng AS store_lng,
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
        `SELECT d.*, o.order_number, o.total_amount, o.status AS order_status, o.notes AS order_notes, o.requested_delivery_datetime,
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
