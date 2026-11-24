import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { GoogleGenAI } from '@google/genai';
import db, { initDatabase } from './server/db.ts';
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
  getNotificationTypesForRoute,
  sanitizePublicText,
  projectPublicProduct,
  projectPublicStore,
  projectPublicPromo,
  CHATBOT_SYSTEM_PROMPT,
  CHATBOT_AI_SUBTLE_LABEL,
  CHATBOT_MAX_MESSAGE_LENGTH,
  sanitizeChatbotText,
  matchFaqQuestion,
  isChatbotAiConfigured,
  parseChatbotDailyCap,
  buildStandardChatbotFallback,
  checkChatbotIpMessageLimit,
  checkChatbotIpAiLimit,
  ChatbotIpBucket,
  PromoDefinition,
  FRANCHISEE_EQUIPMENT_ITEMS,
  normalizeApplicationStatus,
  canFranchiseeLogin,
  canFranchiseeOrderReplenishment,
  isValidPhMobileNumber,
  normalizePhMobileNumber,
  formatApplicationNumber,
  composeApplicantFullName,
  composeStoreFullAddress,
  validateFranchiseeStep1,
  validateFranchiseeStep2,
  buildFranchiseeOrderQrUrl,
  buildStorePosterQrUrl,
} from './src/utils/domainRules.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'aice_franchise_secret_key_2026';

// Ensure upload directories exist inside a writable path (server/uploads/ or /tmp/uploads/ fallback)
function resolveWritableUploadsBaseDir(): string {
  const preferred = path.resolve(process.cwd(), 'server', 'uploads');
  try {
    fs.mkdirSync(path.join(preferred, 'products'), { recursive: true });
    fs.mkdirSync(path.join(preferred, 'proofs'), { recursive: true });
    fs.mkdirSync(path.join(preferred, 'stores'), { recursive: true });
    return preferred;
  } catch {
    const fallback = path.resolve('/tmp', 'aice_uploads');
    fs.mkdirSync(path.join(fallback, 'products'), { recursive: true });
    fs.mkdirSync(path.join(fallback, 'proofs'), { recursive: true });
    fs.mkdirSync(path.join(fallback, 'stores'), { recursive: true });
    return fallback;
  }
}

const uploadsBaseDir = resolveWritableUploadsBaseDir();
const productsUploadDir = path.join(uploadsBaseDir, 'products');
const proofsUploadDir = path.join(uploadsBaseDir, 'proofs');
const storesUploadDir = path.join(uploadsBaseDir, 'stores');

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
const uploadStoreImage = makeUploader(storesUploadDir, 'store');

