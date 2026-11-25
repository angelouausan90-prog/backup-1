import type { Router } from 'express';
import db from '../db.ts';
import {
  asyncHandler,
  authorize,
  requireWarehouse,
  parsePagination,
  getTodaySqlDate,
  logActivity,
} from '../helpers.ts';
import {
  checkOverdueRestocks,
  computeWarehouseProductStockMetrics,
  getRestockLeadTimeDays,
  getWarehouseTotalPhysicalStock,
  notifyFranchiseesBackInStock,
  runMonthlyRestockCheck,
} from '../services/restockingService.ts';
import {
  checkTargetsAgainstCapacity,
  computeExpectedArrivalDate,
  isRestockOverdue,
  sortRestockRecommendations,
  validateCapacityForIncoming,
} from '../../src/utils/restockingRules.ts';

function parsePositiveInt(val: unknown): number | null {
  if (val === null || val === undefined || String(val).trim() === '') return null;
  const n = Number(val);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function parseNonNegativeInt(val: unknown): number | null {
  if (val === null || val === undefined || String(val).trim() === '') return null;
  const n = Number(val);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

export function registerRestockingRoutes(api: Router) {
  // ===== 1. SETTINGS & CAPACITY WARNINGS =====
  api.get(
    '/restocking/settings',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const requestedWh = parsePositiveInt(req.query.warehouse_id);
      const [leadTimeDays, warehouses, products] = await Promise.all([
        getRestockLeadTimeDays(),
        db.queryAll<{
          id: number;
          name: string;
          address: string;
          capacity_limit: number;
          is_active: number;
          current_total_stock: number;
        }>(
          `SELECT w.id, w.name, w.address,
                  COALESCE(w.capacity_limit, 1000)::int AS capacity_limit,
                  w.is_active,
                  COALESCE((SELECT SUM(i.quantity) FROM inventory i WHERE i.warehouse_id = w.id), 0)::int AS current_total_stock
           FROM warehouses w
           WHERE w.is_active = 1
           ORDER BY w.id ASC`
        ),
        db.queryAll<{
          id: number;
          sku: string;
          name: string;
          flavor: string;
          size: string;
          category_name: string;
          target_quantity: number;
          safety_stock: number;
          max_reservation_qty: number | null;
        }>(
          `SELECT p.id, p.sku, p.name, p.flavor, p.size, c.name AS category_name,
                  COALESCE(p.target_quantity, 100)::int AS target_quantity,
                  COALESCE(p.safety_stock, 15)::int AS safety_stock,
                  p.max_reservation_qty
           FROM products p
           JOIN categories c ON c.id = p.category_id
           WHERE p.is_active = 1
           ORDER BY p.name ASC`
        ),
      ]);

      const totalTargets = products.reduce((sum, p) => sum + Number(p.target_quantity || 0), 0);
      const warehousesWithWarnings = warehouses.map((w) => {
        const capCheck = checkTargetsAgainstCapacity(totalTargets, Number(w.capacity_limit || 0));
        return {
          ...w,
          total_targets: totalTargets,
          targets_exceed_capacity: capCheck.exceeds,
          targets_excess: capCheck.excess,
        };
      });

      const activeWhId = requestedWh || warehousesWithWarnings[0]?.id || null;
      const preview = activeWhId ? await computeWarehouseProductStockMetrics(activeWhId) : null;

      res.json({
        lead_time_days: leadTimeDays,
        total_targets: totalTargets,
        warehouses: warehousesWithWarnings,
        products,
        preview,
      });
    })
  );

  api.put(
    '/restocking/settings',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const { lead_time_days, warehouse_id, capacity_limit, products } = req.body || {};

      if (lead_time_days !== undefined) {
        const lt = parsePositiveInt(lead_time_days);
        if (!lt || lt > 90) {
          res.status(400).json({ message: 'Delivery lead time must be an integer between 1 and 90 days.' });
          return;
        }
      }

      if (warehouse_id !== undefined && capacity_limit !== undefined) {
        const cap = parsePositiveInt(capacity_limit);
        if (!cap || cap > 10_000_000) {
          res.status(400).json({ message: 'Warehouse capacity limit must be a positive integer.' });
          return;
        }
      }

      if (Array.isArray(products)) {
        for (const p of products) {
          if (!parsePositiveInt(p.id)) {
            res.status(400).json({ message: 'Invalid product ID in settings update.' });
            return;
          }
          const tq = parseNonNegativeInt(p.target_quantity);
          const ss = parseNonNegativeInt(p.safety_stock);
          if (tq === null || tq > 1_000_000) {
            res.status(400).json({ message: 'Target quantity must be a non-negative integer.' });
            return;
          }
          if (ss === null || ss > 1_000_000) {
            res.status(400).json({ message: 'Safety stock must be a non-negative integer.' });
            return;
          }
          if (
            p.max_reservation_qty !== null &&
            p.max_reservation_qty !== undefined &&
            String(p.max_reservation_qty).trim() !== ''
          ) {
            const mr = parsePositiveInt(p.max_reservation_qty);
            if (!mr || mr > 1_000_000) {
              res.status(400).json({
                message: 'Max reservation quantity per franchisee must be blank or a positive integer.',
              });
              return;
            }
          }
        }
      }

      await db.transaction(async (tx) => {
        const summaryChanges: string[] = [];

        if (lead_time_days !== undefined) {
          const lt = parsePositiveInt(lead_time_days)!;
          await tx.execute(
            `INSERT INTO system_settings (key, value, updated_at)
             VALUES ('restock_lead_time_days', $1, CURRENT_TIMESTAMP)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
            [String(lt)]
          );
          summaryChanges.push(`lead_time=${lt}d`);
        }

        if (warehouse_id !== undefined && capacity_limit !== undefined) {
          const whId = parsePositiveInt(warehouse_id)!;
          const cap = parsePositiveInt(capacity_limit)!;
          await tx.execute('UPDATE warehouses SET capacity_limit = $1 WHERE id = $2', [cap, whId]);
          summaryChanges.push(`warehouse#${whId}_capacity=${cap}`);
        }

        if (Array.isArray(products)) {
          for (const p of products) {
            const pid = parsePositiveInt(p.id)!;
            const tq = parseNonNegativeInt(p.target_quantity)!;
            const ss = parseNonNegativeInt(p.safety_stock)!;
            const maxRes =
              p.max_reservation_qty === null ||
              p.max_reservation_qty === undefined ||
              String(p.max_reservation_qty).trim() === ''
                ? null
                : parsePositiveInt(p.max_reservation_qty);

            await tx.execute(
              `UPDATE products
               SET target_quantity = $1,
                   safety_stock = $2,
                   low_stock_threshold = $2,
                   max_reservation_qty = $3,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = $4`,
              [tq, ss, maxRes, pid]
            );
          }
          summaryChanges.push(`updated_${products.length}_products`);
        }

        await logActivity(
          req.user!.id,
          'RESTOCK_SETTINGS_UPDATED',
          'restock_settings',
          warehouse_id ? Number(warehouse_id) : null,
          `Updated Warehouse Restocking settings (${summaryChanges.join(', ')})`,
          tx
        );
      });

      res.json({ message: 'Warehouse Restocking settings saved.' });
    })
  );

  // ===== 2. RECOMMENDATIONS & LIVE CALCULATION PREVIEW =====
  api.get(
    '/restocking/recommendations',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      await checkOverdueRestocks();
      let whId = parsePositiveInt(req.query.warehouse_id);
      if (!whId) {
        const firstWh = await db.queryOne<{ id: number }>(
          'SELECT id FROM warehouses WHERE is_active = 1 ORDER BY id ASC LIMIT 1'
        );
        whId = firstWh?.id || null;
      }
      if (!whId) {
        res.json({ overview: null, recommendations: [] });
        return;
      }

      const overview = await computeWarehouseProductStockMetrics(whId);
      if (!overview) {
        res.status(404).json({ message: 'Warehouse not found.' });
        return;
      }

      const recommendations = sortRestockRecommendations(
        overview.products.filter(
          (p) => p.stock_status === 'No Stock' || p.stock_status === 'Low Stock'
        )
      );

      res.json({
        overview,
        recommendations,
      });
    })
  );

  // ===== 3. RUN MONTHLY CHECK NOW (Admin manual trigger for testing & demos) =====
  api.post(
    '/restocking/run-monthly-check',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const whId = parsePositiveInt(req.body?.warehouse_id) || null;
      const force = req.body?.force !== false; // default true for manual Admin button
      const result = await runMonthlyRestockCheck(whId, req.user!.id, force);

      const createdCount = result.createdRequests.length;
      const message =
        createdCount > 0
          ? `Monthly restock check created ${createdCount} draft request${createdCount === 1 ? '' : 's'}.`
          : result.skippedWarehouses[0]?.reason ||
            'No new monthly restock drafts needed (all products are at target or already have active restocks).';

      res.json({
        message,
        ...result,
      });
    })
  );

  // ===== 4. RESTOCK REQUESTS LIST & DETAIL =====
  api.get(
    '/restocking/requests',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      await checkOverdueRestocks();
      const { page, limit, offset } = parsePagination(req.query);
      const warehouseId = parsePositiveInt(req.query.warehouse_id);
      const status = String(req.query.status || '').trim();
      const priority = String(req.query.priority || '').trim();
      const triggerType = String(req.query.trigger_type || '').trim();
      const search = `%${String(req.query.search || '').trim()}%`;

      const params: any[] = [search];
      let where = `WHERE (
        rr.request_number ILIKE $1
        OR w.name ILIKE $1
        OR EXISTS (
          SELECT 1 FROM restock_request_items rri
          JOIN products p ON p.id = rri.product_id
          WHERE rri.request_id = rr.id AND (p.name ILIKE $1 OR p.sku ILIKE $1)
        )
      )`;

      if (warehouseId) {
        params.push(warehouseId);
        where += ` AND rr.warehouse_id = $${params.length}`;
      }
      if (status) {
        params.push(status);
        where += ` AND rr.status = $${params.length}`;
      }
      if (priority) {
        params.push(priority);
        where += ` AND rr.priority = $${params.length}`;
      }
      if (triggerType) {
        params.push(triggerType);
        where += ` AND rr.trigger_type = $${params.length}`;
      }

      const [totalRow, rows, todayStr, kpiRow] = await Promise.all([
        db.queryOne<{ total: number }>(
          `SELECT COUNT(*)::int AS total
           FROM restock_requests rr
           JOIN warehouses w ON w.id = rr.warehouse_id
           ${where}`,
          params
        ),
        db.queryAll<any>(
          `SELECT rr.*,
                  w.name AS warehouse_name,
                  COALESCE(w.capacity_limit, 1000)::int AS warehouse_capacity,
                  cu.full_name AS created_by_name,
                  au.full_name AS approved_by_name,
                  ru.full_name AS received_by_name,
                  (SELECT COUNT(*)::int FROM restock_request_items rri WHERE rri.request_id = rr.id) AS items_count,
                  COALESCE((SELECT SUM(rri.suggested_qty)::int FROM restock_request_items rri WHERE rri.request_id = rr.id), 0) AS total_suggested_qty,
                  COALESCE((SELECT SUM(rri.approved_qty)::int FROM restock_request_items rri WHERE rri.request_id = rr.id), 0) AS total_approved_qty,
                  COALESCE((SELECT SUM(COALESCE(rri.received_qty, 0))::int FROM restock_request_items rri WHERE rri.request_id = rr.id), 0) AS total_received_qty,
                  (
                    SELECT string_agg(p.name, ', ' ORDER BY p.name ASC)
                    FROM restock_request_items rri
                    JOIN products p ON p.id = rri.product_id
                    WHERE rri.request_id = rr.id
                  ) AS product_names
           FROM restock_requests rr
           JOIN warehouses w ON w.id = rr.warehouse_id
           LEFT JOIN users cu ON cu.id = rr.created_by
           LEFT JOIN users au ON au.id = rr.approved_by
           LEFT JOIN users ru ON ru.id = rr.received_by
           ${where}
           ORDER BY CASE WHEN rr.status = 'Draft' AND rr.priority = 'high' THEN 0
                         WHEN rr.status = 'Draft' THEN 1
                         WHEN rr.status = 'Approved/In Transit' THEN 2
                         ELSE 3 END ASC,
                    rr.id DESC
           LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset]
        ),
        getTodaySqlDate(),
        db.queryOne<any>(
          `SELECT
             COALESCE(SUM(CASE WHEN status = 'Draft' THEN 1 ELSE 0 END), 0)::int AS draft_count,
             COALESCE(SUM(CASE WHEN status = 'Draft' AND priority = 'high' THEN 1 ELSE 0 END), 0)::int AS high_priority_drafts,
             COALESCE(SUM(CASE WHEN status = 'Approved/In Transit' THEN 1 ELSE 0 END), 0)::int AS in_transit_count,
             COALESCE(SUM(CASE WHEN status = 'Approved/In Transit' AND expected_arrival_date IS NOT NULL AND expected_arrival_date < to_char(CURRENT_DATE, 'YYYY-MM-DD') THEN 1 ELSE 0 END), 0)::int AS overdue_count,
             COALESCE(SUM(CASE WHEN status = 'Received' THEN 1 ELSE 0 END), 0)::int AS received_count
           FROM restock_requests
           ${warehouseId ? 'WHERE warehouse_id = $1' : ''}`,
          warehouseId ? [warehouseId] : []
        ),
      ]);

      const enriched = rows.map((r) => ({
        ...r,
        is_overdue: isRestockOverdue(r.status, r.expected_arrival_date, todayStr),
      }));

      const total = totalRow?.total ?? 0;
      res.json({
        data: enriched,
        summary: kpiRow || {
          draft_count: 0,
          high_priority_drafts: 0,
          in_transit_count: 0,
          overdue_count: 0,
          received_count: 0,
        },
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      });
    })
  );

  api.get(
    '/restocking/requests/:id',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const id = parsePositiveInt(req.params.id);
      if (!id) {
        res.status(400).json({ message: 'Invalid restock request ID.' });
        return;
      }

      const request = await db.queryOne<any>(
        `SELECT rr.*,
                w.name AS warehouse_name,
                w.address AS warehouse_address,
                COALESCE(w.capacity_limit, 1000)::int AS warehouse_capacity,
                cu.full_name AS created_by_name,
                au.full_name AS approved_by_name,
                ru.full_name AS received_by_name
         FROM restock_requests rr
         JOIN warehouses w ON w.id = rr.warehouse_id
         LEFT JOIN users cu ON cu.id = rr.created_by
         LEFT JOIN users au ON au.id = rr.approved_by
         LEFT JOIN users ru ON ru.id = rr.received_by
         WHERE rr.id = $1`,
        [id]
      );

      if (!request) {
        res.status(404).json({ message: 'Restock request not found.' });
        return;
      }

      const [items, overview, todayStr] = await Promise.all([
        db.queryAll<any>(
          `SELECT rri.*, p.sku, p.name AS product_name, p.flavor, p.size, p.image_url,
                  c.name AS category_name
           FROM restock_request_items rri
           JOIN products p ON p.id = rri.product_id
           JOIN categories c ON c.id = p.category_id
           WHERE rri.request_id = $1
           ORDER BY p.name ASC`,
          [id]
        ),
        computeWarehouseProductStockMetrics(Number(request.warehouse_id)),
        getTodaySqlDate(),
      ]);

      const liveByProduct = new Map<number, any>();
      if (overview) {
        for (const p of overview.products) {
          liveByProduct.set(p.product_id, p);
        }
      }

      const enrichedItems = items.map((it) => {
        const live = liveByProduct.get(Number(it.product_id));
        return {
          ...it,
          live_physical_stock: live?.physical_stock ?? it.physical_stock_snapshot,
          live_reserved_stock: live?.reserved_stock ?? it.reserved_stock_snapshot,
          live_available_stock: live?.available_stock ?? it.available_stock_snapshot,
          live_reorder_point: live?.reorder_point ?? it.reorder_point_snapshot,
          live_stock_status: live?.stock_status ?? 'In Stock',
          live_target_quantity: live?.target_quantity ?? it.target_qty_snapshot,
          live_suggested_qty: live?.suggested_qty ?? it.suggested_qty,
        };
      });

      const currentWarehouseTotalStock = overview?.total_physical_stock ?? 0;
      const warehouseCapacity = overview?.capacity_limit ?? Number(request.warehouse_capacity || 1000);
      const totalApprovedQty = enrichedItems.reduce(
        (sum, it) => sum + Number(it.approved_qty || 0),
        0
      );
      const capacityCheck = validateCapacityForIncoming({
        currentWarehouseTotalStock,
        incomingTotalQty: totalApprovedQty,
        warehouseCapacity,
      });

      res.json({
        request: {
          ...request,
          is_overdue: isRestockOverdue(request.status, request.expected_arrival_date, todayStr),
        },
        items: enrichedItems,
        warehouse_capacity_context: {
          current_total_stock: currentWarehouseTotalStock,
          capacity_limit: warehouseCapacity,
          remaining_capacity: capacityCheck.remainingCapacity,
          total_approved_qty: totalApprovedQty,
          projected_total_stock: capacityCheck.projectedTotal,
          exceeds_capacity: !capacityCheck.ok,
          capacity_error: capacityCheck.error || null,
          lead_time_days: overview?.lead_time_days ?? 7,
        },
      });
    })
  );

  // ===== 5. EDIT DRAFT QUANTITIES =====
  api.patch(
    '/restocking/requests/:id/items',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const id = parsePositiveInt(req.params.id);
      const items = req.body?.items;
      if (!id || !Array.isArray(items) || items.length === 0) {
        res.status(400).json({ message: 'Valid restock request ID and item quantities are required.' });
        return;
      }

      const existing = await db.queryOne<{ id: number; status: string; request_number: string }>(
        'SELECT id, status, request_number FROM restock_requests WHERE id = $1',
        [id]
      );
      if (!existing) {
        res.status(404).json({ message: 'Restock request not found.' });
        return;
      }
      if (existing.status !== 'Draft') {
        res.status(400).json({ message: 'Only Draft restock requests can be edited.' });
        return;
      }

      const parsedItems: Array<{ item_id: number; approved_qty: number }> = [];
      for (const it of items) {
        const itemId = parsePositiveInt(it.item_id ?? it.id);
        const qty = parseNonNegativeInt(it.approved_qty);
        if (!itemId || qty === null || qty > 1_000_000) {
          res.status(400).json({ message: 'Every edited item must have a valid non-negative integer quantity.' });
          return;
        }
        parsedItems.push({ item_id: itemId, approved_qty: qty });
      }

      await db.transaction(async (tx) => {
        for (const pi of parsedItems) {
          await tx.execute(
            'UPDATE restock_request_items SET approved_qty = $1 WHERE id = $2 AND request_id = $3',
            [pi.approved_qty, pi.item_id, id]
          );
        }
        await tx.execute(
          'UPDATE restock_requests SET updated_at = CURRENT_TIMESTAMP WHERE id = $1',
          [id]
        );
        await logActivity(
          req.user!.id,
          'RESTOCK_DRAFT_EDITED',
          'restock_request',
          id,
          `Edited quantities on draft ${existing.request_number} (${parsedItems.length} item(s))`,
          tx
        );
      });

      res.json({ message: 'Draft quantities updated.' });
    })
  );

  // ===== 6. APPROVE DRAFT -> APPROVED/IN TRANSIT =====
  api.post(
    '/restocking/requests/:id/approve',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const id = parsePositiveInt(req.params.id);
      if (!id) {
        res.status(400).json({ message: 'Invalid restock request ID.' });
        return;
      }

      const inlineItems = Array.isArray(req.body?.items) ? req.body.items : null;
      const remarks = req.body?.remarks ? String(req.body.remarks).trim() : null;

      try {
        const result = await db.transaction(async (tx) => {
          const reqRow = await tx.queryOne<{
            id: number;
            request_number: string;
            warehouse_id: number;
            status: string;
          }>('SELECT id, request_number, warehouse_id, status FROM restock_requests WHERE id = $1 FOR UPDATE', [
            id,
          ]);

          if (!reqRow) {
            return { errorStatus: 404 as const, message: 'Restock request not found.' };
          }
          if (reqRow.status !== 'Draft') {
            return {
              errorStatus: 400 as const,
              message: `Only Draft requests can be approved (current status: ${reqRow.status}).`,
            };
          }

          const existingItems = await tx.queryAll<{
            id: number;
            product_id: number;
            approved_qty: number;
          }>(
            'SELECT id, product_id, approved_qty FROM restock_request_items WHERE request_id = $1 FOR UPDATE',
            [id]
          );

          const pendingQtyUpdates = new Map<number, number>();
          if (inlineItems) {
            for (const it of inlineItems) {
              const itemId = parsePositiveInt(it.item_id ?? it.id);
              const qty = parseNonNegativeInt(it.approved_qty);
              if (!itemId || qty === null || qty > 1_000_000) {
                return {
                  errorStatus: 400 as const,
                  message: 'All approved quantities must be non-negative integers.',
                };
              }
              pendingQtyUpdates.set(itemId, qty);
            }
          }

          const totalApproved = existingItems.reduce((s, it) => {
            const nextQty = pendingQtyUpdates.has(Number(it.id))
              ? pendingQtyUpdates.get(Number(it.id))!
              : Number(it.approved_qty || 0);
            return s + nextQty;
          }, 0);

          if (totalApproved <= 0) {
            return {
              errorStatus: 400 as const,
              message: 'Total approved quantity must be greater than 0 to approve a delivery.',
            };
          }

          // Strict server-side warehouse capacity check BEFORE mutating item quantities
          const wh = await tx.queryOne<{ capacity_limit: number; name: string }>(
            'SELECT COALESCE(capacity_limit, 1000)::int AS capacity_limit, name FROM warehouses WHERE id = $1 FOR UPDATE',
            [reqRow.warehouse_id]
          );
          const currentStock = await getWarehouseTotalPhysicalStock(reqRow.warehouse_id, tx);
          const capCheck = validateCapacityForIncoming({
            currentWarehouseTotalStock: currentStock,
            incomingTotalQty: totalApproved,
            warehouseCapacity: Number(wh?.capacity_limit || 1000),
          });
          if (!capCheck.ok) {
            return {
              errorStatus: 400 as const,
              message: `Cannot approve delivery: ${capCheck.error}`,
            };
          }

          // Apply validated item quantity updates only after capacity check passes
          for (const [itemId, qty] of pendingQtyUpdates.entries()) {
            await tx.execute(
              'UPDATE restock_request_items SET approved_qty = $1 WHERE id = $2 AND request_id = $3',
              [qty, itemId, id]
            );
          }

          const [todayStr, leadTimeDays] = await Promise.all([
            getTodaySqlDate(tx),
            getRestockLeadTimeDays(tx),
          ]);
          const expectedArrival = computeExpectedArrivalDate(todayStr, leadTimeDays);

          await tx.execute(
            `UPDATE restock_requests
             SET status = 'Approved/In Transit',
                 approved_by = $1,
                 approved_at = CURRENT_TIMESTAMP,
                 expected_arrival_date = $2,
                 remarks = COALESCE($3, remarks),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $4`,
            [req.user!.id, expectedArrival, remarks, id]
          );

          await logActivity(
            req.user!.id,
            'RESTOCK_APPROVED',
            'restock_request',
            id,
            `Approved ${reqRow.request_number} (${totalApproved} units for ${wh?.name || 'warehouse'}, expected ${expectedArrival})`,
            tx
          );

          return {
            ok: true as const,
            expectedArrival,
            totalApproved,
            requestNumber: reqRow.request_number,
          };
        });

        if ('errorStatus' in result && typeof result.errorStatus === 'number') {
          res.status(result.errorStatus).json({ message: result.message });
          return;
        }

        res.json({
          message: `Restock ${result.requestNumber} approved and marked Approved/In Transit (expected ${result.expectedArrival}).`,
          expected_arrival_date: result.expectedArrival,
          total_approved_qty: result.totalApproved,
        });
      } catch (err: any) {
        res.status(400).json({ message: err?.message || 'Failed to approve restock request.' });
      }
    })
  );

  // ===== 7. REJECT DRAFT =====
  api.post(
    '/restocking/requests/:id/reject',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const id = parsePositiveInt(req.params.id);
      const reason = String(req.body?.reason || '').trim();
      if (!id) {
        res.status(400).json({ message: 'Invalid restock request ID.' });
        return;
      }
      if (!reason) {
        res.status(400).json({ message: 'A rejection reason is required.' });
        return;
      }

      const outcome = await db.transaction(async (tx) => {
        const reqRow = await tx.queryOne<{ id: number; status: string; request_number: string }>(
          'SELECT id, status, request_number FROM restock_requests WHERE id = $1 FOR UPDATE',
          [id]
        );
        if (!reqRow) return { errorStatus: 404 as const, message: 'Restock request not found.' };
        if (reqRow.status !== 'Draft') {
          return {
            errorStatus: 400 as const,
            message: 'Only Draft restock requests can be rejected.',
          };
        }

        await tx.execute(
          `UPDATE restock_requests
           SET status = 'Rejected',
               rejection_reason = $1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [reason, id]
        );

        await logActivity(
          req.user!.id,
          'RESTOCK_REJECTED',
          'restock_request',
          id,
          `Rejected ${reqRow.request_number}: ${reason}`,
          tx
        );

        return { ok: true as const, requestNumber: reqRow.request_number };
      });

      if ('errorStatus' in outcome && typeof outcome.errorStatus === 'number') {
        res.status(outcome.errorStatus).json({ message: outcome.message });
        return;
      }

      res.json({ message: `Restock draft ${outcome.requestNumber} rejected.` });
    })
  );

  // ===== 8. CANCEL APPROVED/IN TRANSIT =====
  api.post(
    '/restocking/requests/:id/cancel',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const id = parsePositiveInt(req.params.id);
      const reason = String(req.body?.reason || '').trim();
      if (!id) {
        res.status(400).json({ message: 'Invalid restock request ID.' });
        return;
      }
      if (!reason) {
        res.status(400).json({ message: 'A cancellation reason is required.' });
        return;
      }

      const outcome = await db.transaction(async (tx) => {
        const reqRow = await tx.queryOne<{ id: number; status: string; request_number: string }>(
          'SELECT id, status, request_number FROM restock_requests WHERE id = $1 FOR UPDATE',
          [id]
        );
        if (!reqRow) return { errorStatus: 404 as const, message: 'Restock request not found.' };
        if (reqRow.status !== 'Approved/In Transit') {
          return {
            errorStatus: 400 as const,
            message: 'Only Approved/In Transit deliveries can be cancelled.',
          };
        }

        await tx.execute(
          `UPDATE restock_requests
           SET status = 'Cancelled',
               rejection_reason = $1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [reason, id]
        );

        await logActivity(
          req.user!.id,
          'RESTOCK_CANCELLED',
          'restock_request',
          id,
          `Cancelled in-transit restock ${reqRow.request_number}: ${reason}`,
          tx
        );

        return { ok: true as const, requestNumber: reqRow.request_number };
      });

      if ('errorStatus' in outcome && typeof outcome.errorStatus === 'number') {
        res.status(outcome.errorStatus).json({ message: outcome.message });
        return;
      }

      res.json({ message: `Restock ${outcome.requestNumber} cancelled.` });
    })
  );

  // ===== 9. CONFIRM RECEIVING (Transactional inventory increment + stock_movements) =====
  api.post(
    '/restocking/requests/:id/receive',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const id = parsePositiveInt(req.params.id);
      const incomingItems = req.body?.items;
      const remarks = req.body?.remarks ? String(req.body.remarks).trim() : null;

      if (!id || !Array.isArray(incomingItems) || incomingItems.length === 0) {
        res.status(400).json({ message: 'Valid restock request ID and received item quantities are required.' });
        return;
      }

      const parsedMap = new Map<number, { received_qty: number; difference_remark: string | null }>();
      for (const it of incomingItems) {
        const itemId = parsePositiveInt(it.item_id ?? it.id);
        const rqty = parseNonNegativeInt(it.received_qty);
        if (!itemId || rqty === null || rqty > 1_000_000) {
          res.status(400).json({ message: 'Every received quantity must be a non-negative integer.' });
          return;
        }
        parsedMap.set(itemId, {
          received_qty: rqty,
          difference_remark: it.difference_remark ? String(it.difference_remark).trim() : null,
        });
      }

      const outcome = await db.transaction(async (tx) => {
        const reqRow = await tx.queryOne<{
          id: number;
          request_number: string;
          warehouse_id: number;
          status: string;
        }>('SELECT id, request_number, warehouse_id, status FROM restock_requests WHERE id = $1 FOR UPDATE', [
          id,
        ]);

        if (!reqRow) return { errorStatus: 404 as const, message: 'Restock request not found.' };
        if (reqRow.status !== 'Approved/In Transit') {
          return {
            errorStatus: 400 as const,
            message: `Only Approved/In Transit deliveries can be received (current status: ${reqRow.status}).`,
          };
        }

        const wh = await tx.queryOne<{ capacity_limit: number; name: string }>(
          'SELECT COALESCE(capacity_limit, 1000)::int AS capacity_limit, name FROM warehouses WHERE id = $1 FOR UPDATE',
          [reqRow.warehouse_id]
        );

        const dbItems = await tx.queryAll<{
          id: number;
          product_id: number;
          product_name: string;
          approved_qty: number;
        }>(
          `SELECT rri.id, rri.product_id, p.name AS product_name, rri.approved_qty
           FROM restock_request_items rri
           JOIN products p ON p.id = rri.product_id
           WHERE rri.request_id = $1`,
          [id]
        );

        let totalReceived = 0;
        const resolvedItems: Array<{
          id: number;
          product_id: number;
          product_name: string;
          approved_qty: number;
          received_qty: number;
          difference_qty: number;
          difference_remark: string | null;
        }> = [];

        for (const dbItem of dbItems) {
          const input = parsedMap.get(Number(dbItem.id));
          const receivedQty = input ? input.received_qty : Number(dbItem.approved_qty);
          const diffQty = receivedQty - Number(dbItem.approved_qty);
          const diffRemark = input?.difference_remark || null;

          if (diffQty !== 0 && !diffRemark) {
            return {
              errorStatus: 400 as const,
              message: `Please enter a remark explaining the quantity difference for ${dbItem.product_name} (approved ${dbItem.approved_qty}, received ${receivedQty}).`,
            };
          }

          totalReceived += receivedQty;
          resolvedItems.push({
            id: Number(dbItem.id),
            product_id: Number(dbItem.product_id),
            product_name: dbItem.product_name,
            approved_qty: Number(dbItem.approved_qty),
            received_qty: receivedQty,
            difference_qty: diffQty,
            difference_remark: diffRemark,
          });
        }

        // Strict server-side capacity re-check on receiving
        const currentTotalStock = await getWarehouseTotalPhysicalStock(reqRow.warehouse_id, tx);
        const capCheck = validateCapacityForIncoming({
          currentWarehouseTotalStock: currentTotalStock,
          incomingTotalQty: totalReceived,
          warehouseCapacity: Number(wh?.capacity_limit || 1000),
        });
        if (!capCheck.ok) {
          return {
            errorStatus: 400 as const,
            message: `Cannot receive delivery: ${capCheck.error}`,
          };
        }

        const backInStockNames: string[] = [];

        for (const item of resolvedItems) {
          const inv = await tx.queryOne<{ id: number; quantity: number }>(
            'SELECT id, quantity FROM inventory WHERE warehouse_id = $1 AND product_id = $2 FOR UPDATE',
            [reqRow.warehouse_id, item.product_id]
          );
          const prevQty = inv ? Number(inv.quantity) : 0;
          const newQty = prevQty + item.received_qty;

          if (prevQty === 0 && newQty > 0) {
            backInStockNames.push(item.product_name);
          }

          if (inv) {
            await tx.execute(
              'UPDATE inventory SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
              [newQty, inv.id]
            );
          } else {
            await tx.execute(
              'INSERT INTO inventory (warehouse_id, product_id, quantity) VALUES ($1, $2, $3)',
              [reqRow.warehouse_id, item.product_id, newQty]
            );
          }

          if (item.received_qty > 0) {
            const noteDetail = item.difference_remark
              ? `Supplier restock ${reqRow.request_number} received (${item.received_qty}/${item.approved_qty} units; remark: ${item.difference_remark})`
              : `Supplier restock ${reqRow.request_number} received (${item.received_qty} units)`;

            await tx.execute(
              `INSERT INTO stock_movements (
                 warehouse_id, product_id, movement_type, quantity_change, previous_qty, new_qty, notes, performed_by
               ) VALUES ($1, $2, 'RESTOCK_RECEIVED', $3, $4, $5, $6, $7)`,
              [
                reqRow.warehouse_id,
                item.product_id,
                item.received_qty,
                prevQty,
                newQty,
                noteDetail,
                req.user!.id,
              ]
            );
          }

          await tx.execute(
            `UPDATE restock_request_items
             SET received_qty = $1,
                 difference_qty = $2,
                 difference_remark = $3
             WHERE id = $4`,
            [item.received_qty, item.difference_qty, item.difference_remark, item.id]
          );
        }

        await tx.execute(
          `UPDATE restock_requests
           SET status = 'Received',
               received_by = $1,
               received_at = CURRENT_TIMESTAMP,
               remarks = COALESCE($2, remarks),
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [req.user!.id, remarks, id]
        );

        await logActivity(
          req.user!.id,
          'RESTOCK_RECEIVED',
          'restock_request',
          id,
          `Received ${reqRow.request_number} at ${wh?.name || 'warehouse'} (${totalReceived} total units across ${resolvedItems.length} product(s))`,
          tx
        );

        if (backInStockNames.length > 0) {
          await notifyFranchiseesBackInStock(
            wh?.name || 'Warehouse',
            backInStockNames,
            id,
            tx
          );
        }

        return {
          ok: true as const,
          requestNumber: reqRow.request_number,
          totalReceived,
          backInStockNames,
        };
      });

      if ('errorStatus' in outcome && typeof outcome.errorStatus === 'number') {
        res.status(outcome.errorStatus).json({ message: outcome.message });
        return;
      }

      res.json({
        message: `Delivery ${outcome.requestNumber} confirmed received (+${outcome.totalReceived} units added to warehouse inventory).`,
        total_received_qty: outcome.totalReceived,
        back_in_stock_products: outcome.backInStockNames,
      });
    })
  );
}
