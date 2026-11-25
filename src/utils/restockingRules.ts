/**
 * Pure domain rules and calculations for Warehouse Restocking (Supplier -> Warehouse).
 * Shared across the Express backend, React frontend, and node:test suite.
 */

export type StockStatus = 'In Stock' | 'Low Stock' | 'No Stock';

export type RestockTriggerType = 'monthly' | 'low_stock' | 'no_stock';

export type RestockPriority = 'normal' | 'high';

export type RestockStatus =
  | 'Draft'
  | 'Approved/In Transit'
  | 'Received'
  | 'Rejected'
  | 'Cancelled';

export interface ActiveRestockSummary {
  id: number;
  request_number: string;
  status: RestockStatus;
  priority: RestockPriority;
  trigger_type: RestockTriggerType;
  expected_arrival_date: string | null;
}

/**
 * Available stock = physical stock minus stock reserved by unconfirmed franchisee orders
 * (never negative).
 */
export function computeAvailableStock(physicalStock: number, reservedStock: number): number {
  const phys = Math.max(0, Math.floor(Number(physicalStock || 0)));
  const res = Math.max(0, Math.floor(Number(reservedStock || 0)));
  return Math.max(0, phys - res);
}

/**
 * Average daily franchisee orders over the last 30 days.
 * Falls back to `fallbackDaily` (default 0) when there is no recent order history.
 */
export function computeAvgDailyOrders(last30dQty: number, fallbackDaily = 0): number {
  const qty = Math.max(0, Number(last30dQty || 0));
  if (qty <= 0) {
    return Number(Math.max(0, Number(fallbackDaily || 0)).toFixed(2));
  }
  return Number((qty / 30).toFixed(2));
}

/**
 * Reorder point = (average daily franchisee orders * lead time days) + safety stock.
 */
export function computeReorderPoint(
  avgDailyOrders: number,
  leadTimeDays: number,
  safetyStock: number
): number {
  const daily = Math.max(0, Number(avgDailyOrders || 0));
  const lead = Math.max(0, Number(leadTimeDays || 0));
  const safety = Math.max(0, Number(safetyStock || 0));
  return Math.max(0, Math.ceil(daily * lead + safety));
}

/**
 * Exact stock status classification based strictly on AVAILABLE stock:
 * - "No Stock": available === 0 (never "Low Stock" or "Out of stock")
 * - "Low Stock": 0 < available <= reorderPoint
 * - "In Stock": available > reorderPoint
 */
export function classifyStockStatus(availableStock: number, reorderPoint: number): StockStatus {
  const avail = Math.max(0, Math.floor(Number(availableStock || 0)));
  const rp = Math.max(0, Math.floor(Number(reorderPoint || 0)));
  if (avail <= 0) return 'No Stock';
  if (avail <= rp) return 'Low Stock';
  return 'In Stock';
}

/**
 * Exact recommendation text shown next to products and in Restock Recommendations.
 */
export function getRestockRecommendationLabel(status: StockStatus): string | null {
  if (status === 'No Stock') return 'Urgent restock needed';
  if (status === 'Low Stock') return 'Restock recommended';
  return null;
}

/**
 * Delivery quantity formula:
 * Quantity = Target - Available stock + Expected demand during lead time (avgDailyOrders * leadTimeDays)
 * - Floored at 0
 * - Capped so (currentWarehouseTotalStock + quantity) <= warehouseCapacity
 */
export function computeRestockQuantity(params: {
  targetQty: number;
  availableStock: number;
  avgDailyOrders: number;
  leadTimeDays: number;
  currentWarehouseTotalStock: number;
  warehouseCapacity: number;
}): {
  rawQty: number;
  cappedQty: number;
  wasCapped: boolean;
  remainingCapacity: number;
  expectedLeadDemand: number;
} {
  const target = Math.max(0, Number(params.targetQty || 0));
  const avail = Math.max(0, Number(params.availableStock || 0));
  const daily = Math.max(0, Number(params.avgDailyOrders || 0));
  const lead = Math.max(0, Number(params.leadTimeDays || 0));
  const currentTotal = Math.max(0, Number(params.currentWarehouseTotalStock || 0));
  const capacity = Math.max(0, Number(params.warehouseCapacity || 0));

  const expectedLeadDemand = Number((daily * lead).toFixed(2));
  const rawQty = Math.max(0, Math.ceil(target - avail + expectedLeadDemand));
  const remainingCapacity = Math.max(0, Math.floor(capacity - currentTotal));
  const cappedQty = Math.max(0, Math.min(rawQty, remainingCapacity));

  return {
    rawQty,
    cappedQty,
    wasCapped: rawQty > remainingCapacity,
    remainingCapacity,
    expectedLeadDemand,
  };
}

