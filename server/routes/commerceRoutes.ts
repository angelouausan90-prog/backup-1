import type { Router } from 'express';
import db, { isUniqueViolation, type DbExecutor } from '../db.ts';
import {
  asyncHandler,
  authorize,
  requireWarehouse,
  parsePagination,
  getTodaySqlDate,
  logActivity,
  notifyUser,
  notifyAdmins,
  uploadProductImage,
  uploadProofImage,
  saveUploadedFile,
  deleteUploadedFile,
} from '../helpers.ts';
import {
  haversineKm,
  estimateEtaMinutes,
  isValidCoords,
  computeStockTransition,
  validatePromoPayload,
  formatPromoHowItWorks,
  evaluatePromosForCart,
  isPromoDateValid,
  isPromoEligibleForFranchisee,
  filterEligiblePopupPromos,
  formatPromoLimitNote,
  hasPromoRulesOrDatesChanged,
  PromoDefinition,
  normalizeApplicationStatus,
  canFranchiseeOrderReplenishment,
} from '../../src/utils/domainRules.ts';
import {
  computeWarehouseProductStockMetrics,
  evaluateProductRestockTrigger,
  getWarehouseTotalPhysicalStock,
} from '../services/restockingService.ts';
import { validateCapacityForIncoming } from '../../src/utils/restockingRules.ts';

