import test from 'node:test';
import assert from 'node:assert/strict';
import {
  haversineKm,
  estimateEtaMinutes,
  buildFranchiseeUsernameBase,
  isValidCoords,
  requiresForcedPasswordChange,
  computeStockTransition,
  getTimelineStepIndex,
  calculateDemandForecast,
  isRevenueOrderStatus,
  computeSalesKpiSummary,
  validatePromoPayload,
  formatPromoHowItWorks,
  evaluatePromosForCart,
  filterEligiblePopupPromos,
  formatPromoLimitNote,
  hasPromoRulesOrDatesChanged,
  PromoDefinition,
} from './domainRules';

test('haversineKm calculates distance between Manila and Quezon City accurately', () => {
  const km = haversineKm(14.6042, 120.9921, 14.6191, 121.0537);
  assert.equal(km > 6 && km < 8, true);
});

test('estimateEtaMinutes enforces minimum 2 minutes and scales with distance', () => {
  assert.equal(estimateEtaMinutes(0), 2);
  assert.equal(estimateEtaMinutes(12.5, 25), 30);
});

test('buildFranchiseeUsernameBase sanitizes owner name into lowercase alphanumeric prefix', () => {
  assert.equal(buildFranchiseeUsernameBase('Juan Dela Cruz!', 'AICE Store'), 'juandelacruz');
  assert.equal(buildFranchiseeUsernameBase('', 'Cubao Mart #2'), 'cubaomart2');
});

test('isValidCoords validates GPS coordinates and rejects empty or out-of-range values', () => {
  assert.equal(isValidCoords(14.5995, 120.9842), true);
  assert.equal(isValidCoords(95, 120), false);
  assert.equal(isValidCoords('', ''), false);
  assert.equal(isValidCoords(null, 120), false);
});

test('requiresForcedPasswordChange skips forced change for test accounts (is_test=1)', () => {
  assert.equal(requiresForcedPasswordChange({ must_change_password: 1, is_test: 0 }), true);
  assert.equal(requiresForcedPasswordChange({ must_change_password: 1, is_test: 1 }), false);
  assert.equal(requiresForcedPasswordChange({ must_change_password: 0, is_test: 0 }), false);
});

test('computeStockTransition prevents negative stock and enforces positive stock-in', () => {
  const stockIn = computeStockTransition(50, 'STOCK_IN', 25);
  assert.equal(stockIn.ok, true);
  assert.equal(stockIn.newQty, 75);

  const invalidStockIn = computeStockTransition(50, 'STOCK_IN', -10);
  assert.equal(invalidStockIn.ok, false);

  const deduct = computeStockTransition(30, 'ORDER_DEDUCT', -10);
  assert.equal(deduct.ok, true);
  assert.equal(deduct.newQty, 20);

  const overDeduct = computeStockTransition(5, 'ORDER_DEDUCT', -10);
  assert.equal(overDeduct.ok, false);
});

test('getTimelineStepIndex maps all 7 order tracking stages in sequence', () => {
  assert.equal(getTimelineStepIndex('Placed'), 0);
  assert.equal(getTimelineStepIndex('Confirmed'), 1);
  assert.equal(getTimelineStepIndex('Preparing'), 2);
  assert.equal(getTimelineStepIndex('Assigned to Delivery'), 3);
  assert.equal(getTimelineStepIndex('Out for Delivery'), 4);
  assert.equal(getTimelineStepIndex('Near / Arrived'), 5);
  assert.equal(getTimelineStepIndex('Delivered'), 6);
  assert.equal(getTimelineStepIndex('Cancelled'), -1);
});

