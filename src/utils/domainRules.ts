/**
 * Pure domain rules and calculations for AICE Franchisee Hub.
 * Kept pure so both the Express backend, React frontend, and node:test suite can verify them.
 */

export const ORDER_TIMELINE_STEPS = [
  'Placed',
  'Confirmed',
  'Preparing',
  'Assigned to Delivery',
  'Out for Delivery',
  'Near / Arrived',
  'Delivered',
] as const;

export type OrderStatus =
  | (typeof ORDER_TIMELINE_STEPS)[number]
  | 'Cancelled'
  | 'Rejected';

/**
 * Haversine distance in kilometers between two GPS coordinates.
 */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/**
 * Estimates delivery ETA in minutes assuming average urban cold-chain speed (25 km/h).
 */
export function estimateEtaMinutes(distanceKm: number, speedKmh = 25): number {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return 2;
  return Math.max(2, Math.round((distanceKm / speedKmh) * 60));
}

/**
 * Generates a deterministic candidate franchisee username prefix from owner or store name.
 */
export function buildFranchiseeUsernameBase(
  ownerName: string,
  storeName: string
): string {
  const cleaned = (ownerName || storeName || 'franchisee')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 12);
  return cleaned || 'store';
}

/**
 * Validates latitude and longitude bounds.
 */
export function isValidCoords(lat: unknown, lng: unknown): boolean {
  if (lat === null || lat === undefined || lng === null || lng === undefined) {
    return false;
  }
  if (String(lat).trim() === '' || String(lng).trim() === '') return false;
  const la = Number(lat);
  const ln = Number(lng);
  return (
    !Number.isNaN(la) &&
    !Number.isNaN(ln) &&
    la >= -90 &&
    la <= 90 &&
    ln >= -180 &&
    ln <= 180
  );
}

/**
 * Validates whether a user must change their password on login.
 * Test accounts (is_test = true) always skip the forced password change.
 */
export function requiresForcedPasswordChange(user: {
  must_change_password: boolean | number;
  is_test?: boolean | number;
}): boolean {
  if (Boolean(user.is_test)) return false;
  return Boolean(user.must_change_password);
}

/**
 * Computes new inventory balance and validates against negative stock.
 */
export function computeStockTransition(
  currentQty: number,
  movementType: 'STOCK_IN' | 'ADJUSTMENT' | 'ORDER_DEDUCT' | 'ORDER_RESTORE',
  quantityDelta: number
): { ok: boolean; newQty: number; error?: string } {
  if (!Number.isInteger(quantityDelta) || quantityDelta === 0) {
    return {
      ok: false,
      newQty: currentQty,
      error: 'Quantity change must be a non-zero integer.',
    };
  }
  if (movementType === 'STOCK_IN' && quantityDelta < 0) {
    return {
      ok: false,
      newQty: currentQty,
      error: 'Stock-in quantity must be positive.',
    };
  }
  const newQty = currentQty + quantityDelta;
  if (newQty < 0) {
    return {
      ok: false,
      newQty: currentQty,
      error: 'Insufficient stock in warehouse.',
    };
  }
  return { ok: true, newQty };
}

/**
 * Returns the 0-based index in the 7-step order timeline, or -1 for Cancelled/Rejected.
 */
export function getTimelineStepIndex(status: string): number {
  return ORDER_TIMELINE_STEPS.indexOf(
    status as (typeof ORDER_TIMELINE_STEPS)[number]
  );
}

export interface DemandForecastInput {
  product_id: number;
  sku: string;
  name: string;
  flavor: string;
  size: string;
  price: number;
  image_url: string | null;
  category_name: string;
  current_stock: number;
  low_stock_threshold: number;
  total_ordered_qty: number;
  order_count: number;
  unique_franchisees: number;
  recent_7d_qty: number;
  prev_7d_qty: number;
  recent_30d_qty: number;
}

export interface DemandForecastResult extends DemandForecastInput {
  rank: number;
  franchisee_count: number;
  daily_velocity: number;
  trend_multiplier: number;
  growth_rate_pct: number;
  forecast_next_7d: number;
  forecast_next_30d: number;
  days_of_supply: number;
  recommended_restock: number;
  demand_share_pct: number;
  risk_level: 'CRITICAL' | 'RESTOCK_SOON' | 'HEALTHY';
}

/**
 * Computes demand forecasting metrics and restock recommendations based on franchisee most-ordered products.
 */
