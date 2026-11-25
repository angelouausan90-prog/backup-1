import bcrypt from 'bcryptjs';
import db, { type DbExecutor } from '../db.ts';
import { getTodaySqlDate, logActivity, notifyAdmins, notifyUser } from '../helpers.ts';
import {
  type ActiveRestockSummary,
  type RestockPriority,
  type RestockStatus,
  type RestockTriggerType,
  type StockStatus,
  allocateBatchQuantitiesWithinCapacity,
  checkTargetsAgainstCapacity,
  classifyStockStatus,
  computeAvailableStock,
  computeAvgDailyOrders,
  computeExpectedArrivalDate,
  computeReorderPoint,
  computeRestockQuantity,
  getFranchiseeStockMessage,
  getRestockRecommendationLabel,
  isRestockOverdue,
  isWithinMonthlyTriggerWindow,
  sortRestockRecommendations,
} from '../../src/utils/restockingRules.ts';

export interface ProductStockMetric {
  product_id: number;
  warehouse_id: number;
  sku: string;
  name: string;
  flavor: string;
  size: string;
  price: number;
  image_url: string | null;
  category_id: number;
  category_name: string;
  target_quantity: number;
  safety_stock: number;
  max_reservation_qty: number | null;
  low_stock_threshold: number;
  physical_stock: number;
  reserved_stock: number;
  available_stock: number;
  last_30d_orders: number;
  avg_daily_orders: number;
  expected_lead_demand: number;
  reorder_point: number;
  stock_status: StockStatus;
  recommendation_label: string | null;
  raw_suggested_qty: number;
  suggested_qty: number;
  was_capped: boolean;
  active_restock: ActiveRestockSummary | null;
  franchisee_availability: {
    blocked: boolean;
    message: string;
  };
  updated_at: string | null;
}

export interface WarehouseStockOverview {
  warehouse_id: number;
  warehouse_name: string;
  capacity_limit: number;
  lead_time_days: number;
  total_physical_stock: number;
  total_reserved_stock: number;
  total_available_stock: number;
  remaining_capacity: number;
  utilization_pct: number;
  total_target_qty: number;
  targets_exceed_capacity: boolean;
  targets_excess: number;
  no_stock_count: number;
  low_stock_count: number;
  in_stock_count: number;
  products: ProductStockMetric[];
}

