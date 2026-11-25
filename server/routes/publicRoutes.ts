import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { GoogleGenAI } from '@google/genai';
import type { Router, Request, Response, NextFunction } from 'express';
import db from '../db.ts';
import {
  JWT_SECRET,
  asyncHandler,
  authenticate,
  authorize,
  requireWarehouse,
  parsePagination,
  getTodaySqlDate,
  logActivity,
  notifyUser,
  getPublicSettingsMap,
} from '../helpers.ts';
import {
  checkOverdueRestocks,
  computeWarehouseProductStockMetrics,
} from '../services/restockingService.ts';
import {
  haversineKm,
  isValidCoords,
  requiresForcedPasswordChange,
  formatPromoHowItWorks,
  isPromoDateValid,
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
  normalizeApplicationStatus,
  canFranchiseeOrderReplenishment,
} from '../../src/utils/domainRules.ts';

export function registerPublicAndAuthRoutes(api: Router) {
  api.get(
    '/system/status',
    asyncHandler(async (_req, res) => {
      const row = await db.queryOne<{ cnt: number }>(
        'SELECT COUNT(*) AS cnt FROM warehouses WHERE is_active = 1'
      );
      const showTestAccounts =
        process.env.SHOW_TEST_ACCOUNTS === 'true' ||
        process.env.VITE_SHOW_TEST_ACCOUNTS === 'true';
      res.json({
        hasWarehouse: (row?.cnt ?? 0) > 0,
        warehouseCount: row?.cnt ?? 0,
        showTestAccounts,
      });
    })
  );

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

  api.use('/public', publicRateLimiter);

  api.get(
    '/public/products',
    asyncHandler(async (_req, res) => {
      const settings = await getPublicSettingsMap();
      const rows = await db.queryAll<Record<string, any>>(
        `SELECT p.id, p.name, p.flavor, p.size, p.image_url, p.price, c.name AS category_name
         FROM products p
         JOIN categories c ON c.id = p.category_id
         WHERE p.is_active = 1
         ORDER BY c.name ASC, p.name ASC`
      );
      const data = rows.map((r) => projectPublicProduct(r, settings.show_public_prices));
      res.json({
        data,
        show_prices: settings.show_public_prices,
      });
    })
  );

  api.get(
    '/public/stores',
    asyncHandler(async (_req, res) => {
      const rows = await db.queryAll<Record<string, any>>(
        `SELECT f.id, f.store_name, f.address, f.lat, f.lng
         FROM franchisees f
         JOIN users u ON u.id = f.user_id
         WHERE f.status = 'Approved' AND u.is_active = 1
         ORDER BY f.store_name ASC`
      );
      const data = rows.map((r) => projectPublicStore(r));
      res.json({ data });
    })
  );

  api.get(
    '/public/promos',
    asyncHandler(async (_req, res) => {
      await db.execute(
        `UPDATE promos
         SET status = 'Expired', updated_at = CURRENT_TIMESTAMP
         WHERE status IN ('Active', 'Paused')
           AND COALESCE(recurring_monthly, 0) = 0
           AND end_date::date < CURRENT_DATE`
      );

      const todayStr = await getTodaySqlDate();

      const rawPromos = await db.queryAll<Record<string, any>>(
        `SELECT id, name, description, promo_type, tier_basis, discount_type, discount_value,
                min_order_amount, min_quantity, buy_quantity, free_quantity, free_delivery,
                max_discount_cap, scope, start_date, end_date, recurring_monthly, status
         FROM promos
         WHERE status = 'Active'
         ORDER BY id DESC`
      );

      const withTiers: Record<string, any>[] = [];
      for (const p of rawPromos) {
        const tiers = await db.queryAll(
          'SELECT min_quantity_or_amount, discount_value FROM promo_tiers WHERE promo_id = $1 ORDER BY min_quantity_or_amount ASC',
          [p.id]
        );
        withTiers.push({ ...p, tiers });
      }

      const activePromos = withTiers
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
    })
  );

  api.get(
    '/public/faqs',
    asyncHandler(async (_req, res) => {
      const rows = await db.queryAll<{ id: number; question: string; answer: string }>(
        `SELECT id, question, answer
         FROM faqs
         WHERE is_active = 1 AND LOWER(audience) = 'all'
         ORDER BY sort_order ASC, id ASC`
      );

      const data = rows.map((r) => ({
        id: Number(r.id),
        question: sanitizePublicText(r.question),
        answer: sanitizePublicText(r.answer),
      }));
      res.json({ data });
    })
  );

  api.get(
    '/public/settings',
    asyncHandler(async (req, res) => {
      res.json(await getPublicSettingsMap(req));
    })
  );

  const chatbotIpRateStore = new Map<string, ChatbotIpBucket>();

  const recordUnansweredQuestion = async (sessionId: string, question: string) => {
    const cleanQ = sanitizeChatbotText(question, CHATBOT_MAX_MESSAGE_LENGTH);
    const cleanSession = sanitizeChatbotText(sessionId || 'anon', 80) || 'anon';
    if (!cleanQ) return;

    const existing = await db.queryOne<{ id: number }>(
      `SELECT id FROM chat_unanswered
       WHERE LOWER(question) = LOWER($1) AND status = 'Open'
       LIMIT 1`,
      [cleanQ]
    );

    if (!existing) {
      await db.execute(
        `INSERT INTO chat_unanswered (session_id, question, status, created_at)
         VALUES ($1, $2, 'Open', CURRENT_TIMESTAMP)`,
        [cleanSession, cleanQ]
      );
    }
  };

  api.post(
    '/public/chatbot/ask',
    asyncHandler(async (req, res) => {
      const settings = await getPublicSettingsMap();
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

      const publicFaqs = await db.queryAll<{
        id: number;
        question: string;
        answer: string;
        keywords: string;
      }>(
        `SELECT id, question, answer, COALESCE(keywords, '') AS keywords
         FROM faqs
         WHERE is_active = 1 AND LOWER(audience) = 'all'
         ORDER BY sort_order ASC, id ASC`
      );

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

      const aiEnabled = isChatbotAiConfigured(process.env);
      const dailyCap = parseChatbotDailyCap(process.env.CHATBOT_AI_DAILY_CAP);
      const todayUsageRow = await db.queryOne<{ cnt: number }>(
        'SELECT COUNT(*) AS cnt FROM chat_ai_usage WHERE created_at::date = CURRENT_DATE'
      );
      const callsToday = Number(todayUsageRow?.cnt || 0);

      if (!aiEnabled || callsToday >= dailyCap) {
        await recordUnansweredQuestion(sessionId, visitorMessage);
        res.json({
          reply: fallbackReply,
          source: 'fallback',
          ai_label: null,
        });
        return;
      }

      const ipAiLimit = checkChatbotIpAiLimit(chatbotIpRateStore, ip, nowMs);
      if (!ipAiLimit.allowed) {
        await recordUnansweredQuestion(sessionId, visitorMessage);
        res.json({
          reply: fallbackReply,
          source: 'fallback',
          ai_label: null,
        });
        return;
      }

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

        await db.execute(
          `INSERT INTO chat_ai_usage (session_id, tokens_in, tokens_out, created_at)
           VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
          [sessionId, tokensIn, tokensOut]
        );

        if (!cleanAiReply) {
          await recordUnansweredQuestion(sessionId, visitorMessage);
          res.json({
            reply: fallbackReply,
            source: 'fallback',
            ai_label: null,
          });
          return;
        }

        if (
          /i don'?t know|not in the (provided )?context|outside (this )?scope|couldn'?t find/i.test(
            cleanAiReply
          )
        ) {
          await recordUnansweredQuestion(sessionId, visitorMessage);
        }

        res.json({
          reply: cleanAiReply,
          source: 'ai',
          ai_label: CHATBOT_AI_SUBTLE_LABEL,
        });
      } catch {
        await recordUnansweredQuestion(sessionId, visitorMessage);
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
    })
  );

  // ===== AUTH LOGIN & SESSION ROUTES =====
  api.post(
    '/auth/login',
    asyncHandler(async (req, res) => {
      const { username, password } = req.body;
      if (!username || !password) {
        res.status(400).json({ message: 'Username and password are required.' });
        return;
      }

      const user = await db.queryOne<any>(
        `SELECT u.*, r.name AS role
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE u.username = $1`,
        [String(username).trim()]
      );

      if (!user || !(await bcrypt.compare(String(password), user.password_hash))) {
        res.status(401).json({ message: 'Invalid username or password.' });
        return;
      }

      if (!user.is_active) {
        res.status(403).json({ message: 'This account has been deactivated by the Admin.' });
        return;
      }

      let franchisee: any = null;
      if (user.role === 'franchisee') {
        const fr = await db.queryOne<any>('SELECT * FROM franchisees WHERE user_id = $1', [user.id]);
        if (!fr) {
          res.status(403).json({ message: 'Franchisee profile missing.' });
          return;
        }
        const appRow = await db.queryOne<any>(
          'SELECT id, application_no, status, rejection_reason, freezer_no FROM franchisee_applications WHERE user_id = $1',
          [user.id]
        );
        const effectiveStatus = normalizeApplicationStatus(
          appRow?.status || fr.status || 'Pending Admin Review'
        );
        if (effectiveStatus === 'Pending Admin Review') {
          res.status(403).json({
            message:
              'Your account is not active yet. Your franchisee application is currently Pending Admin Review and cannot log in yet.',
          });
          return;
        }
        if (effectiveStatus === 'Rejected') {
          const reason =
            appRow?.rejection_reason ||
            fr.rejection_reason ||
            'Please contact your recruiting agent.';
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

      const wh = await db.queryOne<{ cnt: number }>(
        'SELECT COUNT(*) AS cnt FROM warehouses WHERE is_active = 1'
      );

      const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, {
        expiresIn: '12h',
      });

      const mustChange = requiresForcedPasswordChange(user);
      await logActivity(user.id, 'LOGIN', 'user', user.id, `Logged in as ${user.role}`);

      res.json({
        token,
        hasWarehouse: (wh?.cnt ?? 0) > 0,
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
    })
  );

  // ===== AUTHENTICATED ROUTES (Allowed even before first-login password change) =====
  api.get(
    '/auth/me',
    authenticate,
    asyncHandler(async (req, res) => {
      const wh = await db.queryOne<{ cnt: number }>(
        'SELECT COUNT(*) AS cnt FROM warehouses WHERE is_active = 1'
      );

      let franchisee: any = null;
      if (req.user!.role === 'franchisee') {
        const fr = await db.queryOne<any>(
          'SELECT id, owner_name, store_name, address, contact_number, lat, lng, status FROM franchisees WHERE user_id = $1',
          [req.user!.id]
        );
        const appRow = await db.queryOne<any>(
          'SELECT id, application_no, status, freezer_no FROM franchisee_applications WHERE user_id = $1',
          [req.user!.id]
        );
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
        hasWarehouse: (wh?.cnt ?? 0) > 0,
        user: {
          ...req.user,
          must_change_password: requiresForcedPasswordChange(req.user!),
          is_test: Boolean(req.user!.is_test),
          franchisee,
        },
      });
    })
  );

  api.post(
    '/auth/change-password',
    authenticate,
    asyncHandler(async (req, res) => {
      const { currentPassword, newPassword } = req.body;
      if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
        res.status(400).json({ message: 'New password must be at least 8 characters long.' });
        return;
      }

      const row = await db.queryOne<{ password_hash: string }>(
        'SELECT password_hash FROM users WHERE id = $1',
        [req.user!.id]
      );
      if (!row) {
        res.status(404).json({ message: 'User account not found.' });
        return;
      }

      if (!(await bcrypt.compare(currentPassword || '', row.password_hash))) {
        res.status(400).json({ message: 'Current password is incorrect.' });
        return;
      }

      if (await bcrypt.compare(newPassword, row.password_hash)) {
        res
          .status(400)
          .json({ message: 'New password must be different from your current password.' });
        return;
      }

      const hash = await bcrypt.hash(newPassword, 10);
      await db.execute(
        'UPDATE users SET password_hash = $1, must_change_password = 0, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [hash, req.user!.id]
      );

      await logActivity(req.user!.id, 'PASSWORD_CHANGED', 'user', req.user!.id, 'User updated password');
      res.json({ message: 'Password updated successfully.' });
    })
  );
}

export function registerProfileNotificationsSettingsWarehouseRoutes(api: Router) {
  api.put(
    '/auth/profile',
    asyncHandler(async (req, res) => {
      const { full_name, email, contact_number } = req.body;
      if (!full_name || !String(full_name).trim()) {
        res.status(400).json({ message: 'Full name is required.' });
        return;
      }
      await db.execute(
        'UPDATE users SET full_name = $1, email = $2, contact_number = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4',
        [String(full_name).trim(), email || null, contact_number || null, req.user!.id]
      );

      if (req.user!.role === 'franchisee' && contact_number) {
        await db.execute(
          'UPDATE franchisees SET contact_number = $1, owner_name = $2 WHERE user_id = $3',
          [String(contact_number).trim(), String(full_name).trim(), req.user!.id]
        );
      }
      await logActivity(req.user!.id, 'PROFILE_UPDATED', 'user', req.user!.id, 'Updated user profile');
      res.json({ message: 'Profile updated successfully.' });
    })
  );

  // ===== NOTIFICATIONS =====
  const ensureActivePromoNotificationsForFranchisee = async (
    userId: number,
    franchiseeId?: number
  ) => {
    if (!franchiseeId) return;
    const activePromos = await db.queryAll<any>(
      `SELECT id, name, promo_type, tier_basis, discount_type, discount_value,
              min_order_amount, min_quantity, buy_quantity, free_quantity,
              free_delivery, max_discount_cap, start_date, end_date, recurring_monthly
       FROM promos
       WHERE status = 'Active'
         AND start_date::date <= CURRENT_DATE
         AND (end_date::date >= CURRENT_DATE OR COALESCE(recurring_monthly, 0) = 1)`
    );

    for (const p of activePromos) {
      const targets = await db.queryAll<{ franchisee_id: number }>(
        'SELECT franchisee_id FROM promo_targets WHERE promo_id = $1',
        [p.id]
      );
      const isTargeted =
        targets.length === 0 ||
        targets.some((t) => Number(t.franchisee_id) === Number(franchiseeId));
      if (!isTargeted) continue;

      const existingNotif = await db.queryOne<{ id: number }>(
        "SELECT id FROM notifications WHERE user_id = $1 AND type = 'promo' AND related_id = $2",
        [userId, p.id]
      );
      if (!existingNotif) {
        const preview = formatPromoHowItWorks(p);
        await notifyUser(
          userId,
          `New Active Promo: ${p.name}`,
          `${preview}. Valid until ${String(p.end_date).slice(0, 10)}. Discount applies automatically at checkout!`,
          'promo',
          p.id
        );
      }
    }
  };

  api.get(
    '/notifications/summary',
    asyncHandler(async (req, res) => {
      const user = req.user!;
      if (user.role === 'franchisee' && user.franchiseeId) {
        await ensureActivePromoNotificationsForFranchisee(user.id, user.franchiseeId);
      }

      const unreadRow = await db.queryOne<{ unread: number }>(
        'SELECT COUNT(*) AS unread FROM notifications WHERE user_id = $1 AND is_read = 0',
        [user.id]
      );
      const unread_total = Number(unreadRow?.unread || 0);

      const sections: Record<string, number> = {
        notifications: unread_total,
        [`/${user.role}/notifications`]: unread_total,
      };

      if (user.role === 'admin') {
        await checkOverdueRestocks();
        const [pf, po, rrBadge, activeWarehouses] = await Promise.all([
          db.queryOne<{ cnt: number }>("SELECT COUNT(*) AS cnt FROM franchisees WHERE status = 'Pending'"),
          db.queryOne<{ cnt: number }>("SELECT COUNT(*) AS cnt FROM orders WHERE status = 'Placed'"),
          db.queryOne<{ cnt: number }>(
            `SELECT COUNT(*)::int AS cnt
             FROM restock_requests
             WHERE status = 'Draft'
                OR (status = 'Approved/In Transit' AND expected_arrival_date IS NOT NULL AND expected_arrival_date < to_char(CURRENT_DATE, 'YYYY-MM-DD'))`
          ),
          db.queryAll<{ id: number }>('SELECT id FROM warehouses WHERE is_active = 1'),
        ]);
        const pendingFranchisees = pf?.cnt ?? 0;
        const placedOrders = po?.cnt ?? 0;
        const restockPending = rrBadge?.cnt ?? 0;

        let attentionSkus = 0;
        for (const wh of activeWarehouses) {
          const ov = await computeWarehouseProductStockMetrics(wh.id);
          if (ov) {
            attentionSkus += ov.no_stock_count + ov.low_stock_count;
          }
        }

        sections.pending_approvals = pendingFranchisees;
        sections['/admin/pending-franchisees'] = pendingFranchisees;
        sections.replenishment_orders = placedOrders;
        sections['/admin/orders'] = placedOrders;
        sections.warehouse_inventory = attentionSkus;
        sections['/admin/inventory'] = attentionSkus;
        sections.warehouse_restocking = restockPending;
        sections['/admin/restocking'] = restockPending;
      } else if (user.role === 'agent') {
        const ua = await db.queryOne<{ cnt: number }>(
          "SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = $1 AND is_read = 0 AND type = 'approval'",
          [user.id]
        );
        const unseenApprovals = ua?.cnt ?? 0;
        sections.franchisees = unseenApprovals;
        sections.my_recruits = unseenApprovals;
        sections['/agent/dashboard'] = unseenApprovals;
      } else if (user.role === 'franchisee') {
        const [oc, up] = await Promise.all([
          db.queryOne<{ cnt: number }>(
            "SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = $1 AND is_read = 0 AND type IN ('order', 'delivery', 'near')",
            [user.id]
          ),
          db.queryOne<{ cnt: number }>(
            "SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = $1 AND is_read = 0 AND type = 'promo'",
            [user.id]
          ),
        ]);
        const unseenOrderChanges = oc?.cnt ?? 0;
        const unseenPromos = up?.cnt ?? 0;
        sections.order_history = unseenOrderChanges;
        sections['/franchisee/orders'] = unseenOrderChanges;
        sections.product_catalog = unseenPromos;
        sections.promos = unseenPromos;
        sections['/franchisee/catalog'] = unseenPromos;
      } else if (user.role === 'delivery') {
        const ad = await db.queryOne<{ cnt: number }>(
          "SELECT COUNT(*) AS cnt FROM deliveries WHERE delivery_staff_id = $1 AND status = 'Assigned'",
          [user.id]
        );
        const assignedDeliveries = ad?.cnt ?? 0;
        sections.assigned_deliveries = assignedDeliveries;
        sections.deliveries = assignedDeliveries;
        sections['/delivery/dashboard'] = assignedDeliveries;
      }

      res.json({
        unread_total,
        sections,
      });
    })
  );

  api.get(
    '/notifications',
    asyncHandler(async (req, res) => {
      const user = req.user!;
      if (user.role === 'franchisee' && user.franchiseeId) {
        await ensureActivePromoNotificationsForFranchisee(user.id, user.franchiseeId);
      }

      const { page, limit, offset } = parsePagination(req.query);
      const totalRow = await db.queryOne<{ total: number }>(
        'SELECT COUNT(*) AS total FROM notifications WHERE user_id = $1',
        [user.id]
      );
      const unreadRow = await db.queryOne<{ unread: number }>(
        'SELECT COUNT(*) AS unread FROM notifications WHERE user_id = $1 AND is_read = 0',
        [user.id]
      );
      const rows = await db.queryAll(
        'SELECT * FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT $2 OFFSET $3',
        [user.id, limit, offset]
      );

      const total = totalRow?.total ?? 0;
      const unread = unreadRow?.unread ?? 0;
      res.json({
        data: rows,
        unreadCount: unread,
        unread_total: unread,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      });
    })
  );

  const handleMarkNotificationRead = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    if (id === 'all') {
      await db.execute('UPDATE notifications SET is_read = 1 WHERE user_id = $1', [req.user!.id]);
    } else {
      await db.execute('UPDATE notifications SET is_read = 1 WHERE id = $1 AND user_id = $2', [
        Number(id),
        req.user!.id,
      ]);
    }
    res.json({ message: 'Marked as read.' });
  });

  api.post(
    '/notifications/read-all',
    asyncHandler(async (req, res) => {
      const user = req.user!;
      const pathParam = req.body?.path ? String(req.body.path) : '';
      const explicitTypes: string[] = Array.isArray(req.body?.types)
        ? req.body.types.map((t: unknown) => String(t))
        : pathParam
        ? getNotificationTypesForRoute(user.role, pathParam)
        : ['*'];

      if (explicitTypes.includes('*')) {
        await db.execute(
          'UPDATE notifications SET is_read = 1 WHERE user_id = $1 AND is_read = 0',
          [user.id]
        );
      } else if (explicitTypes.length > 0) {
        await db.execute(
          'UPDATE notifications SET is_read = 1 WHERE user_id = $1 AND is_read = 0 AND type = ANY($2::text[])',
          [user.id, explicitTypes]
        );
      }
      res.json({ message: 'Notifications marked as read.' });
    })
  );

  api.post('/notifications/:id/read', handleMarkNotificationRead);
  api.patch('/notifications/:id/read', handleMarkNotificationRead);

  // ===== ADMIN: PUBLIC LANDING PAGE SETTINGS =====
  api.get(
    '/admin/settings',
    authorize('admin'),
    asyncHandler(async (_req, res) => {
      res.json(await getPublicSettingsMap());
    })
  );

  api.put(
    '/admin/settings',
    authorize('admin'),
    asyncHandler(async (req, res) => {
      const { contact_email, contact_phone, show_public_prices } = req.body || {};
      const upsertSql = `
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
      `;

      if (typeof contact_email === 'string' && contact_email.trim()) {
        await db.execute(upsertSql, ['contact_email', sanitizePublicText(contact_email)]);
      }
      if (typeof contact_phone === 'string' && contact_phone.trim()) {
        await db.execute(upsertSql, ['contact_phone', sanitizePublicText(contact_phone)]);
      }
      if (show_public_prices !== undefined) {
        await db.execute(upsertSql, ['show_public_prices', show_public_prices ? '1' : '0']);
      }

      await logActivity(
        req.user!.id,
        'PUBLIC_SETTINGS_UPDATED',
        'settings',
        null,
        'Updated public landing page settings'
      );
      res.json({
        message: 'Public landing page settings saved.',
        ...(await getPublicSettingsMap()),
      });
    })
  );

  // ===== ADMIN: CHATBOT FAQs, UNANSWERED QUESTIONS & GEMINI AI FALLBACK STATUS =====
  api.get(
    '/admin/chatbot-faqs',
    authorize('admin'),
    asyncHandler(async (_req, res) => {
      const aiEnabled = isChatbotAiConfigured(process.env);
      const hasApiKey = Boolean(
        process.env.GEMINI_API_KEY &&
          process.env.GEMINI_API_KEY.trim() &&
          process.env.GEMINI_API_KEY.trim() !== 'MY_GEMINI_API_KEY'
      );
      const envFlagEnabled = String(process.env.CHATBOT_AI_ENABLED || '').trim() === 'true';
      const dailyCap = parseChatbotDailyCap(process.env.CHATBOT_AI_DAILY_CAP);

      const todayRow = await db.queryOne<{
        calls_today: number;
        tokens_in_today: number;
        tokens_out_today: number;
      }>(
        `SELECT COUNT(*) AS calls_today,
                COALESCE(SUM(tokens_in), 0) AS tokens_in_today,
                COALESCE(SUM(tokens_out), 0) AS tokens_out_today
         FROM chat_ai_usage
         WHERE created_at::date = CURRENT_DATE`
      );

      const totalRow = await db.queryOne<{ total_calls: number }>(
        'SELECT COUNT(*) AS total_calls FROM chat_ai_usage'
      );

      const faqs = await db.queryAll(
        `SELECT id, question, answer, COALESCE(keywords, '') AS keywords, audience, sort_order, is_active, created_at
         FROM faqs
         ORDER BY sort_order ASC, id ASC`
      );

      const unanswered = await db.queryAll(
        `SELECT id, session_id, question, status, resolved_faq_id, created_at
         FROM chat_unanswered
         ORDER BY CASE WHEN status = 'Open' THEN 0 ELSE 1 END ASC, id DESC
         LIMIT 100`
      );

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
    })
  );

  api.post(
    '/admin/chatbot-faqs',
    authorize('admin'),
    asyncHandler(async (req, res) => {
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

      const row = await db.queryOne<{ id: number }>(
        `INSERT INTO faqs (question, answer, keywords, audience, sort_order, is_active, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
         RETURNING id`,
        [cleanQ, cleanA, cleanK, cleanAud, orderNum, activeInt]
      );

      const newFaqId = Number(row!.id);

      if (unanswered_id && Number.isFinite(Number(unanswered_id))) {
        await db.execute(
          `UPDATE chat_unanswered
           SET status = 'Converted', resolved_faq_id = $1
           WHERE id = $2`,
          [newFaqId, Number(unanswered_id)]
        );
      }

      await logActivity(
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
    })
  );

  api.put(
    '/admin/chatbot-faqs/:id',
    authorize('admin'),
    asyncHandler(async (req, res) => {
      const faqId = Number(req.params.id);
      const existing = await db.queryOne('SELECT id FROM faqs WHERE id = $1', [faqId]);
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

      await db.execute(
        `UPDATE faqs
         SET question = $1, answer = $2, keywords = $3, audience = $4, sort_order = $5, is_active = $6
         WHERE id = $7`,
        [cleanQ, cleanA, cleanK, cleanAud, orderNum, activeInt, faqId]
      );

      await logActivity(
        req.user!.id,
        'FAQ_UPDATED',
        'faq',
        faqId,
        `Updated chatbot FAQ #${faqId}`
      );

      res.json({ message: 'Chatbot FAQ updated.' });
    })
  );

  api.delete(
    '/admin/chatbot-faqs/:id',
    authorize('admin'),
    asyncHandler(async (req, res) => {
      const faqId = Number(req.params.id);
      await db.execute('DELETE FROM faqs WHERE id = $1', [faqId]);
      await logActivity(req.user!.id, 'FAQ_DELETED', 'faq', faqId, `Deleted chatbot FAQ #${faqId}`);
      res.json({ message: 'Chatbot FAQ deleted.' });
    })
  );

  api.delete(
    '/admin/chatbot-unanswered/:id',
    authorize('admin'),
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      await db.execute('DELETE FROM chat_unanswered WHERE id = $1', [id]);
      res.json({ message: 'Unanswered question removed.' });
    })
  );

  // ===== WAREHOUSES (Available even when locked so Admin can complete Warehouse Setup) =====
  api.get(
    '/warehouses',
    asyncHandler(async (_req, res) => {
      const rows = await db.queryAll('SELECT * FROM warehouses ORDER BY id ASC');
      res.json({ data: rows });
    })
  );

  api.post(
    '/warehouses',
    authorize('admin'),
    asyncHandler(async (req, res) => {
      const { name, address, contact_person, contact_number, lat, lng } = req.body;
      if (!name || !address || !contact_person || !contact_number) {
        res
          .status(400)
          .json({ message: 'Name, address, contact person, and contact number are required.' });
        return;
      }
      if (!isValidCoords(lat, lng)) {
        res.status(400).json({ message: 'Please pin a valid warehouse location on the map.' });
        return;
      }

      const row = await db.queryOne<{ id: number }>(
        `INSERT INTO warehouses (name, address, contact_person, contact_number, lat, lng, is_active, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, 1, $7)
         RETURNING id`,
        [
          String(name).trim(),
          String(address).trim(),
          String(contact_person).trim(),
          String(contact_number).trim(),
          Number(lat),
          Number(lng),
          req.user!.id,
        ]
      );

      await logActivity(
        req.user!.id,
        'WAREHOUSE_CREATED',
        'warehouse',
        Number(row!.id),
        `Registered warehouse: ${String(name).trim()}`
      );
      res.status(201).json({
        message: 'Warehouse registered successfully.',
        id: Number(row!.id),
      });
    })
  );

  api.put(
    '/warehouses/:id',
    authorize('admin'),
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const { name, address, contact_person, contact_number, lat, lng, is_active } = req.body;
      if (!name || !address || !contact_person || !contact_number || !isValidCoords(lat, lng)) {
        res
          .status(400)
          .json({ message: 'Complete warehouse details and valid coordinates are required.' });
        return;
      }
      await db.execute(
        'UPDATE warehouses SET name = $1, address = $2, contact_person = $3, contact_number = $4, lat = $5, lng = $6, is_active = $7 WHERE id = $8',
        [
          String(name).trim(),
          String(address).trim(),
          String(contact_person).trim(),
          String(contact_number).trim(),
          Number(lat),
          Number(lng),
          is_active === false || is_active === 0 ? 0 : 1,
          Number(id),
        ]
      );
      await logActivity(req.user!.id, 'WAREHOUSE_UPDATED', 'warehouse', id, `Updated warehouse: ${name}`);
      res.json({ message: 'Warehouse updated.' });
    })
  );

  // ===== STORE MAP (All 4 roles; requires Warehouse Setup) =====
  api.get(
    '/map/stores',
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const warehouses = await db.queryAll<any>(
        'SELECT id, name, address, contact_person, contact_number, lat, lng FROM warehouses WHERE is_active = 1'
      );

      const stores = await db.queryAll<any>(
        `SELECT f.id, f.user_id, f.store_name, f.owner_name, f.address, f.contact_number, f.lat, f.lng
         FROM franchisees f
         JOIN users u ON u.id = f.user_id
         WHERE f.status = 'Approved' AND u.is_active = 1`
      );

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
                haversineKm(
                  Number(myStore.lat),
                  Number(myStore.lng),
                  Number(s.lat),
                  Number(s.lng)
                ).toFixed(2)
              ),
            }))
            .sort((a, b) => a.distance_km - b.distance_km);
        }
      }

      res.json({ warehouses, stores, myStore, nearbyStores });
    })
  );
}