function deleteUploadedFile(imageUrl: string | null | undefined) {
  if (!imageUrl) return;
  const rel = imageUrl.replace(/^\/uploads\//, '').replace(/^\//, '');
  const fullPath = path.resolve(uploadsBaseDir, rel);
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

    user.full_name = String(user.full_name || '').trim() || 'User';

    if (user.role === 'franchisee') {
      const fr = db
        .prepare('SELECT id, status, store_name FROM franchisees WHERE user_id = ?')
        .get(user.id) as { id: number; status: string; store_name: string } | undefined;
      const appRow = db
        .prepare('SELECT id, status FROM franchisee_applications WHERE user_id = ?')
        .get(user.id) as { id: number; status: string } | undefined;
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
  app.use(express.json({ limit: '10mb' }));

  // Serve product photos, store photos, and proof of delivery photos statically
  app.use('/uploads', express.static(uploadsBaseDir));

  const api = express.Router();

  // ===== PUBLIC ENDPOINTS =====
  api.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'AICE Franchisee Hub API' });
  });

  // Ensure database tables and base records are initialized before handling any DB-backed API routes
  api.use((_req, _res, next) => {
    initDatabase();
    next();
  });

  api.get('/system/status', (_req, res) => {
    const row = db
      .prepare('SELECT COUNT(*) AS cnt FROM warehouses WHERE is_active = 1')
      .get() as { cnt: number };
    const showTestAccounts =
      process.env.SHOW_TEST_ACCOUNTS === 'true' ||
      process.env.VITE_SHOW_TEST_ACCOUNTS === 'true';
    res.json({
      hasWarehouse: row.cnt > 0,
      warehouseCount: row.cnt,
      showTestAccounts,
    });
  });

  // In-memory rate limiter for /api/public/* (max 90 requests per 60-second window per IP)
  const publicRateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
  const publicRateLimiter = (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const clientIp =
      String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown')
        .split(',')[0]
        .trim() || 'unknown';

    const bucket = publicRateLimitBuckets.get(clientIp);
    if (!bucket || now >= bucket.resetAt) {
      publicRateLimitBuckets.set(clientIp, { count: 1, resetAt: now + 60_000 });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > 90) {
      res.status(429).json({
        message: 'Too many requests to public endpoints. Please try again in a minute.',
      });
      return;
    }
    next();
  };

  const resolveAppBaseUrl = (req?: Request): string => {
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
  };

  const getPublicSettingsMap = (req?: Request) => {
    const rows = db
      .prepare('SELECT key, value FROM system_settings')
      .all() as { key: string; value: string }[];
    const map: Record<string, string> = {};
    for (const r of rows) {
      map[r.key] = r.value;
    }
    const appBaseUrl = resolveAppBaseUrl(req);
    return {
      show_public_prices:
        (map.show_public_prices ?? process.env.PUBLIC_SHOW_PRICES ?? '0') === '1',
      contact_email: sanitizePublicText(
        map.contact_email || process.env.PUBLIC_CONTACT_EMAIL || 'franchising@aicehub.local'
      ),
      contact_phone: sanitizePublicText(
        map.contact_phone || process.env.PUBLIC_CONTACT_PHONE || '+63 (02) 8888-2423'
      ),
      app_base_url: appBaseUrl,
      franchisee_order_qr_url: buildFranchiseeOrderQrUrl(appBaseUrl),
    };
  };

  api.use('/public', publicRateLimiter);

  // GET /api/public/products: active products only, safe fields only (no stock quantities, no prices unless enabled)
  api.get('/public/products', (_req, res) => {
    const settings = getPublicSettingsMap();
    const rows = db
      .prepare(
        `SELECT p.id, p.name, p.flavor, p.size, p.image_url, p.price, c.name AS category_name
         FROM products p
         JOIN categories c ON c.id = p.category_id
         WHERE p.is_active = 1
         ORDER BY c.name ASC, p.name ASC`
      )
      .all() as Record<string, any>[];

    const data = rows.map((r) => projectPublicProduct(r, settings.show_public_prices));
    res.json({
      data,
      show_prices: settings.show_public_prices,
    });
  });

  // GET /api/public/stores: approved franchisees only, safe fields only (store_name, area, lat, lng)
  api.get('/public/stores', (_req, res) => {
    const rows = db
      .prepare(
        `SELECT f.id, f.store_name, f.address, f.lat, f.lng
         FROM franchisees f
         JOIN users u ON u.id = f.user_id
         WHERE f.status = 'Approved' AND u.is_active = 1
         ORDER BY f.store_name ASC`
      )
      .all() as Record<string, any>[];

    const data = rows.map((r) => projectPublicStore(r));
    res.json({ data });
  });

  // GET /api/public/promos: active promos within valid dates, safe fields only (name, short_description, valid_until)
  api.get('/public/promos', (_req, res) => {
    // Auto-expire past non-recurring promos first
    db.prepare(
      `UPDATE promos
       SET status = 'Expired', updated_at = datetime('now')
       WHERE status IN ('Active', 'Paused')
         AND COALESCE(recurring_monthly, 0) = 0
         AND date(end_date) < date('now')`
    ).run();

    const todayRow = db.prepare("SELECT date('now') AS d").get() as { d: string };
    const todayStr = todayRow.d;

    const rawPromos = db
      .prepare(
        `SELECT id, name, description, promo_type, tier_basis, discount_type, discount_value,
                min_order_amount, min_quantity, buy_quantity, free_quantity, free_delivery,
                max_discount_cap, scope, start_date, end_date, recurring_monthly, status
         FROM promos
         WHERE status = 'Active'
         ORDER BY id DESC`
      )
      .all() as Record<string, any>[];

    const activePromos = rawPromos
      .map((p: Record<string, any>): Record<string, any> => {
        const tiers = db
          .prepare(
            'SELECT min_quantity_or_amount, discount_value FROM promo_tiers WHERE promo_id = ? ORDER BY min_quantity_or_amount ASC'
          )
          .all(p.id);
        return { ...p, tiers };
      })
      .filter((p) =>
        isPromoDateValid(
          String(p.start_date),
          String(p.end_date),
          todayStr,
          Boolean(p.recurring_monthly)
        )
      )
      .map((p) => projectPublicPromo(p));

    res.json({ data: activePromos });
  });

  // GET /api/public/faqs: active FAQs visible to "all"
  api.get('/public/faqs', (_req, res) => {
    const rows = db
      .prepare(
        `SELECT id, question, answer
         FROM faqs
         WHERE is_active = 1 AND LOWER(audience) = 'all'
         ORDER BY sort_order ASC, id ASC`
      )
      .all() as { id: number; question: string; answer: string }[];

    const data = rows.map((r) => ({
      id: Number(r.id),
      question: sanitizePublicText(r.question),
      answer: sanitizePublicText(r.answer),
    }));
    res.json({ data });
  });

  // GET /api/public/settings: safe public contact email, phone, show_public_prices toggle, and QR ordering URL
  api.get('/public/settings', (req, res) => {
    res.json(getPublicSettingsMap(req));
  });

  // Per-IP rate limiter store for public chatbot (10 messages/min, 5 AI calls/hour)
  const chatbotIpRateStore = new Map<string, ChatbotIpBucket>();

  const recordUnansweredQuestion = (sessionId: string, question: string) => {
    const cleanQ = sanitizeChatbotText(question, CHATBOT_MAX_MESSAGE_LENGTH);
    const cleanSession = sanitizeChatbotText(sessionId || 'anon', 80) || 'anon';
    if (!cleanQ) return;

    // Avoid inserting duplicate open identical question in the same session
    const existing = db
      .prepare(
        `SELECT id FROM chat_unanswered
         WHERE LOWER(question) = LOWER(?) AND status = 'Open'
         LIMIT 1`
      )
      .get(cleanQ) as { id: number } | undefined;

    if (!existing) {
      db.prepare(
        `INSERT INTO chat_unanswered (session_id, question, status, created_at)
         VALUES (?, ?, 'Open', datetime('now'))`
      ).run(cleanSession, cleanQ);
    }
  };

  // POST /api/public/chatbot/ask: FAQ match first -> optional server-side Gemini AI fallback -> standard contact fallback
  api.post('/public/chatbot/ask', async (req, res) => {
    const settings = getPublicSettingsMap();
    const fallbackReply = buildStandardChatbotFallback(settings);

    const ip =
      String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown')
        .split(',')[0]
        .trim() || 'unknown';

    const rawMessage = req.body?.message;
    const visitorMessage = sanitizeChatbotText(rawMessage, CHATBOT_MAX_MESSAGE_LENGTH);
    const sessionId =
      sanitizeChatbotText(req.body?.session_id, 80) ||
      `sess_${crypto.createHash('sha256').update(ip).digest('hex').slice(0, 12)}`;

    if (!visitorMessage) {
      res.status(400).json({
        message: 'Please enter a question (up to 200 characters).',
      });
      return;
    }

    const nowMs = Date.now();
    // Per-IP message limit: max 10 messages / minute
    const msgLimit = checkChatbotIpMessageLimit(chatbotIpRateStore, ip, nowMs);
    if (!msgLimit.allowed) {
      res.json({
        reply: fallbackReply,
        source: 'fallback',
        ai_label: null,
        rate_limited: true,
      });
      return;
    }

    // 1. Load active public FAQs (visible to "all") and try local FAQ matching first
    const publicFaqs = db
      .prepare(
        `SELECT id, question, answer, COALESCE(keywords, '') AS keywords
         FROM faqs
         WHERE is_active = 1 AND LOWER(audience) = 'all'
         ORDER BY sort_order ASC, id ASC`
      )
      .all() as { id: number; question: string; answer: string; keywords: string }[];

    const faqMatch = matchFaqQuestion(visitorMessage, publicFaqs);
    if (faqMatch.matched && faqMatch.faq) {
      res.json({
        reply: sanitizeChatbotText(faqMatch.faq.answer),
        source: 'faq',
        matched_faq_id: faqMatch.faq.id,
        matched_question: sanitizeChatbotText(faqMatch.faq.question),
        ai_label: null,
      });
      return;
    }

    // 2. Otherwise, check if Gemini AI fallback is enabled and within per-IP & global daily limits
    const aiEnabled = isChatbotAiConfigured(process.env);
    const dailyCap = parseChatbotDailyCap(process.env.CHATBOT_AI_DAILY_CAP);
    const todayUsageRow = db
      .prepare("SELECT COUNT(*) AS cnt FROM chat_ai_usage WHERE date(created_at) = date('now')")
      .get() as { cnt: number };
    const callsToday = Number(todayUsageRow?.cnt || 0);

    if (!aiEnabled || callsToday >= dailyCap) {
      recordUnansweredQuestion(sessionId, visitorMessage);
      res.json({
        reply: fallbackReply,
        source: 'fallback',
        ai_label: null,
      });
      return;
    }

    const ipAiLimit = checkChatbotIpAiLimit(chatbotIpRateStore, ip, nowMs);
    if (!ipAiLimit.allowed) {
      recordUnansweredQuestion(sessionId, visitorMessage);
      res.json({
        reply: fallbackReply,
        source: 'fallback',
        ai_label: null,
      });
      return;
    }

    // Build context from public FAQs ONLY (question + answer; no prices, no stock, no user info)
    const faqContextBlock = publicFaqs
      .map((f, idx) => {
        const q = sanitizeChatbotText(f.question);
        const a = sanitizeChatbotText(f.answer);
        return `Q${idx + 1}: ${q}\nA${idx + 1}: ${a}`;
      })
      .join('\n\n');

    const fullSystemInstruction = `${CHATBOT_SYSTEM_PROMPT}\n\nPublic FAQ Context:\n${
      faqContextBlock || 'No public FAQs available.'
    }`;

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    try {
      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error('CHATBOT_AI_TIMEOUT'));
        }, 8000);
      });

      // Visitor's message (max 200 chars) sent as the user turn only
      const aiResponse = await Promise.race([
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: visitorMessage,
          config: {
            systemInstruction: fullSystemInstruction,
          },
        }),
        timeoutPromise,
      ]);

      const rawText = aiResponse?.text || '';
      const cleanAiReply = sanitizeChatbotText(rawText, 600);

      const tokensIn =
        typeof aiResponse?.usageMetadata?.promptTokenCount === 'number'
          ? aiResponse.usageMetadata.promptTokenCount
          : null;
      const tokensOut =
        typeof aiResponse?.usageMetadata?.candidatesTokenCount === 'number'
          ? aiResponse.usageMetadata.candidatesTokenCount
          : null;

      // Log AI usage in chat_ai_usage
      db.prepare(
        `INSERT INTO chat_ai_usage (session_id, tokens_in, tokens_out, created_at)
         VALUES (?, ?, ?, datetime('now'))`
      ).run(sessionId, tokensIn, tokensOut);

      if (!cleanAiReply) {
        recordUnansweredQuestion(sessionId, visitorMessage);
        res.json({
          reply: fallbackReply,
          source: 'fallback',
          ai_label: null,
        });
        return;
      }

      // If the AI indicates the answer is not in the FAQ context, also save to chat_unanswered for the Admin
      if (
        /i don'?t know|not in the (provided )?context|outside (this )?scope|couldn'?t find/i.test(
          cleanAiReply
        )
      ) {
        recordUnansweredQuestion(sessionId, visitorMessage);
      }

      res.json({
        reply: cleanAiReply,
        source: 'ai',
        ai_label: CHATBOT_AI_SUBTLE_LABEL,
      });
    } catch {
      // Never log or expose the API key or raw upstream API error
      recordUnansweredQuestion(sessionId, visitorMessage);
      res.json({
        reply: fallbackReply,
        source: 'fallback',
        ai_label: null,
      });
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
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
      const appRow = db
        .prepare(
          'SELECT id, application_no, status, rejection_reason, freezer_no FROM franchisee_applications WHERE user_id = ?'
        )
        .get(user.id) as any;
      const effectiveStatus = normalizeApplicationStatus(appRow?.status || fr.status || 'Pending Admin Review');
      if (effectiveStatus === 'Pending Admin Review') {
        res.status(403).json({
          message:
            'Your account is not active yet. Your franchisee application is currently Pending Admin Review and cannot log in yet.',
        });
        return;
      }
      if (effectiveStatus === 'Rejected') {
        const reason = appRow?.rejection_reason || fr.rejection_reason || 'Please contact your recruiting agent.';
        res.status(403).json({
          message: `Your franchisee registration was Rejected: ${reason}`,
        });
        return;
      }
      franchisee = {
        ...fr,
        application_id: appRow?.id || null,
        application_no: appRow?.application_no || null,
        application_status: effectiveStatus,
        freezer_no: appRow?.freezer_no || '',
        can_order_replenishment: canFranchiseeOrderReplenishment(effectiveStatus),
      };
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
        full_name: String(user.full_name || '').trim() || 'User',
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
              application_id: franchisee.application_id,
              application_no: franchisee.application_no,
              application_status: franchisee.application_status,
              freezer_no: franchisee.freezer_no,
              can_order_replenishment: franchisee.can_order_replenishment,
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
      const fr = db
        .prepare(
          'SELECT id, owner_name, store_name, address, contact_number, lat, lng, status FROM franchisees WHERE user_id = ?'
        )
        .get(req.user!.id) as any;
      const appRow = db
        .prepare(
          'SELECT id, application_no, status, freezer_no FROM franchisee_applications WHERE user_id = ?'
        )
        .get(req.user!.id) as any;
      if (fr) {
        const effectiveStatus = normalizeApplicationStatus(
          appRow?.status || fr.status || 'Approved'
        );
        franchisee = {
          ...fr,
          application_id: appRow?.id || null,
          application_no: appRow?.application_no || null,
          application_status: effectiveStatus,
          freezer_no: appRow?.freezer_no || '',
          can_order_replenishment: canFranchiseeOrderReplenishment(effectiveStatus),
        };
      }
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
  const ensureActivePromoNotificationsForFranchisee = (
    userId: number,
    franchiseeId?: number
  ) => {
    if (!franchiseeId) return;
    const activePromos = db
      .prepare(
        `SELECT id, name, promo_type, tier_basis, discount_type, discount_value,
                min_order_amount, min_quantity, buy_quantity, free_quantity,
                free_delivery, max_discount_cap, start_date, end_date, recurring_monthly
         FROM promos
         WHERE status = 'Active'
           AND date(start_date) <= date('now')
           AND (date(end_date) >= date('now') OR COALESCE(recurring_monthly, 0) = 1)`
      )
      .all() as any[];

    for (const p of activePromos) {
      const targets = db
        .prepare('SELECT franchisee_id FROM promo_targets WHERE promo_id = ?')
        .all(p.id) as { franchisee_id: number }[];
      const isTargeted =
        targets.length === 0 ||
        targets.some((t) => Number(t.franchisee_id) === Number(franchiseeId));
      if (!isTargeted) continue;

      const existingNotif = db
        .prepare(
          "SELECT id FROM notifications WHERE user_id = ? AND type = 'promo' AND related_id = ?"
        )
        .get(userId, p.id);
      if (!existingNotif) {
        const preview = formatPromoHowItWorks(p);
        notifyUser(
          userId,
          `New Active Promo: ${p.name}`,
          `${preview}. Valid until ${String(p.end_date).slice(0, 10)}. Discount applies automatically at checkout!`,
          'promo',
          p.id
        );
      }
    }
  };

  api.get('/notifications/summary', (req, res) => {
    const user = req.user!;
    if (user.role === 'franchisee' && user.franchiseeId) {
      ensureActivePromoNotificationsForFranchisee(user.id, user.franchiseeId);
    }

    const unreadRow = db
      .prepare('SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND is_read = 0')
      .get(user.id) as { unread: number };
    const unread_total = Number(unreadRow?.unread || 0);

    const sections: Record<string, number> = {
      notifications: unread_total,
      [`/${user.role}/notifications`]: unread_total,
    };

    if (user.role === 'admin') {
      const pendingFranchisees = (
        db
          .prepare("SELECT COUNT(*) AS cnt FROM franchisees WHERE status = 'Pending'")
          .get() as { cnt: number }
      ).cnt;
      const placedOrders = (
        db
          .prepare("SELECT COUNT(*) AS cnt FROM orders WHERE status = 'Placed'")
          .get() as { cnt: number }
      ).cnt;
      const lowStockSkus = (
        db
          .prepare(
            `SELECT COUNT(*) AS cnt
             FROM inventory i
             JOIN products p ON p.id = i.product_id
             JOIN warehouses w ON w.id = i.warehouse_id
             WHERE p.is_active = 1 AND w.is_active = 1 AND i.quantity <= p.low_stock_threshold`
          )
          .get() as { cnt: number }
      ).cnt;

      sections.pending_approvals = pendingFranchisees;
      sections['/admin/pending-franchisees'] = pendingFranchisees;
      sections.replenishment_orders = placedOrders;
      sections['/admin/orders'] = placedOrders;
      sections.warehouse_inventory = lowStockSkus;
      sections['/admin/inventory'] = lowStockSkus;
    } else if (user.role === 'agent') {
      const unseenApprovals = (
        db
          .prepare(
            "SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = ? AND is_read = 0 AND type = 'approval'"
          )
          .get(user.id) as { cnt: number }
      ).cnt;

      sections.franchisees = unseenApprovals;
      sections.my_recruits = unseenApprovals;
      sections['/agent/dashboard'] = unseenApprovals;
    } else if (user.role === 'franchisee') {
      const unseenOrderChanges = (
        db
          .prepare(
            "SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = ? AND is_read = 0 AND type IN ('order', 'delivery', 'near')"
          )
          .get(user.id) as { cnt: number }
      ).cnt;
      const unseenPromos = (
        db
          .prepare(
            "SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = ? AND is_read = 0 AND type = 'promo'"
          )
          .get(user.id) as { cnt: number }
      ).cnt;

      sections.order_history = unseenOrderChanges;
      sections['/franchisee/orders'] = unseenOrderChanges;
      sections.product_catalog = unseenPromos;
      sections.promos = unseenPromos;
      sections['/franchisee/catalog'] = unseenPromos;
    } else if (user.role === 'delivery') {
      const assignedDeliveries = (
        db
          .prepare(
            "SELECT COUNT(*) AS cnt FROM deliveries WHERE delivery_staff_id = ? AND status = 'Assigned'"
          )
          .get(user.id) as { cnt: number }
      ).cnt;

      sections.assigned_deliveries = assignedDeliveries;
      sections.deliveries = assignedDeliveries;
      sections['/delivery/dashboard'] = assignedDeliveries;
    }

    res.json({
      unread_total,
      sections,
    });
  });

  api.get('/notifications', (req, res) => {
    const user = req.user!;
    if (user.role === 'franchisee' && user.franchiseeId) {
      ensureActivePromoNotificationsForFranchisee(user.id, user.franchiseeId);
    }

    const { page, limit, offset } = parsePagination(req.query);
    const totalRow = db
      .prepare('SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?')
      .get(user.id) as { total: number };
    const unreadRow = db
      .prepare('SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND is_read = 0')
      .get(user.id) as { unread: number };
    const rows = db
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?')
      .all(user.id, limit, offset);

    res.json({
      data: rows,
      unreadCount: unreadRow.unread,
      unread_total: unreadRow.unread,
      pagination: {
        page,
        limit,
        total: totalRow.total,
        totalPages: Math.ceil(totalRow.total / limit) || 1,
      },
    });
  });

  const handleMarkNotificationRead = (req: Request, res: Response) => {
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
  };

  api.post('/notifications/read-all', (req, res) => {
    const user = req.user!;
    const pathParam = req.body?.path ? String(req.body.path) : '';
    const explicitTypes: string[] = Array.isArray(req.body?.types)
      ? req.body.types.map((t: unknown) => String(t))
      : pathParam
      ? getNotificationTypesForRoute(user.role, pathParam)
      : ['*'];

    if (explicitTypes.includes('*')) {
      db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(
        user.id
      );
    } else if (explicitTypes.length > 0) {
      const placeholders = explicitTypes.map(() => '?').join(',');
      db.prepare(
        `UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0 AND type IN (${placeholders})`
      ).run(user.id, ...explicitTypes);
    }
    res.json({ message: 'Notifications marked as read.' });
  });

  api.post('/notifications/:id/read', handleMarkNotificationRead);
  api.patch('/notifications/:id/read', handleMarkNotificationRead);

  // ===== ADMIN: PUBLIC LANDING PAGE SETTINGS =====
  api.get('/admin/settings', authorize('admin'), (_req, res) => {
    res.json(getPublicSettingsMap());
  });

  api.put('/admin/settings', authorize('admin'), (req, res) => {
    const { contact_email, contact_phone, show_public_prices } = req.body || {};
    const upsert = db.prepare(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    );

    if (typeof contact_email === 'string' && contact_email.trim()) {
      upsert.run('contact_email', sanitizePublicText(contact_email));
    }
    if (typeof contact_phone === 'string' && contact_phone.trim()) {
      upsert.run('contact_phone', sanitizePublicText(contact_phone));
    }
    if (show_public_prices !== undefined) {
      upsert.run('show_public_prices', show_public_prices ? '1' : '0');
    }

    logActivity(
      req.user!.id,
      'PUBLIC_SETTINGS_UPDATED',
      'settings',
      null,
      'Updated public landing page settings'
    );
    res.json({
      message: 'Public landing page settings saved.',
      ...getPublicSettingsMap(),
    });
  });

  // ===== ADMIN: CHATBOT FAQs, UNANSWERED QUESTIONS & GEMINI AI FALLBACK STATUS =====
  api.get('/admin/chatbot-faqs', authorize('admin'), (_req, res) => {
    const aiEnabled = isChatbotAiConfigured(process.env);
    const hasApiKey = Boolean(
      process.env.GEMINI_API_KEY &&
        process.env.GEMINI_API_KEY.trim() &&
        process.env.GEMINI_API_KEY.trim() !== 'MY_GEMINI_API_KEY'
    );
    const envFlagEnabled = String(process.env.CHATBOT_AI_ENABLED || '').trim() === 'true';
    const dailyCap = parseChatbotDailyCap(process.env.CHATBOT_AI_DAILY_CAP);

    const todayRow = db
      .prepare(
        `SELECT COUNT(*) AS calls_today,
                COALESCE(SUM(tokens_in), 0) AS tokens_in_today,
                COALESCE(SUM(tokens_out), 0) AS tokens_out_today
         FROM chat_ai_usage
         WHERE date(created_at) = date('now')`
      )
      .get() as { calls_today: number; tokens_in_today: number; tokens_out_today: number };

    const totalRow = db
      .prepare('SELECT COUNT(*) AS total_calls FROM chat_ai_usage')
      .get() as { total_calls: number };

    const faqs = db
      .prepare(
        `SELECT id, question, answer, COALESCE(keywords, '') AS keywords, audience, sort_order, is_active, created_at
         FROM faqs
         ORDER BY sort_order ASC, id ASC`
      )
      .all();

    const unanswered = db
      .prepare(
        `SELECT id, session_id, question, status, resolved_faq_id, created_at
         FROM chat_unanswered
         ORDER BY CASE WHEN status = 'Open' THEN 0 ELSE 1 END ASC, id DESC
         LIMIT 100`
      )
      .all();

    res.json({
      ai_status: {
        enabled: aiEnabled,
        has_api_key: hasApiKey,
        env_flag_enabled: envFlagEnabled,
        calls_today: Number(todayRow?.calls_today || 0),
        daily_cap: dailyCap,
        tokens_in_today: Number(todayRow?.tokens_in_today || 0),
        tokens_out_today: Number(todayRow?.tokens_out_today || 0),
        total_calls_all_time: Number(totalRow?.total_calls || 0),
      },
      faqs,
      unanswered,
    });
  });

  api.post('/admin/chatbot-faqs', authorize('admin'), (req, res) => {
    const {
      question,
      answer,
      keywords,
      audience = 'all',
      sort_order = 0,
      is_active = 1,
      unanswered_id,
    } = req.body || {};

    const cleanQ = sanitizeChatbotText(question, 300);
    const cleanA = sanitizeChatbotText(answer, 1200);
    const cleanK = sanitizeChatbotText(keywords || '', 300);
    const cleanAud = sanitizeChatbotText(audience || 'all', 40) || 'all';
    const orderNum = Number.isFinite(Number(sort_order)) ? Number(sort_order) : 0;
    const activeInt = is_active ? 1 : 0;

    if (!cleanQ || !cleanA) {
      res.status(400).json({ message: 'Both question and answer are required.' });
      return;
    }

    const result = db
      .prepare(
        `INSERT INTO faqs (question, answer, keywords, audience, sort_order, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
      )
      .run(cleanQ, cleanA, cleanK, cleanAud, orderNum, activeInt);

    const newFaqId = Number(result.lastInsertRowid);

    if (unanswered_id && Number.isFinite(Number(unanswered_id))) {
      db.prepare(
        `UPDATE chat_unanswered
         SET status = 'Converted', resolved_faq_id = ?
         WHERE id = ?`
      ).run(newFaqId, Number(unanswered_id));
    }

    logActivity(
      req.user!.id,
      'FAQ_CREATED',
      'faq',
      newFaqId,
      `Created chatbot FAQ: ${cleanQ.slice(0, 60)}`
    );

    res.status(201).json({
      message: 'Chatbot FAQ created.',
      id: newFaqId,
    });
  });

  api.put('/admin/chatbot-faqs/:id', authorize('admin'), (req, res) => {
    const faqId = Number(req.params.id);
    const existing = db.prepare('SELECT id FROM faqs WHERE id = ?').get(faqId);
    if (!existing) {
      res.status(404).json({ message: 'FAQ not found.' });
      return;
    }

    const {
      question,
      answer,
      keywords,
      audience = 'all',
      sort_order = 0,
      is_active = 1,
    } = req.body || {};

    const cleanQ = sanitizeChatbotText(question, 300);
    const cleanA = sanitizeChatbotText(answer, 1200);
    const cleanK = sanitizeChatbotText(keywords || '', 300);
    const cleanAud = sanitizeChatbotText(audience || 'all', 40) || 'all';
    const orderNum = Number.isFinite(Number(sort_order)) ? Number(sort_order) : 0;
    const activeInt = is_active ? 1 : 0;

    if (!cleanQ || !cleanA) {
      res.status(400).json({ message: 'Both question and answer are required.' });
      return;
    }

    db.prepare(
      `UPDATE faqs
       SET question = ?, answer = ?, keywords = ?, audience = ?, sort_order = ?, is_active = ?
       WHERE id = ?`
    ).run(cleanQ, cleanA, cleanK, cleanAud, orderNum, activeInt, faqId);

    logActivity(
      req.user!.id,
      'FAQ_UPDATED',
      'faq',
      faqId,
      `Updated chatbot FAQ #${faqId}`
    );

    res.json({ message: 'Chatbot FAQ updated.' });
  });

  api.delete('/admin/chatbot-faqs/:id', authorize('admin'), (req, res) => {
    const faqId = Number(req.params.id);
    db.prepare('DELETE FROM faqs WHERE id = ?').run(faqId);
    logActivity(req.user!.id, 'FAQ_DELETED', 'faq', faqId, `Deleted chatbot FAQ #${faqId}`);
    res.json({ message: 'Chatbot FAQ deleted.' });
  });

  api.delete('/admin/chatbot-unanswered/:id', authorize('admin'), (req, res) => {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM chat_unanswered WHERE id = ?').run(id);
    res.json({ message: 'Unanswered question removed.' });
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

  // ===== DIGITIZED "NEW FRANCHISEE FORM" (AICE COTABATO-JCDL CORPORATION) =====
  const getNextApplicationNo = (): string => {
    const year = new Date().getFullYear();
    const maxRow = db
      .prepare('SELECT COALESCE(MAX(id), 0) AS max_id FROM franchisee_applications')
      .get() as { max_id: number };
    let seq = Number(maxRow?.max_id || 0) + 1;
    for (let i = 0; i < 50; i++) {
      const candidate = formatApplicationNumber(year, seq + i);
      const exists = db
        .prepare('SELECT id FROM franchisee_applications WHERE application_no = ?')
        .get(candidate);
      if (!exists) return candidate;
    }
    return formatApplicationNumber(year, Date.now() % 100000);
  };

  const findDuplicateApplicationFields = (
    contactNumberRaw: string,
    emailRaw: string,
    storeNameRaw: string,
    excludeApplicationId?: number | null,
    excludeFranchiseeId?: number | null,
    excludeUserId?: number | null
  ): Record<string, string> => {
    const errors: Record<string, string> = {};
    const normContact = normalizePhMobileNumber(contactNumberRaw || '');
    const cleanEmail = String(emailRaw || '').trim().toLowerCase();
    const cleanStore = String(storeNameRaw || '').trim().toLowerCase();

    const appExclId = Number(excludeApplicationId || 0);
    const frExclId = Number(excludeFranchiseeId || 0);
    const uExclId = Number(excludeUserId || 0);

    if (normContact) {
      const dupAppContact = db
        .prepare(
          `SELECT id, application_no, store_name
           FROM franchisee_applications
           WHERE id != ?
             AND (REPLACE(REPLACE(contact_number, ' ', ''), '-', '') = ?
               OR REPLACE(REPLACE(contact_number, ' ', ''), '-', '') = ?)`
        )
        .get(
          appExclId,
          normContact,
          normContact.startsWith('09') ? `+63${normContact.slice(1)}` : normContact
        ) as { id: number; application_no: string; store_name: string } | undefined;

      const dupUserContact = db
        .prepare(
          `SELECT id, username
           FROM users
           WHERE id != ?
             AND (REPLACE(REPLACE(COALESCE(contact_number, ''), ' ', ''), '-', '') = ?)`
        )
        .get(uExclId, normContact) as { id: number; username: string } | undefined;

      if (dupAppContact || dupUserContact) {
        errors.contact_number = 'This mobile contact number is already registered to another account/application.';
      }
    }

    if (cleanEmail) {
      const dupAppEmail = db
        .prepare(
          `SELECT id FROM franchisee_applications
           WHERE id != ? AND LOWER(TRIM(email)) = ?`
        )
        .get(appExclId, cleanEmail);
      const dupUserEmail = db
        .prepare(
          `SELECT id FROM users
           WHERE id != ? AND LOWER(TRIM(COALESCE(email, ''))) = ?`
        )
        .get(uExclId, cleanEmail);
      if (dupAppEmail || dupUserEmail) {
        errors.email = 'This email address is already registered to another user or application.';
      }
    }

    if (cleanStore) {
      const dupAppStore = db
        .prepare(
          `SELECT id FROM franchisee_applications
           WHERE id != ? AND LOWER(TRIM(store_name)) = ?`
        )
        .get(appExclId, cleanStore);
      const dupFrStore = db
        .prepare(
          `SELECT id FROM franchisees
           WHERE id != ? AND LOWER(TRIM(store_name)) = ?`
        )
        .get(frExclId, cleanStore);
      if (dupAppStore || dupFrStore) {
        errors.store_name = 'A franchisee store with this store name already exists.';
      }
    }

    return errors;
  };

  const hydrateApplicationRecord = (appRow: any) => {
    if (!appRow) return null;
    const eqRows = db
      .prepare(
        `SELECT id, application_id, item, condition, quantity, freezer_no, updated_at
         FROM franchisee_equipment
         WHERE application_id = ?`
      )
      .all(appRow.id) as any[];

    const eqMap: Record<string, any> = {};
    for (const r of eqRows) {
      eqMap[r.item] = r;
    }

    const equipment = FRANCHISEE_EQUIPMENT_ITEMS.map((itemName) => {
      const found = eqMap[itemName];
      const cond = (found?.condition || 'NOT_ISSUED') as 'NEW' | 'OLD' | 'NOT_ISSUED';
      return {
        item_name: itemName,
        item: itemName,
        item_condition: cond,
        condition_status: cond,
        condition: cond,
        quantity: Number(found?.quantity || 0),
        freezer_no:
          itemName === 'Freezer'
            ? String(found?.freezer_no || appRow.freezer_no || '')
            : String(found?.freezer_no || ''),
        updated_at: found?.updated_at || null,
      };
    });

    const sigRows = db
      .prepare(
        `SELECT fs.id, fs.application_id, fs.role, fs.printed_name, fs.signature_image,
                fs.signed_by_user_id, fs.signed_at, u.full_name AS signed_by_user_name
         FROM franchisee_signatures fs
         LEFT JOIN users u ON u.id = fs.signed_by_user_id
         WHERE fs.application_id = ?`
      )
      .all(appRow.id) as any[];

    const signatures: Record<string, any> = {};
    for (const s of sigRows) {
      signatures[s.role] = {
        ...s,
        signature_data: s.signature_image,
      };
    }

    const normalizedStatus = normalizeApplicationStatus(appRow.status);

    return {
      ...appRow,
      id: Number(appRow.id),
      application_id: Number(appRow.id),
      franchisee_id: Number(appRow.franchisee_id),
      user_id: Number(appRow.user_id),
      agent_id: Number(appRow.agent_id),
      owner_name: appRow.complete_name || appRow.owner_name,
      address: appRow.full_address || appRow.address,
      status: normalizedStatus,
      application_status: normalizedStatus,
      legacy_status:
        appRow.franchisee_status ||
        (normalizedStatus === 'Pending Admin Review'
          ? 'Pending'
          : normalizedStatus === 'Rejected'
          ? 'Rejected'
          : 'Approved'),
      assigned_delivery_staff_name: appRow.assigned_delivery_name || null,
      assigned_delivery_staff_contact: appRow.assigned_delivery_contact || null,
      can_login: canFranchiseeLogin(normalizedStatus),
      can_order_replenishment: canFranchiseeOrderReplenishment(normalizedStatus),
      equipment,
      signatures,
      signatures_by_role: signatures,
      signatures_list: sigRows,
    };
  };

  const getHydratedApplicationBy = (
    column: 'fa.id' | 'fa.franchisee_id' | 'fa.user_id',
    idVal: number
  ) => {
    const row = db
      .prepare(
        `SELECT fa.*,
                f.status AS franchisee_status,
                u.username, u.is_active,
                au.full_name AS agent_name, au.username AS agent_username, au.contact_number AS agent_contact,
                du.full_name AS assigned_delivery_name, du.username AS assigned_delivery_username, du.contact_number AS assigned_delivery_contact,
                apu.full_name AS approved_by_name
         FROM franchisee_applications fa
         JOIN franchisees f ON f.id = fa.franchisee_id
         JOIN users u ON u.id = fa.user_id
         JOIN agents a ON a.id = fa.agent_id
         JOIN users au ON au.id = a.user_id
         LEFT JOIN users du ON du.id = fa.assigned_delivery_user_id
         LEFT JOIN users apu ON apu.id = fa.approved_by
         WHERE ${column} = ?`
      )
      .get(idVal) as any;

    return hydrateApplicationRecord(row);
  };

  const resolveApplicationByParamId = (rawId: number) => {
    return (
      getHydratedApplicationBy('fa.id', rawId) ||
      getHydratedApplicationBy('fa.franchisee_id', rawId)
    );
  };

  const upsertSignatureRow = (
    applicationId: number,
    role: 'customer' | 'sales_agent' | 'delivery_team' | 'driver' | 'collector' | 'noted_by',
    printedName: string,
    signatureImage: string | null | undefined,
    signedByUserId: number | null
  ) => {
    const cleanName = String(printedName || '').trim();
    const cleanImg = signatureImage && String(signatureImage).trim() ? String(signatureImage).trim() : '';
    if (!cleanName && !cleanImg) return;
    db.prepare(
      `INSERT INTO franchisee_signatures (application_id, role, printed_name, signature_image, signed_by_user_id, signed_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(application_id, role) DO UPDATE SET
         printed_name = CASE WHEN excluded.printed_name != '' THEN excluded.printed_name ELSE franchisee_signatures.printed_name END,
         signature_image = CASE WHEN excluded.signature_image != '' THEN excluded.signature_image ELSE franchisee_signatures.signature_image END,
         signed_by_user_id = COALESCE(excluded.signed_by_user_id, franchisee_signatures.signed_by_user_id),
         signed_at = datetime('now')`
    ).run(applicationId, role, cleanName, cleanImg, signedByUserId);
  };

  // Duplicate check endpoint for Agent registration wizard
  api.get(
    '/franchisee-applications/check-duplicate',
    authorize('agent', 'admin'),
    requireWarehouse,
    (req, res) => {
      const contactNumber = String(req.query.contact_number || '').trim();
      const email = String(req.query.email || '').trim();
      const storeName = String(req.query.store_name || '').trim();
      const excludeAppId = req.query.exclude_id ? Number(req.query.exclude_id) : null;

      let exclFrId: number | null = null;
      let exclUserId: number | null = null;
      if (excludeAppId) {
        const cur = resolveApplicationByParamId(excludeAppId);
        if (cur) {
          exclFrId = cur.franchisee_id;
          exclUserId = cur.user_id;
        }
      }

      const errors = findDuplicateApplicationFields(
        contactNumber,
        email,
        storeName,
        excludeAppId,
        exclFrId,
        exclUserId
      );

      res.json({
        hasDuplicates: Object.keys(errors).length > 0,
        errors,
      });
    }
  );

  // Active Delivery Staff options for Admin to assign equipment delivery
  api.get(
    '/franchisee-applications/delivery-staff-options',
    authorize('admin'),
    requireWarehouse,
    (_req, res) => {
      const riders = db
        .prepare(
          `SELECT u.id, u.full_name, u.username, u.contact_number
           FROM users u
           JOIN roles r ON r.id = u.role_id
           WHERE r.name = 'delivery' AND u.is_active = 1
           ORDER BY u.full_name ASC`
        )
        .all();
      res.json({ data: riders });
    }
  );

  // Franchisee read-only view of their own registration & equipment record
  api.get(
    '/franchisee-applications/my',
    authorize('franchisee'),
    requireWarehouse,
    (req, res) => {
      const record = getHydratedApplicationBy('fa.user_id', req.user!.id);
      if (!record) {
        res.status(404).json({ message: 'Franchisee application record not found.' });
        return;
      }
      res.json({ data: record });
    }
  );

  // Handler for creating a new franchisee application (used by POST /api/franchisee-applications and POST /api/agent/franchisees)
  const handleCreateFranchiseeApplication = (req: Request, res: Response) => {
    const body = req.body || {};

    // Support both structured Section 1 fields and legacy owner_name/address fallback
    const todayStr = (db.prepare("SELECT date('now') AS d").get() as { d: string }).d;
    const dateApplied = String(body.date_applied || todayStr).trim().slice(0, 10);

    let firstName = String(body.first_name || '').trim();
    let middleName = String(body.middle_name || '').trim();
    let lastName = String(body.last_name || '').trim();
    if ((!firstName || !lastName) && body.owner_name) {
      const parts = String(body.owner_name).trim().split(/\s+/);
      firstName = firstName || parts[0] || '';
      lastName = lastName || (parts.length > 1 ? parts.slice(1).join(' ') : parts[0] || '');
    }

    let street = String(body.street || '').trim();
    let barangay = String(body.barangay || '').trim();
    let cityMunicipality = String(body.city_municipality || '').trim();
    let province = String(body.province || '').trim();
    if ((!street || !barangay || !cityMunicipality || !province) && body.address) {
      const addrParts = String(body.address)
        .split(',')
        .map((p: string) => p.trim())
        .filter(Boolean);
      street = street || addrParts[0] || String(body.address).trim();
      barangay = barangay || addrParts[1] || ' Poblacion';
      cityMunicipality = cityMunicipality || addrParts[2] || 'Cotabato City';
      province = province || addrParts[3] || 'Maguindanao del Norte';
    }

    const storeName = String(body.store_name || '').trim();
    const contactNumberRaw = String(body.contact_number || '').trim();
    const landmark = String(body.landmark || 'Near main thoroughfare').trim();
    const facebookAccount = String(body.facebook_account || '').trim();
    const email = String(body.email || '').trim();
    const remarks = String(body.remarks || 'New franchisee application submitted by Sales Agent.').trim();
    const initialPassword = String(body.initial_password || '');
    const lat = Number(body.lat);
    const lng = Number(body.lng);

    const step1Check = validateFranchiseeStep1(
      {
        date_applied: dateApplied,
        first_name: firstName,
        middle_name: middleName,
        last_name: lastName,
        contact_number: contactNumberRaw,
        store_name: storeName,
        email,
        facebook_account: facebookAccount,
        remarks,
        initial_password: initialPassword,
      },
      true
    );

    const step2Check = validateFranchiseeStep2({
      street,
      barangay,
      city_municipality: cityMunicipality,
      province,
      landmark,
      lat,
      lng,
    });

    const combinedErrors: Record<string, string> = {
      ...step1Check.errors,
      ...step2Check.errors,
    };

    if (Object.keys(combinedErrors).length > 0) {
      if (req.file) deleteUploadedFile(`/uploads/stores/${req.file.filename}`);
      const firstErrMsg = Object.values(combinedErrors)[0];
      res.status(400).json({
        message: firstErrMsg,
        errors: combinedErrors,
      });
      return;
    }

    const dupErrors = findDuplicateApplicationFields(contactNumberRaw, email, storeName);
    if (Object.keys(dupErrors).length > 0) {
      if (req.file) deleteUploadedFile(`/uploads/stores/${req.file.filename}`);
      const firstDupMsg = Object.values(dupErrors)[0];
      res.status(409).json({
        message: firstDupMsg,
        errors: dupErrors,
      });
      return;
    }

    const normalizedContact = normalizePhMobileNumber(contactNumberRaw);
    const completeName = composeApplicantFullName(firstName, middleName, lastName);
    const fullAddress = composeStoreFullAddress(street, barangay, cityMunicipality, province);
    const username = generateFranchiseeUsername(completeName, storeName);
    const applicationNo = getNextApplicationNo();
    const hash = bcrypt.hashSync(initialPassword, 10);
    const storePhotoUrl = req.file ? `/uploads/stores/${req.file.filename}` : null;

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
          completeName,
          email,
          normalizedContact
        );
      const newUserId = Number(uRes.lastInsertRowid);

      const fRes = db
        .prepare(
          `INSERT INTO franchisees (user_id, agent_id, owner_name, store_name, address, contact_number, lat, lng, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending')`
        )
        .run(
          newUserId,
          req.user!.agentId,
          completeName,
          storeName,
          fullAddress,
          normalizedContact,
          lat,
          lng
        );
      const newFranchiseeId = Number(fRes.lastInsertRowid);

      const appRes = db
        .prepare(
          `INSERT INTO franchisee_applications (
             application_no, franchisee_id, user_id, agent_id, date_applied,
             first_name, middle_name, last_name, complete_name, contact_number,
             store_name, street, barangay, city_municipality, province, full_address,
             landmark, facebook_account, email, remarks, lat, lng, store_photo_url,
             freezer_no, status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'Pending Admin Review', datetime('now'), datetime('now'))`
        )
        .run(
          applicationNo,
          newFranchiseeId,
          newUserId,
          req.user!.agentId,
          dateApplied,
          firstName,
          middleName,
          lastName,
          completeName,
          normalizedContact,
          storeName,
          street,
          barangay,
          cityMunicipality,
          province,
          fullAddress,
          landmark,
          facebookAccount,
          email,
          remarks,
          lat,
          lng,
          storePhotoUrl
        );
      const newAppId = Number(appRes.lastInsertRowid);

      // Initialize the 6 equipment checklist items as NOT_ISSUED (to be completed by Delivery Staff at delivery)
      const insEq = db.prepare(
        `INSERT INTO franchisee_equipment (application_id, item, condition, quantity, freezer_no)
         VALUES (?, ?, 'NOT_ISSUED', 0, '')`
      );
      for (const itemName of FRANCHISEE_EQUIPMENT_ITEMS) {
        insEq.run(newAppId, itemName);
      }

      // Record Sales Agent auto-filled sign-off in Section 3
      upsertSignatureRow(
        newAppId,
        'sales_agent',
        req.user!.full_name,
        body.sales_agent_signature || null,
        req.user!.id
      );

      notifyAdmins(
        `New Franchisee Application (${applicationNo})`,
        `Sales Agent ${req.user!.full_name} submitted NEW FRANCHISEE FORM ${applicationNo} for "${storeName}" (${completeName}). Waiting for Admin review.`,
        'approval',
        newAppId
      );

      logActivity(
        req.user!.id,
        'FRANCHISEE_REGISTERED',
        'franchisee',
        newFranchiseeId,
        `Submitted application ${applicationNo} for ${storeName}`
      );

      return { newAppId, newFranchiseeId };
    });

    const { newAppId, newFranchiseeId } = tx();
    const hydrated = getHydratedApplicationBy('fa.id', newAppId);

    res.status(201).json({
      message: `Franchisee application ${applicationNo} submitted for Admin review.`,
      applicationId: newAppId,
      applicationNo,
      franchiseeId: newFranchiseeId,
      generatedUsername: username,
      application: hydrated,
    });
  };

  api.post(
    '/franchisee-applications',
    authorize('agent'),
    requireWarehouse,
    uploadStoreImage.single('store_photo'),
    handleCreateFranchiseeApplication
  );

  api.post(
    '/agent/franchisees',
    authorize('agent'),
    requireWarehouse,
    uploadStoreImage.single('store_photo'),
    handleCreateFranchiseeApplication
  );

  // List franchisee applications (role-filtered for Admin, Agent, Delivery Staff, Franchisee)
  const handleListFranchiseeApplications = (req: Request, res: Response) => {
    const { page, limit, offset } = parsePagination(req.query);
    const search = `%${String(req.query.search || '').trim()}%`;
    const statusParam = String(req.query.status || '').trim();

    const params: any[] = [search, search, search, search, search];
    let where =
      'WHERE (fa.store_name LIKE ? OR fa.complete_name LIKE ? OR fa.application_no LIKE ? OR u.username LIKE ? OR fa.city_municipality LIKE ?)';

    if (req.user!.role === 'agent') {
      where += ' AND fa.agent_id = ?';
      params.push(req.user!.agentId);
    } else if (req.user!.role === 'delivery') {
      if (req.query.all_for_delivery === '1') {
        where += " AND (fa.assigned_delivery_user_id = ? OR fa.status IN ('For Delivery', 'Delivered', 'Active'))";
        params.push(req.user!.id);
      } else {
        where += ' AND fa.assigned_delivery_user_id = ?';
        params.push(req.user!.id);
      }
    } else if (req.user!.role === 'franchisee') {
      where += ' AND fa.user_id = ?';
      params.push(req.user!.id);
    }

    if (statusParam) {
      if (statusParam === 'Pending' || statusParam === 'Pending Admin Review') {
        where += " AND fa.status = 'Pending Admin Review'";
      } else if (statusParam === 'Approved_Group') {
        where += " AND fa.status IN ('Approved', 'For Delivery', 'Delivered', 'Active')";
      } else if (
        ['Approved', 'Rejected', 'For Delivery', 'Delivered', 'Active'].includes(statusParam)
      ) {
        where += ' AND fa.status = ?';
        params.push(statusParam);
      }
    }

    const totalRow = db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM franchisee_applications fa
         JOIN users u ON u.id = fa.user_id
         ${where}`
      )
      .get(...params) as { total: number };

    const rawRows = db
      .prepare(
        `SELECT fa.*,
                f.status AS franchisee_status,
                u.username, u.is_active,
                au.full_name AS agent_name, au.username AS agent_username, au.contact_number AS agent_contact,
                du.full_name AS assigned_delivery_name, du.username AS assigned_delivery_username, du.contact_number AS assigned_delivery_contact,
                apu.full_name AS approved_by_name
         FROM franchisee_applications fa
         JOIN franchisees f ON f.id = fa.franchisee_id
         JOIN users u ON u.id = fa.user_id
         JOIN agents a ON a.id = fa.agent_id
         JOIN users au ON au.id = a.user_id
         LEFT JOIN users du ON du.id = fa.assigned_delivery_user_id
         LEFT JOIN users apu ON apu.id = fa.approved_by
         ${where}
         ORDER BY fa.id DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as any[];

    const data = rawRows.map((r) => hydrateApplicationRecord(r));

    // Role-scoped summary counts
    let summaryWhere = 'WHERE 1=1';
    const summaryParams: any[] = [];
    if (req.user!.role === 'agent') {
      summaryWhere += ' AND agent_id = ?';
      summaryParams.push(req.user!.agentId);
    } else if (req.user!.role === 'delivery') {
      summaryWhere += ' AND assigned_delivery_user_id = ?';
      summaryParams.push(req.user!.id);
    } else if (req.user!.role === 'franchisee') {
      summaryWhere += ' AND user_id = ?';
      summaryParams.push(req.user!.id);
    }

    const counts = db
      .prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN status = 'Pending Admin Review' THEN 1 ELSE 0 END), 0) AS pending,
                COALESCE(SUM(CASE WHEN status = 'Pending Admin Review' THEN 1 ELSE 0 END), 0) AS pending_review,
                COALESCE(SUM(CASE WHEN status IN ('Approved', 'For Delivery', 'Delivered', 'Active') THEN 1 ELSE 0 END), 0) AS approved,
                COALESCE(SUM(CASE WHEN status = 'Approved' THEN 1 ELSE 0 END), 0) AS approved_only,
                COALESCE(SUM(CASE WHEN status = 'For Delivery' THEN 1 ELSE 0 END), 0) AS for_delivery,
                COALESCE(SUM(CASE WHEN status = 'Delivered' THEN 1 ELSE 0 END), 0) AS delivered,
                COALESCE(SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END), 0) AS active,
                COALESCE(SUM(CASE WHEN status = 'Rejected' THEN 1 ELSE 0 END), 0) AS rejected
         FROM franchisee_applications
         ${summaryWhere}`
      )
      .get(...summaryParams);

    res.json({
      data,
      summary: counts,
      pagination: {
        page,
        limit,
        total: totalRow.total,
        totalPages: Math.ceil(totalRow.total / limit) || 1,
      },
    });
  };

  api.get(
    '/franchisee-applications',
    authorize('admin', 'agent', 'delivery', 'franchisee'),
    requireWarehouse,
    handleListFranchiseeApplications
  );

  api.get('/agent/recruits', authorize('agent'), requireWarehouse, handleListFranchiseeApplications);
  api.get('/admin/franchisees', authorize('admin'), requireWarehouse, handleListFranchiseeApplications);

  // Single application details
  api.get(
    '/franchisee-applications/:id',
    authorize('admin', 'agent', 'delivery', 'franchisee'),
    requireWarehouse,
    (req, res) => {
      const record = resolveApplicationByParamId(Number(req.params.id));
      if (!record) {
        res.status(404).json({ message: 'Franchisee application not found.' });
        return;
      }

      if (req.user!.role === 'agent' && record.agent_id !== req.user!.agentId) {
        res.status(403).json({ message: 'Forbidden: you can only view your own recruits.' });
        return;
      }
      if (req.user!.role === 'franchisee' && record.user_id !== req.user!.id) {
        res.status(403).json({ message: 'Forbidden: you can only view your own registration form.' });
        return;
      }

      res.json({ data: record });
    }
  );

  // Full application payload formatted for official paper form print & PDF export
  api.get(
    '/franchisee-applications/:id/pdf',
    authorize('admin', 'agent', 'delivery', 'franchisee'),
    requireWarehouse,
    (req, res) => {
      const record = resolveApplicationByParamId(Number(req.params.id));
      if (!record) {
        res.status(404).json({ message: 'Franchisee application not found.' });
        return;
      }
      if (req.user!.role === 'agent' && record.agent_id !== req.user!.agentId) {
        res.status(403).json({ message: 'Forbidden.' });
        return;
      }
      if (req.user!.role === 'franchisee' && record.user_id !== req.user!.id) {
        res.status(403).json({ message: 'Forbidden.' });
        return;
      }

      res.json({
        company_header: 'AICE COTABATO-JCDL CORPORATION',
        form_banner: 'NEW FRANCHISEE FORM',
        generated_at: new Date().toISOString(),
        data: record,
      });
    }
  );

  // Agent edits an application while it is still "Pending Admin Review"
  api.put(
    '/franchisee-applications/:id',
    authorize('agent'),
    requireWarehouse,
    uploadStoreImage.single('store_photo'),
    (req, res) => {
      const record = resolveApplicationByParamId(Number(req.params.id));
      if (!record) {
        if (req.file) deleteUploadedFile(`/uploads/stores/${req.file.filename}`);
        res.status(404).json({ message: 'Franchisee application not found.' });
        return;
      }

      if (record.agent_id !== req.user!.agentId) {
        if (req.file) deleteUploadedFile(`/uploads/stores/${req.file.filename}`);
        res.status(403).json({ message: 'You can only edit applications you registered.' });
        return;
      }

      if (record.status !== 'Pending Admin Review') {
        if (req.file) deleteUploadedFile(`/uploads/stores/${req.file.filename}`);
        res.status(400).json({
          message: `Application ${record.application_no} is already "${record.status}" and can no longer be edited by the Agent.`,
        });
        return;
      }

      const body = req.body || {};
      const dateApplied = String(body.date_applied || record.date_applied).trim().slice(0, 10);
      const firstName = String(body.first_name ?? record.first_name).trim();
      const middleName = String(body.middle_name ?? record.middle_name).trim();
      const lastName = String(body.last_name ?? record.last_name).trim();
      const contactNumberRaw = String(body.contact_number ?? record.contact_number).trim();
      const storeName = String(body.store_name ?? record.store_name).trim();
      const street = String(body.street ?? record.street).trim();
      const barangay = String(body.barangay ?? record.barangay).trim();
      const cityMunicipality = String(body.city_municipality ?? record.city_municipality).trim();
      const province = String(body.province ?? record.province).trim();
      const landmark = String(body.landmark ?? record.landmark).trim();
      const facebookAccount = String(body.facebook_account ?? record.facebook_account).trim();
      const email = String(body.email ?? record.email).trim();
      const remarks = String(body.remarks ?? record.remarks).trim();
      const initialPassword = body.initial_password ? String(body.initial_password) : '';
      const lat = body.lat !== undefined ? Number(body.lat) : Number(record.lat);
      const lng = body.lng !== undefined ? Number(body.lng) : Number(record.lng);

      const step1Check = validateFranchiseeStep1(
        {
          date_applied: dateApplied,
          first_name: firstName,
          middle_name: middleName,
          last_name: lastName,
          contact_number: contactNumberRaw,
          store_name: storeName,
          email,
          facebook_account: facebookAccount,
          remarks,
          initial_password: initialPassword,
        },
        false
      );

      const step2Check = validateFranchiseeStep2({
        street,
        barangay,
        city_municipality: cityMunicipality,
        province,
        landmark,
        lat,
        lng,
      });

      const combinedErrors: Record<string, string> = {
        ...step1Check.errors,
        ...step2Check.errors,
      };

      if (Object.keys(combinedErrors).length > 0) {
        if (req.file) deleteUploadedFile(`/uploads/stores/${req.file.filename}`);
        res.status(400).json({
          message: Object.values(combinedErrors)[0],
          errors: combinedErrors,
        });
        return;
      }

      const dupErrors = findDuplicateApplicationFields(
        contactNumberRaw,
        email,
        storeName,
        record.id,
        record.franchisee_id,
        record.user_id
      );

      if (Object.keys(dupErrors).length > 0) {
        if (req.file) deleteUploadedFile(`/uploads/stores/${req.file.filename}`);
        res.status(409).json({
          message: Object.values(dupErrors)[0],
          errors: dupErrors,
        });
        return;
      }

      const normalizedContact = normalizePhMobileNumber(contactNumberRaw);
      const completeName = composeApplicantFullName(firstName, middleName, lastName);
      const fullAddress = composeStoreFullAddress(street, barangay, cityMunicipality, province);

      let storePhotoUrl: string | null = record.store_photo_url;
      if (body.remove_store_photo === 'true') {
        deleteUploadedFile(record.store_photo_url);
        storePhotoUrl = null;
      }
      if (req.file) {
        deleteUploadedFile(record.store_photo_url);
        storePhotoUrl = `/uploads/stores/${req.file.filename}`;
      }

      const tx = db.transaction(() => {
        if (initialPassword) {
          const hash = bcrypt.hashSync(initialPassword, 10);
          db.prepare(
            "UPDATE users SET full_name = ?, email = ?, contact_number = ?, password_hash = ?, updated_at = datetime('now') WHERE id = ?"
          ).run(completeName, email, normalizedContact, hash, record.user_id);
        } else {
          db.prepare(
            "UPDATE users SET full_name = ?, email = ?, contact_number = ?, updated_at = datetime('now') WHERE id = ?"
          ).run(completeName, email, normalizedContact, record.user_id);
        }

        db.prepare(
          `UPDATE franchisees
           SET owner_name = ?, store_name = ?, address = ?, contact_number = ?, lat = ?, lng = ?
           WHERE id = ?`
        ).run(
          completeName,
          storeName,
          fullAddress,
          normalizedContact,
          lat,
          lng,
          record.franchisee_id
        );

        db.prepare(
          `UPDATE franchisee_applications
           SET date_applied = ?, first_name = ?, middle_name = ?, last_name = ?, complete_name = ?,
               contact_number = ?, store_name = ?, street = ?, barangay = ?, city_municipality = ?,
               province = ?, full_address = ?, landmark = ?, facebook_account = ?, email = ?,
               remarks = ?, lat = ?, lng = ?, store_photo_url = ?, updated_at = datetime('now')
           WHERE id = ?`
        ).run(
          dateApplied,
          firstName,
          middleName,
          lastName,
          completeName,
          normalizedContact,
          storeName,
          street,
          barangay,
          cityMunicipality,
          province,
          fullAddress,
          landmark,
          facebookAccount,
          email,
          remarks,
          lat,
          lng,
          storePhotoUrl,
          record.id
        );

        if (body.sales_agent_signature) {
          upsertSignatureRow(
            record.id,
            'sales_agent',
            req.user!.full_name,
            body.sales_agent_signature,
            req.user!.id
          );
        }

        logActivity(
          req.user!.id,
          'FRANCHISEE_APPLICATION_UPDATED',
          'franchisee',
          record.franchisee_id,
          `Updated application ${record.application_no} for ${storeName}`
        );
      });

      tx();
      const updated = getHydratedApplicationBy('fa.id', record.id);
      res.json({
        message: `Application ${record.application_no} updated successfully.`,
        application: updated,
      });
    }
  );

  // Admin review: Approve or Reject application (with optional immediate delivery assignment & Noted By signature)
  const handleAdminReviewApplication = (req: Request, res: Response) => {
    const record = resolveApplicationByParamId(Number(req.params.id));
    if (!record) {
      res.status(404).json({ message: 'Franchisee application not found.' });
      return;
    }

    const {
      decision,
      rejection_reason,
      assigned_delivery_user_id,
      cashier_name,
      collector_name,
      collector_signature,
      noted_by_name,
      noted_by_signature,
      freezer_no,
    } = req.body || {};

    if (!['Approved', 'Rejected'].includes(decision)) {
      res.status(400).json({ message: 'Decision must be Approved or Rejected.' });
      return;
    }
    if (decision === 'Rejected' && (!rejection_reason || !String(rejection_reason).trim())) {
      res.status(400).json({
        message: 'Please provide a rejection reason when rejecting a franchisee application.',
      });
      return;
    }
    if (record.status !== 'Pending Admin Review') {
      res.status(400).json({
        message: `Application ${record.application_no} is already "${record.status}".`,
      });
      return;
    }

    const agRow = db
      .prepare('SELECT user_id FROM agents WHERE id = ?')
      .get(record.agent_id) as { user_id: number } | undefined;

    const riderId =
      decision === 'Approved' && assigned_delivery_user_id ? Number(assigned_delivery_user_id) : null;
    const nextAppStatus =
      decision === 'Rejected'
        ? 'Rejected'
        : riderId
        ? 'For Delivery'
        : 'Approved';

    const cleanNotedBy = String(noted_by_name || req.user!.full_name || '').trim();
    const cleanCashier = String(cashier_name ?? record.cashier_name ?? '').trim();
    const cleanCollector = String(collector_name ?? record.collector_name ?? '').trim();
    const cleanFreezerNo = String(freezer_no ?? record.freezer_no ?? '').trim();

    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE franchisees
         SET status = ?, rejection_reason = ?, approved_by = ?, approved_at = datetime('now')
         WHERE id = ?`
      ).run(
        decision === 'Rejected' ? 'Rejected' : 'Approved',
        decision === 'Rejected' ? String(rejection_reason).trim() : null,
        req.user!.id,
        record.franchisee_id
      );

      db.prepare(
        `UPDATE franchisee_applications
         SET status = ?,
             rejection_reason = ?,
             approved_by = ?,
             approved_at = datetime('now'),
             assigned_delivery_user_id = COALESCE(?, assigned_delivery_user_id),
             assigned_at = CASE WHEN ? IS NOT NULL THEN datetime('now') ELSE assigned_at END,
             cashier_name = ?,
             collector_name = ?,
             noted_by_name = ?,
             freezer_no = ?,
             updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        nextAppStatus,
        decision === 'Rejected' ? String(rejection_reason).trim() : null,
        req.user!.id,
        riderId,
        riderId,
        cleanCashier,
        cleanCollector,
        cleanNotedBy,
        cleanFreezerNo,
        record.id
      );

      if (cleanFreezerNo) {
        db.prepare(
          `UPDATE franchisee_equipment
           SET freezer_no = ?
           WHERE application_id = ? AND item = 'Freezer'`
        ).run(cleanFreezerNo, record.id);
      }

      if (decision === 'Approved') {
        upsertSignatureRow(
          record.id,
          'noted_by',
          cleanNotedBy,
          noted_by_signature || null,
          req.user!.id
        );
      }

      if (cleanCollector || collector_signature) {
        upsertSignatureRow(
          record.id,
          'collector',
          cleanCollector,
          collector_signature || null,
          req.user!.id
        );
      }

      if (agRow?.user_id) {
        notifyUser(
          agRow.user_id,
          `Application ${record.application_no} ${nextAppStatus}`,
          decision === 'Approved'
            ? `Your recruit "${record.store_name}" (${record.application_no}) has been Approved by Admin${
                riderId ? ' and scheduled For Delivery' : ''
              }.`
            : `Your recruit "${record.store_name}" (${record.application_no}) was Rejected. Reason: ${String(
                rejection_reason
              ).trim()}`,
          'approval',
          record.id
        );
      }

      if (decision === 'Approved') {
        notifyUser(
          record.user_id,
          `Franchisee Application ${record.application_no} Approved`,
          `Welcome to AICE Franchisee Hub! Your store "${record.store_name}" is now Approved. ${
            riderId
              ? 'A delivery team has been assigned to deliver your freezer and equipment.'
              : 'Your freezer and equipment delivery will be scheduled shortly.'
          }`,
          'approval',
          record.id
        );
      }

      if (riderId) {
        notifyUser(
          riderId,
          `New Equipment Delivery Assigned (${record.application_no})`,
          `Admin assigned you to deliver the freezer & equipment kit to "${record.store_name}" (${record.full_address}). Please complete the Equipment Checklist and on-site signatures upon delivery.`,
          'delivery',
          record.id
        );
      }

      logActivity(
        req.user!.id,
        `FRANCHISEE_${String(decision).toUpperCase()}`,
        'franchisee',
        record.franchisee_id,
        `${record.application_no} (${record.store_name}) -> ${nextAppStatus}`
      );
    });

    tx();
    const updated = getHydratedApplicationBy('fa.id', record.id);
    res.json({
      message: `Application ${record.application_no} marked as ${nextAppStatus}.`,
      application: updated,
    });
  };

  api.post(
    '/franchisee-applications/:id/review',
    authorize('admin'),
    requireWarehouse,
    handleAdminReviewApplication
  );

  api.post(
    '/admin/franchisees/:id/review',
    authorize('admin'),
    requireWarehouse,
    handleAdminReviewApplication
  );

  // Admin assigns Delivery Staff for equipment delivery (transitions Approved -> For Delivery) & updates Cashier/Collector/Noted By
  api.post(
    '/franchisee-applications/:id/assign-delivery',
    authorize('admin'),
    requireWarehouse,
    (req, res) => {
      const record = resolveApplicationByParamId(Number(req.params.id));
      if (!record) {
        res.status(404).json({ message: 'Franchisee application not found.' });
        return;
      }

      if (record.status === 'Pending Admin Review' || record.status === 'Rejected') {
        res.status(400).json({
          message: 'Application must be Approved before assigning equipment delivery staff.',
        });
        return;
      }

      const {
        assigned_delivery_user_id,
        cashier_name,
        collector_name,
        collector_signature,
        noted_by_name,
        noted_by_signature,
        freezer_no,
      } = req.body || {};

      if (!assigned_delivery_user_id) {
        res.status(400).json({ message: 'Please select a Delivery Staff rider.' });
        return;
      }

      const rider = db
        .prepare(
          `SELECT u.id, u.full_name
           FROM users u
           JOIN roles r ON r.id = u.role_id
           WHERE u.id = ? AND r.name = 'delivery' AND u.is_active = 1`
        )
        .get(Number(assigned_delivery_user_id)) as { id: number; full_name: string } | undefined;

      if (!rider) {
        res.status(404).json({ message: 'Selected Delivery Staff rider not found or inactive.' });
        return;
      }

      const nextStatus =
        record.status === 'Approved' ? 'For Delivery' : record.status;
      const cleanCashier = String(cashier_name ?? record.cashier_name ?? '').trim();
      const cleanCollector = String(collector_name ?? record.collector_name ?? '').trim();
      const cleanNotedBy = String(noted_by_name || record.noted_by_name || req.user!.full_name).trim();
      const cleanFreezerNo = String(freezer_no ?? record.freezer_no ?? '').trim();

      const tx = db.transaction(() => {
        db.prepare(
          `UPDATE franchisee_applications
           SET assigned_delivery_user_id = ?,
               assigned_at = datetime('now'),
               status = ?,
               cashier_name = ?,
               collector_name = ?,
               noted_by_name = ?,
               freezer_no = ?,
               updated_at = datetime('now')
           WHERE id = ?`
        ).run(
          rider.id,
          nextStatus,
          cleanCashier,
          cleanCollector,
          cleanNotedBy,
          cleanFreezerNo,
          record.id
        );

        if (cleanFreezerNo) {
          db.prepare(
            `UPDATE franchisee_equipment
             SET freezer_no = ?
             WHERE application_id = ? AND item = 'Freezer'`
          ).run(cleanFreezerNo, record.id);
        }

        if (cleanNotedBy || noted_by_signature) {
          upsertSignatureRow(
            record.id,
            'noted_by',
            cleanNotedBy,
            noted_by_signature || null,
            req.user!.id
          );
        }

        if (cleanCollector || collector_signature) {
          upsertSignatureRow(
            record.id,
            'collector',
            cleanCollector,
            collector_signature || null,
            req.user!.id
          );
        }

        notifyUser(
          rider.id,
          `New Equipment Delivery Assigned (${record.application_no})`,
          `You have been assigned to deliver the freezer & equipment kit to "${record.store_name}" (${record.full_address}). Landmark: ${record.landmark}. Contact: ${record.contact_number}.`,
          'delivery',
          record.id
        );

        notifyUser(
          record.user_id,
          `Equipment Delivery Scheduled (${record.application_no})`,
          `Delivery rider ${rider.full_name} has been assigned to deliver your AICE freezer and starter equipment kit to "${record.store_name}".`,
          'delivery',
          record.id
        );

        logActivity(
          req.user!.id,
          'EQUIPMENT_DELIVERY_ASSIGNED',
          'franchisee',
          record.franchisee_id,
          `Assigned rider ${rider.full_name} to ${record.application_no} (${nextStatus})`
        );
      });

      tx();
      const updated = getHydratedApplicationBy('fa.id', record.id);
      res.json({
        message: `Assigned ${rider.full_name} for equipment delivery (${record.application_no}).`,
        application: updated,
      });
    }
  );

  // Admin sign-off / Cashier / Collector / Noted By update
  api.post(
    '/franchisee-applications/:id/admin-signoff',
    authorize('admin'),
    requireWarehouse,
    (req, res) => {
      const record = resolveApplicationByParamId(Number(req.params.id));
      if (!record) {
        res.status(404).json({ message: 'Franchisee application not found.' });
        return;
      }

      const {
        cashier_name,
        collector_name,
        collector_signature,
        noted_by_name,
        noted_by_signature,
        freezer_no,
        status,
      } = req.body || {};

      const cleanCashier = String(cashier_name ?? record.cashier_name ?? '').trim();
      const cleanCollector = String(collector_name ?? record.collector_name ?? '').trim();
      const cleanNotedBy = String(noted_by_name ?? record.noted_by_name ?? req.user!.full_name).trim();
      const cleanFreezerNo = String(freezer_no ?? record.freezer_no ?? '').trim();
      const nextStatus =
        status && ['Approved', 'For Delivery', 'Delivered', 'Active'].includes(status)
          ? status
          : record.status;

      const tx = db.transaction(() => {
        db.prepare(
          `UPDATE franchisee_applications
           SET cashier_name = ?,
               collector_name = ?,
               noted_by_name = ?,
               freezer_no = ?,
               status = ?,
               activated_at = CASE WHEN ? = 'Active' THEN COALESCE(activated_at, datetime('now')) ELSE activated_at END,
               updated_at = datetime('now')
           WHERE id = ?`
        ).run(
          cleanCashier,
          cleanCollector,
          cleanNotedBy,
          cleanFreezerNo,
          nextStatus,
          nextStatus,
          record.id
        );

        if (cleanFreezerNo) {
          db.prepare(
            `UPDATE franchisee_equipment
             SET freezer_no = ?
             WHERE application_id = ? AND item = 'Freezer'`
          ).run(cleanFreezerNo, record.id);
        }

        if (cleanNotedBy || noted_by_signature) {
          upsertSignatureRow(
            record.id,
            'noted_by',
            cleanNotedBy,
            noted_by_signature || null,
            req.user!.id
          );
        }

        if (cleanCollector || collector_signature) {
          upsertSignatureRow(
            record.id,
            'collector',
            cleanCollector,
            collector_signature || null,
            req.user!.id
          );
        }

        logActivity(
          req.user!.id,
          'FRANCHISEE_ADMIN_SIGNOFF',
          'franchisee',
          record.franchisee_id,
          `Updated Admin/Cashier/Collector sign-offs on ${record.application_no} (${nextStatus})`
        );
      });

      tx();
      const updated = getHydratedApplicationBy('fa.id', record.id);
      res.json({
        message: `Sign-off details saved for ${record.application_no}.`,
        application: updated,
      });
    }
  );

  // Delivery Staff (or Admin) completes Section 2 (Equipment Checklist) and Section 3 (On-Site Signatures)
  api.post(
    '/franchisee-applications/:id/equipment-delivery',
    authorize('delivery', 'admin'),
    requireWarehouse,
    (req, res) => {
      const record = resolveApplicationByParamId(Number(req.params.id));
      if (!record) {
        res.status(404).json({ message: 'Franchisee application not found.' });
        return;
      }

      if (
        req.user!.role === 'delivery' &&
        record.assigned_delivery_user_id &&
        record.assigned_delivery_user_id !== req.user!.id
      ) {
        res.status(403).json({
          message: 'This equipment delivery is assigned to another delivery staff member.',
        });
        return;
      }

      if (record.status === 'Pending Admin Review' || record.status === 'Rejected') {
        res.status(400).json({
          message: 'Cannot record equipment delivery for an unapproved application.',
        });
        return;
      }

      const body = req.body || {};
      const todayStr = (db.prepare("SELECT date('now') AS d").get() as { d: string }).d;
      const dateDelivered = String(body.date_delivered || record.date_delivered || todayStr)
        .trim()
        .slice(0, 10);

      const incomingEq: any[] = Array.isArray(body.equipment) ? body.equipment : [];
      const eqByName: Record<
        string,
        { item_condition: 'NEW' | 'OLD' | 'NOT_ISSUED'; quantity: number; freezer_no: string }
      > = {};

      for (const itemName of FRANCHISEE_EQUIPMENT_ITEMS) {
        const match = incomingEq.find(
          (e) => e && (e.item_name === itemName || e.item === itemName)
        );
        const condRaw = String(
          match?.item_condition || match?.condition_status || match?.condition || 'NOT_ISSUED'
        ).toUpperCase();
        const cond: 'NEW' | 'OLD' | 'NOT_ISSUED' =
          condRaw === 'NEW' ? 'NEW' : condRaw === 'OLD' ? 'OLD' : 'NOT_ISSUED';
        const qty =
          cond === 'NOT_ISSUED'
            ? 0
            : Math.max(1, parseInt(String(match?.quantity ?? '1'), 10) || 1);
        const fNo =
          itemName === 'Freezer'
            ? String(body.freezer_no ?? match?.freezer_no ?? record.freezer_no ?? '').trim()
            : '';
        eqByName[itemName] = {
          item_condition: cond,
          quantity: qty,
          freezer_no: fNo,
        };
      }

      const issuedItemsCount = Object.values(eqByName).filter(
        (e) => e.item_condition === 'NEW' || e.item_condition === 'OLD'
      ).length;

      if (issuedItemsCount === 0) {
        res.status(400).json({
          message: 'Please check at least one equipment item as NEW or OLD in Section 2.',
        });
        return;
      }

      const freezerEntry = eqByName['Freezer'];
      if (
        (freezerEntry.item_condition === 'NEW' || freezerEntry.item_condition === 'OLD') &&
        !freezerEntry.freezer_no
      ) {
        res.status(400).json({
          message: 'Freezer # (serial or asset number) is required when issuing a Freezer.',
        });
        return;
      }

      const customerPrintedName = String(
        body.customer_printed_name ||
          record.signatures?.customer?.printed_name ||
          record.complete_name ||
          ''
      ).trim();
      const customerSignature =
        body.customer_signature ||
        body.customer_signature_data ||
        record.signatures?.customer?.signature_image ||
        null;

      const deliveryTeamPrintedName = String(
        body.delivery_team_printed_name ||
          record.signatures?.delivery_team?.printed_name ||
          `${req.user!.full_name} Team`
      ).trim();
      const deliveryTeamSignature =
        body.delivery_team_signature ||
        body.delivery_team_signature_data ||
        record.signatures?.delivery_team?.signature_image ||
        null;

      const driverPrintedName = String(
        body.driver_printed_name ||
          record.signatures?.driver?.printed_name ||
          req.user!.full_name ||
          ''
      ).trim();
      const driverSignature =
        body.driver_signature ||
        body.driver_signature_data ||
        record.signatures?.driver?.signature_image ||
        null;

      if (!customerPrintedName || !customerSignature) {
        res.status(400).json({
          message: 'Customer printed name and on-site signature are required to complete equipment handover.',
        });
        return;
      }
      if (!deliveryTeamPrintedName || !deliveryTeamSignature) {
        res.status(400).json({
          message: 'Delivery Team printed name and signature are required.',
        });
        return;
      }
      if (!driverPrintedName || !driverSignature) {
        res.status(400).json({
          message: 'Driver printed name and signature are required.',
        });
        return;
      }

      const collectorPrintedName = String(
        body.collector_printed_name ??
          body.collector_name ??
          record.collector_name ??
          record.signatures?.collector?.printed_name ??
          ''
      ).trim();
      const collectorSignature =
        body.collector_signature ||
        body.collector_signature_data ||
        record.signatures?.collector?.signature_image ||
        null;

      const cleanCashier = String(body.cashier_name ?? record.cashier_name ?? '').trim();
      const targetStatus = body.status === 'Delivered' ? 'Delivered' : 'Active';

      const agRow = db
        .prepare('SELECT user_id FROM agents WHERE id = ?')
        .get(record.agent_id) as { user_id: number } | undefined;

      const tx = db.transaction(() => {
        const upEq = db.prepare(
          `INSERT INTO franchisee_equipment (application_id, item, condition, quantity, freezer_no, updated_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(application_id, item) DO UPDATE SET
             condition = excluded.condition,
             quantity = excluded.quantity,
             freezer_no = excluded.freezer_no,
             updated_at = datetime('now')`
        );

        for (const itemName of FRANCHISEE_EQUIPMENT_ITEMS) {
          const entry = eqByName[itemName];
          upEq.run(
            record.id,
            itemName,
            entry.item_condition,
            entry.quantity,
            entry.freezer_no
          );
        }

        upsertSignatureRow(
          record.id,
          'customer',
          customerPrintedName,
          customerSignature,
          record.user_id
        );
        upsertSignatureRow(
          record.id,
          'delivery_team',
          deliveryTeamPrintedName,
          deliveryTeamSignature,
          req.user!.id
        );
        upsertSignatureRow(
          record.id,
          'driver',
          driverPrintedName,
          driverSignature,
          req.user!.id
        );

        if (collectorPrintedName || collectorSignature) {
          upsertSignatureRow(
            record.id,
            'collector',
            collectorPrintedName,
            collectorSignature,
            req.user!.id
          );
        }

        db.prepare(
          `UPDATE franchisee_applications
           SET freezer_no = ?,
               date_delivered = ?,
               delivered_at = COALESCE(delivered_at, datetime('now')),
               activated_at = CASE WHEN ? = 'Active' THEN COALESCE(activated_at, datetime('now')) ELSE activated_at END,
               assigned_delivery_user_id = COALESCE(assigned_delivery_user_id, ?),
               cashier_name = ?,
               collector_name = CASE WHEN ? != '' THEN ? ELSE collector_name END,
               status = ?,
               updated_at = datetime('now')
           WHERE id = ?`
        ).run(
          freezerEntry.freezer_no,
          dateDelivered,
          targetStatus,
          req.user!.role === 'delivery' ? req.user!.id : record.assigned_delivery_user_id,
          cleanCashier,
          collectorPrintedName,
          collectorPrintedName,
          targetStatus,
          record.id
        );

        notifyAdmins(
          `Equipment Delivered & Signed (${record.application_no})`,
          `${req.user!.full_name} completed the equipment checklist (Freezer #${
            freezerEntry.freezer_no || 'N/A'
          }) and customer sign-off for "${record.store_name}". Franchisee is now ${targetStatus}.`,
          'delivery',
          record.id
        );

        if (agRow?.user_id) {
          notifyUser(
            agRow.user_id,
            `Recruit Activated (${record.application_no})`,
            `Equipment delivery and signatures for "${record.store_name}" are complete. Store status is now ${targetStatus}.`,
            'approval',
            record.id
          );
        }

        notifyUser(
          record.user_id,
          `Equipment Handover Complete — Store ${targetStatus}!`,
          `Your AICE freezer (${
            freezerEntry.freezer_no || 'Issued'
          }) and equipment checklist have been signed off. You can now place online stock replenishment orders!`,
          'approval',
          record.id
        );

        logActivity(
          req.user!.id,
          'FRANCHISEE_EQUIPMENT_DELIVERED',
          'franchisee',
          record.franchisee_id,
          `Completed equipment checklist & signatures for ${record.application_no} -> ${targetStatus}`
        );
      });

      tx();
      const updated = getHydratedApplicationBy('fa.id', record.id);
      res.json({
        message: `Equipment checklist and signatures saved! "${record.store_name}" is now ${targetStatus}.`,
        application: updated,
        data: updated,
      });
    }
  );

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
    const appRow = db
      .prepare('SELECT status, application_no FROM franchisee_applications WHERE user_id = ?')
      .get(req.user!.id) as { status: string; application_no: string } | undefined;
    const effectiveAppStatus = appRow ? normalizeApplicationStatus(appRow.status) : 'Active';
    if (!canFranchiseeOrderReplenishment(effectiveAppStatus)) {
      res.status(403).json({
        message: `Replenishment stock ordering is locked until your initial freezer & equipment delivery checklist and on-site signatures are completed (current status: ${effectiveAppStatus}).`,
        application_status: effectiveAppStatus,
      });
      return;
    }

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

  const isProduction =
    process.env.NODE_ENV === 'production' ||
    Boolean(process.env.K_SERVICE) ||
    Boolean(process.argv[1]?.replace(/\\/g, '/').endsWith('dist/server.js'));

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
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

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AICE Franchisee Hub running on http://0.0.0.0:${PORT}`);
    setImmediate(() => {
      try {
        initDatabase();
      } catch (err) {
        console.error('[DB INIT ERROR]', err);
      }
    });
  });
}

startServer();