export function registerCommerceRoutes(api: Router) {
  // ===== CATEGORIES & PRODUCTS =====
  api.get(
    '/categories',
    requireWarehouse,
    asyncHandler(async (_req, res) => {
      const rows = await db.queryAll('SELECT * FROM categories ORDER BY name ASC');
      res.json({ data: rows });
    })
  );

  api.post(
    '/categories',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const { name, description } = req.body;
      if (!name || !String(name).trim()) {
        res.status(400).json({ message: 'Category name is required.' });
        return;
      }
      try {
        const row = await db.queryOne<{ id: number }>(
          'INSERT INTO categories (name, description) VALUES ($1, $2) RETURNING id',
          [String(name).trim(), description ? String(description).trim() : null]
        );
        res.status(201).json({ message: 'Category created.', id: Number(row!.id) });
      } catch (err: any) {
        if (isUniqueViolation(err)) {
          res.status(409).json({ message: 'Category already exists.' });
          return;
        }
        throw err;
      }
    })
  );

  api.get(
    '/products',
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const { page, limit, offset } = parsePagination(req.query);
      const search = `%${String(req.query.search || '').trim()}%`;
      const categoryId = req.query.category_id;
      const warehouseId = req.query.warehouse_id;
      const activeOnly = req.query.active_only === '1' || req.user!.role === 'franchisee';

      const countParams: any[] = [search];
      let where = 'WHERE (p.name ILIKE $1 OR p.flavor ILIKE $1 OR p.sku ILIKE $1)';
      if (categoryId) {
        countParams.push(Number(categoryId));
        where += ` AND p.category_id = $${countParams.length}`;
      }
      if (activeOnly) {
        where += ' AND p.is_active = 1';
      }

      const totalRow = await db.queryOne<{ total: number }>(
        `SELECT COUNT(*) AS total FROM products p ${where}`,
        countParams
      );

      const selectParams = [...countParams];
      let stockExpr =
        'COALESCE((SELECT SUM(i.quantity) FROM inventory i WHERE i.product_id = p.id), 0)';
      if (warehouseId) {
        selectParams.push(Number(warehouseId));
        stockExpr = `COALESCE((SELECT i.quantity FROM inventory i WHERE i.product_id = p.id AND i.warehouse_id = $${selectParams.length}), 0)`;
      }

      const limitIdx = selectParams.length + 1;
      const offsetIdx = selectParams.length + 2;

      const rows = await db.queryAll<any>(
        `SELECT p.*, c.name AS category_name, ${stockExpr} AS stock_qty
         FROM products p
         JOIN categories c ON c.id = p.category_id
         ${where}
         ORDER BY p.id DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        [...selectParams, limit, offset]
      );

      let metricWhId = Number(warehouseId) || 0;
      if (!metricWhId) {
        const firstWh = await db.queryOne<{ id: number }>(
          'SELECT id FROM warehouses WHERE is_active = 1 ORDER BY id ASC LIMIT 1'
        );
        metricWhId = firstWh?.id || 0;
      }
      const overview = metricWhId ? await computeWarehouseProductStockMetrics(metricWhId) : null;
      const metricByProduct = new Map<number, any>();
      if (overview) {
        for (const m of overview.products) {
          metricByProduct.set(m.product_id, m);
        }
      }

      const enrichedRows = rows.map((r) => {
        const m = metricByProduct.get(Number(r.id));
        if (!m) return r;
        return {
          ...r,
          stock_qty: m.available_stock,
          physical_stock: m.physical_stock,
          reserved_stock: m.reserved_stock,
          available_stock: m.available_stock,
          reorder_point: m.reorder_point,
          stock_status: m.stock_status,
          recommendation_label: m.recommendation_label,
          active_restock: m.active_restock,
          franchisee_availability: m.franchisee_availability,
          target_quantity: m.target_quantity,
          safety_stock: m.safety_stock,
          max_reservation_qty: m.max_reservation_qty,
        };
      });

      const total = totalRow?.total ?? 0;
      res.json({
        data: enrichedRows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      });
    })
  );

  api.post(
    '/products',
    authorize('admin'),
    requireWarehouse,
    uploadProductImage.single('image'),
    asyncHandler(async (req, res) => {
      const { category_id, sku, name, flavor, size, price, low_stock_threshold } = req.body;
      if (!category_id || !sku || !name || !flavor || !size || price === undefined) {
        res
          .status(400)
          .json({ message: 'Category, SKU, name, flavor, size, and price are required.' });
        return;
      }

      const numPrice = Number(price);
      if (Number.isNaN(numPrice) || numPrice <= 0) {
        res.status(400).json({ message: 'Price must be greater than 0.' });
        return;
      }

      try {
        const { newId, imageUrl } = await db.transaction(async (tx) => {
          const uploadedUrl = req.file
            ? await saveUploadedFile('products', 'prod', req.file, tx)
            : null;
          const row = await tx.queryOne<{ id: number }>(
            `INSERT INTO products (category_id, sku, name, flavor, size, price, low_stock_threshold, image_url)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id`,
            [
              Number(category_id),
              String(sku).trim(),
              String(name).trim(),
              String(flavor).trim(),
              String(size).trim(),
              numPrice,
              Number(low_stock_threshold || 20),
              uploadedUrl,
            ]
          );

          await logActivity(
            req.user!.id,
            'PRODUCT_CREATED',
            'product',
            Number(row!.id),
            `Created product ${String(name).trim()} (${String(sku).trim()})`,
            tx
          );
          return { newId: Number(row!.id), imageUrl: uploadedUrl };
        });

        res.status(201).json({
          message: 'Product created.',
          id: newId,
          image_url: imageUrl,
        });
      } catch (err: any) {
        if (isUniqueViolation(err)) {
          res.status(409).json({ message: 'A product with that SKU already exists.' });
          return;
        }
        throw err;
      }
    })
  );

  api.put(
    '/products/:id',
    authorize('admin'),
    requireWarehouse,
    uploadProductImage.single('image'),
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const cur = await db.queryOne<any>('SELECT * FROM products WHERE id = $1', [Number(id)]);
      if (!cur) {
        res.status(404).json({ message: 'Product not found.' });
        return;
      }

      try {
        const finalImageUrl = await db.transaction(async (tx) => {
          let imageUrl: string | null = cur.image_url;
          if (req.body.remove_image === 'true') {
            await deleteUploadedFile(cur.image_url, tx);
            imageUrl = null;
          }
          if (req.file) {
            await deleteUploadedFile(cur.image_url, tx);
            imageUrl = await saveUploadedFile('products', 'prod', req.file, tx);
          }

          await tx.execute(
            `UPDATE products
             SET category_id = $1, sku = $2, name = $3, flavor = $4, size = $5, price = $6,
                 low_stock_threshold = $7, image_url = $8, is_active = $9, updated_at = CURRENT_TIMESTAMP
             WHERE id = $10`,
            [
              Number(req.body.category_id || cur.category_id),
              String(req.body.sku || cur.sku).trim(),
              String(req.body.name || cur.name).trim(),
              String(req.body.flavor || cur.flavor).trim(),
              String(req.body.size || cur.size).trim(),
              Number(req.body.price ?? cur.price),
              Number(req.body.low_stock_threshold ?? cur.low_stock_threshold),
              imageUrl,
              req.body.is_active === 'false' || req.body.is_active === false ? 0 : 1,
              Number(id),
            ]
          );

          await logActivity(
            req.user!.id,
            'PRODUCT_UPDATED',
            'product',
            id,
            `Updated product ${req.body.name || cur.name}`,
            tx
          );
          return imageUrl;
        });

        res.json({ message: 'Product updated.', image_url: finalImageUrl });
      } catch (err: any) {
        if (isUniqueViolation(err)) {
          res.status(409).json({ message: 'A product with that SKU already exists.' });
          return;
        }
        throw err;
      }
    })
  );

  // ===== WAREHOUSE INVENTORY (Admin) =====
  api.get(
    '/inventory',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const { page, limit, offset } = parsePagination(req.query);
      let selectedWh = Number(req.query.warehouse_id) || null;
      if (!selectedWh) {
        const firstWh = await db.queryOne<{ id: number }>(
          'SELECT id FROM warehouses WHERE is_active = 1 ORDER BY id ASC LIMIT 1'
        );
        selectedWh = firstWh?.id || null;
      }
      if (!selectedWh) {
        res.json({
          data: [],
          warehouse_overview: null,
          pagination: { page: 1, limit, total: 0, totalPages: 1 },
        });
        return;
      }

      const overview = await computeWarehouseProductStockMetrics(selectedWh);
      if (!overview) {
        res.json({
          data: [],
          warehouse_overview: null,
          pagination: { page: 1, limit, total: 0, totalPages: 1 },
        });
        return;
      }

      const searchTerm = String(req.query.search || '').trim().toLowerCase();
      const lowOnly = req.query.low_only === '1';

      let filtered = overview.products;
      if (searchTerm) {
        filtered = filtered.filter(
          (p) =>
            p.name.toLowerCase().includes(searchTerm) ||
            p.sku.toLowerCase().includes(searchTerm) ||
            p.flavor.toLowerCase().includes(searchTerm)
        );
      }
      if (lowOnly) {
        filtered = filtered.filter(
          (p) => p.stock_status === 'No Stock' || p.stock_status === 'Low Stock'
        );
      }

      const statusRank = (s: string) => (s === 'No Stock' ? 0 : s === 'Low Stock' ? 1 : 2);
      const sorted = [...filtered].sort(
        (a, b) =>
          statusRank(a.stock_status) - statusRank(b.stock_status) ||
          a.available_stock - b.available_stock ||
          a.name.localeCompare(b.name)
      );

      const total = sorted.length;
      const paged = sorted.slice(offset, offset + limit).map((m) => ({
        ...m,
        quantity: m.physical_stock,
        is_low_stock: m.stock_status !== 'In Stock' ? 1 : 0,
      }));

      res.json({
        warehouse_id: selectedWh,
        warehouse_overview: {
          warehouse_id: overview.warehouse_id,
          warehouse_name: overview.warehouse_name,
          capacity_limit: overview.capacity_limit,
          lead_time_days: overview.lead_time_days,
          total_physical_stock: overview.total_physical_stock,
          total_reserved_stock: overview.total_reserved_stock,
          total_available_stock: overview.total_available_stock,
          remaining_capacity: overview.remaining_capacity,
          utilization_pct: overview.utilization_pct,
          total_target_qty: overview.total_target_qty,
          targets_exceed_capacity: overview.targets_exceed_capacity,
          targets_excess: overview.targets_excess,
          no_stock_count: overview.no_stock_count,
          low_stock_count: overview.low_stock_count,
          in_stock_count: overview.in_stock_count,
        },
        data: paged,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      });
    })
  );

  api.post(
    '/inventory/movement',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const { warehouse_id, product_id, movement_type, quantity_change, notes } = req.body;
      if (!warehouse_id || !product_id || !['STOCK_IN', 'ADJUSTMENT'].includes(movement_type)) {
        res
          .status(400)
          .json({ message: 'Valid warehouse, product, and movement type are required.' });
        return;
      }

      const delta = parseInt(String(quantity_change), 10);
      const whId = Number(warehouse_id);
      const prodId = Number(product_id);

      const outcome = await db.transaction(async (tx) => {
        const inv = await tx.queryOne<{ id: number; quantity: number }>(
          'SELECT id, quantity FROM inventory WHERE warehouse_id = $1 AND product_id = $2 FOR UPDATE',
          [whId, prodId]
        );

        const prevQty = inv ? inv.quantity : 0;
        const transition = computeStockTransition(prevQty, movement_type, delta);
        if (!transition.ok) {
          return { ok: false as const, error: transition.error };
        }

        // Enforce warehouse capacity limit on positive incoming adjustments
        if (delta > 0) {
          const whRow = await tx.queryOne<{ capacity_limit: number }>(
            'SELECT COALESCE(capacity_limit, 1000)::int AS capacity_limit FROM warehouses WHERE id = $1 FOR UPDATE',
            [whId]
          );
          const currentWhTotal = await getWarehouseTotalPhysicalStock(whId, tx);
          const capCheck = validateCapacityForIncoming({
            currentWarehouseTotalStock: currentWhTotal,
            incomingTotalQty: delta,
            warehouseCapacity: Number(whRow?.capacity_limit || 1000),
          });
          if (!capCheck.ok) {
            return { ok: false as const, error: capCheck.error };
          }
        }

        if (inv) {
          await tx.execute(
            'UPDATE inventory SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [transition.newQty, inv.id]
          );
        } else {
          await tx.execute(
            'INSERT INTO inventory (warehouse_id, product_id, quantity) VALUES ($1, $2, $3)',
            [whId, prodId, transition.newQty]
          );
        }

        await tx.execute(
          `INSERT INTO stock_movements (warehouse_id, product_id, movement_type, quantity_change, previous_qty, new_qty, notes, performed_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            whId,
            prodId,
            movement_type,
            delta,
            prevQty,
            transition.newQty,
            notes ? String(notes).trim() : null,
            req.user!.id,
          ]
        );

        await logActivity(
          req.user!.id,
          movement_type,
          'inventory',
          prodId,
          `Warehouse #${whId}: ${prevQty} -> ${transition.newQty}`,
          tx
        );

        return { ok: true as const, prevQty, newQty: transition.newQty };
      });

      if (!outcome.ok) {
        res.status(400).json({ message: outcome.error });
        return;
      }

      // Evaluate Low Stock / No Stock restock trigger automatically after stock update
      await evaluateProductRestockTrigger(whId, prodId, req.user!.id);

      res.json({
        message: 'Inventory updated.',
        previous_qty: outcome.prevQty,
        new_qty: outcome.newQty,
      });
    })
  );

  api.get(
    '/inventory/movements',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const { page, limit, offset } = parsePagination(req.query);
      const warehouseId = req.query.warehouse_id;
      const params: any[] = [];
      let where = 'WHERE 1=1';
      if (warehouseId) {
        params.push(Number(warehouseId));
        where += ` AND sm.warehouse_id = $${params.length}`;
      }

      const totalRow = await db.queryOne<{ total: number }>(
        `SELECT COUNT(*) AS total FROM stock_movements sm ${where}`,
        params
      );

      const rows = await db.queryAll(
        `SELECT sm.*, p.name AS product_name, p.sku, w.name AS warehouse_name, u.full_name AS performed_by_name
         FROM stock_movements sm
         JOIN products p ON p.id = sm.product_id
         JOIN warehouses w ON w.id = sm.warehouse_id
         LEFT JOIN users u ON u.id = sm.performed_by
         ${where}
         ORDER BY sm.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );

      const total = totalRow?.total ?? 0;
      res.json({
        data: rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      });
    })
  );

  // ===== PROMOTIONS =====
  const notifyTargetedFranchiseesForPromo = async (
    promoId: number,
    title: string,
    message: string,
    executor: DbExecutor = db
  ) => {
    const targets = await executor.queryAll<{ franchisee_id: number }>(
      'SELECT franchisee_id FROM promo_targets WHERE promo_id = $1',
      [promoId]
    );

    let franchiseeUsers: { user_id: number }[] = [];
    if (targets.length === 0) {
      franchiseeUsers = await executor.queryAll<{ user_id: number }>(
        "SELECT user_id FROM franchisees WHERE status = 'Approved'"
      );
    } else {
      const ids = targets.map((t) => Number(t.franchisee_id));
      franchiseeUsers = await executor.queryAll<{ user_id: number }>(
        "SELECT user_id FROM franchisees WHERE status = 'Approved' AND id = ANY($1::int[])",
        [ids]
      );
    }

    for (const fu of franchiseeUsers) {
      await notifyUser(fu.user_id, title, message, 'promo', promoId, executor);
    }
  };

  const syncPromosLifecycle = async () => {
    await db.execute(
      `UPDATE promos
       SET status = 'Expired', updated_at = CURRENT_TIMESTAMP
       WHERE status IN ('Active', 'Paused')
         AND COALESCE(recurring_monthly, 0) = 0
         AND end_date::date < CURRENT_DATE`
    );

    const endingSoon = await db.queryAll<{
      id: number;
      name: string;
      end_date: string;
      days_left: number;
    }>(
      `SELECT id, name, end_date,
              (end_date::date - CURRENT_DATE)::int AS days_left
       FROM promos
       WHERE status = 'Active'
         AND (end_date::date - CURRENT_DATE) BETWEEN 0 AND 3`
    );

    for (const p of endingSoon) {
      const targets = await db.queryAll<{ franchisee_id: number }>(
        'SELECT franchisee_id FROM promo_targets WHERE promo_id = $1',
        [p.id]
      );

      let franchiseeUsers: { user_id: number }[] = [];
      if (targets.length === 0) {
        franchiseeUsers = await db.queryAll<{ user_id: number }>(
          "SELECT user_id FROM franchisees WHERE status = 'Approved'"
        );
      } else {
        const ids = targets.map((t) => Number(t.franchisee_id));
        franchiseeUsers = await db.queryAll<{ user_id: number }>(
          "SELECT user_id FROM franchisees WHERE status = 'Approved' AND id = ANY($1::int[])",
          [ids]
        );
      }

      const reminderTitle = `Promo Ending Soon: ${p.name}`;
      for (const fu of franchiseeUsers) {
        const alreadySent = await db.queryOne(
          "SELECT id FROM notifications WHERE user_id = $1 AND type = 'promo' AND related_id = $2 AND title = $3",
          [fu.user_id, p.id, reminderTitle]
        );
        if (!alreadySent) {
          const dayText =
            p.days_left <= 0
              ? 'ends today'
              : `ends in ${p.days_left} day${p.days_left === 1 ? '' : 's'} (${p.end_date})`;
          await notifyUser(
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

  const loadHydratedPromos = async (
    franchiseeId?: number
  ): Promise<(PromoDefinition & Record<string, any>)[]> => {
    await syncPromosLifecycle();
    const rawPromos = await db.queryAll<any>(
      `SELECT p.*,
              (SELECT COUNT(*) FROM promo_redemptions pr WHERE pr.promo_id = p.id) AS total_redemptions,
              COALESCE((SELECT SUM(pr.discount_amount) FROM promo_redemptions pr WHERE pr.promo_id = p.id), 0) AS total_discount_given,
              (p.end_date::date - CURRENT_DATE)::int AS days_remaining
       FROM promos p
       ORDER BY p.id DESC`
    );

    const result: (PromoDefinition & Record<string, any>)[] = [];
    for (const p of rawPromos) {
      const [productRows, categoryRows, tiers, targetRows] = await Promise.all([
        db.queryAll<any>(
          `SELECT pp.product_id, pr.name AS product_name, pr.sku
           FROM promo_products pp
           JOIN products pr ON pr.id = pp.product_id
           WHERE pp.promo_id = $1`,
          [p.id]
        ),
        db.queryAll<any>(
          `SELECT pc.category_id, c.name AS category_name
           FROM promo_categories pc
           JOIN categories c ON c.id = pc.category_id
           WHERE pc.promo_id = $1`,
          [p.id]
        ),
        db.queryAll<{ min_quantity_or_amount: number; discount_value: number }>(
          `SELECT min_quantity_or_amount, discount_value
           FROM promo_tiers
           WHERE promo_id = $1
           ORDER BY min_quantity_or_amount ASC`,
          [p.id]
        ),
        db.queryAll<any>(
          `SELECT pt.franchisee_id, f.store_name, f.owner_name
           FROM promo_targets pt
           JOIN franchisees f ON f.id = pt.franchisee_id
           WHERE pt.promo_id = $1`,
          [p.id]
        ),
      ]);

      let franchiseeRedemptions = 0;
      if (franchiseeId) {
        const frRow = await db.queryOne<{ cnt: number }>(
          'SELECT COUNT(*) AS cnt FROM promo_redemptions WHERE promo_id = $1 AND franchisee_id = $2',
          [p.id, franchiseeId]
        );
        franchiseeRedemptions = frRow?.cnt ?? 0;
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
      result.push(def);
    }

    return result;
  };

  api.get(
    '/promos',
    authorize('admin', 'agent', 'franchisee'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const statusFilter = String(req.query.status || '').trim();
      const todayStr = await getTodaySqlDate();
      const allPromos = await loadHydratedPromos(req.user!.franchiseeId);

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

      const activePromos = allPromos.filter(
        (p) =>
          p.status === 'Active' &&
          isPromoDateValid(p.start_date, p.end_date, todayStr, Boolean(p.recurring_monthly))
      );
      res.json({ data: activePromos });
    })
  );

  api.get(
    '/promos/popup',
    authorize('franchisee'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const todayStr = await getTodaySqlDate();
      const allPromos = await loadHydratedPromos(req.user!.franchiseeId);
      const dismissedRows = await db.queryAll<{ promo_id: number }>(
        'SELECT promo_id FROM promo_dismissals WHERE user_id = $1',
        [req.user!.id]
      );
      const dismissedPromoIds = dismissedRows.map((r) => Number(r.promo_id));

      const eligiblePopupPromos = filterEligiblePopupPromos(allPromos, {
        franchiseeId: Number(req.user!.franchiseeId),
        todayStr,
        dismissedPromoIds,
      });

      res.json({ data: eligiblePopupPromos });
    })
  );

  api.post(
    '/promos/:id/dismiss',
    authorize('franchisee'),
    asyncHandler(async (req, res) => {
      const promoId = Number(req.params.id);
      const promo = await db.queryOne('SELECT id FROM promos WHERE id = $1', [promoId]);
      if (!promo) {
        res.status(404).json({ message: 'Promotion not found.' });
        return;
      }

      if (req.body && req.body.dismissed === false) {
        await db.execute('DELETE FROM promo_dismissals WHERE user_id = $1 AND promo_id = $2', [
          req.user!.id,
          promoId,
        ]);
        res.json({ message: 'Promotion dismissal removed.', promoId });
        return;
      }

      await db.execute(
        `INSERT INTO promo_dismissals (user_id, promo_id, dismissed_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id, promo_id) DO UPDATE SET dismissed_at = CURRENT_TIMESTAMP`,
        [req.user!.id, promoId]
      );

      res.json({ message: 'Promotion dismissal saved.', promoId });
    })
  );

  api.delete(
    '/promos/:id/dismiss',
    authorize('franchisee'),
    asyncHandler(async (req, res) => {
      const promoId = Number(req.params.id);
      await db.execute('DELETE FROM promo_dismissals WHERE user_id = $1 AND promo_id = $2', [
        req.user!.id,
        promoId,
      ]);
      res.json({ message: 'Promotion dismissal removed.', promoId });
    })
  );

  api.get(
    '/promos/:id',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const promoId = Number(req.params.id);
      const allPromos = await loadHydratedPromos();
      const promo = allPromos.find((p) => p.id === promoId);
      if (!promo) {
        res.status(404).json({ message: 'Promotion not found.' });
        return;
      }

      const redemptions = await db.queryAll(
        `SELECT pr.*, o.order_number, o.subtotal AS order_subtotal, o.total_amount AS order_total, o.status AS order_status,
                f.store_name, f.owner_name
         FROM promo_redemptions pr
         JOIN orders o ON o.id = pr.order_id
         JOIN franchisees f ON f.id = pr.franchisee_id
         WHERE pr.promo_id = $1
         ORDER BY pr.id DESC`,
        [promoId]
      );

      res.json({ promo, redemptions });
    })
  );

  const savePromoRelations = async (promoId: number, body: any, executor: DbExecutor = db) => {
    await executor.execute('DELETE FROM promo_products WHERE promo_id = $1', [promoId]);
    await executor.execute('DELETE FROM promo_categories WHERE promo_id = $1', [promoId]);
    await executor.execute('DELETE FROM promo_tiers WHERE promo_id = $1', [promoId]);
    await executor.execute('DELETE FROM promo_targets WHERE promo_id = $1', [promoId]);

    if (Array.isArray(body.product_ids)) {
      for (const pid of body.product_ids) {
        if (Number(pid) > 0) {
          await executor.execute(
            'INSERT INTO promo_products (promo_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [promoId, Number(pid)]
          );
        }
      }
    }
    if (Array.isArray(body.category_ids)) {
      for (const cid of body.category_ids) {
        if (Number(cid) > 0) {
          await executor.execute(
            'INSERT INTO promo_categories (promo_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [promoId, Number(cid)]
          );
        }
      }
    }
    if (Array.isArray(body.tiers)) {
      for (const t of body.tiers) {
        if (Number(t.min_quantity_or_amount) > 0 && Number(t.discount_value) > 0) {
          await executor.execute(
            'INSERT INTO promo_tiers (promo_id, min_quantity_or_amount, discount_value) VALUES ($1, $2, $3)',
            [promoId, Number(t.min_quantity_or_amount), Number(t.discount_value)]
          );
        }
      }
    }
    if (Array.isArray(body.target_franchisee_ids)) {
      for (const fid of body.target_franchisee_ids) {
        if (Number(fid) > 0) {
          await executor.execute(
            'INSERT INTO promo_targets (promo_id, franchisee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [promoId, Number(fid)]
          );
        }
      }
    }
  };

  api.post(
    '/promos',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const body = req.body;
      const validation = validatePromoPayload(body);
      if (!validation.ok) {
        res.status(400).json({ message: validation.error });
        return;
      }

      const dup = await db.queryOne(
        `SELECT id FROM promos
         WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
           AND status != 'Expired'
           AND start_date::date <= $2::date
           AND end_date::date >= $3::date`,
        [
          String(body.name).trim(),
          String(body.end_date).slice(0, 10),
          String(body.start_date).slice(0, 10),
        ]
      );
      if (dup) {
        res.status(409).json({
          message: 'An overlapping promotion with the same name already exists in this date range.',
        });
        return;
      }

      const status = ['Draft', 'Active', 'Paused'].includes(body.status) ? body.status : 'Draft';

      const promoId = await db.transaction(async (tx) => {
        const row = await tx.queryOne<{ id: number }>(
          `INSERT INTO promos (
             name, description, promo_type, tier_basis, discount_type, discount_value,
             min_order_amount, min_quantity, buy_quantity, free_quantity, free_product_id,
             free_delivery, max_discount_cap, scope, start_date, end_date, recurring_monthly,
             usage_limit_total, usage_limit_per_franchisee, stackable, status, created_by
           ) VALUES (
             $1, $2, $3, $4, $5, $6,
             $7, $8, $9, $10, $11,
             $12, $13, $14, $15, $16, $17,
             $18, $19, $20, $21, $22
           )
           RETURNING id`,
          [
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
            req.user!.id,
          ]
        );

        const newPromoId = Number(row!.id);
        await savePromoRelations(newPromoId, body, tx);

        await logActivity(
          req.user!.id,
          'PROMO_CREATED',
          'promo',
          newPromoId,
          `Created promo "${String(body.name).trim()}" (${status})`,
          tx
        );

        if (status === 'Active') {
          const preview = formatPromoHowItWorks(body);
          await notifyTargetedFranchiseesForPromo(
            newPromoId,
            `New Active Promo: ${String(body.name).trim()}`,
            `${preview}. Valid until ${String(body.end_date).slice(0, 10)}. Discount applies automatically at checkout!`,
            tx
          );
        }

        return newPromoId;
      });

      res.status(201).json({ message: 'Promotion created successfully.', id: promoId });
    })
  );

  api.put(
    '/promos/:id',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const promoId = Number(req.params.id);
      const existing = await db.queryOne<any>('SELECT * FROM promos WHERE id = $1', [promoId]);
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

      const dup = await db.queryOne(
        `SELECT id FROM promos
         WHERE id != $1
           AND LOWER(TRIM(name)) = LOWER(TRIM($2))
           AND status != 'Expired'
           AND start_date::date <= $3::date
           AND end_date::date >= $4::date`,
        [
          promoId,
          String(body.name).trim(),
          String(body.end_date).slice(0, 10),
          String(body.start_date).slice(0, 10),
        ]
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

      const allPromos = await loadHydratedPromos();
      const existingHydrated = allPromos.find((p) => p.id === promoId);
      const rulesOrDatesChanged = existingHydrated
        ? hasPromoRulesOrDatesChanged(existingHydrated, body)
        : true;

      await db.transaction(async (tx) => {
        await tx.execute(
          `UPDATE promos
           SET name = $1, description = $2, promo_type = $3, tier_basis = $4, discount_type = $5, discount_value = $6,
               min_order_amount = $7, min_quantity = $8, buy_quantity = $9, free_quantity = $10, free_product_id = $11,
               free_delivery = $12, max_discount_cap = $13, scope = $14, start_date = $15, end_date = $16, recurring_monthly = $17,
               usage_limit_total = $18, usage_limit_per_franchisee = $19, stackable = $20, status = $21, updated_at = CURRENT_TIMESTAMP
           WHERE id = $22`,
          [
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
            promoId,
          ]
        );

        await savePromoRelations(promoId, body, tx);

        if (rulesOrDatesChanged) {
          await tx.execute('DELETE FROM promo_dismissals WHERE promo_id = $1', [promoId]);
        }

        await logActivity(
          req.user!.id,
          'PROMO_UPDATED',
          'promo',
          promoId,
          `Updated promo "${String(body.name).trim()}" (${status})${
            rulesOrDatesChanged ? ' [dismissals reset]' : ''
          }`,
          tx
        );

        if (existing.status !== 'Active' && status === 'Active') {
          const preview = formatPromoHowItWorks(body);
          await notifyTargetedFranchiseesForPromo(
            promoId,
            `New Active Promo: ${String(body.name).trim()}`,
            `${preview}. Valid until ${String(body.end_date).slice(0, 10)}. Discount applies automatically at checkout!`,
            tx
          );
        }
      });

      res.json({ message: 'Promotion updated successfully.' });
    })
  );

  api.patch(
    '/promos/:id/status',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const promoId = Number(req.params.id);
      const { status } = req.body;
      if (!['Draft', 'Active', 'Paused', 'Expired'].includes(status)) {
        res.status(400).json({ message: 'Invalid promo status.' });
        return;
      }

      const existing = await db.queryOne<any>('SELECT * FROM promos WHERE id = $1', [promoId]);
      if (!existing) {
        res.status(404).json({ message: 'Promotion not found.' });
        return;
      }

      await db.execute(
        'UPDATE promos SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [status, promoId]
      );

      const actionLabel =
        status === 'Paused'
          ? 'PROMO_PAUSED'
          : status === 'Active'
          ? 'PROMO_ACTIVATED'
          : status === 'Expired'
          ? 'PROMO_ENDED'
          : 'PROMO_STATUS_CHANGED';

      await logActivity(
        req.user!.id,
        actionLabel,
        'promo',
        promoId,
        `${existing.name} -> ${status}`
      );

      if (existing.status !== 'Active' && status === 'Active') {
        const allPromos = await loadHydratedPromos();
        const hydrated = allPromos.find((p) => p.id === promoId);
        if (hydrated) {
          await notifyTargetedFranchiseesForPromo(
            promoId,
            `New Active Promo: ${hydrated.name}`,
            `${hydrated.how_it_works}. Valid until ${hydrated.end_date}. Discount applies automatically at checkout!`
          );
        }
      }

      res.json({ message: `Promotion status changed to ${status}.` });
    })
  );

  api.post(
    '/promos/:id/duplicate',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const promoId = Number(req.params.id);
      const allPromos = await loadHydratedPromos();
      const hydrated = allPromos.find((p) => p.id === promoId);
      if (!hydrated) {
        res.status(404).json({ message: 'Promotion not found.' });
        return;
      }

      const copyName = `${hydrated.name} (Copy ${Date.now().toString().slice(-4)})`;
      const newId = await db.transaction(async (tx) => {
        const row = await tx.queryOne<{ id: number }>(
          `INSERT INTO promos (
             name, description, promo_type, tier_basis, discount_type, discount_value,
             min_order_amount, min_quantity, buy_quantity, free_quantity, free_product_id,
             free_delivery, max_discount_cap, scope, start_date, end_date, recurring_monthly,
             usage_limit_total, usage_limit_per_franchisee, stackable, status, created_by
           ) VALUES (
             $1, $2, $3, $4, $5, $6,
             $7, $8, $9, $10, $11,
             $12, $13, $14, $15, $16, $17,
             $18, $19, $20, 'Draft', $21
           )
           RETURNING id`,
          [
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
            req.user!.id,
          ]
        );
        const dupId = Number(row!.id);
        await savePromoRelations(
          dupId,
          {
            product_ids: hydrated.product_ids,
            category_ids: hydrated.category_ids,
            tiers: hydrated.tiers,
            target_franchisee_ids: hydrated.target_franchisee_ids,
          },
          tx
        );

        await logActivity(
          req.user!.id,
          'PROMO_DUPLICATED',
          'promo',
          dupId,
          `Duplicated promo #${promoId} as "${copyName}"`,
          tx
        );
        return dupId;
      });

      res.status(201).json({ message: 'Promotion duplicated as Draft.', id: newId });
    })
  );

  api.post(
    '/promos/evaluate-cart',
    authorize('franchisee'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
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
        const prod = await db.queryOne<{
          id: number;
          category_id: number;
          name: string;
          price: number;
        }>('SELECT id, category_id, name, price FROM products WHERE id = $1 AND is_active = 1', [
          Number(item.product_id),
        ]);
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

      const [promos, todayStr] = await Promise.all([
        loadHydratedPromos(req.user!.franchiseeId),
        getTodaySqlDate(),
      ]);
      const evaluation = evaluatePromosForCart(cartEvalItems, promos, {
        franchiseeId: Number(req.user!.franchiseeId),
        todayStr,
      });

      res.json(evaluation);
    })
  );

  // ===== ORDERS (Franchisee & Admin — Real PostgreSQL Transactions & Stock Locking) =====
  api.post(
    '/orders',
    authorize('franchisee'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const appRow = await db.queryOne<{ status: string; application_no: string }>(
        'SELECT status, application_no FROM franchisee_applications WHERE user_id = $1',
        [req.user!.id]
      );
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
        const firstWh = await db.queryOne<{ id: number }>(
          'SELECT id FROM warehouses WHERE is_active = 1 ORDER BY id ASC LIMIT 1'
        );
        whId = firstWh?.id || 0;
      }
      if (!whId) {
        res.status(423).json({ message: 'No active warehouse available.' });
        return;
      }

      const whOverview = await computeWarehouseProductStockMetrics(whId);
      const metricMap = new Map<number, any>();
      if (whOverview) {
        for (const m of whOverview.products) {
          metricMap.set(m.product_id, m);
        }
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

        const prod = await db.queryOne<{
          id: number;
          category_id: number;
          name: string;
          price: number;
          max_reservation_qty: number | null;
        }>(
          `SELECT p.id, p.category_id, p.name, p.price, p.max_reservation_qty
           FROM products p
           WHERE p.id = $1 AND p.is_active = 1`,
          [Number(item.product_id)]
        );

        if (!prod) {
          res.status(404).json({ message: `Product #${item.product_id} not found.` });
          return;
        }

        const metric = metricMap.get(prod.id);
        const availableStock = metric ? metric.available_stock : 0;

        if (availableStock <= 0) {
          const msg = metric?.franchisee_availability?.message || 'No Stock';
          res.status(400).json({
            message: `${prod.name}: ${msg}. New reservations are blocked until stock is replenished.`,
          });
          return;
        }
        if (prod.max_reservation_qty && qty > Number(prod.max_reservation_qty)) {
          res.status(400).json({
            message: `${prod.name} is limited to a maximum of ${prod.max_reservation_qty} units per franchisee reservation.`,
          });
          return;
        }
        if (availableStock < qty) {
          res.status(400).json({
            message: `Insufficient available stock for ${prod.name} (available: ${availableStock}).`,
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
          stock: availableStock,
        });
      }

      const [promos, todayStr] = await Promise.all([
        loadHydratedPromos(req.user!.franchiseeId),
        getTodaySqlDate(),
      ]);
      const promoEval = evaluatePromosForCart(normalizedItems, promos, {
        franchiseeId: Number(req.user!.franchiseeId),
        todayStr,
      });

      for (const fi of promoEval.free_items) {
        const paidItem = normalizedItems.find((n) => n.product_id === fi.product_id);
        const totalNeeded = (paidItem ? paidItem.quantity : 0) + fi.free_qty;
        const metric = metricMap.get(fi.product_id);
        const avail = metric ? metric.available_stock : 0;
        if (avail < totalNeeded) {
          res.status(400).json({
            message: `Insufficient available warehouse stock to include ${fi.free_qty} free box(es) of ${fi.name} (needed: ${totalNeeded}, available: ${avail}).`,
          });
          return;
        }
      }

      const orderNumber = `AICE-${Date.now().toString().slice(-6)}-${Math.floor(
        100 + Math.random() * 900
      )}`;

      const orderId = await db.transaction(async (tx) => {
        const oRes = await tx.queryOne<{ id: number }>(
          `INSERT INTO orders (
             order_number, franchisee_id, warehouse_id, status,
             subtotal, discount_amount, delivery_fee, total_amount,
             promo_id, applied_promos_json, requested_delivery_datetime, notes
           ) VALUES ($1, $2, $3, 'Placed', $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING id`,
          [
            orderNumber,
            req.user!.franchiseeId,
            whId,
            promoEval.subtotal,
            promoEval.discount_amount,
            promoEval.delivery_fee,
            promoEval.final_total,
            promoEval.primary_promo_id,
            promoEval.applied_promos.length > 0 ? JSON.stringify(promoEval.applied_promos) : null,
            requested_delivery_datetime || null,
            notes ? String(notes).trim() : null,
          ]
        );

        const newOrderId = Number(oRes!.id);

        for (const ni of normalizedItems) {
          const itemDisc = Number(promoEval.item_discounts[ni.product_id] || 0);
          await tx.execute(
            `INSERT INTO order_items (
               order_id, product_id, quantity, unit_price, subtotal, discount_amount, is_free_item
             ) VALUES ($1, $2, $3, $4, $5, $6, 0)`,
            [newOrderId, ni.product_id, ni.quantity, ni.unit_price, ni.subtotal, itemDisc]
          );
        }

        for (const fi of promoEval.free_items) {
          await tx.execute(
            `INSERT INTO order_items (
               order_id, product_id, quantity, unit_price, subtotal, discount_amount, is_free_item
             ) VALUES ($1, $2, $3, 0, 0, $4, 1)`,
            [newOrderId, fi.product_id, fi.free_qty, fi.free_value]
          );
        }

        for (const ap of promoEval.applied_promos) {
          const recordedDiscount = Number(
            (Number(ap.discount_amount || 0) + Number(ap.free_items_value || 0)).toFixed(2)
          );
          await tx.execute(
            `INSERT INTO promo_redemptions (promo_id, order_id, franchisee_id, discount_amount)
             VALUES ($1, $2, $3, $4)`,
            [ap.promo_id, newOrderId, req.user!.franchiseeId, recordedDiscount]
          );
        }

        const promoSummaryNote =
          promoEval.applied_promos.length > 0
            ? ` (Promo applied: ${promoEval.applied_promos.map((p) => p.name).join(', ')})`
            : '';

        await tx.execute(
          'INSERT INTO order_status_history (order_id, status, notes, changed_by) VALUES ($1, $2, $3, $4)',
          [newOrderId, 'Placed', `Order placed by franchisee${promoSummaryNote}`, req.user!.id]
        );

        await notifyAdmins(
          'New Replenishment Order',
          `${req.user!.storeName} placed order ${orderNumber} (Total PHP ${promoEval.final_total.toFixed(
            2
          )}${promoSummaryNote}).`,
          'order',
          newOrderId,
          tx
        );
        await logActivity(
          req.user!.id,
          'ORDER_PLACED',
          'order',
          newOrderId,
          `Placed ${orderNumber} totaling PHP ${promoEval.final_total.toFixed(2)}${promoSummaryNote}`,
          tx
        );
        return newOrderId;
      });

      // Immediately evaluate Low Stock / No Stock restock triggers for every ordered product
      const affectedProductIds = Array.from(
        new Set([
          ...normalizedItems.map((i) => i.product_id),
          ...promoEval.free_items.map((fi) => fi.product_id),
        ])
      );
      for (const pid of affectedProductIds) {
        await evaluateProductRestockTrigger(whId, pid, req.user!.id);
      }

      res.status(201).json({
        message: 'Order placed successfully.',
        id: orderId,
        order_number: orderNumber,
        promo_evaluation: promoEval,
      });
    })
  );

  api.get(
    '/orders',
    authorize('admin', 'franchisee'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const { page, limit, offset } = parsePagination(req.query);
      const search = `%${String(req.query.search || '').trim()}%`;
      const status = String(req.query.status || '');
      const params: any[] = [search];
      let where = 'WHERE (o.order_number ILIKE $1 OR f.store_name ILIKE $1)';

      if (req.user!.role === 'franchisee') {
        params.push(req.user!.franchiseeId);
        where += ` AND o.franchisee_id = $${params.length}`;
      }
      if (status) {
        params.push(status);
        where += ` AND o.status = $${params.length}`;
      }

      const totalRow = await db.queryOne<{ total: number }>(
        `SELECT COUNT(*) AS total FROM orders o JOIN franchisees f ON f.id = o.franchisee_id ${where}`,
        params
      );

      const rows = await db.queryAll<any>(
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
         ORDER BY o.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );

      for (const r of rows) {
        r.items = await db.queryAll(
          `SELECT oi.*, p.name AS product_name, p.flavor, p.size, p.image_url
           FROM order_items oi
           JOIN products p ON p.id = oi.product_id
           WHERE oi.order_id = $1`,
          [r.id]
        );
      }

      const total = totalRow?.total ?? 0;
      res.json({
        data: rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      });
    })
  );

  api.post(
    '/orders/:id/cancel',
    authorize('franchisee'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const orderId = Number(req.params.id);
      const { reason } = req.body;
      const order = await db.queryOne<any>(
        'SELECT * FROM orders WHERE id = $1 AND franchisee_id = $2',
        [orderId, req.user!.franchiseeId]
      );

      if (!order) {
        res.status(404).json({ message: 'Order not found.' });
        return;
      }
      if (order.status !== 'Placed') {
        res
          .status(400)
          .json({ message: 'Only Placed orders can be cancelled by the franchisee.' });
        return;
      }

      await db.transaction(async (tx) => {
        await tx.execute(
          "UPDATE orders SET status = 'Cancelled', cancel_reason = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
          [reason || 'Cancelled by franchisee', orderId]
        );
        await tx.execute('DELETE FROM promo_redemptions WHERE order_id = $1', [orderId]);
        await tx.execute(
          "INSERT INTO order_status_history (order_id, status, notes, changed_by) VALUES ($1, 'Cancelled', $2, $3)",
          [orderId, reason || 'Cancelled by franchisee (promo redemption reversed)', req.user!.id]
        );
        await logActivity(
          req.user!.id,
          'ORDER_CANCELLED',
          'order',
          orderId,
          `Cancelled ${order.order_number} and restored promo usage`,
          tx
        );
      });

      res.json({ message: 'Order cancelled and promotion usage restored.' });
    })
  );

  api.patch(
    '/orders/:id/status',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const orderId = Number(req.params.id);
      const { status, notes } = req.body;
      const allowed = ['Confirmed', 'Preparing', 'Cancelled', 'Rejected'];
      if (!allowed.includes(status)) {
        res.status(400).json({ message: 'Invalid status transition.' });
        return;
      }

      try {
        const result = await db.transaction(async (tx) => {
          const order = await tx.queryOne<any>(
            `SELECT o.*, f.user_id AS franchisee_user_id, f.store_name
             FROM orders o JOIN franchisees f ON f.id = o.franchisee_id
             WHERE o.id = $1
             FOR UPDATE OF o`,
            [orderId]
          );

          if (!order) {
            return { notFound: true as const };
          }

          const items = await tx.queryAll<any>('SELECT * FROM order_items WHERE order_id = $1', [
            orderId,
          ]);

          if (status === 'Confirmed' && !order.stock_deducted) {
            for (const it of items) {
              const inv = await tx.queryOne<{ id: number; quantity: number }>(
                'SELECT id, quantity FROM inventory WHERE warehouse_id = $1 AND product_id = $2 FOR UPDATE',
                [order.warehouse_id, it.product_id]
              );
              const curQty = inv ? inv.quantity : 0;
              if (curQty < it.quantity) {
                throw new Error(
                  `Insufficient warehouse stock for product #${it.product_id} (available: ${curQty}, needed: ${it.quantity}).`
                );
              }
              const newQty = curQty - it.quantity;
              await tx.execute(
                'UPDATE inventory SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                [newQty, inv!.id]
              );
              await tx.execute(
                `INSERT INTO stock_movements (warehouse_id, product_id, movement_type, quantity_change, previous_qty, new_qty, reference_order_id, notes, performed_by)
                 VALUES ($1, $2, 'ORDER_DEDUCT', $3, $4, $5, $6, $7, $8)`,
                [
                  order.warehouse_id,
                  it.product_id,
                  -it.quantity,
                  curQty,
                  newQty,
                  order.id,
                  `Confirmed ${order.order_number}${it.is_free_item ? ' (Promo Free Item)' : ''}`,
                  req.user!.id,
                ]
              );
            }
            await tx.execute('UPDATE orders SET stock_deducted = 1 WHERE id = $1', [orderId]);
          }

          if (status === 'Cancelled' || status === 'Rejected') {
            await tx.execute('DELETE FROM promo_redemptions WHERE order_id = $1', [orderId]);

            if (order.stock_deducted) {
              for (const it of items) {
                const inv = await tx.queryOne<{ id: number; quantity: number }>(
                  'SELECT id, quantity FROM inventory WHERE warehouse_id = $1 AND product_id = $2 FOR UPDATE',
                  [order.warehouse_id, it.product_id]
                );
                const curQty = inv ? inv.quantity : 0;
                const newQty = curQty + it.quantity;
                if (inv) {
                  await tx.execute(
                    'UPDATE inventory SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                    [newQty, inv.id]
                  );
                } else {
                  await tx.execute(
                    'INSERT INTO inventory (warehouse_id, product_id, quantity) VALUES ($1, $2, $3)',
                    [order.warehouse_id, it.product_id, newQty]
                  );
                }
                await tx.execute(
                  `INSERT INTO stock_movements (warehouse_id, product_id, movement_type, quantity_change, previous_qty, new_qty, reference_order_id, notes, performed_by)
                   VALUES ($1, $2, 'ORDER_RESTORE', $3, $4, $5, $6, $7, $8)`,
                  [
                    order.warehouse_id,
                    it.product_id,
                    it.quantity,
                    curQty,
                    newQty,
                    order.id,
                    `${status} ${order.order_number}`,
                    req.user!.id,
                  ]
                );
              }
              await tx.execute(
                'UPDATE orders SET stock_deducted = 0, cancel_reason = $1 WHERE id = $2',
                [notes || null, orderId]
              );
            }
          }

          await tx.execute(
            'UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [status, orderId]
          );
          await tx.execute(
            'INSERT INTO order_status_history (order_id, status, notes, changed_by) VALUES ($1, $2, $3, $4)',
            [orderId, status, notes || `Status changed to ${status}`, req.user!.id]
          );

          await notifyUser(
            order.franchisee_user_id,
            `Order ${order.order_number} ${status}`,
            `Your order status is now: ${status}.`,
            'order',
            order.id,
            tx
          );
          await logActivity(
            req.user!.id,
            'ORDER_STATUS_UPDATED',
            'order',
            orderId,
            `${order.order_number} -> ${status}`,
            tx
          );

          return {
            notFound: false as const,
            warehouseId: Number(order.warehouse_id),
            productIds: Array.from(new Set(items.map((it: any) => Number(it.product_id)))),
          };
        });

        if (result.notFound) {
          res.status(404).json({ message: 'Order not found.' });
          return;
        }

        // Re-evaluate restock triggers for affected products after status transition
        for (const pid of result.productIds) {
          await evaluateProductRestockTrigger(result.warehouseId, pid, req.user!.id);
        }

        res.json({ message: `Order updated to ${status}.` });
      } catch (err: any) {
        res.status(400).json({ message: err.message || 'Failed to update order status.' });
      }
    })
  );

  api.post(
    '/orders/:id/assign-delivery',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const orderId = Number(req.params.id);
      const { delivery_staff_id } = req.body;
      if (!delivery_staff_id) {
        res.status(400).json({ message: 'Please select a delivery staff member.' });
        return;
      }

      const order = await db.queryOne<any>(
        `SELECT o.*, f.user_id AS franchisee_user_id, f.store_name
         FROM orders o JOIN franchisees f ON f.id = o.franchisee_id
         WHERE o.id = $1`,
        [orderId]
      );

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

      await db.transaction(async (tx) => {
        const existing = await tx.queryOne<{ id: number }>(
          'SELECT id FROM deliveries WHERE order_id = $1',
          [orderId]
        );

        if (existing) {
          await tx.execute(
            "UPDATE deliveries SET delivery_staff_id = $1, status = 'Assigned', updated_at = CURRENT_TIMESTAMP WHERE order_id = $2",
            [Number(delivery_staff_id), orderId]
          );
        } else {
          await tx.execute(
            "INSERT INTO deliveries (order_id, delivery_staff_id, status) VALUES ($1, $2, 'Assigned')",
            [orderId, Number(delivery_staff_id)]
          );
        }

        await tx.execute(
          "UPDATE orders SET status = 'Assigned to Delivery', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
          [orderId]
        );
        await tx.execute(
          "INSERT INTO order_status_history (order_id, status, notes, changed_by) VALUES ($1, 'Assigned to Delivery', $2, $3)",
          [orderId, `Assigned to delivery staff #${delivery_staff_id}`, req.user!.id]
        );

        await notifyUser(
          Number(delivery_staff_id),
          'New Delivery Assigned',
          `Order ${order.order_number} for ${order.store_name} is assigned to you.`,
          'delivery',
          order.id,
          tx
        );
        await notifyUser(
          order.franchisee_user_id,
          'Delivery Staff Assigned',
          `Order ${order.order_number} has been assigned to a delivery rider.`,
          'order',
          order.id,
          tx
        );
        await logActivity(
          req.user!.id,
          'DELIVERY_ASSIGNED',
          'order',
          orderId,
          `Assigned rider #${delivery_staff_id} to ${order.order_number}`,
          tx
        );
      });

      res.json({ message: 'Delivery staff assigned.' });
    })
  );

  api.get(
    '/orders/:id/tracking',
    authorize('admin', 'franchisee'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const orderId = Number(req.params.id);
      const order = await db.queryOne<any>(
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
         WHERE o.id = $1`,
        [orderId]
      );

      if (!order) {
        res.status(404).json({ message: 'Order not found.' });
        return;
      }
      if (req.user!.role === 'franchisee' && order.franchisee_id !== req.user!.franchiseeId) {
        res.status(403).json({ message: 'Forbidden.' });
        return;
      }

      const [items, history] = await Promise.all([
        db.queryAll(
          `SELECT oi.*, p.name AS product_name, p.flavor, p.size, p.image_url
           FROM order_items oi JOIN products p ON p.id = oi.product_id
           WHERE oi.order_id = $1`,
          [orderId]
        ),
        db.queryAll(
          `SELECT osh.*, u.full_name AS changed_by_name
           FROM order_status_history osh
           LEFT JOIN users u ON u.id = osh.changed_by
           WHERE osh.order_id = $1
           ORDER BY osh.id ASC`,
          [orderId]
        ),
      ]);

      let liveLocation: any = null;
      let etaMinutes: number | null = null;

      if (order.delivery_id) {
        const loc = await db.queryOne<{ lat: number; lng: number; recorded_at: string }>(
          'SELECT lat, lng, recorded_at FROM delivery_locations WHERE delivery_id = $1 ORDER BY id DESC LIMIT 1',
          [order.delivery_id]
        );

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
    })
  );

  // ===== DELIVERIES (Delivery Staff) =====
  api.get(
    '/deliveries',
    authorize('delivery'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const { page, limit, offset } = parsePagination(req.query);
      const mode = req.query.mode;
      const params: any[] = [req.user!.id];
      let where = 'WHERE d.delivery_staff_id = $1';
      if (mode === 'active') where += " AND d.status != 'Delivered'";
      if (mode === 'history') where += " AND d.status = 'Delivered'";

      const totalRow = await db.queryOne<{ total: number }>(
        `SELECT COUNT(*) AS total FROM deliveries d ${where}`,
        params
      );

      const rows = await db.queryAll<any>(
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
         ORDER BY d.id DESC LIMIT $2 OFFSET $3`,
        [...params, limit, offset]
      );

      for (const r of rows) {
        r.items = await db.queryAll(
          `SELECT oi.*, p.name AS product_name, p.flavor, p.size, p.image_url
           FROM order_items oi
           JOIN products p ON p.id = oi.product_id
           WHERE oi.order_id = $1`,
          [r.order_id]
        );
      }

      const total = totalRow?.total ?? 0;
      res.json({
        data: rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      });
    })
  );

  api.patch(
    '/deliveries/:id/status',
    authorize('delivery'),
    requireWarehouse,
    uploadProofImage.single('proof_image'),
    asyncHandler(async (req, res) => {
      const deliveryId = Number(req.params.id);
      const { status, proof_note } = req.body;
      const allowed = ['Picked Up', 'Out for Delivery', 'Near / Arrived', 'Delivered'];
      if (!allowed.includes(status)) {
        res.status(400).json({ message: 'Invalid delivery status.' });
        return;
      }

      const del = await db.queryOne<any>(
        `SELECT d.*, o.order_number, f.user_id AS franchisee_user_id
         FROM deliveries d
         JOIN orders o ON o.id = d.order_id
         JOIN franchisees f ON f.id = o.franchisee_id
         WHERE d.id = $1 AND d.delivery_staff_id = $2`,
        [deliveryId, req.user!.id]
      );

      if (!del) {
        res.status(404).json({ message: 'Delivery not found.' });
        return;
      }

      let orderStatus = 'Assigned to Delivery';
      let timestampUpdate = '';

      if (status === 'Picked Up') {
        timestampUpdate =
          ', accepted_at = COALESCE(accepted_at, CURRENT_TIMESTAMP), picked_up_at = CURRENT_TIMESTAMP';
        orderStatus = 'Assigned to Delivery';
      } else if (status === 'Out for Delivery') {
        timestampUpdate =
          ', accepted_at = COALESCE(accepted_at, CURRENT_TIMESTAMP), out_for_delivery_at = CURRENT_TIMESTAMP';
        orderStatus = 'Out for Delivery';
      } else if (status === 'Near / Arrived') {
        timestampUpdate = ', arrived_at = CURRENT_TIMESTAMP, near_notified = 1';
        orderStatus = 'Near / Arrived';
      } else if (status === 'Delivered') {
        timestampUpdate = ', delivered_at = CURRENT_TIMESTAMP';
        orderStatus = 'Delivered';
      }

      await db.transaction(async (tx) => {
        const proofImageUrl = req.file
          ? await saveUploadedFile('proofs', 'proof', req.file, tx)
          : del.proof_image_url;

        await tx.execute(
          `UPDATE deliveries
           SET status = $1, proof_note = COALESCE($2::text, proof_note), proof_image_url = $3, updated_at = CURRENT_TIMESTAMP ${timestampUpdate}
           WHERE id = $4`,
          [status, proof_note || null, proofImageUrl, deliveryId]
        );

        await tx.execute(
          'UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [orderStatus, del.order_id]
        );

        await tx.execute(
          'INSERT INTO order_status_history (order_id, status, notes, changed_by) VALUES ($1, $2, $3, $4)',
          [del.order_id, orderStatus, proof_note || `Delivery updated: ${status}`, req.user!.id]
        );

        await notifyUser(
          del.franchisee_user_id,
          `Delivery Update: ${status}`,
          `Order ${del.order_number} is now ${status}.`,
          'delivery',
          del.order_id,
          tx
        );

        await logActivity(
          req.user!.id,
          'DELIVERY_STATUS_UPDATED',
          'delivery',
          deliveryId,
          `${del.order_number} -> ${status}`,
          tx
        );
      });

      res.json({ message: `Delivery status updated to ${status}.` });
    })
  );

  api.post(
    '/deliveries/:id/location',
    authorize('delivery'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const deliveryId = Number(req.params.id);
      const { lat, lng } = req.body;
      if (!isValidCoords(lat, lng)) {
        res.status(400).json({ message: 'Invalid GPS coordinates.' });
        return;
      }

      const del = await db.queryOne(
        "SELECT id FROM deliveries WHERE id = $1 AND delivery_staff_id = $2 AND status != 'Delivered'",
        [deliveryId, req.user!.id]
      );
      if (!del) {
        res.status(404).json({ message: 'Active delivery not found.' });
        return;
      }

      await db.execute(
        'INSERT INTO delivery_locations (delivery_id, lat, lng) VALUES ($1, $2, $3)',
        [deliveryId, Number(lat), Number(lng)]
      );
      res.json({ message: 'Location recorded.' });
    })
  );

  api.post(
    '/deliveries/:id/notify-near',
    authorize('delivery'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const deliveryId = Number(req.params.id);
      const del = await db.queryOne<any>(
        `SELECT d.*, o.order_number, f.user_id AS franchisee_user_id
         FROM deliveries d
         JOIN orders o ON o.id = d.order_id
         JOIN franchisees f ON f.id = o.franchisee_id
         WHERE d.id = $1 AND d.delivery_staff_id = $2`,
        [deliveryId, req.user!.id]
      );

      if (!del) {
        res.status(404).json({ message: 'Delivery not found.' });
        return;
      }

      await db.execute('UPDATE deliveries SET near_notified = 1 WHERE id = $1', [deliveryId]);
      await notifyUser(
        del.franchisee_user_id,
        'Delivery Rider Nearby!',
        `Your rider (${req.user!.full_name}) is near your store with order ${del.order_number}. Please prepare your freezer to receive the stock.`,
        'near',
        del.order_id
      );
      res.json({ message: 'Franchisee notified that you are near.' });
    })
  );
}