export function calculateDemandForecast(
  rows: DemandForecastInput[],
  horizonDays: 7 | 30 = 30
): DemandForecastResult[] {
  const totalNetworkOrdered = rows.reduce(
    (sum, r) => sum + Math.max(0, Number(r.total_ordered_qty || 0)),
    0
  );

  const computed = rows
    .map((r) => {
      const totalOrdered = Math.max(0, Number(r.total_ordered_qty || 0));
      const recent30 = Math.max(0, Number(r.recent_30d_qty || totalOrdered));
      const recent7 = Math.max(0, Number(r.recent_7d_qty || 0));
      const prev7 = Math.max(0, Number(r.prev_7d_qty || 0));
      const currentStock = Math.max(0, Number(r.current_stock || 0));
      const threshold = Math.max(0, Number(r.low_stock_threshold || 20));

      // Daily order velocity from 30-day demand window (or lifetime orders if new)
      const baseWindowQty = recent30 > 0 ? recent30 : totalOrdered;
      const dailyVelocity = baseWindowQty / 30;

      // Short-term momentum multiplier bounded between 0.85 and 1.50
      let trendMultiplier = 1.0;
      if (prev7 > 0) {
        const ratio = recent7 / prev7;
        trendMultiplier = Math.min(1.5, Math.max(0.85, Number(ratio.toFixed(2))));
      } else if (recent7 > 0) {
        trendMultiplier = 1.15;
      }

      const growthRatePct = Math.round((trendMultiplier - 1) * 100);

      // Projected demand over next 7 and 30 days (with 15% cold-chain safety buffer)
      const safetyFactor = 1.15;
      const forecast7d =
        totalOrdered > 0
          ? Math.max(1, Math.ceil(dailyVelocity * 7 * trendMultiplier * safetyFactor))
          : 0;
      const forecast30d =
        totalOrdered > 0
          ? Math.max(1, Math.ceil(dailyVelocity * 30 * trendMultiplier * safetyFactor))
          : 0;

      const targetForecast = horizonDays === 7 ? forecast7d : forecast30d;
      const recommendedRestock = Math.max(
        0,
        targetForecast + threshold - currentStock
      );

      const daysOfSupply =
        dailyVelocity > 0 ? Math.min(999, Math.round(currentStock / dailyVelocity)) : 999;

      const demandSharePct =
        totalNetworkOrdered > 0
          ? Number(((totalOrdered / totalNetworkOrdered) * 100).toFixed(1))
          : 0;

      let riskLevel: 'CRITICAL' | 'RESTOCK_SOON' | 'HEALTHY' = 'HEALTHY';
      if (currentStock <= threshold || (targetForecast > 0 && currentStock < targetForecast * 0.5)) {
        riskLevel = 'CRITICAL';
      } else if (targetForecast > currentStock) {
        riskLevel = 'RESTOCK_SOON';
      }

      return {
        ...r,
        rank: 0,
        franchisee_count: Number(r.unique_franchisees || 0),
        daily_velocity: Number(dailyVelocity.toFixed(2)),
        trend_multiplier: trendMultiplier,
        growth_rate_pct: growthRatePct,
        forecast_next_7d: forecast7d,
        forecast_next_30d: forecast30d,
        days_of_supply: daysOfSupply,
        recommended_restock: recommendedRestock,
        demand_share_pct: demandSharePct,
        risk_level: riskLevel,
      };
    })
    .sort((a, b) => b.total_ordered_qty - a.total_ordered_qty || a.name.localeCompare(b.name));

  return computed.map((item, idx) => ({
    ...item,
    rank: idx + 1,
  }));
}

const KNOWN_PH_LOCATIONS: { keywords: string[]; label: string; lat: number; lng: number }[] = [
  { keywords: ['quezon city', 'mindanao ave', 'novaliches', 'cubao'], label: 'Quezon City', lat: 14.676, lng: 121.0437 },
  { keywords: ['makati', 'ayala', 'buendia'], label: 'Makati City', lat: 14.5547, lng: 121.0244 },
  { keywords: ['taguig', 'bgc', 'bonifacio'], label: 'Taguig City', lat: 14.5176, lng: 121.0509 },
  { keywords: ['manila', 'sampaloc', 'ermita', 'tondo', 'binondo'], label: 'Manila', lat: 14.5995, lng: 120.9842 },
  { keywords: ['pasig', 'ortigas', 'kapitolyo'], label: 'Pasig City', lat: 14.5764, lng: 121.0851 },
  { keywords: ['mandaluyong', 'shaw', 'edsa'], label: 'Mandaluyong City', lat: 14.5794, lng: 121.0359 },
  { keywords: ['pasay', 'taft', 'moa'], label: 'Pasay City', lat: 14.5378, lng: 121.0014 },
  { keywords: ['caloocan', 'monumento'], label: 'Caloocan City', lat: 14.657, lng: 120.9842 },
  { keywords: ['paranaque', 'sucat', 'bicutan'], label: 'Parañaque City', lat: 14.4793, lng: 121.0198 },
  { keywords: ['cebu'], label: 'Cebu City', lat: 10.3157, lng: 123.8854 },
  { keywords: ['davao'], label: 'Davao City', lat: 7.1907, lng: 125.4553 },
];

export function resolveKnownLocationCoords(
  addressText: string
): { label: string; lat: number; lng: number } | null {
  const normalized = String(addressText || '').trim().toLowerCase();
  if (normalized.length < 3) return null;
  for (const entry of KNOWN_PH_LOCATIONS) {
    if (entry.keywords.some((kw) => normalized.includes(kw))) {
      return { label: entry.label, lat: entry.lat, lng: entry.lng };
    }
  }
  return null;
}

/**
 * Exact status values for orders that have been Confirmed or Delivered.
 * Orders with status 'Placed', 'Cancelled', or 'Rejected' do NOT count as revenue.
 */
export const REVENUE_ORDER_STATUSES = [
  'Confirmed',
  'Preparing',
  'Assigned to Delivery',
  'Out for Delivery',
  'Near / Arrived',
  'Delivered',
] as const;

