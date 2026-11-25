import path from 'path';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import type { Request, Response, NextFunction } from 'express';
import db, { type DbExecutor } from './db.ts';
import {
  buildFranchiseeUsernameBase,
  requiresForcedPasswordChange,
  sanitizePublicText,
  normalizeApplicationStatus,
  canFranchiseeLogin,
  buildFranchiseeOrderQrUrl,
} from '../src/utils/domainRules.ts';

export const JWT_SECRET = process.env.JWT_SECRET || 'aice_franchise_secret_key_2026';

export type UploadCategory = 'products' | 'proofs' | 'stores';

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];
const MAX_UPLOAD_SIZE = 5 * 1024 * 1024; // 5 MB

function makeMemoryUploader() {
  return multer({
    storage: multer.memoryStorage(),
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

export const uploadProductImage = makeMemoryUploader();
export const uploadProofImage = makeMemoryUploader();
export const uploadStoreImage = makeMemoryUploader();

export async function saveUploadedFile(
  category: UploadCategory,
  prefix: string,
  file: Express.Multer.File,
  executor: DbExecutor = db
): Promise<string> {
  const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
  const safeExt = ALLOWED_EXTS.includes(ext) ? ext : '.jpg';
  const filename = `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${safeExt}`;
  const storageKey = `${category}/${filename}`;
  const dataBase64 = file.buffer.toString('base64');

  await executor.execute(
    `INSERT INTO uploaded_files (storage_key, category, mime_type, file_size, data_base64)
     VALUES ($1, $2, $3, $4, $5)`,
    [storageKey, category, file.mimetype, file.size, dataBase64]
  );

  return `/uploads/${storageKey}`;
}

export async function deleteUploadedFile(
  imageUrl: string | null | undefined,
  executor: DbExecutor = db
): Promise<void> {
  if (!imageUrl) return;
  const storageKey = imageUrl.replace(/^\/uploads\//, '').replace(/^\//, '');
  if (!storageKey) return;
  try {
    await executor.execute('DELETE FROM uploaded_files WHERE storage_key = $1', [storageKey]);
  } catch {
    // ignore cleanup error
  }
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void> | void
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$';
  let pwd = '';
  const bytes = crypto.randomBytes(10);
  for (let i = 0; i < 10; i++) {
    pwd += chars[bytes[i] % chars.length];
  }
  return pwd;
}

export async function generateFranchiseeUsername(
  ownerName: string,
  storeName: string,
  executor: DbExecutor = db
): Promise<string> {
  const base = buildFranchiseeUsernameBase(ownerName, storeName);
  for (let i = 0; i < 15; i++) {
    const suffix = Math.floor(100 + Math.random() * 900);
    const candidate = `fr_${base}_${suffix}`;
    const existing = await executor.queryOne<{ id: number }>(
      'SELECT id FROM users WHERE username = $1',
      [candidate]
    );
    if (!existing) return candidate;
  }
  return `fr_${base}_${Date.now().toString().slice(-5)}`;
}

export function parsePagination(query: Record<string, any>) {
  const page = Math.max(1, parseInt(String(query.page || '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit || '10'), 10) || 10));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

export async function getTodaySqlDate(executor: DbExecutor = db): Promise<string> {
  const row = await executor.queryOne<{ d: string }>(
    "SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d"
  );
  return row?.d || new Date().toISOString().slice(0, 10);
}

export async function logActivity(
  userId: number | null,
  action: string,
  entityType: string,
  entityId: number | string | null,
  details: string | null,
  executor: DbExecutor = db
): Promise<void> {
  await executor.execute(
    'INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
    [userId, action, entityType, entityId !== null ? Number(entityId) : null, details]
  );
}

export async function notifyUser(
  userId: number | null | undefined,
  title: string,
  message: string,
  type = 'info',
  relatedId: number | null = null,
  executor: DbExecutor = db
): Promise<void> {
  if (!userId) return;
  await executor.execute(
    'INSERT INTO notifications (user_id, title, message, type, related_id) VALUES ($1, $2, $3, $4, $5)',
    [userId, title, message, type, relatedId]
  );
}

export async function notifyAdmins(
  title: string,
  message: string,
  type = 'info',
  relatedId: number | null = null,
  executor: DbExecutor = db
): Promise<void> {
  const admins = await executor.queryAll<{ id: number }>(
    "SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'admin' AND u.is_active = 1"
  );
  for (const admin of admins) {
    await notifyUser(admin.id, title, message, type, relatedId, executor);
  }
}

export interface AuthenticatedUser {
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
  applicationId?: number;
  applicationStatus?: string;
  agentId?: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export const authenticate = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ message: 'Authentication required.' });
    return;
  }

  let decoded: { userId: number; role: string };
  try {
    decoded = jwt.verify(token, JWT_SECRET) as { userId: number; role: string };
  } catch {
    res.status(401).json({ message: 'Invalid or expired session token.' });
    return;
  }

  const user = await db.queryOne<AuthenticatedUser>(
    `SELECT u.id, u.username, u.full_name, u.email, u.contact_number, u.is_active,
            u.must_change_password, u.is_test, r.name AS role
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1`,
    [decoded.userId]
  );

  if (!user) {
    res.status(401).json({ message: 'User account not found.' });
    return;
  }
  if (!user.is_active) {
    res.status(403).json({ message: 'This account has been deactivated.' });
    return;
  }

  user.full_name = String(user.full_name || '').trim() || 'User';

  if (user.role === 'franchisee') {
    const fr = await db.queryOne<{ id: number; status: string; store_name: string }>(
      'SELECT id, status, store_name FROM franchisees WHERE user_id = $1',
      [user.id]
    );
    const appRow = await db.queryOne<{ id: number; status: string }>(
      'SELECT id, status FROM franchisee_applications WHERE user_id = $1',
      [user.id]
    );
    const effectiveStatus = appRow?.status || fr?.status || 'Pending Admin Review';
    if (!fr || !canFranchiseeLogin(effectiveStatus)) {
      res.status(403).json({ message: 'Franchisee account is not approved.' });
      return;
    }
    user.franchiseeId = fr.id;
    user.storeName = fr.store_name;
    user.applicationId = appRow?.id;
    user.applicationStatus = normalizeApplicationStatus(effectiveStatus);
  }

  if (user.role === 'agent') {
    const ag = await db.queryOne<{ id: number }>('SELECT id FROM agents WHERE user_id = $1', [
      user.id,
    ]);
    if (ag) user.agentId = ag.id;
  }

  req.user = user;
  next();
});

export function authorize(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      res.status(403).json({ message: 'Forbidden: insufficient role permissions.' });
      return;
    }
    next();
  };
}

export function requirePasswordUpdated(req: Request, res: Response, next: NextFunction) {
  if (req.user && requiresForcedPasswordChange(req.user)) {
    res.status(403).json({
      message: 'You must change your temporary/initial password before continuing.',
      mustChangePassword: true,
    });
    return;
  }
  next();
}

export const requireWarehouse = asyncHandler(
  async (_req: Request, res: Response, next: NextFunction) => {
    const row = await db.queryOne<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM warehouses WHERE is_active = 1'
    );
    if (!row || row.cnt === 0) {
      res.status(423).json({
        message: 'System locked: Admin must register at least one warehouse first.',
        warehouseLocked: true,
      });
      return;
    }
    next();
  }
);

export function resolveAppBaseUrl(req?: Request): string {
  const rawEnvBase = String(
    process.env.APP_BASE_URL || process.env.VITE_APP_BASE_URL || process.env.APP_URL || ''
  ).trim();
  if (
    rawEnvBase &&
    rawEnvBase !== 'MY_APP_URL' &&
    rawEnvBase !== 'MY_APP_BASE_URL' &&
    !/^https?:\/\/localhost\b/i.test(rawEnvBase)
  ) {
    return rawEnvBase.replace(/\/+$/, '');
  }
  if (req) {
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
      .split(',')[0]
      .trim();
    const host = String(req.headers['x-forwarded-host'] || req.get('host') || '')
      .split(',')[0]
      .trim();
    if (host) {
      return `${proto}://${host}`.replace(/\/+$/, '');
    }
  }
  return rawEnvBase.replace(/\/+$/, '');
}

export async function getPublicSettingsMap(req?: Request) {
  const rows = await db.queryAll<{ key: string; value: string }>(
    'SELECT key, value FROM system_settings'
  );
  const map: Record<string, string> = {};
  for (const r of rows) {
    map[r.key] = r.value;
  }
  const appBaseUrl = resolveAppBaseUrl(req);
  return {
    show_public_prices:
      (map.show_public_prices ?? process.env.PUBLIC_SHOW_PRICES ?? '0') === '1',
    contact_email: sanitizePublicText(
      map.contact_email || process.env.PUBLIC_CONTACT_EMAIL || 'franchising@aicecotabato.ph'
    ),
    contact_phone: sanitizePublicText(
      map.contact_phone || process.env.PUBLIC_CONTACT_PHONE || '+63 (02) 8888-2423'
    ),
    app_base_url: appBaseUrl,
    franchisee_order_qr_url: buildFranchiseeOrderQrUrl(appBaseUrl),
  };
}