/**
 * Allocates suggested quantities across multiple products in a single batch delivery (e.g., monthly draft)
 * so the combined total never exceeds remaining warehouse capacity.
 * Prioritizes No Stock first, then Low Stock, then In Stock (largest deficit first).
 */
export function allocateBatchQuantitiesWithinCapacity<
  T extends {
    product_id: number;
    stock_status: StockStatus;
    raw_qty: number;
  },
>(
  items: T[],
  currentWarehouseTotalStock: number,
  warehouseCapacity: number
): Array<T & { allocated_qty: number; was_capped: boolean }> {
  let remaining = Math.max(
    0,
    Math.floor(Number(warehouseCapacity || 0) - Number(currentWarehouseTotalStock || 0))
  );

  const priorityRank = (s: StockStatus) => (s === 'No Stock' ? 0 : s === 'Low Stock' ? 1 : 2);
  const sorted = [...items].sort(
    (a, b) =>
      priorityRank(a.stock_status) - priorityRank(b.stock_status) ||
      b.raw_qty - a.raw_qty ||
      a.product_id - b.product_id
  );

  const allocatedMap = new Map<number, { allocated_qty: number; was_capped: boolean }>();
  for (const item of sorted) {
    const desired = Math.max(0, Math.floor(Number(item.raw_qty || 0)));
    const granted = Math.min(desired, remaining);
    remaining = Math.max(0, remaining - granted);
    allocatedMap.set(item.product_id, {
      allocated_qty: granted,
      was_capped: granted < desired,
    });
  }

  return items.map((item) => {
    const alloc = allocatedMap.get(item.product_id) || { allocated_qty: 0, was_capped: false };
    return {
      ...item,
      allocated_qty: alloc.allocated_qty,
      was_capped: alloc.was_capped,
    };
  });
}

/**
 * Validates whether approving or receiving a delivery would exceed warehouse capacity.
 */
export function validateCapacityForIncoming(params: {
  currentWarehouseTotalStock: number;
  incomingTotalQty: number;
  warehouseCapacity: number;
}): {
  ok: boolean;
  projectedTotal: number;
  excess: number;
  remainingCapacity: number;
  error?: string;
} {
  const current = Math.max(0, Math.floor(Number(params.currentWarehouseTotalStock || 0)));
  const incoming = Math.max(0, Math.floor(Number(params.incomingTotalQty || 0)));
  const capacity = Math.max(0, Math.floor(Number(params.warehouseCapacity || 0)));
  const projectedTotal = current + incoming;
  const remainingCapacity = Math.max(0, capacity - current);

  if (projectedTotal > capacity) {
    const excess = projectedTotal - capacity;
    return {
      ok: false,
      projectedTotal,
      excess,
      remainingCapacity,
      error: `Exceeds warehouse capacity by ${excess} unit${excess === 1 ? '' : 's'} (current stock: ${current}, incoming: ${incoming}, capacity: ${capacity}, max allowed incoming: ${remainingCapacity}).`,
    };
  }

  return {
    ok: true,
    projectedTotal,
    excess: 0,
    remainingCapacity,
  };
}

/**
 * Warns Admin when sum of all product target quantities exceeds warehouse capacity.
 */
export function checkTargetsAgainstCapacity(
  totalTargets: number,
  warehouseCapacity: number
): { exceeds: boolean; excess: number } {
  const targets = Math.max(0, Math.floor(Number(totalTargets || 0)));
  const capacity = Math.max(0, Math.floor(Number(warehouseCapacity || 0)));
  const excess = Math.max(0, targets - capacity);
  return {
    exceeds: targets > capacity,
    excess,
  };
}

/**
 * Returns true if `todayDateStr` (YYYY-MM-DD) is within `leadTimeDays` of the end of the current month.
 * Example: in a 30-day month with leadTimeDays = 7, days 23..30 return true (30 - 23 = 7 <= 7).
 */