export function isRevenueOrderStatus(status: string): boolean {
  return (REVENUE_ORDER_STATUSES as readonly string[]).includes(status);
}

/**
 * Calculates percentage change from previous period to current period.
 */
export function calculatePctChange(current: number, previous: number): number {
  const cur = Number(current || 0);
  const prev = Number(previous || 0);
  if (prev === 0) {
    return cur > 0 ? 100 : 0;
  }
  return Number((((cur - prev) / prev) * 100).toFixed(1));
}

export interface PeriodSalesMetricsInput {
  total_revenue: number;
  counted_orders: number;
  total_orders: number;
  delivered_orders: number;
  cancelled_orders: number;
}

export interface SalesKpiSummary {
  total_revenue: number;
  counted_orders: number;
  total_orders: number;
  avg_order_value: number;
  delivered_orders: number;
  cancelled_orders: number;
  prev_total_revenue: number;
  prev_total_orders: number;
  prev_avg_order_value: number;
  prev_delivered_orders: number;
  prev_cancelled_orders: number;
  comparison: {
    revenue_pct: number;
    total_orders_pct: number;
    avg_order_value_pct: number;
    delivered_orders_pct: number;
    cancelled_orders_pct: number;
  };
}

export function computeSalesKpiSummary(
  current: PeriodSalesMetricsInput,
  previous: PeriodSalesMetricsInput
): SalesKpiSummary {
  const curRev = Number(current.total_revenue || 0);
  const curCounted = Number(current.counted_orders || 0);
  const curTotal = Number(current.total_orders || 0);
  const curDelivered = Number(current.delivered_orders || 0);
  const curCancelled = Number(current.cancelled_orders || 0);
  const curAov = curCounted > 0 ? Number((curRev / curCounted).toFixed(2)) : 0;

  const prevRev = Number(previous.total_revenue || 0);
  const prevCounted = Number(previous.counted_orders || 0);
  const prevTotal = Number(previous.total_orders || 0);
  const prevDelivered = Number(previous.delivered_orders || 0);
  const prevCancelled = Number(previous.cancelled_orders || 0);
  const prevAov = prevCounted > 0 ? Number((prevRev / prevCounted).toFixed(2)) : 0;

  return {
    total_revenue: Number(curRev.toFixed(2)),
    counted_orders: curCounted,
    total_orders: curTotal,
    avg_order_value: curAov,
    delivered_orders: curDelivered,
    cancelled_orders: curCancelled,
    prev_total_revenue: Number(prevRev.toFixed(2)),
    prev_total_orders: prevTotal,
    prev_avg_order_value: prevAov,
    prev_delivered_orders: prevDelivered,
    prev_cancelled_orders: prevCancelled,
    comparison: {
      revenue_pct: calculatePctChange(curRev, prevRev),
      total_orders_pct: calculatePctChange(curTotal, prevTotal),
      avg_order_value_pct: calculatePctChange(curAov, prevAov),
      delivered_orders_pct: calculatePctChange(curDelivered, prevDelivered),
      cancelled_orders_pct: calculatePctChange(curCancelled, prevCancelled),
    },
  };
}

// ===== PROMOTIONS ENGINE (Pure Domain Logic) =====

export type PromoType =
  | 'volume_tiered'
  | 'min_purchase'
  | 'buy_x_get_y'
  | 'free_delivery'
  | 'seasonal'
  | 'product_category'
  | 'franchisee_targeted';

export type PromoDiscountType = 'percent' | 'fixed';
export type PromoScope = 'all_products' | 'category' | 'product';
export type PromoStatus = 'Draft' | 'Active' | 'Paused' | 'Expired';

export interface PromoTierRule {
  min_quantity_or_amount: number;
  discount_value: number;
}

export interface PromoDefinition {
  id: number;
  name: string;
  description?: string | null;
  promo_type: PromoType;
  tier_basis?: 'quantity' | 'amount';
  discount_type: PromoDiscountType;
  discount_value: number;
  min_order_amount: number;
  min_quantity: number;
  buy_quantity: number;
  free_quantity: number;
  free_product_id?: number | null;
  free_delivery: number | boolean;
  max_discount_cap?: number | null;
  scope: PromoScope;
  start_date: string;
  end_date: string;
  recurring_monthly?: number | boolean;
  usage_limit_total?: number | null;
  usage_limit_per_franchisee?: number | null;
  stackable: number | boolean;
  status: PromoStatus;
  product_ids?: number[];
  category_ids?: number[];
  tiers?: PromoTierRule[];
  target_franchisee_ids?: number[];
  total_redemptions?: number;
  franchisee_redemptions?: number;
}

export interface CartEvalItem {
  product_id: number;
  category_id: number;
  name: string;
  quantity: number;
  unit_price: number;
}

export interface FreeItemGrant {
  promo_id: number;
  promo_name: string;
  product_id: number;
  name: string;
  free_qty: number;
  unit_price: number;
  free_value: number;
}

export interface AppliedPromoBreakdown {
  promo_id: number;
  name: string;
  promo_type: PromoType;
  discount_amount: number;
  free_delivery: boolean;
  free_items: FreeItemGrant[];
  free_items_value: number;
  summary_label: string;
}