test('calculateDemandForecast ranks most-ordered products and computes 30-day projection and restock gap', () => {
  const results = calculateDemandForecast([
    {
      product_id: 1,
      sku: 'AICE-WM-65',
      name: 'AICE Watermelon Stick',
      flavor: 'Watermelon',
      size: '65ml x 40',
      price: 480,
      image_url: null,
      category_name: 'Stick',
      current_stock: 25,
      low_stock_threshold: 20,
      total_ordered_qty: 120,
      order_count: 6,
      unique_franchisees: 3,
      recent_7d_qty: 40,
      prev_7d_qty: 30,
      recent_30d_qty: 120,
    },
    {
      product_id: 2,
      sku: 'AICE-CHOCO-80',
      name: 'AICE Chocolate Crispy',
      flavor: 'Chocolate',
      size: '80ml x 30',
      price: 520,
      image_url: null,
      category_name: 'Stick',
      current_stock: 150,
      low_stock_threshold: 20,
      total_ordered_qty: 30,
      order_count: 2,
      unique_franchisees: 1,
      recent_7d_qty: 10,
      prev_7d_qty: 10,
      recent_30d_qty: 30,
    },
  ]);

  assert.equal(results.length, 2);
  assert.equal(results[0].sku, 'AICE-WM-65');
  assert.equal(results[0].demand_share_pct, 80);
  assert.equal(results[0].forecast_next_30d > 120, true);
  assert.equal(results[0].recommended_restock > 0, true);
  assert.equal(results[1].risk_level, 'HEALTHY');
});

test('isRevenueOrderStatus and computeSalesKpiSummary exclude Placed and Cancelled from revenue and calculate AOV & period comparisons', () => {
  assert.equal(isRevenueOrderStatus('Placed'), false);
  assert.equal(isRevenueOrderStatus('Cancelled'), false);
  assert.equal(isRevenueOrderStatus('Rejected'), false);
  assert.equal(isRevenueOrderStatus('Confirmed'), true);
  assert.equal(isRevenueOrderStatus('Delivered'), true);

  const summary = computeSalesKpiSummary(
    {
      total_revenue: 15000,
      counted_orders: 3,
      total_orders: 5,
      delivered_orders: 2,
      cancelled_orders: 1,
    },
    {
      total_revenue: 10000,
      counted_orders: 2,
      total_orders: 4,
      delivered_orders: 1,
      cancelled_orders: 1,
    }
  );

  assert.equal(summary.total_revenue, 15000);
  assert.equal(summary.avg_order_value, 5000);
  assert.equal(summary.comparison.revenue_pct, 50);
  assert.equal(summary.comparison.total_orders_pct, 25);
  assert.equal(summary.comparison.avg_order_value_pct, 0);
  assert.equal(summary.comparison.delivered_orders_pct, 100);
});

test('validatePromoPayload and evaluatePromosForCart compute tiered discounts, Buy X Get Y free items, and upsell hints', () => {
  const invalidDates = validatePromoPayload({
    name: 'Bad Dates',
    promo_type: 'min_purchase',
    discount_type: 'percent',
    discount_value: 10,
    start_date: '2026-11-25',
    end_date: '2026-11-20',
  });
  assert.equal(invalidDates.ok, false);

  const tieredPromo: PromoDefinition = {
    id: 1,
    name: 'Tiered Box Volume Promo',
    promo_type: 'volume_tiered',
    tier_basis: 'quantity',
    discount_type: 'percent',
    discount_value: 5,
    min_order_amount: 0,
    min_quantity: 10,
    buy_quantity: 0,
    free_quantity: 0,
    free_delivery: 0,
    scope: 'all_products',
    start_date: '2026-11-01',
    end_date: '2026-11-30',
    stackable: 0,
    status: 'Active',
    tiers: [
      { min_quantity_or_amount: 10, discount_value: 5 },
      { min_quantity_or_amount: 20, discount_value: 10 },
    ],
  };

  assert.equal(
    formatPromoHowItWorks(tieredPromo),
    'Buy 10 boxes → 5% off; Buy 20 boxes → 10% off'
  );

  const evalRes = evaluatePromosForCart(
    [
      {
        product_id: 1,
        category_id: 1,
        name: 'AICE Watermelon Stick',
        quantity: 17,
        unit_price: 500,
      },
    ],
    [tieredPromo],
    { franchiseeId: 1, todayStr: '2026-11-19' }
  );

  // 17 boxes @ 500 = 8,500 subtotal; qualifies for 10-box tier (5% = 425 discount), and hints "Add 3 more boxes to get 10% off"
  assert.equal(evalRes.subtotal, 8500);
  assert.equal(evalRes.discount_amount, 425);
  assert.equal(evalRes.final_total, 8075);
  assert.equal(evalRes.hints[0].includes('Add 3 more boxes to get 10% off'), true);

  const bogoPromo: PromoDefinition = {
    id: 2,
    name: 'Watermelon Buy 10 Get 1 Free',
    promo_type: 'buy_x_get_y',
    discount_type: 'percent',
    discount_value: 0,
    min_order_amount: 0,
    min_quantity: 0,
    buy_quantity: 10,
    free_quantity: 1,
    free_delivery: 0,
    scope: 'product',
    product_ids: [1],
    start_date: '2026-11-01',
    end_date: '2026-11-30',
    stackable: 0,
    status: 'Active',
  };

  const bogoEval = evaluatePromosForCart(
    [
      {
        product_id: 1,
        category_id: 1,
        name: 'AICE Watermelon Stick',
        quantity: 20,
        unit_price: 480,
      },
    ],
    [bogoPromo],
    { franchiseeId: 1, todayStr: '2026-11-19' }
  );
  assert.equal(bogoEval.free_items.length, 1);
  assert.equal(bogoEval.free_items[0].free_qty, 2);
});