export function isWithinMonthlyTriggerWindow(todayDateStr: string, leadTimeDays: number): boolean {
  const parts = String(todayDateStr || '')
    .slice(0, 10)
    .split('-')
    .map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return false;
  const [year, month, day] = parts;
  const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const daysRemaining = lastDayOfMonth - day;
  const lead = Math.max(1, Math.floor(Number(leadTimeDays || 7)));
  return daysRemaining >= 0 && daysRemaining <= lead;
}

/**
 * Adds `leadTimeDays` calendar days to a YYYY-MM-DD date string.
 */
export function computeExpectedArrivalDate(approvalDateStr: string, leadTimeDays: number): string {
  const parts = String(approvalDateStr || '')
    .slice(0, 10)
    .split('-')
    .map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    const fallback = new Date();
    fallback.setUTCDate(fallback.getUTCDate() + Math.max(1, Math.floor(Number(leadTimeDays || 7))));
    return fallback.toISOString().slice(0, 10);
  }
  const [year, month, day] = parts;
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() + Math.max(1, Math.floor(Number(leadTimeDays || 7))));
  return dt.toISOString().slice(0, 10);
}

/**
 * Returns true if an Approved/In Transit restock delivery has passed its expected arrival date.
 */
export function isRestockOverdue(
  status: string,
  expectedArrivalDateStr: string | null | undefined,
  todayDateStr: string
): boolean {
  if (status !== 'Approved/In Transit') return false;
  const expected = String(expectedArrivalDateStr || '').slice(0, 10);
  const today = String(todayDateStr || '').slice(0, 10);
  if (!expected || !today) return false;
  return expected < today;
}

/**
 * Builds the franchisee-facing availability message and reservation block flag:
 * - No Stock -> blocked = true; shows expected arrival date if in transit, else "Restock requested" if Draft
 * - Low Stock -> blocked = false; shows "Low Stock. Only X left" (+ expected arrival date if in transit)
 * - In Stock -> blocked = false; shows available stock
 */
export function getFranchiseeStockMessage(
  status: StockStatus,
  availableStock: number,
  activeRestock?: Pick<ActiveRestockSummary, 'status' | 'expected_arrival_date'> | null
): { blocked: boolean; message: string } {
  const avail = Math.max(0, Math.floor(Number(availableStock || 0)));

  if (status === 'No Stock' || avail <= 0) {
    if (activeRestock?.status === 'Approved/In Transit' && activeRestock.expected_arrival_date) {
      return {
        blocked: true,
        message: `No Stock. Restock expected on ${activeRestock.expected_arrival_date}`,
      };
    }
    if (activeRestock?.status === 'Draft') {
      return {
        blocked: true,
        message: 'No Stock. Restock requested',
      };
    }
    return {
      blocked: true,
      message: 'No Stock',
    };
  }

  if (status === 'Low Stock') {
    const base = `Low Stock. Only ${avail} left`;
    if (activeRestock?.status === 'Approved/In Transit' && activeRestock.expected_arrival_date) {
      return {
        blocked: false,
        message: `${base} · Restock expected on ${activeRestock.expected_arrival_date}`,
      };
    }
    return {
      blocked: false,
      message: base,
    };
  }

  return {
    blocked: false,
    message: `In Stock (${avail} available)`,
  };
}

/**
 * Sorts Restock Recommendations with No Stock first, then Low Stock, then lowest available stock.
 */
export function sortRestockRecommendations<
  T extends {
    stock_status: StockStatus;
    available_stock: number;
    name?: string;
    product_name?: string;
  },
>(rows: T[]): T[] {
  const rank = (s: StockStatus) => (s === 'No Stock' ? 0 : s === 'Low Stock' ? 1 : 2);
  return [...rows].sort((a, b) => {
    const rDiff = rank(a.stock_status) - rank(b.stock_status);
    if (rDiff !== 0) return rDiff;
    const aDiff = Number(a.available_stock || 0) - Number(b.available_stock || 0);
    if (aDiff !== 0) return aDiff;
    const nameA = String(a.name || a.product_name || '');
    const nameB = String(b.name || b.product_name || '');
    return nameA.localeCompare(nameB);
  });
}