export interface CartPromoEvaluationResult {
  subtotal: number;
  discount_amount: number;
  delivery_fee: number;
  free_delivery_applied: boolean;
  final_total: number;
  primary_promo_id: number | null;
  applied_promos: AppliedPromoBreakdown[];
  free_items: FreeItemGrant[];
  item_discounts: Record<number, number>;
  hints: string[];
}

/**
 * Generates a human-readable live preview of how a promo works.
 */
export function formatPromoHowItWorks(promo: Partial<PromoDefinition>): string {
  const pType = promo.promo_type || 'min_purchase';
  const dType = promo.discount_type || 'percent';
  const dVal = Number(promo.discount_value || 0);
  const minAmt = Number(promo.min_order_amount || 0);
  const minQty = Number(promo.min_quantity || 0);
  const buyQty = Number(promo.buy_quantity || 0);
  const freeQty = Number(promo.free_quantity || 0);
  const cap = Number(promo.max_discount_cap || 0);
  const tierBasis = promo.tier_basis || 'quantity';

  const fmtDiscount = (val: number) =>
    dType === 'percent'
      ? `${val}% off`
      : `PHP ${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} off`;

  let base = '';
  if (pType === 'volume_tiered') {
    const tiers = (promo.tiers || [])
      .filter((t) => Number(t.min_quantity_or_amount) > 0 && Number(t.discount_value) > 0)
      .sort((a, b) => Number(a.min_quantity_or_amount) - Number(b.min_quantity_or_amount));
    if (tiers.length > 0) {
      base = tiers
        .map((t) =>
          tierBasis === 'amount'
            ? `Spend PHP ${Number(t.min_quantity_or_amount).toLocaleString('en-US')} → ${fmtDiscount(Number(t.discount_value))}`
            : `Buy ${t.min_quantity_or_amount} boxes → ${fmtDiscount(Number(t.discount_value))}`
        )
        .join('; ');
    } else {
      base =
        minQty > 0
          ? `Buy ${minQty} boxes → ${fmtDiscount(dVal)}`
          : `Volume discount: ${fmtDiscount(dVal)}`;
    }
  } else if (pType === 'buy_x_get_y') {
    base = `Buy ${buyQty || 10} boxes → Get ${freeQty || 1} box(es) free`;
  } else if (pType === 'free_delivery') {
    base =
      minAmt > 0
        ? `Spend PHP ${minAmt.toLocaleString('en-US')} → Free Delivery${dVal > 0 ? ` + ${fmtDiscount(dVal)}` : ''}`
        : minQty > 0
        ? `Order ${minQty} boxes → Free Delivery${dVal > 0 ? ` + ${fmtDiscount(dVal)}` : ''}`
        : `Free Delivery on eligible replenishment orders${dVal > 0 ? ` (${fmtDiscount(dVal)})` : ''}`;
  } else {
    const conds: string[] = [];
    if (minAmt > 0) conds.push(`Spend PHP ${minAmt.toLocaleString('en-US')}`);
    if (minQty > 0) conds.push(`Order ${minQty}+ boxes`);
    const condText = conds.length > 0 ? `${conds.join(' & ')} → ` : '';
    base = `${condText}${fmtDiscount(dVal)}`;
  }

  if (Boolean(promo.free_delivery) && pType !== 'free_delivery') {
    base += ' + Free Delivery';
  }
  if (cap > 0) {
    base += ` (max cap PHP ${cap.toLocaleString('en-US')})`;
  }
  return base;
}

/**
 * Checks whether a promo is within its active date window on a given YYYY-MM-DD date.
 */
export function isPromoDateValid(
  startDate: string,
  endDate: string,
  todayStr: string,
  recurringMonthly = false
): boolean {
  const s = String(startDate || '').slice(0, 10);
  const e = String(endDate || '').slice(0, 10);
  const t = String(todayStr || '').slice(0, 10);
  if (!s || !e || !t) return false;
  if (t >= s && t <= e) return true;

  if (recurringMonthly && t >= s) {
    const startDay = parseInt(s.slice(8, 10), 10);
    const endDay = parseInt(e.slice(8, 10), 10);
    const todayDay = parseInt(t.slice(8, 10), 10);
    if (!Number.isNaN(startDay) && !Number.isNaN(endDay) && !Number.isNaN(todayDay)) {
      if (startDay <= endDay) {
        return todayDay >= startDay && todayDay <= endDay;
      } else {
        return todayDay >= startDay || todayDay <= endDay;
      }
    }
  }
  return false;
}

/**
 * Validates promo creation/update payload.
 */
