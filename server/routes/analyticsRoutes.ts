import bcrypt from 'bcryptjs';
import type { Router } from 'express';
import db from '../db.ts';
import {
  asyncHandler,
  authorize,
  requireWarehouse,
  parsePagination,
  generateTempPassword,
  logActivity,
  notifyUser,
} from '../helpers.ts';
import {
  calculateDemandForecast,
  computeSalesKpiSummary,
} from '../../src/utils/domainRules.ts';
import {
  checkOverdueRestocks,
  computeWarehouseProductStockMetrics,
} from '../services/restockingService.ts';
import { sortRestockRecommendations } from '../../src/utils/restockingRules.ts';

export function registerAnalyticsAndStaffRoutes(api: Router) {
  // ===== ADMIN DASHBOARD & REPORTS =====
  api.get(
    '/admin/dashboard',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (_req, res) => {
      await checkOverdueRestocks();
      const [orders, franchisees, recentOrders, activeWarehouses, restockKpi] = await Promise.all([
        db.queryOne<any>(
          `SELECT COUNT(*) AS total_orders,
                  COALESCE(SUM(CASE WHEN status = 'Placed' THEN 1 ELSE 0 END), 0) AS pending_orders,
                  COALESCE(SUM(CASE WHEN status IN ('Out for Delivery', 'Near / Arrived') THEN 1 ELSE 0 END), 0) AS in_transit,
                  COALESCE(SUM(CASE WHEN status = 'Delivered' THEN 1 ELSE 0 END), 0) AS delivered_orders,
                  COALESCE(SUM(CASE WHEN status IN ('Confirmed', 'Preparing', 'Assigned to Delivery', 'Out for Delivery', 'Near / Arrived', 'Delivered') THEN total_amount ELSE 0 END), 0) AS total_sales
           FROM orders`
        ),
        db.queryOne<any>(
          `SELECT COALESCE(SUM(CASE WHEN status = 'Approved' THEN 1 ELSE 0 END), 0) AS approved,
                  COALESCE(SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END), 0) AS pending,
                  COALESCE(SUM(CASE WHEN status = 'Rejected' THEN 1 ELSE 0 END), 0) AS rejected
           FROM franchisees`
        ),
        db.queryAll(
          `SELECT o.id, o.order_number, o.status, o.total_amount, o.created_at, f.store_name
           FROM orders o
           JOIN franchisees f ON f.id = o.franchisee_id
           ORDER BY o.id DESC LIMIT 8`
        ),
        db.queryAll<{ id: number; name: string }>(
          'SELECT id, name FROM warehouses WHERE is_active = 1 ORDER BY id ASC'
        ),
        db.queryOne<any>(
          `SELECT
             COALESCE(SUM(CASE WHEN status = 'Draft' THEN 1 ELSE 0 END), 0)::int AS pending_drafts,
             COALESCE(SUM(CASE WHEN status = 'Draft' AND priority = 'high' THEN 1 ELSE 0 END), 0)::int AS high_priority_drafts,
             COALESCE(SUM(CASE WHEN status = 'Approved/In Transit' THEN 1 ELSE 0 END), 0)::int AS in_transit,
             COALESCE(SUM(CASE WHEN status = 'Approved/In Transit' AND expected_arrival_date IS NOT NULL AND expected_arrival_date < to_char(CURRENT_DATE, 'YYYY-MM-DD') THEN 1 ELSE 0 END), 0)::int AS overdue
           FROM restock_requests`
        ),
      ]);

      const allRecommendations: any[] = [];
      let lowStockCount = 0;
      let noStockCount = 0;

      for (const wh of activeWarehouses) {
        const overview = await computeWarehouseProductStockMetrics(wh.id);
        if (!overview) continue;
        lowStockCount += overview.low_stock_count;
        noStockCount += overview.no_stock_count;
        for (const p of overview.products) {
          if (p.stock_status === 'No Stock' || p.stock_status === 'Low Stock') {
            allRecommendations.push({
              ...p,
              warehouse_name: overview.warehouse_name,
            });
          }
        }
      }

      const sortedRecommendations = sortRestockRecommendations(allRecommendations);

      res.json({
        orders,
        franchisees,
        lowStockCount: lowStockCount + noStockCount,
        noStockCount,
        lowStockOnlyCount: lowStockCount,
        restockSummary: restockKpi || {
          pending_drafts: 0,
          high_priority_drafts: 0,
          in_transit: 0,
          overdue: 0,
        },
        restockRecommendations: sortedRecommendations,
        recentOrders,
      });
    })
  );

  // ===== SALES ANALYTICS (Admin Only — Real Cloud SQL PostgreSQL Data) =====
  api.get(
    '/analytics/sales',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const rangeParam = String(req.query.range || '30d');
      const range = ['7d', '30d', 'month', 'custom'].includes(rangeParam) ? rangeParam : '30d';
      const warehouseId = Number.isInteger(Number(req.query.warehouse_id)) && Number(req.query.warehouse_id) > 0
        ? Number(req.query.warehouse_id)
        : null;
      const categoryId = Number.isInteger(Number(req.query.category_id)) && Number(req.query.category_id) > 0
        ? Number(req.query.category_id)
        : null;

      let startDate = '';
      let endDate = '';
      let prevStartDate = '';
      let prevEndDate = '';
      let groupBy: 'day' | 'week' | 'month' = 'day';

      if (range === '7d') {
        const d = await db.queryOne<any>(
          `SELECT to_char(CURRENT_DATE - INTERVAL '6 days', 'YYYY-MM-DD') AS s,
                  to_char(CURRENT_DATE, 'YYYY-MM-DD') AS e,
                  to_char(CURRENT_DATE - INTERVAL '13 days', 'YYYY-MM-DD') AS ps,
                  to_char(CURRENT_DATE - INTERVAL '7 days', 'YYYY-MM-DD') AS pe`
        );
        startDate = d.s;
        endDate = d.e;
        prevStartDate = d.ps;
        prevEndDate = d.pe;
        groupBy = 'day';
      } else if (range === 'month') {
        const d = await db.queryOne<any>(
          `SELECT to_char(date_trunc('month', CURRENT_DATE), 'YYYY-MM-DD') AS s,
                  to_char(CURRENT_DATE, 'YYYY-MM-DD') AS e,
                  to_char(date_trunc('month', CURRENT_DATE) - INTERVAL '1 month', 'YYYY-MM-DD') AS ps,
                  to_char(date_trunc('month', CURRENT_DATE) - INTERVAL '1 day', 'YYYY-MM-DD') AS pe`
        );
        startDate = d.s;
        endDate = d.e;
        prevStartDate = d.ps;
        prevEndDate = d.pe;
        groupBy = 'day';
      } else if (range === 'custom' && req.query.from && req.query.to) {
        const rawFrom = String(req.query.from).trim().slice(0, 10);
        const rawTo = String(req.query.to).trim().slice(0, 10);
        const d = await db.queryOne<any>(
          `SELECT to_char($1::date, 'YYYY-MM-DD') AS s,
                  to_char($2::date, 'YYYY-MM-DD') AS e,
                  GREATEST(1, ($2::date - $1::date) + 1)::int AS span`,
          [rawFrom, rawTo]
        );
        startDate = d?.s || rawFrom;
        endDate = d?.e || rawTo;
        const span = Number(d?.span || 30);
        const prev = await db.queryOne<any>(
          `SELECT to_char($1::date - ($2::int * INTERVAL '1 day'), 'YYYY-MM-DD') AS ps,
                  to_char($1::date - INTERVAL '1 day', 'YYYY-MM-DD') AS pe`,
          [startDate, span]
        );
        prevStartDate = prev.ps;
        prevEndDate = prev.pe;
        groupBy = span > 90 ? 'month' : span > 35 ? 'week' : 'day';
      } else {
        const d = await db.queryOne<any>(
          `SELECT to_char(CURRENT_DATE - INTERVAL '29 days', 'YYYY-MM-DD') AS s,
                  to_char(CURRENT_DATE, 'YYYY-MM-DD') AS e,
                  to_char(CURRENT_DATE - INTERVAL '59 days', 'YYYY-MM-DD') AS ps,
                  to_char(CURRENT_DATE - INTERVAL '30 days', 'YYYY-MM-DD') AS pe`
        );
        startDate = d.s;
        endDate = d.e;
        prevStartDate = d.ps;
        prevEndDate = d.pe;
        groupBy = 'day';
      }

      const REVENUE_STATUS_SQL =
        "('Confirmed', 'Preparing', 'Assigned to Delivery', 'Out for Delivery', 'Near / Arrived', 'Delivered')";

      // Safe integer-coerced clauses (validated integer > 0 above)
      const whClause = warehouseId ? ` AND o.warehouse_id = ${warehouseId}` : '';
      const catExistsClause = categoryId
        ? ` AND EXISTS (
              SELECT 1 FROM order_items oi
              JOIN products p ON p.id = oi.product_id
              WHERE oi.order_id = o.id AND p.category_id = ${categoryId}
            )`
        : '';
      const orderRevenueExpr = categoryId
        ? `COALESCE((
              SELECT SUM(oi.subtotal)
              FROM order_items oi
              JOIN products p ON p.id = oi.product_id
              WHERE oi.order_id = o.id AND p.category_id = ${categoryId}
            ), 0)`
        : 'o.total_amount';

      const queryPeriodMetrics = async (pStart: string, pEnd: string) => {
        return db.queryOne<any>(
          `SELECT
             COALESCE(SUM(CASE WHEN o.status IN ${REVENUE_STATUS_SQL} THEN ${orderRevenueExpr} ELSE 0 END), 0) AS total_revenue,
             COALESCE(SUM(CASE WHEN o.status IN ${REVENUE_STATUS_SQL} THEN 1 ELSE 0 END), 0) AS counted_orders,
             COUNT(*) AS total_orders,
             COALESCE(SUM(CASE WHEN o.status = 'Delivered' THEN 1 ELSE 0 END), 0) AS delivered_orders,
             COALESCE(SUM(CASE WHEN o.status IN ('Cancelled', 'Rejected') THEN 1 ELSE 0 END), 0) AS cancelled_orders
           FROM orders o
           WHERE o.created_at::date >= $1::date
             AND o.created_at::date <= $2::date
             ${whClause}
             ${catExistsClause}`,
          [pStart, pEnd]
        );
      };

      const [currentRaw, previousRaw] = await Promise.all([
        queryPeriodMetrics(startDate, endDate),
        queryPeriodMetrics(prevStartDate, prevEndDate),
      ]);
      const kpis = computeSalesKpiSummary(currentRaw, previousRaw);

      const pgDateFmt =
        groupBy === 'month' ? 'YYYY-MM' : groupBy === 'week' ? 'IYYY-"W"IW' : 'YYYY-MM-DD';

      const revenueOverTime = await db.queryAll<any>(
        `SELECT
           to_char(o.created_at, '${pgDateFmt}') AS period_label,
           COALESCE(SUM(CASE WHEN o.status IN ${REVENUE_STATUS_SQL} THEN ${orderRevenueExpr} ELSE 0 END), 0) AS revenue,
           COALESCE(SUM(CASE WHEN o.status IN ${REVENUE_STATUS_SQL} THEN 1 ELSE 0 END), 0) AS counted_orders,
           COUNT(*) AS total_orders
         FROM orders o
         WHERE o.created_at::date >= $1::date
           AND o.created_at::date <= $2::date
           ${whClause}
           ${catExistsClause}
         GROUP BY to_char(o.created_at, '${pgDateFmt}')
         ORDER BY period_label ASC`,
        [startDate, endDate]
      );

      const itemCatClause = categoryId ? ` AND p.category_id = ${categoryId}` : '';
      const productSalesRows = await db.queryAll<any>(
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
           AND o.created_at::date >= $1::date
           AND o.created_at::date <= $2::date
           ${whClause}
           ${itemCatClause}
         GROUP BY p.id, c.name
         HAVING COALESCE(SUM(oi.quantity), 0) > 0 OR COALESCE(SUM(oi.subtotal), 0) > 0`,
        [startDate, endDate]
      );

      const topProductsByRevenue = [...productSalesRows]
        .sort(
          (a, b) =>
            Number(b.revenue) - Number(a.revenue) || Number(b.boxes_sold) - Number(a.boxes_sold)
        )
        .slice(0, 5);

      const topProductsByBoxes = [...productSalesRows]
        .sort(
          (a, b) =>
            Number(b.boxes_sold) - Number(a.boxes_sold) || Number(b.revenue) - Number(a.revenue)
        )
        .slice(0, 5);

      const categoryRows = await db.queryAll<any>(
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
           AND o.created_at::date >= $1::date
           AND o.created_at::date <= $2::date
           ${whClause}
           ${itemCatClause}
         GROUP BY c.id, c.name
         ORDER BY revenue DESC`,
        [startDate, endDate]
      );

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

      const franchiseeRows = await db.queryAll<any>(
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
         WHERE o.created_at::date >= $1::date
           AND o.created_at::date <= $2::date
           ${whClause}
           ${catExistsClause}
         GROUP BY f.id, u.username
         ORDER BY order_value DESC, total_orders DESC
         LIMIT 10`,
        [startDate, endDate]
      );

      const topFranchisees = franchiseeRows.map((row, index) => ({
        ...row,
        rank: index + 1,
        order_value: Number(row.order_value || 0),
        total_orders: Number(row.total_orders || 0),
        counted_orders: Number(row.counted_orders || 0),
        delivered_orders: Number(row.delivered_orders || 0),
      }));

      const agentRows = await db.queryAll<any>(
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
               AND o.created_at::date >= $1::date
               AND o.created_at::date <= $2::date
               ${whClause}
               ${catExistsClause}
           ), 0) AS counted_orders,
           COALESCE((
             SELECT SUM(${orderRevenueExpr})
             FROM orders o
             JOIN franchisees f ON f.id = o.franchisee_id
             WHERE f.agent_id = a.id
               AND o.status IN ${REVENUE_STATUS_SQL}
               AND o.created_at::date >= $1::date
               AND o.created_at::date <= $2::date
               ${whClause}
               ${catExistsClause}
           ), 0) AS total_order_value
         FROM agents a
         JOIN users u ON u.id = a.user_id
         ORDER BY total_order_value DESC, approved_franchisees DESC, a.id ASC`,
        [startDate, endDate]
      );

      const statusRows = await db.queryAll<any>(
        `SELECT
           o.status,
           COUNT(o.id) AS order_count,
           COALESCE(SUM(${orderRevenueExpr}), 0) AS status_amount,
           COUNT(d.id) AS assigned_deliveries
         FROM orders o
         LEFT JOIN deliveries d ON d.order_id = o.id
         WHERE o.created_at::date >= $1::date
           AND o.created_at::date <= $2::date
           ${whClause}
           ${catExistsClause}
         GROUP BY o.status
         ORDER BY order_count DESC`,
        [startDate, endDate]
      );

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
    })
  );

  api.get(
    '/admin/reports/sales',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const { from, to } = req.query;
      const params: any[] = [];
      let where = "WHERE o.status NOT IN ('Cancelled', 'Rejected')";
      if (from) {
        params.push(String(from).slice(0, 10));
        where += ` AND o.created_at::date >= $${params.length}::date`;
      }
      if (to) {
        params.push(String(to).slice(0, 10));
        where += ` AND o.created_at::date <= $${params.length}::date`;
      }

      const rows = await db.queryAll<any>(
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
         ORDER BY o.id DESC`,
        params
      );

      const totalSales = rows.reduce((sum, r) => sum + Number(r.total_amount || 0), 0);
      const totalDiscount = rows.reduce((sum, r) => sum + Number(r.discount_amount || 0), 0);
      res.json({ data: rows, summary: { count: rows.length, totalSales, totalDiscount } });
    })
  );

  api.get(
    '/admin/reports/inventory',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const warehouseId = req.query.warehouse_id ? Number(req.query.warehouse_id) : null;
      const warehouses = warehouseId
        ? await db.queryAll<{ id: number; name: string }>(
            'SELECT id, name FROM warehouses WHERE id = $1 ORDER BY name ASC',
            [warehouseId]
          )
        : await db.queryAll<{ id: number; name: string }>(
            'SELECT id, name FROM warehouses WHERE is_active = 1 ORDER BY name ASC'
          );

      const rows: any[] = [];
      for (const wh of warehouses) {
        const overview = await computeWarehouseProductStockMetrics(wh.id);
        if (!overview) continue;
        for (const p of overview.products) {
          rows.push({
            warehouse_id: wh.id,
            warehouse_name: wh.name,
            sku: p.sku,
            product_name: p.name,
            flavor: p.flavor,
            size: p.size,
            price: p.price,
            quantity: p.physical_stock,
            physical_stock: p.physical_stock,
            reserved_stock: p.reserved_stock,
            available_stock: p.available_stock,
            target_quantity: p.target_quantity,
            reorder_point: p.reorder_point,
            low_stock_threshold: p.reorder_point,
            stock_status: p.stock_status,
            recommendation_label: p.recommendation_label,
          });
        }
      }
      res.json({ data: rows });
    })
  );

  // ===== ADMIN: DEMAND FORECASTING =====
  api.get(
    '/admin/demand-forecast',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const warehouseId = Number.isInteger(Number(req.query.warehouse_id)) && Number(req.query.warehouse_id) > 0
        ? Number(req.query.warehouse_id)
        : null;
      const categoryId = Number.isInteger(Number(req.query.category_id)) && Number(req.query.category_id) > 0
        ? Number(req.query.category_id)
        : null;
      const horizon: 7 | 30 = req.query.horizon === '7' ? 7 : 30;

      const whFilterOrder = warehouseId ? `AND o.warehouse_id = ${warehouseId}` : '';
      const whFilterInv = warehouseId ? `AND i.warehouse_id = ${warehouseId}` : '';
      const catFilter = categoryId ? `AND p.category_id = ${categoryId}` : '';

      const rawProducts = await db.queryAll<any>(
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
               AND o.created_at::date >= (CURRENT_DATE - INTERVAL '7 days')::date
               ${whFilterOrder}
           ), 0) AS recent_7d_qty,
           COALESCE((
             SELECT SUM(oi.quantity)
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             WHERE oi.product_id = p.id
               AND o.status NOT IN ('Cancelled', 'Rejected')
               AND o.created_at::date < (CURRENT_DATE - INTERVAL '7 days')::date
               AND o.created_at::date >= (CURRENT_DATE - INTERVAL '14 days')::date
               ${whFilterOrder}
           ), 0) AS prev_7d_qty,
           COALESCE((
             SELECT SUM(oi.quantity)
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             WHERE oi.product_id = p.id
               AND o.status NOT IN ('Cancelled', 'Rejected')
               AND o.created_at::date >= (CURRENT_DATE - INTERVAL '30 days')::date
               ${whFilterOrder}
           ), 0) AS recent_30d_qty
         FROM products p
         JOIN categories c ON c.id = p.category_id
         WHERE p.is_active = 1 ${catFilter}`
      );

      const forecastRows = calculateDemandForecast(rawProducts, horizon);

      const topFranchiseesByProduct = await db.queryAll<any>(
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
         GROUP BY oi.product_id, f.id, f.store_name
         ORDER BY store_qty DESC`
      );

      const storeMap: Record<
        number,
        { store_name: string; store_qty: number; store_orders: number }[]
      > = {};
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

      let stockWhId = warehouseId;
      if (!stockWhId) {
        const firstWh = await db.queryOne<{ id: number }>(
          'SELECT id FROM warehouses WHERE is_active = 1 ORDER BY id ASC LIMIT 1'
        );
        stockWhId = firstWh?.id || null;
      }
      const stockOverview = stockWhId
        ? await computeWarehouseProductStockMetrics(stockWhId)
        : null;
      const stockByProd = new Map<number, any>();
      if (stockOverview) {
        for (const m of stockOverview.products) {
          stockByProd.set(m.product_id, m);
        }
      }

      const enrichedRows = forecastRows.map((item) => {
        const sm = stockByProd.get(item.product_id);
        return {
          ...item,
          available_stock: sm ? sm.available_stock : item.current_stock,
          reorder_point: sm ? sm.reorder_point : item.low_stock_threshold,
          stock_status: sm ? sm.stock_status : item.current_stock <= 0 ? 'No Stock' : 'In Stock',
          top_stores: storeMap[item.product_id] || [],
        };
      });

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
    })
  );

  api.get(
    '/admin/activity-logs',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const { page, limit, offset } = parsePagination(req.query);
      const search = `%${String(req.query.search || '').trim()}%`;
      const totalRow = await db.queryOne<{ total: number }>(
        `SELECT COUNT(*) AS total
         FROM activity_logs al
         LEFT JOIN users u ON u.id = al.user_id
         WHERE al.action ILIKE $1 OR COALESCE(al.details, '') ILIKE $1 OR COALESCE(u.username, '') ILIKE $1`,
        [search]
      );

      const rows = await db.queryAll(
        `SELECT al.*, u.username, u.full_name
         FROM activity_logs al
         LEFT JOIN users u ON u.id = al.user_id
         WHERE al.action ILIKE $1 OR COALESCE(al.details, '') ILIKE $1 OR COALESCE(u.username, '') ILIKE $1
         ORDER BY al.id DESC LIMIT $2 OFFSET $3`,
        [search, limit, offset]
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

  // ===== ADMIN: AGENT MANAGEMENT =====
  api.get(
    '/admin/agents',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const { page, limit, offset } = parsePagination(req.query);
      const search = `%${String(req.query.search || '').trim()}%`;
      const status = req.query.status;
      const params: any[] = [search];
      let where =
        "WHERE (u.full_name ILIKE $1 OR u.username ILIKE $1 OR COALESCE(u.email, '') ILIKE $1)";
      if (status === 'active') where += ' AND u.is_active = 1';
      if (status === 'inactive') where += ' AND u.is_active = 0';

      const totalRow = await db.queryOne<{ total: number }>(
        `SELECT COUNT(*) AS total FROM agents a JOIN users u ON u.id = a.user_id ${where}`,
        params
      );

      const rows = await db.queryAll(
        `SELECT a.id AS agent_id, u.id AS user_id, u.username, u.full_name, u.email, u.contact_number,
                u.is_active, u.must_change_password, u.created_at,
                (SELECT COUNT(*) FROM franchisees f WHERE f.agent_id = a.id) AS total_recruits,
                (SELECT COUNT(*) FROM franchisees f WHERE f.agent_id = a.id AND f.status = 'Approved') AS approved_recruits,
                (SELECT COUNT(*) FROM franchisees f WHERE f.agent_id = a.id AND f.status = 'Pending') AS pending_recruits
         FROM agents a
         JOIN users u ON u.id = a.user_id
         ${where}
         ORDER BY a.id DESC LIMIT $2 OFFSET $3`,
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

  api.post(
    '/admin/agents',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const { full_name, contact_number, email, username } = req.body;
      if (!full_name || !contact_number || !email || !username) {
        res
          .status(400)
          .json({ message: 'Full name, contact number, email, and username are required.' });
        return;
      }

      const cleanUser = String(username).trim().toLowerCase();
      const dup = await db.queryOne('SELECT id FROM users WHERE username = $1', [cleanUser]);
      if (dup) {
        res.status(409).json({ message: 'Username already exists.' });
        return;
      }

      const tempPassword = generateTempPassword();
      const hash = await bcrypt.hash(tempPassword, 10);

      const agentId = await db.transaction(async (tx) => {
        const role = await tx.queryOne<{ id: number }>("SELECT id FROM roles WHERE name = 'agent'");
        const uRes = await tx.queryOne<{ id: number }>(
          `INSERT INTO users (role_id, username, password_hash, full_name, email, contact_number, is_active, must_change_password)
           VALUES ($1, $2, $3, $4, $5, $6, 1, 1)
           RETURNING id`,
          [
            role!.id,
            cleanUser,
            hash,
            String(full_name).trim(),
            String(email).trim(),
            String(contact_number).trim(),
          ]
        );
        const aRes = await tx.queryOne<{ id: number }>(
          'INSERT INTO agents (user_id, created_by) VALUES ($1, $2) RETURNING id',
          [Number(uRes!.id), req.user!.id]
        );
        await logActivity(
          req.user!.id,
          'AGENT_CREATED',
          'agent',
          Number(aRes!.id),
          `Created agent ${cleanUser}`,
          tx
        );
        return Number(aRes!.id);
      });

      res.status(201).json({
        message: 'Agent account created. Hand the one-time temporary password to the agent.',
        agentId,
        username: cleanUser,
        temporaryPassword: tempPassword,
      });
    })
  );

  api.post(
    '/admin/agents/:userId/reset-password',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const { userId } = req.params;
      const tempPassword = generateTempPassword();
      const hash = await bcrypt.hash(tempPassword, 10);

      const agentUser = await db.queryOne<{ id: number; username: string }>(
        `SELECT u.id, u.username FROM users u JOIN roles r ON r.id = u.role_id
         WHERE u.id = $1 AND r.name = 'agent'`,
        [Number(userId)]
      );

      if (!agentUser) {
        res.status(404).json({ message: 'Agent not found.' });
        return;
      }

      await db.execute(
        'UPDATE users SET password_hash = $1, must_change_password = 1, is_test = 0, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [hash, agentUser.id]
      );

      await logActivity(
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
    })
  );

  // ===== ADMIN: DELIVERY STAFF =====
  api.get(
    '/admin/delivery-staff',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const { page, limit, offset } = parsePagination(req.query);
      const search = `%${String(req.query.search || '').trim()}%`;

      const totalRow = await db.queryOne<{ total: number }>(
        `SELECT COUNT(*) AS total FROM users u JOIN roles r ON r.id = u.role_id
         WHERE r.name = 'delivery' AND (u.full_name ILIKE $1 OR u.username ILIKE $1 OR COALESCE(u.contact_number, '') ILIKE $1)`,
        [search]
      );

      const rows = await db.queryAll(
        `SELECT u.id, u.username, u.full_name, u.email, u.contact_number, u.is_active, u.created_at,
                (SELECT COUNT(*) FROM deliveries d WHERE d.delivery_staff_id = u.id AND d.status != 'Delivered') AS active_deliveries,
                (SELECT COUNT(*) FROM deliveries d WHERE d.delivery_staff_id = u.id AND d.status = 'Delivered') AS completed_deliveries
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE r.name = 'delivery' AND (u.full_name ILIKE $1 OR u.username ILIKE $1 OR COALESCE(u.contact_number, '') ILIKE $1)
         ORDER BY u.id DESC LIMIT $2 OFFSET $3`,
        [search, limit, offset]
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

  api.post(
    '/admin/delivery-staff',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const { full_name, username, contact_number, email, password } = req.body;
      if (!full_name || !username || !contact_number || !password) {
        res
          .status(400)
          .json({ message: 'Full name, username, contact number, and password are required.' });
        return;
      }
      if (String(password).length < 8) {
        res.status(400).json({ message: 'Password must be at least 8 characters.' });
        return;
      }
      const cleanUser = String(username).trim().toLowerCase();
      const dup = await db.queryOne('SELECT id FROM users WHERE username = $1', [cleanUser]);
      if (dup) {
        res.status(409).json({ message: 'Username already exists.' });
        return;
      }

      const role = await db.queryOne<{ id: number }>("SELECT id FROM roles WHERE name = 'delivery'");
      const hash = await bcrypt.hash(String(password), 10);
      const row = await db.queryOne<{ id: number }>(
        `INSERT INTO users (role_id, username, password_hash, full_name, email, contact_number, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, 1)
         RETURNING id`,
        [
          role!.id,
          cleanUser,
          hash,
          String(full_name).trim(),
          email ? String(email).trim() : null,
          String(contact_number).trim(),
        ]
      );

      await logActivity(
        req.user!.id,
        'DELIVERY_STAFF_CREATED',
        'user',
        Number(row!.id),
        `Created delivery staff @${cleanUser}`
      );
      res.status(201).json({
        message: 'Delivery staff account created.',
        id: Number(row!.id),
      });
    })
  );

  api.patch(
    '/admin/users/:userId/toggle-status',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const targetId = Number(req.params.userId);
      if (targetId === req.user!.id) {
        res.status(400).json({ message: 'You cannot deactivate your own account.' });
        return;
      }
      const row = await db.queryOne<{ is_active: number; username: string }>(
        'SELECT is_active, username FROM users WHERE id = $1',
        [targetId]
      );
      if (!row) {
        res.status(404).json({ message: 'User not found.' });
        return;
      }
      const nextState = row.is_active ? 0 : 1;
      await db.execute(
        'UPDATE users SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [nextState, targetId]
      );
      await logActivity(
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
    })
  );

  // ===== COMMISSIONS =====
  api.get(
    '/commissions',
    authorize('admin', 'agent'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const { page, limit, offset } = parsePagination(req.query);
      const params: any[] = [];
      let where = 'WHERE 1=1';

      if (req.user!.role === 'agent') {
        params.push(req.user!.agentId);
        where += ` AND c.agent_id = $${params.length}`;
      } else if (req.query.agent_id) {
        params.push(Number(req.query.agent_id));
        where += ` AND c.agent_id = $${params.length}`;
      }

      if (req.query.status) {
        params.push(String(req.query.status));
        where += ` AND c.status = $${params.length}`;
      }

      const totalRow = await db.queryOne<{ total: number }>(
        `SELECT COUNT(*) AS total FROM commissions c ${where}`,
        params
      );

      const rows = await db.queryAll(
        `SELECT c.*, u.full_name AS agent_name, u.username AS agent_username
         FROM commissions c
         JOIN agents a ON a.id = c.agent_id
         JOIN users u ON u.id = a.user_id
         ${where}
         ORDER BY c.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
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

  api.post(
    '/commissions',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const { agent_id, amount, period_label, status, notes } = req.body;
      if (!agent_id || !amount || !period_label) {
        res.status(400).json({ message: 'Agent, amount, and period label are required.' });
        return;
      }

      const ag = await db.queryOne<{ id: number; user_id: number }>(
        'SELECT id, user_id FROM agents WHERE id = $1',
        [Number(agent_id)]
      );
      if (!ag) {
        res.status(404).json({ message: 'Agent not found.' });
        return;
      }

      const cntRow = await db.queryOne<{ cnt: number }>(
        "SELECT COUNT(*) AS cnt FROM franchisees WHERE agent_id = $1 AND status = 'Approved'",
        [ag.id]
      );
      const recruitsCount = cntRow?.cnt ?? 0;

      const row = await db.queryOne<{ id: number }>(
        `INSERT INTO commissions (agent_id, recruits_count, amount, period_label, status, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          ag.id,
          recruitsCount,
          Number(amount),
          String(period_label).trim(),
          status === 'Paid' ? 'Paid' : 'Pending',
          notes ? String(notes).trim() : null,
          req.user!.id,
        ]
      );

      await notifyUser(
        ag.user_id,
        'New Commission Record',
        `Admin recorded a commission of PHP ${Number(amount).toFixed(2)} for ${String(period_label).trim()} (${recruitsCount} approved recruits).`,
        'commission',
        Number(row!.id)
      );
      await logActivity(
        req.user!.id,
        'COMMISSION_CREATED',
        'commission',
        Number(row!.id),
        `Agent #${ag.id}: PHP ${Number(amount).toFixed(2)}`
      );

      res.status(201).json({ message: 'Commission created.', id: Number(row!.id) });
    })
  );

  api.patch(
    '/commissions/:id/paid',
    authorize('admin'),
    requireWarehouse,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      await db.execute("UPDATE commissions SET status = 'Paid' WHERE id = $1", [Number(id)]);
      await logActivity(req.user!.id, 'COMMISSION_PAID', 'commission', id, 'Marked commission as Paid');
      res.json({ message: 'Commission marked as Paid.' });
    })
  );
}