test('filterEligiblePopupPromos, formatPromoLimitNote, and hasPromoRulesOrDatesChanged enforce franchisee eligibility, usage limits, dismissals, and admin rule-edit resets', () => {
  const basePromo: PromoDefinition = {
    id: 10,
    name: 'Holiday Freezer Promo',
    promo_type: 'min_purchase',
    discount_type: 'percent',
    discount_value: 10,
    min_order_amount: 5000,
    min_quantity: 0,
    buy_quantity: 0,
    free_quantity: 0,
    free_delivery: 1,
    max_discount_cap: 1500,
    scope: 'all_products',
    start_date: '2026-11-15',
    end_date: '2026-11-25',
    usage_limit_total: 20,
    usage_limit_per_franchisee: 2,
    total_redemptions: 5,
    franchisee_redemptions: 1,
    stackable: 0,
    status: 'Active',
    target_franchisee_ids: [1],
  };

  const exhaustedPromo: PromoDefinition = {
    ...basePromo,
    id: 11,
    name: 'Exhausted Promo',
    franchisee_redemptions: 2,
  };

  const otherTargetPromo: PromoDefinition = {
    ...basePromo,
    id: 12,
    name: 'Other Franchisee Promo',
    target_franchisee_ids: [99],
  };

  const eligible = filterEligiblePopupPromos(
    [basePromo, exhaustedPromo, otherTargetPromo],
    {
      franchiseeId: 1,
      todayStr: '2026-11-20',
      dismissedPromoIds: [],
    }
  );
  assert.equal(eligible.length, 1);
  assert.equal(eligible[0].id, 10);

  // When dismissed by user, it is excluded from popup
  const afterDismiss = filterEligiblePopupPromos([basePromo], {
    franchiseeId: 1,
    todayStr: '2026-11-20',
    dismissedPromoIds: [10],
  });
  assert.equal(afterDismiss.length, 0);

  // Format limit note includes max discount cap, per-franchisee limit, and network limit
  const note = formatPromoLimitNote(basePromo);
  assert.equal(note?.includes('Max discount: PHP 1,500.00'), true);
  assert.equal(note?.includes('Limit: 2 uses per franchisee (1 left)'), true);

  // Changing only description does not reset dismissals, but changing discount_value or end_date does
  assert.equal(
    hasPromoRulesOrDatesChanged(basePromo, { ...basePromo, description: 'Updated copy only' }),
    false
  );
  assert.equal(
    hasPromoRulesOrDatesChanged(basePromo, { ...basePromo, discount_value: 15 }),
    true
  );
  assert.equal(
    hasPromoRulesOrDatesChanged(basePromo, { ...basePromo, end_date: '2026-11-30' }),
    true
  );
});