export function validatePromoPayload(input: Partial<PromoDefinition>): {
  ok: boolean;
  error?: string;
} {
  if (!input.name || !String(input.name).trim()) {
    return { ok: false, error: 'Promo name is required.' };
  }
  const s = String(input.start_date || '').slice(0, 10);
  const e = String(input.end_date || '').slice(0, 10);
  if (!s || !e) {
    return { ok: false, error: 'Start date and end date are required.' };
  }
  if (e < s) {
    return { ok: false, error: 'End date must be on or after the start date.' };
  }

  const pType = input.promo_type;
  const dType = input.discount_type || 'percent';
  const dVal = Number(input.discount_value || 0);

  if (pType === 'buy_x_get_y') {
    if (Number(input.buy_quantity || 0) <= 0 || Number(input.free_quantity || 0) <= 0) {
      return {
        ok: false,
        error: 'Buy X Get Y promos require both Buy Quantity and Free Quantity greater than 0.',
      };
    }
  } else if (pType === 'volume_tiered') {
    const tiers = input.tiers || [];
    if (tiers.length === 0 && dVal <= 0) {
      return {
        ok: false,
        error: 'Volume/tiered promos require at least one tier with a discount value > 0.',
      };
    }
    for (const tier of tiers) {
      if (Number(tier.min_quantity_or_amount) <= 0 || Number(tier.discount_value) <= 0) {
        return {
          ok: false,
          error: 'Each tier must have a threshold > 0 and discount value > 0.',
        };
      }
      if (dType === 'percent' && Number(tier.discount_value) > 100) {
        return {
          ok: false,
          error: 'Percentage discount cannot exceed 100%.',
        };
      }
    }
  } else if (pType === 'free_delivery') {
    if (dVal < 0) {
      return { ok: false, error: 'Discount value cannot be negative.' };
    }
    if (dType === 'percent' && dVal > 100) {
      return { ok: false, error: 'Percentage discount cannot exceed 100%.' };
    }
  } else {
    if (dVal <= 0) {
      return { ok: false, error: 'Discount value must be greater than 0.' };
    }
    if (dType === 'percent' && dVal > 100) {
      return { ok: false, error: 'Percentage discount cannot exceed 100%.' };
    }
  }

  return { ok: true };
}

/**
 * Evaluates all active promos against a franchisee's cart items and returns the best discount
 * (or stacked discounts when stackable=1), free items, item-level discount snapshots, and upsell hints.
 */