export async function getRestockLeadTimeDays(executor: DbExecutor = db): Promise<number> {
  const row = await executor.queryOne<{ value: string }>(
    "SELECT value FROM system_settings WHERE key = 'restock_lead_time_days'"
  );
  const parsed = parseInt(String(row?.value ?? '7'), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 7;
  return Math.min(90, parsed);
}

export function generateRestockRequestNumber(todayStr: string): string {
  const compact = String(todayStr || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `RST-${compact}-${rand}`;
}

export async function getWarehouseTotalPhysicalStock(
  warehouseId: number,
  executor: DbExecutor = db
): Promise<number> {
  const row = await executor.queryOne<{ total: number }>(
    'SELECT COALESCE(SUM(quantity), 0)::int AS total FROM inventory WHERE warehouse_id = $1',
    [warehouseId]
  );
  return Number(row?.total || 0);
}

/**
 * Single source of truth for warehouse stock metrics, reorder points, stock status labels,
 * suggested restock quantities, capacity utilization, and active supplier restock requests.
 */
export async function computeWarehouseProductStockMetrics(
  warehouseId: number,
  executor: DbExecutor = db
): Promise<WarehouseStockOverview | null> {
  const wh = await executor.queryOne<{
    id: number;
    name: string;
    capacity_limit: number;
  }>('SELECT id, name, COALESCE(capacity_limit, 1000)::int AS capacity_limit FROM warehouses WHERE id = $1', [
    warehouseId,
  ]);
  if (!wh) return null;

  const [leadTimeDays, prodRows, invRows, reservedRows, sales30Rows, activeRestockRows, totalWhStockRow] =
    await Promise.all([
      getRestockLeadTimeDays(executor),
      executor.queryAll<any>(
        `SELECT p.id, p.sku, p.name, p.flavor, p.size, p.price, p.image_url,
                p.category_id, c.name AS category_name,
                COALESCE(p.target_quantity, 100)::int AS target_quantity,
                COALESCE(p.safety_stock, 15)::int AS safety_stock,
                p.max_reservation_qty,
                COALESCE(p.low_stock_threshold, 20)::int AS low_stock_threshold
         FROM products p
         JOIN categories c ON c.id = p.category_id
         WHERE p.is_active = 1
         ORDER BY p.name ASC`
      ),
      executor.queryAll<{ product_id: number; quantity: number; updated_at: string | null }>(
        `SELECT product_id, COALESCE(quantity, 0)::int AS quantity, updated_at
         FROM inventory
         WHERE warehouse_id = $1`,
        [warehouseId]
      ),
      executor.queryAll<{ product_id: number; reserved_qty: number }>(
        `SELECT oi.product_id, COALESCE(SUM(oi.quantity), 0)::int AS reserved_qty
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE o.warehouse_id = $1
           AND o.status = 'Placed'
           AND COALESCE(o.stock_deducted, 0) = 0
         GROUP BY oi.product_id`,
        [warehouseId]
      ),
      executor.queryAll<{ product_id: number; ordered_30d: number }>(
        `SELECT oi.product_id, COALESCE(SUM(oi.quantity), 0)::int AS ordered_30d
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE o.warehouse_id = $1
           AND o.status NOT IN ('Cancelled', 'Rejected')
           AND o.created_at::date >= (CURRENT_DATE - INTERVAL '30 days')::date
         GROUP BY oi.product_id`,
        [warehouseId]
      ),
      executor.queryAll<{
        product_id: number;
        request_id: number;
        request_number: string;
        status: RestockStatus;
        priority: RestockPriority;
        trigger_type: RestockTriggerType;
        expected_arrival_date: string | null;
      }>(
        `SELECT rri.product_id,
                rr.id AS request_id,
                rr.request_number,
                rr.status,
                rr.priority,
                rr.trigger_type,
                rr.expected_arrival_date
         FROM restock_request_items rri
         JOIN restock_requests rr ON rr.id = rri.request_id
         WHERE rr.warehouse_id = $1
           AND rr.status IN ('Draft', 'Approved/In Transit')
         ORDER BY CASE WHEN rr.status = 'Approved/In Transit' THEN 0 ELSE 1 END ASC,
                  CASE WHEN rr.priority = 'high' THEN 0 ELSE 1 END ASC,
                  rr.id DESC`,
        [warehouseId]
      ),
      executor.queryOne<{ total: number }>(
        'SELECT COALESCE(SUM(quantity), 0)::int AS total FROM inventory WHERE warehouse_id = $1',
        [warehouseId]
      ),
    ]);

  const invMap = new Map<number, { quantity: number; updated_at: string | null }>();
  for (const r of invRows) {
    invMap.set(Number(r.product_id), {
      quantity: Number(r.quantity || 0),
      updated_at: r.updated_at ? String(r.updated_at) : null,
    });
  }

  const reservedMap = new Map<number, number>();
  for (const r of reservedRows) {
    reservedMap.set(Number(r.product_id), Number(r.reserved_qty || 0));
  }

  const sales30Map = new Map<number, number>();
  for (const r of sales30Rows) {
    sales30Map.set(Number(r.product_id), Number(r.ordered_30d || 0));
  }

  const activeRestockMap = new Map<number, ActiveRestockSummary>();
  for (const r of activeRestockRows) {
    const pid = Number(r.product_id);
    if (!activeRestockMap.has(pid)) {
      activeRestockMap.set(pid, {
        id: Number(r.request_id),
        request_number: r.request_number,
        status: r.status,
        priority: r.priority,
        trigger_type: r.trigger_type,
        expected_arrival_date: r.expected_arrival_date,
      });
    }
  }

  const totalPhysicalStock = Number(totalWhStockRow?.total || 0);
  const capacityLimit = Math.max(1, Number(wh.capacity_limit || 1000));
  const remainingCapacity = Math.max(0, capacityLimit - totalPhysicalStock);
  const utilizationPct = Number(
    Math.min(999, (totalPhysicalStock / capacityLimit) * 100).toFixed(1)
  );

  let totalTargetQty = 0;
  let totalReservedStock = 0;
  let totalAvailableStock = 0;
  let noStockCount = 0;
  let lowStockCount = 0;
  let inStockCount = 0;

  const products: ProductStockMetric[] = prodRows.map((p) => {
    const pid = Number(p.id);
    const inv = invMap.get(pid);
    const physicalStock = inv ? inv.quantity : 0;
    const reservedStock = reservedMap.get(pid) || 0;
    const availableStock = computeAvailableStock(physicalStock, reservedStock);
    const last30dOrders = sales30Map.get(pid) || 0;
    const avgDailyOrders = computeAvgDailyOrders(last30dOrders, 0);
    const targetQty = Math.max(0, Number(p.target_quantity ?? 100));
    const safetyStock = Math.max(0, Number(p.safety_stock ?? 15));
    const reorderPoint = computeReorderPoint(avgDailyOrders, leadTimeDays, safetyStock);
    const stockStatus = classifyStockStatus(availableStock, reorderPoint);
    const recLabel = getRestockRecommendationLabel(stockStatus);
    const qtyCalc = computeRestockQuantity({
      targetQty,
      availableStock,
      avgDailyOrders,
      leadTimeDays,
      currentWarehouseTotalStock: totalPhysicalStock,
      warehouseCapacity: capacityLimit,
    });
    const activeRestock = activeRestockMap.get(pid) || null;
    const franchiseeAvail = getFranchiseeStockMessage(stockStatus, availableStock, activeRestock);

    totalTargetQty += targetQty;
    totalReservedStock += reservedStock;
    totalAvailableStock += availableStock;
    if (stockStatus === 'No Stock') noStockCount += 1;
    else if (stockStatus === 'Low Stock') lowStockCount += 1;
    else inStockCount += 1;

    return {
      product_id: pid,
      warehouse_id: wh.id,
      sku: p.sku,
      name: p.name,
      flavor: p.flavor,
      size: p.size,
      price: Number(p.price || 0),
      image_url: p.image_url || null,
      category_id: Number(p.category_id),
      category_name: p.category_name,
      target_quantity: targetQty,
      safety_stock: safetyStock,
      max_reservation_qty:
        p.max_reservation_qty !== null && p.max_reservation_qty !== undefined
          ? Number(p.max_reservation_qty)
          : null,
      low_stock_threshold: Number(p.low_stock_threshold ?? 20),
      physical_stock: physicalStock,
      reserved_stock: reservedStock,
      available_stock: availableStock,
      last_30d_orders: last30dOrders,
      avg_daily_orders: avgDailyOrders,
      expected_lead_demand: qtyCalc.expectedLeadDemand,
      reorder_point: reorderPoint,
      stock_status: stockStatus,
      recommendation_label: recLabel,
      raw_suggested_qty: qtyCalc.rawQty,
      suggested_qty: qtyCalc.cappedQty,
      was_capped: qtyCalc.wasCapped,
      active_restock: activeRestock,
      franchisee_availability: franchiseeAvail,
      updated_at: inv?.updated_at || null,
    };
  });

  const targetCap = checkTargetsAgainstCapacity(totalTargetQty, capacityLimit);

  return {
    warehouse_id: wh.id,
    warehouse_name: wh.name,
    capacity_limit: capacityLimit,
    lead_time_days: leadTimeDays,
    total_physical_stock: totalPhysicalStock,
    total_reserved_stock: totalReservedStock,
    total_available_stock: totalAvailableStock,
    remaining_capacity: remainingCapacity,
    utilization_pct: utilizationPct,
    total_target_qty: totalTargetQty,
    targets_exceed_capacity: targetCap.exceeds,
    targets_excess: targetCap.excess,
    no_stock_count: noStockCount,
    low_stock_count: lowStockCount,
    in_stock_count: inStockCount,
    products,
  };
}

/**
 * Evaluates a single product in a warehouse after any stock change (order placement, confirmation,
 * cancellation, or manual stock adjustment).
 * - Creates a Draft immediately on Low Stock (normal) or No Stock (high).
 * - Prevents duplicate active drafts/in-transit requests for the same product.
 * - Upgrades an existing Low Stock / Monthly Draft to HIGH priority if the product hits No Stock.
 */
export async function evaluateProductRestockTrigger(
  warehouseId: number,
  productId: number,
  actorUserId: number | null,
  executor: DbExecutor = db
): Promise<{
  action: 'none' | 'created' | 'upgraded' | 'duplicate_skipped';
  requestId?: number;
  stockStatus?: StockStatus;
}> {
  const overview = await computeWarehouseProductStockMetrics(warehouseId, executor);
  if (!overview) return { action: 'none' };

  const metric = overview.products.find((p) => p.product_id === productId);
  if (!metric) return { action: 'none' };

  if (metric.stock_status === 'In Stock') {
    return { action: 'none', stockStatus: 'In Stock' };
  }

  const isNoStock = metric.stock_status === 'No Stock';

  // Check for existing active restock request containing this product
  const existingActive = await executor.queryOne<{
    request_id: number;
    request_number: string;
    status: RestockStatus;
    priority: RestockPriority;
    trigger_type: RestockTriggerType;
    item_id: number;
  }>(
    `SELECT rr.id AS request_id, rr.request_number, rr.status, rr.priority, rr.trigger_type, rri.id AS item_id
     FROM restock_request_items rri
     JOIN restock_requests rr ON rr.id = rri.request_id
     WHERE rr.warehouse_id = $1
       AND rri.product_id = $2
       AND rr.status IN ('Draft', 'Approved/In Transit')
     ORDER BY CASE WHEN rr.status = 'Draft' THEN 0 ELSE 1 END ASC, rr.id DESC
     LIMIT 1`,
    [warehouseId, productId]
  );

  if (existingActive) {
    // Upgrade existing normal-priority Draft to HIGH PRIORITY if product dropped to No Stock
    if (existingActive.status === 'Draft' && isNoStock && existingActive.priority !== 'high') {
      await executor.execute(
        `UPDATE restock_requests
         SET priority = 'high',
             trigger_type = 'no_stock',
             remarks = COALESCE(remarks, '') || CASE WHEN COALESCE(remarks, '') = '' THEN '' ELSE ' | ' END || $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [`Upgraded to HIGH PRIORITY because ${metric.name} reached No Stock`, existingActive.request_id]
      );

      await executor.execute(
        `UPDATE restock_request_items
         SET target_qty_snapshot = $1,
             physical_stock_snapshot = $2,
             reserved_stock_snapshot = $3,
             available_stock_snapshot = $4,
             reorder_point_snapshot = $5,
             avg_daily_orders_snapshot = $6,
             suggested_qty = $7,
             approved_qty = $7
         WHERE id = $8`,
        [
          metric.target_quantity,
          metric.physical_stock,
          metric.reserved_stock,
          metric.available_stock,
          metric.reorder_point,
          metric.avg_daily_orders,
          metric.suggested_qty,
          existingActive.item_id,
        ]
      );

      await notifyAdmins(
        `URGENT: No Stock — ${metric.name}`,
        `${metric.name} at ${overview.warehouse_name} hit No Stock (0 available). Existing draft ${existingActive.request_number} was upgraded to HIGH PRIORITY (recommended: ${metric.suggested_qty} units).`,
        'restock_urgent',
        existingActive.request_id,
        executor
      );

      await logActivity(
        actorUserId,
        'RESTOCK_DRAFT_UPGRADED',
        'restock_request',
        existingActive.request_id,
        `Upgraded ${existingActive.request_number} to HIGH PRIORITY (No Stock: ${metric.name}, suggested ${metric.suggested_qty})`,
        executor
      );

      return {
        action: 'upgraded',
        requestId: existingActive.request_id,
        stockStatus: metric.stock_status,
      };
    }

    // If Approved/In Transit exists and product just hit No Stock, notify Admin urgently (deduplicated per day)
    if (existingActive.status === 'Approved/In Transit' && isNoStock) {
      const notifTitle = `URGENT: No Stock — ${metric.name}`;
      const existingNotif = await executor.queryOne<{ id: number }>(
        `SELECT id FROM notifications
         WHERE type = 'restock_urgent'
           AND title = $1
           AND related_id = $2
           AND created_at::date = CURRENT_DATE
         LIMIT 1`,
        [notifTitle, existingActive.request_id]
      );
      if (!existingNotif) {
        await notifyAdmins(
          notifTitle,
          `${metric.name} at ${overview.warehouse_name} reached No Stock (0 available). Existing restock ${existingActive.request_number} is already Approved/In Transit.`,
          'restock_urgent',
          existingActive.request_id,
          executor
        );
      }
    }

    return {
      action: 'duplicate_skipped',
      requestId: existingActive.request_id,
      stockStatus: metric.stock_status,
    };
  }

  // Create new Draft request
  const todayStr = await getTodaySqlDate(executor);
  const requestNumber = generateRestockRequestNumber(todayStr);
  const triggerType: RestockTriggerType = isNoStock ? 'no_stock' : 'low_stock';
  const priority: RestockPriority = isNoStock ? 'high' : 'normal';
  const remarkText = metric.was_capped
    ? `Auto-generated (${metric.stock_status}). Quantity capped from ${metric.raw_suggested_qty} to ${metric.suggested_qty} due to warehouse capacity limit (${overview.capacity_limit}).`
    : `Auto-generated because ${metric.name} reached ${metric.stock_status} (${metric.available_stock} available vs reorder point ${metric.reorder_point}).`;

  const reqRow = await executor.queryOne<{ id: number }>(
    `INSERT INTO restock_requests (
       request_number, warehouse_id, trigger_type, priority, status, created_by, remarks
     ) VALUES ($1, $2, $3, $4, 'Draft', $5, $6)
     RETURNING id`,
    [requestNumber, warehouseId, triggerType, priority, actorUserId, remarkText]
  );
  const newRequestId = Number(reqRow!.id);

  await executor.execute(
    `INSERT INTO restock_request_items (
       request_id, product_id, target_qty_snapshot, physical_stock_snapshot,
       reserved_stock_snapshot, available_stock_snapshot, reorder_point_snapshot,
       avg_daily_orders_snapshot, suggested_qty, approved_qty
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
    [
      newRequestId,
      metric.product_id,
      metric.target_quantity,
      metric.physical_stock,
      metric.reserved_stock,
      metric.available_stock,
      metric.reorder_point,
      metric.avg_daily_orders,
      metric.suggested_qty,
    ]
  );

  if (isNoStock) {
    await notifyAdmins(
      `URGENT: No Stock — ${metric.name}`,
      `${metric.name} at ${overview.warehouse_name} is at No Stock (0 available). High-priority restock draft ${requestNumber} created for ${metric.suggested_qty} units.`,
      'restock_urgent',
      newRequestId,
      executor
    );
  } else {
    await notifyAdmins(
      `Restock Draft Created: ${metric.name}`,
      `${metric.name} at ${overview.warehouse_name} reached Low Stock (${metric.available_stock} available, reorder point ${metric.reorder_point}). Draft ${requestNumber} recommends ${metric.suggested_qty} units.`,
      'restock',
      newRequestId,
      executor
    );
  }

  await logActivity(
    actorUserId,
    'RESTOCK_DRAFT_CREATED',
    'restock_request',
    newRequestId,
    `Auto-created ${priority} priority ${triggerType} draft ${requestNumber} for ${metric.name} (${metric.suggested_qty} units)`,
    executor
  );

  return {
    action: 'created',
    requestId: newRequestId,
    stockStatus: metric.stock_status,
  };
}

/**
 * Monthly trigger: creates one consolidated monthly delivery draft per active warehouse
 * within `lead_time_days` before month end (or immediately when `force = true`).
 * Skips products that already have an active Draft or Approved/In Transit restock.
 */
export async function runMonthlyRestockCheck(
  warehouseId: number | null,
  actorUserId: number | null,
  force = false
): Promise<{
  checked: boolean;
  withinWindow: boolean;
  today: string;
  leadTimeDays: number;
  createdRequests: Array<{
    id: number;
    request_number: string;
    warehouse_id: number;
    warehouse_name: string;
    items_count: number;
    total_suggested_qty: number;
  }>;
  skippedWarehouses: Array<{ warehouse_id: number; warehouse_name: string; reason: string }>;
}> {
  const todayStr = await getTodaySqlDate();
  const leadTimeDays = await getRestockLeadTimeDays();
  const withinWindow = isWithinMonthlyTriggerWindow(todayStr, leadTimeDays);

  if (!force && !withinWindow) {
    return {
      checked: false,
      withinWindow: false,
      today: todayStr,
      leadTimeDays,
      createdRequests: [],
      skippedWarehouses: [],
    };
  }

  const warehouses = warehouseId
    ? await db.queryAll<{ id: number; name: string }>(
        'SELECT id, name FROM warehouses WHERE id = $1 AND is_active = 1',
        [warehouseId]
      )
    : await db.queryAll<{ id: number; name: string }>(
        'SELECT id, name FROM warehouses WHERE is_active = 1 ORDER BY id ASC'
      );

  const createdRequests: Array<{
    id: number;
    request_number: string;
    warehouse_id: number;
    warehouse_name: string;
    items_count: number;
    total_suggested_qty: number;
  }> = [];
  const skippedWarehouses: Array<{ warehouse_id: number; warehouse_name: string; reason: string }> = [];

  for (const wh of warehouses) {
    const overview = await computeWarehouseProductStockMetrics(wh.id);
    if (!overview) continue;

    // If not forced (automatic cron), don't create another monthly draft in the same calendar month
    if (!force) {
      const monthPrefix = todayStr.slice(0, 7);
      const existingMonthlyThisMonth = await db.queryOne<{ id: number }>(
        `SELECT id FROM restock_requests
         WHERE warehouse_id = $1
           AND trigger_type = 'monthly'
           AND status IN ('Draft', 'Approved/In Transit', 'Received')
           AND to_char(created_at, 'YYYY-MM') = $2
         LIMIT 1`,
        [wh.id, monthPrefix]
      );
      if (existingMonthlyThisMonth) {
        skippedWarehouses.push({
          warehouse_id: wh.id,
          warehouse_name: wh.name,
          reason: `Monthly restock already created for ${monthPrefix}.`,
        });
        continue;
      }
    }

    // Eligible products: no active Draft or Approved/In Transit, and raw_suggested_qty > 0
    const candidates = overview.products.filter(
      (p) => !p.active_restock && p.raw_suggested_qty > 0
    );

    if (candidates.length === 0) {
      skippedWarehouses.push({
        warehouse_id: wh.id,
        warehouse_name: wh.name,
        reason: 'All products are either at target stock or already have an active restock request.',
      });
      continue;
    }

    const allocated = allocateBatchQuantitiesWithinCapacity(
      candidates.map((c) => ({
        ...c,
        raw_qty: c.raw_suggested_qty,
      })),
      overview.total_physical_stock,
      overview.capacity_limit
    ).filter((item) => item.allocated_qty > 0);

    if (allocated.length === 0) {
      skippedWarehouses.push({
        warehouse_id: wh.id,
        warehouse_name: wh.name,
        reason: `Warehouse is at full capacity (${overview.total_physical_stock}/${overview.capacity_limit}).`,
      });
      continue;
    }

    const hasNoStock = allocated.some((a) => a.stock_status === 'No Stock');
    const anyCapped = allocated.some((a) => a.was_capped);
    const totalQty = allocated.reduce((sum, a) => sum + a.allocated_qty, 0);
    const requestNumber = generateRestockRequestNumber(todayStr);

    const newReqId = await db.transaction(async (tx) => {
      const remarkParts = [
        force
          ? `Monthly restock check triggered manually on ${todayStr}.`
          : `Scheduled monthly restock draft generated ${leadTimeDays} days before month end (${todayStr}).`,
      ];
      if (anyCapped) {
        remarkParts.push(
          `Quantities were capped to fit within warehouse capacity (${overview.capacity_limit} units).`
        );
      }

      const row = await tx.queryOne<{ id: number }>(
        `INSERT INTO restock_requests (
           request_number, warehouse_id, trigger_type, priority, status, created_by, remarks
         ) VALUES ($1, $2, 'monthly', $3, 'Draft', $4, $5)
         RETURNING id`,
        [requestNumber, wh.id, hasNoStock ? 'high' : 'normal', actorUserId, remarkParts.join(' ')]
      );
      const reqId = Number(row!.id);

      for (const item of allocated) {
        await tx.execute(
          `INSERT INTO restock_request_items (
             request_id, product_id, target_qty_snapshot, physical_stock_snapshot,
             reserved_stock_snapshot, available_stock_snapshot, reorder_point_snapshot,
             avg_daily_orders_snapshot, suggested_qty, approved_qty
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
          [
            reqId,
            item.product_id,
            item.target_quantity,
            item.physical_stock,
            item.reserved_stock,
            item.available_stock,
            item.reorder_point,
            item.avg_daily_orders,
            item.allocated_qty,
          ]
        );
      }

      await notifyAdmins(
        `Monthly Restock Draft Ready: ${requestNumber}`,
        `Monthly restock draft for ${wh.name} includes ${allocated.length} product(s) totaling ${totalQty} units. Review and approve in Warehouse Restocking.`,
        hasNoStock ? 'restock_urgent' : 'restock',
        reqId,
        tx
      );

      await logActivity(
        actorUserId,
        'RESTOCK_MONTHLY_DRAFT_CREATED',
        'restock_request',
        reqId,
        `Created monthly draft ${requestNumber} for ${wh.name} (${allocated.length} products, ${totalQty} units, manual=${force})`,
        tx
      );

      return reqId;
    });

    createdRequests.push({
      id: newReqId,
      request_number: requestNumber,
      warehouse_id: wh.id,
      warehouse_name: wh.name,
      items_count: allocated.length,
      total_suggested_qty: totalQty,
    });
  }

  return {
    checked: true,
    withinWindow,
    today: todayStr,
    leadTimeDays,
    createdRequests,
    skippedWarehouses,
  };
}

/**
 * Checks for Approved/In Transit supplier deliveries whose expected_arrival_date has passed
 * and sends an overdue alert to Admins (idempotent via overdue_notified flag).
 */
export async function checkOverdueRestocks(): Promise<number> {
  const todayStr = await getTodaySqlDate();
  const inTransit = await db.queryAll<{
    id: number;
    request_number: string;
    warehouse_name: string;
    expected_arrival_date: string | null;
    status: string;
  }>(
    `SELECT rr.id, rr.request_number, w.name AS warehouse_name, rr.expected_arrival_date, rr.status
     FROM restock_requests rr
     JOIN warehouses w ON w.id = rr.warehouse_id
     WHERE rr.status = 'Approved/In Transit'
       AND COALESCE(rr.overdue_notified, 0) = 0
       AND rr.expected_arrival_date IS NOT NULL`
  );

  let alerted = 0;
  for (const r of inTransit) {
    if (isRestockOverdue(r.status, r.expected_arrival_date, todayStr)) {
      await db.transaction(async (tx) => {
        await tx.execute(
          'UPDATE restock_requests SET overdue_notified = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
          [r.id]
        );
        await notifyAdmins(
          `Overdue Supplier Delivery: ${r.request_number}`,
          `Supplier restock ${r.request_number} for ${r.warehouse_name} was expected on ${r.expected_arrival_date} and has not been marked Received yet.`,
          'restock_urgent',
          r.id,
          tx
        );
        await logActivity(
          null,
          'RESTOCK_OVERDUE_ALERT',
          'restock_request',
          r.id,
          `Delivery ${r.request_number} overdue (expected ${r.expected_arrival_date})`,
          tx
        );
      });
      alerted += 1;
    }
  }
  return alerted;
}

/**
 * Notifies active franchisees when previously No Stock products are restocked back into stock.
 */
export async function notifyFranchiseesBackInStock(
  warehouseName: string,
  restockedProductNames: string[],
  requestId: number,
  executor: DbExecutor = db
): Promise<void> {
  if (restockedProductNames.length === 0) return;
  const franchiseeUsers = await executor.queryAll<{ user_id: number }>(
    `SELECT f.user_id
     FROM franchisees f
     JOIN users u ON u.id = f.user_id
     WHERE f.status = 'Approved' AND u.is_active = 1`
  );
  const productList = restockedProductNames.join(', ');
  for (const fu of franchiseeUsers) {
    await notifyUser(
      fu.user_id,
      'Products Back In Stock',
      `New supplier delivery received at ${warehouseName}: ${productList} ${
        restockedProductNames.length === 1 ? 'is' : 'are'
      } now available for replenishment orders.`,
      'restock',
      requestId,
      executor
    );
  }
}

/**
 * Idempotently seeds realistic Warehouse Restocking demo products, historical orders,
 * test accounts (if missing), and initial restock requests ONLY when the products table is empty.
 * This ensures all 8 test scenarios work immediately on first boot without overwriting live user edits.
 */
export async function seedRestockingDemoDataIfEmpty(): Promise<void> {
  const prodCountRow = await db.queryOne<{ cnt: number }>('SELECT COUNT(*)::int AS cnt FROM products');
  if ((prodCountRow?.cnt ?? 0) > 0) return;

  const activeWh = await db.queryOne<{ id: number; name: string }>(
    'SELECT id, name FROM warehouses WHERE is_active = 1 ORDER BY id ASC LIMIT 1'
  );
  if (!activeWh) return;

  const categories = await db.queryAll<{ id: number; name: string }>(
    'SELECT id, name FROM categories ORDER BY id ASC'
  );
  if (categories.length === 0) return;

  const findCat = (keyword: string) =>
    categories.find((c) => c.name.toLowerCase().includes(keyword.toLowerCase()))?.id ??
    categories[0].id;

  const adminUser = await db.queryOne<{ id: number }>(
    "SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'admin' ORDER BY u.id ASC LIMIT 1"
  );
  const adminId = adminUser?.id ?? null;

  await db.transaction(async (tx) => {
    // Double-check inside transaction
    const checkCnt = await tx.queryOne<{ cnt: number }>('SELECT COUNT(*)::int AS cnt FROM products');
    if ((checkCnt?.cnt ?? 0) > 0) return;

    // Set active warehouse capacity to 500 units so capacity limits & target-vs-capacity warning are immediately testable
    await tx.execute('UPDATE warehouses SET capacity_limit = 500 WHERE id = $1', [activeWh.id]);

    // Ensure demo franchisee, agent, and delivery accounts exist for end-to-end testing (without touching admin)
    const testHash = await bcrypt.hash('Test@1234', 10);
    let agentUser = await tx.queryOne<{ id: number }>("SELECT id FROM users WHERE username = 'agent_test'");
    if (!agentUser) {
      agentUser = await tx.queryOne<{ id: number }>(
        `INSERT INTO users (role_id, username, password_hash, full_name, email, contact_number, is_active, must_change_password, is_test)
         VALUES (2, 'agent_test', $1, 'Demo Field Agent', 'agent@aicecotabato.ph', '09171234561', 1, 0, 1)
         RETURNING id`,
        [testHash]
      );
    }
    let agentRow = await tx.queryOne<{ id: number }>('SELECT id FROM agents WHERE user_id = $1', [
      agentUser!.id,
    ]);
    if (!agentRow) {
      agentRow = await tx.queryOne<{ id: number }>(
        'INSERT INTO agents (user_id, created_by) VALUES ($1, $2) RETURNING id',
        [agentUser!.id, adminId]
      );
    }

    let franchiseeUser = await tx.queryOne<{ id: number }>(
      "SELECT id FROM users WHERE username = 'franchisee_test'"
    );
    if (!franchiseeUser) {
      franchiseeUser = await tx.queryOne<{ id: number }>(
        `INSERT INTO users (role_id, username, password_hash, full_name, email, contact_number, is_active, must_change_password, is_test)
         VALUES (3, 'franchisee_test', $1, 'Maria Santos', 'maria.store@aicecotabato.ph', '09171234562', 1, 0, 1)
         RETURNING id`,
        [testHash]
      );
    }
    let franchiseeRow = await tx.queryOne<{ id: number }>(
      'SELECT id FROM franchisees WHERE user_id = $1',
      [franchiseeUser!.id]
    );
    if (!franchiseeRow) {
      franchiseeRow = await tx.queryOne<{ id: number }>(
        `INSERT INTO franchisees (user_id, agent_id, owner_name, store_name, address, contact_number, lat, lng, status, approved_by, approved_at, store_code, is_open)
         VALUES ($1, $2, 'Maria Santos', 'Santos Mini Mart', 'Sinsuat Ave, Rosary Heights, Cotabato City', '09171234562', 7.2195, 124.2485, 'Approved', $3, CURRENT_TIMESTAMP, 'AICE-COT-001', 1)
         RETURNING id`,
        [franchiseeUser!.id, agentRow!.id, adminId]
      );
    }
    const existingApp = await tx.queryOne<{ id: number }>(
      'SELECT id FROM franchisee_applications WHERE franchisee_id = $1',
      [franchiseeRow!.id]
    );
    if (!existingApp) {
      await tx.execute(
        `INSERT INTO franchisee_applications (
           application_no, franchisee_id, user_id, agent_id, first_name, last_name, complete_name,
           contact_number, store_name, street, barangay, city_municipality, province, full_address,
           email, lat, lng, status, approved_by, approved_at, activated_at, store_code, is_open
         ) VALUES (
           'APP-DEMO-001', $1, $2, $3, 'Maria', 'Santos', 'Maria Santos',
           '09171234562', 'Santos Mini Mart', 'Sinsuat Ave', 'Rosary Heights', 'Cotabato City', 'Maguindanao del Norte',
           'Sinsuat Ave, Rosary Heights, Cotabato City', 'maria.store@aicecotabato.ph',
           7.2195, 124.2485, 'Active', $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'AICE-COT-001', 1
         )`,
        [franchiseeRow!.id, franchiseeUser!.id, agentRow!.id, adminId]
      );
    }

    // Seed 5 AICE products whose sum of targets (530) > warehouse capacity (500) to demonstrate the target capacity warning
    const demoProducts = [
      {
        categoryId: findCat('stick'),
        sku: 'AICE-CC-01',
        name: 'Crispy Chocolate',
        flavor: 'Belgian Chocolate',
        size: 'Pack of 24',
        price: 380,
        targetQty: 100,
        safetyStock: 15,
        maxReservationQty: 40,
        initialStock: 11, // Target 100, 89 ordered in last 30d, 11 left -> Low Stock (ready for Monthly Check demo!)
      },
      {
        categoryId: findCat('stick'),
        sku: 'AICE-SC-02',
        name: 'Sweet Corn Stick',
        flavor: 'Sweet Corn',
        size: 'Pack of 24',
        price: 320,
        targetQty: 120,
        safetyStock: 20,
        maxReservationQty: 50,
        initialStock: 95, // Healthy In Stock (can be ordered down to Low Stock / No Stock in tests)
      },
      {
        categoryId: findCat('mochi'),
        sku: 'AICE-MV-03',
        name: 'Mochi Vanilla',
        flavor: 'Creamy Vanilla',
        size: 'Pack of 20',
        price: 410,
        targetQty: 100,
        safetyStock: 15,
        maxReservationQty: 30,
        initialStock: 18, // Minus 4 reserved = 14 available -> Low Stock with existing normal Draft
      },
      {
        categoryId: findCat('cone'),
        sku: 'AICE-ST-04',
        name: 'Strawberry Crispy Cone',
        flavor: 'Strawberry Cream',
        size: 'Pack of 20',
        price: 450,
        targetQty: 90,
        safetyStock: 15,
        maxReservationQty: 25,
        initialStock: 0, // No Stock with existing HIGH PRIORITY Draft
      },
      {
        categoryId: findCat('cup'),
        sku: 'AICE-MM-05',
        name: 'Milk Melon Cup',
        flavor: 'Honeydew Melon',
        size: 'Pack of 24',
        price: 360,
        targetQty: 120,
        safetyStock: 20,
        maxReservationQty: 40,
        initialStock: 0, // No Stock with existing Approved/In Transit restock (ready to Receive!)
      },
    ];

    const productIds: Record<string, number> = {};
    for (const p of demoProducts) {
      const row = await tx.queryOne<{ id: number }>(
        `INSERT INTO products (
           category_id, sku, name, flavor, size, price, low_stock_threshold,
           target_quantity, safety_stock, max_reservation_qty, is_active
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1)
         RETURNING id`,
        [
          p.categoryId,
          p.sku,
          p.name,
          p.flavor,
          p.size,
          p.price,
          p.safetyStock,
          p.targetQty,
          p.safetyStock,
          p.maxReservationQty,
        ]
      );
      const pid = Number(row!.id);
      productIds[p.sku] = pid;

      await tx.execute(
        'INSERT INTO inventory (warehouse_id, product_id, quantity) VALUES ($1, $2, $3)',
        [activeWh.id, pid, p.initialStock]
      );
    }

    // Seed historical 30-day delivered orders (Crispy Chocolate: 89 units ordered across 30 days!)
    const histOrder1 = await tx.queryOne<{ id: number }>(
      `INSERT INTO orders (
         order_number, franchisee_id, warehouse_id, status, subtotal, discount_amount,
         delivery_fee, total_amount, stock_deducted, created_at, updated_at
       ) VALUES ('AICE-HIST-001', $1, $2, 'Delivered', 33820, 0, 0, 33820, 1, CURRENT_TIMESTAMP - INTERVAL '12 days', CURRENT_TIMESTAMP - INTERVAL '10 days')
       RETURNING id`,
      [franchiseeRow!.id, activeWh.id]
    );
    await tx.execute(
      `INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal, discount_amount, is_free_item)
       VALUES ($1, $2, 89, 380, 33820, 0, 0)`,
      [histOrder1!.id, productIds['AICE-CC-01']]
    );

    const histOrder2 = await tx.queryOne<{ id: number }>(
      `INSERT INTO orders (
         order_number, franchisee_id, warehouse_id, status, subtotal, discount_amount,
         delivery_fee, total_amount, stock_deducted, created_at, updated_at
       ) VALUES ('AICE-HIST-002', $1, $2, 'Delivered', 45900, 0, 0, 45900, 1, CURRENT_TIMESTAMP - INTERVAL '8 days', CURRENT_TIMESTAMP - INTERVAL '7 days')
       RETURNING id`,
      [franchiseeRow!.id, activeWh.id]
    );
    await tx.execute(
      `INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal, discount_amount, is_free_item)
       VALUES ($1, $2, 30, 320, 9600, 0, 0),
              ($1, $3, 30, 410, 12300, 0, 0),
              ($1, $4, 30, 450, 13500, 0, 0),
              ($1, $5, 30, 360, 10800, 0, 0)`,
      [
        histOrder2!.id,
        productIds['AICE-SC-02'],
        productIds['AICE-MV-03'],
        productIds['AICE-ST-04'],
        productIds['AICE-MM-05'],
      ]
    );

    // Seed one Placed (unconfirmed) franchisee order reserving 10 Sweet Corn Stick and 4 Mochi Vanilla
    // so Reserved Stock vs Available Stock math is immediately visible
    const placedOrder = await tx.queryOne<{ id: number }>(
      `INSERT INTO orders (
         order_number, franchisee_id, warehouse_id, status, subtotal, discount_amount,
         delivery_fee, total_amount, stock_deducted, created_at, updated_at
       ) VALUES ('AICE-RES-001', $1, $2, 'Placed', 4840, 0, 0, 4840, 0, CURRENT_TIMESTAMP - INTERVAL '1 day', CURRENT_TIMESTAMP - INTERVAL '1 day')
       RETURNING id`,
      [franchiseeRow!.id, activeWh.id]
    );
    await tx.execute(
      `INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal, discount_amount, is_free_item)
       VALUES ($1, $2, 10, 320, 3200, 0, 0),
              ($1, $3, 4, 410, 1640, 0, 0)`,
      [placedOrder!.id, productIds['AICE-SC-02'], productIds['AICE-MV-03']]
    );

    const todayStr = await getTodaySqlDate(tx);
    const eta7 = computeExpectedArrivalDate(todayStr, 7);

    // Demo Restock Request 1: HIGH PRIORITY Draft for Strawberry Crispy Cone (No Stock)
    const draftNoStock = await tx.queryOne<{ id: number }>(
      `INSERT INTO restock_requests (
         request_number, warehouse_id, trigger_type, priority, status, created_by, remarks
       ) VALUES ('RST-DEMO-001', $1, 'no_stock', 'high', 'Draft', $2, 'Urgent auto-draft: Strawberry Crispy Cone reached No Stock (0 available).')
       RETURNING id`,
      [activeWh.id, adminId]
    );
    await tx.execute(
      `INSERT INTO restock_request_items (
         request_id, product_id, target_qty_snapshot, physical_stock_snapshot, reserved_stock_snapshot,
         available_stock_snapshot, reorder_point_snapshot, avg_daily_orders_snapshot, suggested_qty, approved_qty
       ) VALUES ($1, $2, 90, 0, 0, 0, 22, 1.0, 97, 97)`,
      [draftNoStock!.id, productIds['AICE-ST-04']]
    );

    // Demo Restock Request 2: Normal Draft for Mochi Vanilla (Low Stock: 18 physical - 4 reserved = 14 available)
    const draftLowStock = await tx.queryOne<{ id: number }>(
      `INSERT INTO restock_requests (
         request_number, warehouse_id, trigger_type, priority, status, created_by, remarks
       ) VALUES ('RST-DEMO-002', $1, 'low_stock', 'normal', 'Draft', $2, 'Auto-draft: Mochi Vanilla dropped to Low Stock (14 available vs reorder point 22).')
       RETURNING id`,
      [activeWh.id, adminId]
    );
    await tx.execute(
      `INSERT INTO restock_request_items (
         request_id, product_id, target_qty_snapshot, physical_stock_snapshot, reserved_stock_snapshot,
         available_stock_snapshot, reorder_point_snapshot, avg_daily_orders_snapshot, suggested_qty, approved_qty
       ) VALUES ($1, $2, 100, 18, 4, 14, 22, 1.0, 93, 93)`,
      [draftLowStock!.id, productIds['AICE-MV-03']]
    );

    // Demo Restock Request 3: Approved/In Transit for Milk Melon Cup (No Stock -> Franchisee sees expected date!)
    const inTransitReq = await tx.queryOne<{ id: number }>(
      `INSERT INTO restock_requests (
         request_number, warehouse_id, trigger_type, priority, status, created_by, approved_by,
         approved_at, expected_arrival_date, remarks
       ) VALUES ('RST-DEMO-003', $1, 'no_stock', 'high', 'Approved/In Transit', $2, $2, CURRENT_TIMESTAMP, $3, 'Supplier shipment confirmed and in transit.')
       RETURNING id`,
      [activeWh.id, adminId, eta7]
    );
    await tx.execute(
      `INSERT INTO restock_request_items (
         request_id, product_id, target_qty_snapshot, physical_stock_snapshot, reserved_stock_snapshot,
         available_stock_snapshot, reorder_point_snapshot, avg_daily_orders_snapshot, suggested_qty, approved_qty
       ) VALUES ($1, $2, 120, 0, 0, 0, 27, 1.0, 127, 100)`,
      [inTransitReq!.id, productIds['AICE-MM-05']]
    );

    // Seed initial Admin urgent notification for the No Stock draft
    await notifyAdmins(
      'URGENT: No Stock — Strawberry Crispy Cone',
      `Strawberry Crispy Cone at ${activeWh.name} is at No Stock (0 available). High-priority restock draft RST-DEMO-001 requires approval.`,
      'restock_urgent',
      draftNoStock!.id,
      tx
    );

    await logActivity(
      adminId,
      'RESTOCK_DEMO_SEEDED',
      'restock_request',
      draftNoStock!.id,
      'Initialized Warehouse Restocking demo products, orders, and sample restock requests',
      tx
    );
  });
}