export function evaluatePromosForCart(
  cartItems: CartEvalItem[],
  promos: PromoDefinition[],
  context: {
    franchiseeId: number;
    todayStr: string;
  }
): CartPromoEvaluationResult {
  const subtotal = Number(
    cartItems
      .reduce((sum, i) => sum + Number(i.quantity || 0) * Number(i.unit_price || 0), 0)
      .toFixed(2)
  );

  if (cartItems.length === 0 || subtotal <= 0) {
    return {
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
    };
  }

  const hints: string[] = [];
  interface CandidateEvaluation {
    promo: PromoDefinition;
    discountAmount: number;
    freeDelivery: boolean;
    freeItems: FreeItemGrant[];
    freeItemsValue: number;
    effectiveScore: number;
    qualifyingProductIds: number[];
    qualifyingSubtotal: number;
  }

  const eligibleCandidates: CandidateEvaluation[] = [];

  for (const promo of promos) {
    if (promo.status !== 'Active') continue;
    if (
      !isPromoDateValid(
        promo.start_date,
        promo.end_date,
        context.todayStr,
        Boolean(promo.recurring_monthly)
      )
    ) {
      continue;
    }

    // Usage limits check
    const limitTotal = Number(promo.usage_limit_total || 0);
    if (limitTotal > 0 && Number(promo.total_redemptions || 0) >= limitTotal) {
      continue;
    }
    const limitPerFranchisee = Number(promo.usage_limit_per_franchisee || 0);
    if (
      limitPerFranchisee > 0 &&
      Number(promo.franchisee_redemptions || 0) >= limitPerFranchisee
    ) {
      continue;
    }

    // Franchisee targeting check (empty = all franchisees)
    const targets = promo.target_franchisee_ids || [];
    if (targets.length > 0 && !targets.includes(context.franchiseeId)) {
      continue;
    }

    // Determine qualifying cart items based on scope
    const prodIds = promo.product_ids || [];
    const catIds = promo.category_ids || [];
    const qualifyingItems = cartItems.filter((item) => {
      if (promo.scope === 'product' && prodIds.length > 0) {
        return prodIds.includes(item.product_id);
      }
      if (promo.scope === 'category' && catIds.length > 0) {
        return catIds.includes(item.category_id);
      }
      return true;
    });

    const qualifyingQty = qualifyingItems.reduce((s, i) => s + Number(i.quantity || 0), 0);
    const qualifyingSubtotal = Number(
      qualifyingItems
        .reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unit_price || 0), 0)
        .toFixed(2)
    );

    if (qualifyingItems.length === 0) {
      continue;
    }

    const dType = promo.discount_type || 'percent';
    const cap = Number(promo.max_discount_cap || 0);
    const applyCap = (rawDiscount: number) => {
      let d = Math.max(0, Math.min(rawDiscount, qualifyingSubtotal));
      if (cap > 0) d = Math.min(d, cap);
      return Number(d.toFixed(2));
    };

    const fmtDiscLabel = (val: number) =>
      dType === 'percent'
        ? `${val}% off`
        : `PHP ${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} off`;

    let discountAmount = 0;
    let freeDelivery = Boolean(promo.free_delivery) || promo.promo_type === 'free_delivery';
    const freeItems: FreeItemGrant[] = [];
    let isEligible = false;

    if (promo.promo_type === 'volume_tiered') {
      const basis = promo.tier_basis || 'quantity';
      const currentMetric = basis === 'amount' ? qualifyingSubtotal : qualifyingQty;
      const sortedTiers = [...(promo.tiers || [])]
        .filter((t) => Number(t.min_quantity_or_amount) > 0 && Number(t.discount_value) > 0)
        .sort((a, b) => Number(a.min_quantity_or_amount) - Number(b.min_quantity_or_amount));

      if (sortedTiers.length > 0) {
        const matchedTiers = sortedTiers.filter(
          (t) => currentMetric >= Number(t.min_quantity_or_amount)
        );
        const nextTier = sortedTiers.find(
          (t) => currentMetric < Number(t.min_quantity_or_amount)
        );

        if (nextTier) {
          const gap = Number(nextTier.min_quantity_or_amount) - currentMetric;
          if (basis === 'amount') {
            hints.push(
              `Spend PHP ${gap.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} more to get ${fmtDiscLabel(Number(nextTier.discount_value))} (${promo.name})`
            );
          } else {
            hints.push(
              `Add ${gap} more box${gap === 1 ? '' : 'es'} to get ${fmtDiscLabel(Number(nextTier.discount_value))} (${promo.name})`
            );
          }
        }

        if (matchedTiers.length > 0) {
          const bestTier = matchedTiers[matchedTiers.length - 1];
          const tVal = Number(bestTier.discount_value);
          const raw =
            dType === 'percent' ? (qualifyingSubtotal * tVal) / 100 : tVal;
          discountAmount = applyCap(raw);
          isEligible = discountAmount > 0 || freeDelivery;
        }
      } else {
        // Fallback to min_quantity / min_order_amount if tiers array was empty
        const minQty = Number(promo.min_quantity || 0);
        const minAmt = Number(promo.min_order_amount || 0);
        if (qualifyingQty >= minQty && qualifyingSubtotal >= minAmt) {
          const raw =
            dType === 'percent'
              ? (qualifyingSubtotal * Number(promo.discount_value || 0)) / 100
              : Number(promo.discount_value || 0);
          discountAmount = applyCap(raw);
          isEligible = discountAmount > 0 || freeDelivery;
        } else if (qualifyingQty < minQty) {
          const gap = minQty - qualifyingQty;
          hints.push(
            `Add ${gap} more box${gap === 1 ? '' : 'es'} to get ${fmtDiscLabel(Number(promo.discount_value))} (${promo.name})`
          );
        }
      }
    } else if (promo.promo_type === 'buy_x_get_y') {
      const buyX = Math.max(1, Number(promo.buy_quantity || 1));
      const getY = Math.max(1, Number(promo.free_quantity || 1));

      for (const item of qualifyingItems) {
        const bundles = Math.floor(Number(item.quantity) / buyX);
        const rem = Number(item.quantity) % buyX;
        if (bundles > 0) {
          const freeQty = bundles * getY;
          const freeVal = Number((freeQty * Number(item.unit_price)).toFixed(2));
          freeItems.push({
            promo_id: promo.id,
            promo_name: promo.name,
            product_id: item.product_id,
            name: item.name,
            free_qty: freeQty,
            unit_price: Number(item.unit_price),
            free_value: freeVal,
          });
        }
        if (bundles === 0 || rem > 0) {
          const needed = buyX - rem;
          hints.push(
            `Add ${needed} more box${needed === 1 ? '' : 'es'} of ${item.name} to get ${getY} free (${promo.name})`
          );
        }
      }
      isEligible = freeItems.length > 0;
    } else {
      // min_purchase, free_delivery, seasonal, product_category, franchisee_targeted
      const minAmt = Number(promo.min_order_amount || 0);
      const minQty = Number(promo.min_quantity || 0);
      const meetsAmt = qualifyingSubtotal >= minAmt;
      const meetsQty = qualifyingQty >= minQty;

      if (meetsAmt && meetsQty) {
        const dVal = Number(promo.discount_value || 0);
        const raw =
          dType === 'percent' ? (qualifyingSubtotal * dVal) / 100 : dVal;
        discountAmount = applyCap(raw);
        isEligible = discountAmount > 0 || freeDelivery;
      } else {
        if (!meetsQty && minQty > 0) {
          const gapQty = minQty - qualifyingQty;
          const rewardLabel =
            promo.promo_type === 'free_delivery' && Number(promo.discount_value || 0) === 0
              ? 'Free Delivery'
              : fmtDiscLabel(Number(promo.discount_value || 0));
          hints.push(
            `Add ${gapQty} more box${gapQty === 1 ? '' : 'es'} to get ${rewardLabel} (${promo.name})`
          );
        } else if (!meetsAmt && minAmt > 0) {
          const gapAmt = Number((minAmt - qualifyingSubtotal).toFixed(2));
          const rewardLabel =
            promo.promo_type === 'free_delivery' && Number(promo.discount_value || 0) === 0
              ? 'Free Delivery'
              : fmtDiscLabel(Number(promo.discount_value || 0));
          hints.push(
            `Spend PHP ${gapAmt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} more to get ${rewardLabel} (${promo.name})`
          );
        }
      }
    }

    if (isEligible) {
      const freeItemsValue = Number(
        freeItems.reduce((s, f) => s + f.free_value, 0).toFixed(2)
      );
      const effectiveScore =
        discountAmount + freeItemsValue + (freeDelivery ? 250 : 0);
      eligibleCandidates.push({
        promo,
        discountAmount,
        freeDelivery,
        freeItems,
        freeItemsValue,
        effectiveScore,
        qualifyingProductIds: qualifyingItems.map((i) => i.product_id),
        qualifyingSubtotal,
      });
    }
  }

  // Separate stackable vs non-stackable candidates
  const nonStackable = eligibleCandidates
    .filter((c) => !Boolean(c.promo.stackable))
    .sort((a, b) => b.effectiveScore - a.effectiveScore || a.promo.id - b.promo.id);

  const stackable = eligibleCandidates
    .filter((c) => Boolean(c.promo.stackable))
    .sort((a, b) => a.promo.id - b.promo.id);

  const bestSingleNonStackable = nonStackable[0] || null;
  const stackableTotalScore = stackable.reduce((s, c) => s + c.effectiveScore, 0);

  let chosenEvaluations: CandidateEvaluation[] = [];
  if (
    stackable.length > 0 &&
    (!bestSingleNonStackable || stackableTotalScore >= bestSingleNonStackable.effectiveScore)
  ) {
    chosenEvaluations = stackable;
  } else if (bestSingleNonStackable) {
    chosenEvaluations = [bestSingleNonStackable];
  }

  // Apply chosen evaluations in order, never letting total go below 0
  let remainingSubtotal = subtotal;
  let totalDiscount = 0;
  let freeDeliveryApplied = false;
  const appliedPromos: AppliedPromoBreakdown[] = [];
  const allFreeItems: FreeItemGrant[] = [];
  const itemDiscounts: Record<number, number> = {};

  for (const ev of chosenEvaluations) {
    const actualDiscount = Number(
      Math.min(ev.discountAmount, remainingSubtotal).toFixed(2)
    );
    remainingSubtotal = Number(Math.max(0, remainingSubtotal - actualDiscount).toFixed(2));
    totalDiscount = Number((totalDiscount + actualDiscount).toFixed(2));
    if (ev.freeDelivery) freeDeliveryApplied = true;
    allFreeItems.push(...ev.freeItems);

    // Distribute item-level discount snapshot across qualifying cart items
    if (actualDiscount > 0 && ev.qualifyingSubtotal > 0) {
      for (const item of cartItems) {
        if (ev.qualifyingProductIds.includes(item.product_id)) {
          const itemSub = item.quantity * item.unit_price;
          const share = Number(
            ((itemSub / ev.qualifyingSubtotal) * actualDiscount).toFixed(2)
          );
          itemDiscounts[item.product_id] = Number(
            ((itemDiscounts[item.product_id] || 0) + share).toFixed(2)
          );
        }
      }
    }

    appliedPromos.push({
      promo_id: ev.promo.id,
      name: ev.promo.name,
      promo_type: ev.promo.promo_type,
      discount_amount: actualDiscount,
      free_delivery: ev.freeDelivery,
      free_items: ev.freeItems,
      free_items_value: ev.freeItemsValue,
      summary_label: formatPromoHowItWorks(ev.promo),
    });
  }

  const finalTotal = Number(Math.max(0, subtotal - totalDiscount).toFixed(2));

  return {
    subtotal,
    discount_amount: totalDiscount,
    delivery_fee: 0,
    free_delivery_applied: freeDeliveryApplied,
    final_total: finalTotal,
    primary_promo_id: appliedPromos[0]?.promo_id || null,
    applied_promos: appliedPromos,
    free_items: allFreeItems,
    item_discounts: itemDiscounts,
    hints: Array.from(new Set(hints)).slice(0, 3),
  };
}

/**
 * Checks whether a promo is currently eligible to be shown/used by a specific franchisee:
 * - Active status
 * - Within start/end date (or recurring monthly window)
 * - Targeted to this franchisee (or all franchisees)
 * - Total and per-franchisee usage limits not exceeded
 * - Not dismissed by this user (when dismissedPromoIds is provided)
 */
export function isPromoEligibleForFranchisee<T extends PromoDefinition>(
  promo: T,
  context: {
    franchiseeId: number;
    todayStr: string;
    dismissedPromoIds?: number[];
  }
): boolean {
  if (promo.status !== 'Active') return false;
  if (
    !isPromoDateValid(
      promo.start_date,
      promo.end_date,
      context.todayStr,
      Boolean(promo.recurring_monthly)
    )
  ) {
    return false;
  }

  const targets = promo.target_franchisee_ids || [];
  if (targets.length > 0 && !targets.includes(Number(context.franchiseeId))) {
    return false;
  }

  const limitTotal = Number(promo.usage_limit_total || 0);
  if (limitTotal > 0 && Number(promo.total_redemptions || 0) >= limitTotal) {
    return false;
  }

  const limitPerFranchisee = Number(promo.usage_limit_per_franchisee || 0);
  if (
    limitPerFranchisee > 0 &&
    Number(promo.franchisee_redemptions || 0) >= limitPerFranchisee
  ) {
    return false;
  }

  if (
    Array.isArray(context.dismissedPromoIds) &&
    context.dismissedPromoIds.includes(Number(promo.id))
  ) {
    return false;
  }

  return true;
}

/**
 * Filters a list of promos down to those eligible to appear in the franchisee post-login promo popup.
 */
export function filterEligiblePopupPromos<T extends PromoDefinition>(
  promos: T[],
  context: {
    franchiseeId: number;
    todayStr: string;
    dismissedPromoIds?: number[];
  }
): T[] {
  return promos.filter((p) => isPromoEligibleForFranchisee(p, context));
}

/**
 * Formats a human-readable "Max discount / limit" note from real promo data, or returns null if no cap or limit exists.
 */
export function formatPromoLimitNote(
  promo: Partial<PromoDefinition> & {
    total_redemptions?: number;
    franchisee_redemptions?: number;
  }
): string | null {
  const parts: string[] = [];

  const cap = Number(promo.max_discount_cap || 0);
  if (cap > 0) {
    parts.push(
      `Max discount: PHP ${cap.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`
    );
  }

  const limitPerFranchisee = Number(promo.usage_limit_per_franchisee || 0);
  if (limitPerFranchisee > 0) {
    const used = Number(promo.franchisee_redemptions || 0);
    const remaining = Math.max(0, limitPerFranchisee - used);
    parts.push(
      `Limit: ${limitPerFranchisee} use${limitPerFranchisee === 1 ? '' : 's'} per franchisee (${remaining} left)`
    );
  }

  const limitTotal = Number(promo.usage_limit_total || 0);
  if (limitTotal > 0) {
    const usedTotal = Number(promo.total_redemptions || 0);
    const remainingTotal = Math.max(0, limitTotal - usedTotal);
    parts.push(
      `Network limit: ${limitTotal} total redemptions (${remainingTotal} left)`
    );
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Detects whether a promo's rules or validity dates changed when edited by Admin,
 * which triggers resetting any franchisee "Don't show this promo again" dismissals.
 */
export function hasPromoRulesOrDatesChanged(
  existing: Partial<PromoDefinition>,
  updated: Partial<PromoDefinition>
): boolean {
  const normalizeNum = (v: unknown) => Number(v || 0);
  const normalizeBool = (v: unknown) => Boolean(v);
  const normalizeDate = (v: unknown) => String(v || '').slice(0, 10);
  const normalizeIds = (arr: unknown) =>
    Array.isArray(arr)
      ? [...arr].map((x) => Number(x)).sort((a, b) => a - b).join(',')
      : '';
  const normalizeTiers = (tiers: unknown) =>
    Array.isArray(tiers)
      ? [...tiers]
          .map(
            (t: any) =>
              `${Number(t.min_quantity_or_amount || 0)}:${Number(t.discount_value || 0)}`
          )
          .sort()
          .join('|')
      : '';

  if (String(existing.promo_type || '') !== String(updated.promo_type || '')) return true;
  if (String(existing.tier_basis || 'quantity') !== String(updated.tier_basis || 'quantity'))
    return true;
  if (String(existing.discount_type || 'percent') !== String(updated.discount_type || 'percent'))
    return true;
  if (normalizeNum(existing.discount_value) !== normalizeNum(updated.discount_value)) return true;
  if (normalizeNum(existing.min_order_amount) !== normalizeNum(updated.min_order_amount))
    return true;
  if (normalizeNum(existing.min_quantity) !== normalizeNum(updated.min_quantity)) return true;
  if (normalizeNum(existing.buy_quantity) !== normalizeNum(updated.buy_quantity)) return true;
  if (normalizeNum(existing.free_quantity) !== normalizeNum(updated.free_quantity)) return true;
  if (normalizeBool(existing.free_delivery) !== normalizeBool(updated.free_delivery)) return true;
  if (normalizeNum(existing.max_discount_cap) !== normalizeNum(updated.max_discount_cap))
    return true;
  if (String(existing.scope || 'all_products') !== String(updated.scope || 'all_products'))
    return true;
  if (normalizeDate(existing.start_date) !== normalizeDate(updated.start_date)) return true;
  if (normalizeDate(existing.end_date) !== normalizeDate(updated.end_date)) return true;
  if (normalizeBool(existing.recurring_monthly) !== normalizeBool(updated.recurring_monthly))
    return true;
  if (normalizeNum(existing.usage_limit_total) !== normalizeNum(updated.usage_limit_total))
    return true;
  if (
    normalizeNum(existing.usage_limit_per_franchisee) !==
    normalizeNum(updated.usage_limit_per_franchisee)
  )
    return true;
  if (normalizeBool(existing.stackable) !== normalizeBool(updated.stackable)) return true;
  if (normalizeIds(existing.product_ids) !== normalizeIds(updated.product_ids)) return true;
  if (normalizeIds(existing.category_ids) !== normalizeIds(updated.category_ids)) return true;
  if (normalizeIds(existing.target_franchisee_ids) !== normalizeIds(updated.target_franchisee_ids))
    return true;
  if (normalizeTiers(existing.tiers) !== normalizeTiers(updated.tiers)) return true;

  return false;
}






