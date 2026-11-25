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
  formatBadgeCount,
  formatRelativeTimeAgo,
  resolveNotificationTargetRoute,
  getNotificationTypesForRoute,
  getSidebarBadgeCount,
  sanitizePublicText,
  extractGeneralAreaFromAddress,
  projectPublicProduct,
  projectPublicStore,
  projectPublicPromo,
  CHATBOT_SYSTEM_PROMPT,
  CHATBOT_AI_SUBTLE_LABEL,
  sanitizeChatbotText,
  matchFaqQuestion,
  isChatbotAiConfigured,
  parseChatbotDailyCap,
  buildStandardChatbotFallback,
  buildChatbotFaqContextPrompt,
  checkChatbotIpMessageLimit,
  checkChatbotIpAiLimit,
  ChatbotIpBucket,
  FRANCHISEE_EQUIPMENT_ITEMS,
  normalizeApplicationStatus,
  getApplicationTimelineStepIndex,
  canFranchiseeLogin,
  canFranchiseeOrderReplenishment,
  isValidPhMobileNumber,
  normalizePhMobileNumber,
  formatApplicationNumber,
  composeApplicantFullName,
  composeStoreFullAddress,
  validateFranchiseeStep1,
  validateFranchiseeStep2,
  sanitizeInternalRedirectPath,
  buildFranchiseeOrderQrUrl,
  buildStorePosterQrUrl,
  resolveFranchiseeQrRouteAccess,
  COTABATO_CITY_COORDS,
  formatRoleDisplayLabel,
  formatSidebarUserFooter,
  PromoDefinition,
} from './domainRules.ts';

test('haversineKm calculates distance between two Cotabato City coordinates accurately', () => {
  const km = haversineKm(7.2236, 124.2464, 7.1812, 124.2294);
  assert.equal(km > 4 && km < 6, true);
});

test('estimateEtaMinutes enforces minimum 2 minutes and scales with distance', () => {
  assert.equal(estimateEtaMinutes(0), 2);
  assert.equal(estimateEtaMinutes(12.5, 25), 30);
});

test('buildFranchiseeUsernameBase sanitizes owner name into lowercase alphanumeric prefix', () => {
  assert.equal(buildFranchiseeUsernameBase('Juan Dela Cruz!', 'AICE Store'), 'juandelacruz');
  assert.equal(buildFranchiseeUsernameBase('', 'Awang Mart #2'), 'awangmart2');
});

test('isValidCoords validates GPS coordinates and rejects empty or out-of-range values', () => {
  assert.equal(isValidCoords(COTABATO_CITY_COORDS.lat, COTABATO_CITY_COORDS.lng), true);
  assert.equal(isValidCoords(95, 120), false);
  assert.equal(isValidCoords('', ''), false);
  assert.equal(isValidCoords(null, 120), false);
});

test('requiresForcedPasswordChange skips forced change for pre-verified accounts', () => {
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

test('formatBadgeCount, formatRelativeTimeAgo, resolveNotificationTargetRoute, and getSidebarBadgeCount handle all role rules', () => {
  // Badge count formatting: hidden for 0, exact 1..9, "9+" above 9
  assert.equal(formatBadgeCount(0), null);
  assert.equal(formatBadgeCount(-2), null);
  assert.equal(formatBadgeCount(3), '3');
  assert.equal(formatBadgeCount(9), '9');
  assert.equal(formatBadgeCount(10), '9+');
  assert.equal(formatBadgeCount(42), '9+');

  // Relative time ago formatting
  const baseMs = Date.parse('2026-11-20T12:00:00Z');
  assert.equal(formatRelativeTimeAgo('2026-11-20 11:59:30', baseMs), 'Just now');
  assert.equal(formatRelativeTimeAgo('2026-11-20 11:55:00', baseMs), '5m ago');
  assert.equal(formatRelativeTimeAgo('2026-11-20 09:00:00', baseMs), '3h ago');
  assert.equal(formatRelativeTimeAgo('2026-11-18 12:00:00', baseMs), '2d ago');

  // Route target resolution per role & notification type
  assert.equal(resolveNotificationTargetRoute('admin', 'approval', 5).path, '/admin/pending-franchisees');
  assert.equal(resolveNotificationTargetRoute('admin', 'order', 12).path, '/admin/orders');
  assert.equal(resolveNotificationTargetRoute('admin', 'restock', 4).path, '/admin/restocking');
  assert.equal(resolveNotificationTargetRoute('admin', 'restock_urgent', 4).path, '/admin/restocking');
  assert.equal(resolveNotificationTargetRoute('admin', 'low_stock', 3).path, '/admin/inventory');
  assert.equal(resolveNotificationTargetRoute('agent', 'approval', 5).path, '/agent/dashboard');
  assert.equal(resolveNotificationTargetRoute('franchisee', 'promo', 9).path, '/franchisee/catalog');
  assert.equal(resolveNotificationTargetRoute('franchisee', 'restock', 9).path, '/franchisee/catalog');
  assert.equal(resolveNotificationTargetRoute('franchisee', 'order', 18).path, '/franchisee/orders');
  assert.equal(resolveNotificationTargetRoute('delivery', 'delivery', 7).path, '/delivery/dashboard');

  // Route -> notification types to mark read on open
  assert.deepEqual(getNotificationTypesForRoute('admin', '/admin/pending-franchisees'), ['approval']);
  assert.deepEqual(getNotificationTypesForRoute('admin', '/admin/restocking'), ['restock', 'restock_urgent']);
  assert.deepEqual(getNotificationTypesForRoute('agent', '/agent/dashboard'), ['approval']);
  assert.deepEqual(getNotificationTypesForRoute('franchisee', '/franchisee/catalog'), ['promo', 'restock']);
  assert.deepEqual(getNotificationTypesForRoute('franchisee', '/franchisee/orders'), ['order', 'delivery', 'near']);
  assert.deepEqual(getNotificationTypesForRoute('delivery', '/delivery/dashboard'), ['delivery', 'order', 'near']);
  assert.deepEqual(getNotificationTypesForRoute('admin', '/admin/notifications'), ['*']);

  // Sidebar badge lookup
  const adminSummary = {
    unread_total: 4,
    sections: {
      pending_approvals: 2,
      replenishment_orders: 5,
      warehouse_inventory: 11,
      warehouse_restocking: 3,
    },
  };
  assert.equal(getSidebarBadgeCount('admin', '/admin/pending-franchisees', adminSummary), 2);
  assert.equal(getSidebarBadgeCount('admin', '/admin/orders', adminSummary), 5);
  assert.equal(getSidebarBadgeCount('admin', '/admin/inventory', adminSummary), 11);
  assert.equal(getSidebarBadgeCount('admin', '/admin/restocking', adminSummary), 3);
  assert.equal(getSidebarBadgeCount('admin', '/admin/notifications', adminSummary), 4);
  assert.equal(getSidebarBadgeCount('admin', '/admin/dashboard', adminSummary), 0);
});

test('public endpoint projections strip private fields, hide prices unless enabled, and extract general store area only', () => {
  assert.equal(sanitizePublicText('<script>alert(1)</script>AICE Choco'), 'alert(1)AICE Choco');
  assert.equal(
    extractGeneralAreaFromAddress('124 Notre Dame Ave, Poblacion VI, Cotabato City'),
    'Poblacion VI, Cotabato City'
  );
  assert.equal(
    extractGeneralAreaFromAddress('88 Sinsuat Ave, Rosary Heights VII, Cotabato City'),
    'Rosary Heights VII, Cotabato City'
  );
  assert.equal(extractGeneralAreaFromAddress(''), 'Cotabato City');

  const rawProd = {
    id: 5,
    name: 'AICE Mochi Klepon',
    flavor: 'Pandan Coconut',
    size: '40 pcs / box',
    image_url: '/uploads/products/mochi.jpg',
    category_name: 'Mochi Series',
    price: 540,
    stock_qty: 95,
    low_stock_threshold: 15,
    sku: 'AICE-MK-05',
  };

  const prodWithoutPrice = projectPublicProduct(rawProd, false);
  assert.equal('price' in prodWithoutPrice, false);
  assert.equal('stock_qty' in (prodWithoutPrice as any), false);
  assert.equal('sku' in (prodWithoutPrice as any), false);
  assert.equal(prodWithoutPrice.category, 'Mochi Series');

  const prodWithPrice = projectPublicProduct(rawProd, true);
  assert.equal(prodWithPrice.price, 540);

  const rawStore = {
    id: 1,
    user_id: 4,
    agent_id: 1,
    owner_name: 'Juan Dela Cruz',
    store_name: 'AICE Notre Dame Avenue Corner Store',
    address: '124 Notre Dame Ave, Poblacion VI, Cotabato City',
    contact_number: '09173333333',
    username: 'juandelacruz',
    lat: 7.2215,
    lng: 124.2482,
  };
  const publicStore = projectPublicStore(rawStore);
  assert.deepEqual(publicStore, {
    id: 1,
    store_name: 'AICE Notre Dame Avenue Corner Store',
    area: 'Poblacion VI, Cotabato City',
    lat: 7.2215,
    lng: 124.2482,
  });
  assert.equal('owner_name' in (publicStore as any), false);
  assert.equal('contact_number' in (publicStore as any), false);
  assert.equal('username' in (publicStore as any), false);
  assert.equal('address' in (publicStore as any), false);

  const publicPromo = projectPublicPromo({
    id: 2,
    name: 'Freezer Bundle Promo',
    description: 'Save on bulk restock',
    promo_type: 'buy_x_get_y',
    buy_quantity: 5,
    free_quantity: 1,
    end_date: '2026-12-15',
  });
  assert.equal(publicPromo.name, 'Freezer Bundle Promo');
  assert.equal(publicPromo.valid_until, '2026-12-15');
  assert.equal(publicPromo.short_description.includes('Buy 5 boxes'), true);
});

test('public chatbot FAQ matching, Gemini AI fallback config, rate limits, and output sanitization work accurately', () => {
  const faqEntries = [
    {
      id: 1,
      question: 'How do approved franchisees place stock-replenishment orders?',
      answer:
        'Approved franchisees sign in to their store workspace, select an active origin warehouse, add AICE cartons to their replenishment cart, and submit online.',
    },
    {
      id: 2,
      question: 'How can I apply to become an AICE franchisee?',
      answer:
        'There is no public self sign-up or online application form. All new franchisee applications are registered on-site by accredited AICE field agents.',
    },
    {
      id: 3,
      question: 'How does live delivery tracking work?',
      answer:
        'Once an order is confirmed and assigned to a delivery rider, franchisees can open the live tracking map.',
    },
  ];

  // 1. FAQ match succeeds on exact or paraphrased in-scope question
  const match1 = matchFaqQuestion('How can I apply to become an AICE franchisee?', faqEntries);
  assert.equal(match1.matched, true);
  assert.equal(match1.faq?.id, 2);

  const match2 = matchFaqQuestion('how do franchisees place stock replenishment orders?', faqEntries);
  assert.equal(match2.matched, true);
  assert.equal(match2.faq?.id, 1);

  // 2. Unrelated question does not pass threshold
  const miss = matchFaqQuestion('What is the atomic weight of molybdenum in space?', faqEntries);
  assert.equal(miss.matched, false);
  assert.equal(miss.faq, null);

  // 3. HTML stripping and 200-char limit
  const dirty = '<script>alert("xss")</script><b>Hello</b> <img src=x onerror=alert(1)> ' + 'a'.repeat(250);
  const cleaned = sanitizeChatbotText(dirty, 200);
  assert.equal(cleaned.includes('<'), false);
  assert.equal(cleaned.includes('>'), false);
  assert.equal(cleaned.includes('alert("xss")'), false);
  assert.equal(cleaned.length <= 200, true);

  // 4. AI configuration requires BOTH CHATBOT_AI_ENABLED === "true" and valid GEMINI_API_KEY
  assert.equal(isChatbotAiConfigured({}), false);
  assert.equal(isChatbotAiConfigured({ GEMINI_API_KEY: 'AIzaRealKey', CHATBOT_AI_ENABLED: 'false' }), false);
  assert.equal(isChatbotAiConfigured({ GEMINI_API_KEY: '', CHATBOT_AI_ENABLED: 'true' }), false);
  assert.equal(isChatbotAiConfigured({ GEMINI_API_KEY: 'MY_GEMINI_API_KEY', CHATBOT_AI_ENABLED: 'true' }), false);
  assert.equal(isChatbotAiConfigured({ GEMINI_API_KEY: 'AIzaRealKey', CHATBOT_AI_ENABLED: 'true' }), true);

  // 5. Daily cap defaults to 200 and parses custom valid numbers
  assert.equal(parseChatbotDailyCap(undefined), 200);
  assert.equal(parseChatbotDailyCap('invalid'), 200);
  assert.equal(parseChatbotDailyCap('350'), 350);

  // 6. Standard fallback reply includes contact details and required phrase
  const fallback = buildStandardChatbotFallback({
    contact_email: 'franchising@aicehub.local',
    contact_phone: '+63 (02) 8888-2423',
  });
  assert.equal(fallback.includes("I couldn't find that, please contact us"), true);
  assert.equal(fallback.includes('franchising@aicehub.local'), true);
  assert.equal(fallback.includes('+63 (02) 8888-2423'), true);

  // 7. Context prompt includes only public FAQs and visitor message (max 200 chars)
  const prompt = buildChatbotFaqContextPrompt(faqEntries, 'Can I sign up online?');
  assert.equal(prompt.includes('Public FAQ Context:'), true);
  assert.equal(prompt.includes('Can I sign up online?'), true);
  assert.equal(CHATBOT_SYSTEM_PROMPT.includes('Keep answers under 80 words'), true);
  assert.equal(CHATBOT_AI_SUBTLE_LABEL, 'AI-generated, may be inaccurate');

  // 8. Per-IP limits: 10 messages/min and 5 AI calls/hour
  const rateMap = new Map<string, ChatbotIpBucket>();
  const now = 1_700_000_000_000;
  for (let i = 0; i < 10; i++) {
    assert.equal(checkChatbotIpMessageLimit(rateMap, '127.0.0.1', now + i * 100).allowed, true);
  }
  assert.equal(checkChatbotIpMessageLimit(rateMap, '127.0.0.1', now + 2000).allowed, false);
  // After 61 seconds, messages are allowed again
  assert.equal(checkChatbotIpMessageLimit(rateMap, '127.0.0.1', now + 62_000).allowed, true);

  for (let i = 0; i < 5; i++) {
    assert.equal(checkChatbotIpAiLimit(rateMap, '127.0.0.1', now + i * 100).allowed, true);
  }
  assert.equal(checkChatbotIpAiLimit(rateMap, '127.0.0.1', now + 2000).allowed, false);
});

test('NEW FRANCHISEE FORM rules: PH mobile validation, status workflow, login/ordering gates, and step validation', () => {
  assert.equal(FRANCHISEE_EQUIPMENT_ITEMS.length, 6);
  assert.deepEqual(FRANCHISEE_EQUIPMENT_ITEMS, [
    'Freezer',
    'Lock & Key',
    'Scraper',
    'Baskets',
    'Manual',
    'Freezer Cover',
  ]);

  // 1. PH Mobile validation & normalization
  assert.equal(isValidPhMobileNumber('09171234567'), true);
  assert.equal(isValidPhMobileNumber('+639171234567'), true);
  assert.equal(isValidPhMobileNumber('63917-123-4567'), true);
  assert.equal(isValidPhMobileNumber('08171234567'), false);
  assert.equal(isValidPhMobileNumber('091712345'), false);
  assert.equal(normalizePhMobileNumber('+63917 123 4567'), '09171234567');

  // 2. Application number & name/address composition
  assert.equal(formatApplicationNumber(1, 2026), 'FR-2026-0001');
  assert.equal(formatApplicationNumber(42, 2026), 'FR-2026-0042');
  assert.equal(composeApplicantFullName('Elena', 'Marie', 'Bautista'), 'Elena Marie Bautista');
  assert.equal(composeApplicantFullName('Elena', '', 'Bautista'), 'Elena Bautista');
  assert.equal(
    composeStoreFullAddress('54 Sinsuat Ave', 'Rosary Heights', 'Cotabato City', 'Maguindanao del Norte'),
    '54 Sinsuat Ave, Brgy. Rosary Heights, Cotabato City, Maguindanao del Norte'
  );

  // 3. Status workflow, timeline index, login gate, and replenishment order gate
  assert.equal(normalizeApplicationStatus('Pending'), 'Pending Admin Review');
  assert.equal(getApplicationTimelineStepIndex('Pending Admin Review'), 0);
  assert.equal(getApplicationTimelineStepIndex('Approved'), 1);
  assert.equal(getApplicationTimelineStepIndex('For Delivery'), 2);
  assert.equal(getApplicationTimelineStepIndex('Delivered'), 3);
  assert.equal(getApplicationTimelineStepIndex('Active'), 4);
  assert.equal(getApplicationTimelineStepIndex('Rejected'), -1);

  assert.equal(canFranchiseeLogin('Pending Admin Review'), false);
  assert.equal(canFranchiseeLogin('Rejected'), false);
  assert.equal(canFranchiseeLogin('Approved'), true);
  assert.equal(canFranchiseeLogin('For Delivery'), true);
  assert.equal(canFranchiseeLogin('Delivered'), true);
  assert.equal(canFranchiseeLogin('Active'), true);

  assert.equal(canFranchiseeOrderReplenishment('Pending Admin Review'), false);
  assert.equal(canFranchiseeOrderReplenishment('Approved'), false);
  assert.equal(canFranchiseeOrderReplenishment('For Delivery'), false);
  assert.equal(canFranchiseeOrderReplenishment('Delivered'), true);
  assert.equal(canFranchiseeOrderReplenishment('Active'), true);

  // 4. Step 1 & Step 2 inline validation
  const step1Errs = validateFranchiseeStep1({
    date_applied: '2026-11-22',
    first_name: 'Elena',
    last_name: 'Bautista',
    contact_number: '12345',
    email: 'invalid-email',
    initial_password: 'short',
  });
  assert.equal(Boolean(step1Errs.contact_number), true);
  assert.equal(Boolean(step1Errs.email), true);
  assert.equal(Boolean(step1Errs.initial_password), true);

  const step2Errs = validateFranchiseeStep2({
    store_name: 'AICE Cotabato Plaza Mart',
    street: '12 Sinsuat Ave',
    barangay: 'Rosary Heights',
    city_municipality: 'Cotabato City',
    province: 'Maguindanao del Norte',
    lat: null,
    lng: null,
  });
  assert.equal(Boolean(step2Errs.coords), true);
});

test('Franchisee QR code URLs, safe internal redirect validation, and role/status QR route resolution', () => {
  // 1. Safe internal redirect sanitizer
  assert.equal(sanitizeInternalRedirectPath('/franchisee/order'), '/franchisee/order');
  assert.equal(sanitizeInternalRedirectPath('/qr/FR-2026-0001'), '/qr/FR-2026-0001');
  assert.equal(sanitizeInternalRedirectPath('https://evil.example.com'), null);
  assert.equal(sanitizeInternalRedirectPath('//evil.example.com'), null);
  assert.equal(sanitizeInternalRedirectPath('/\\evil.example.com'), null);
  assert.equal(sanitizeInternalRedirectPath('javascript:alert(1)'), null);
  assert.equal(sanitizeInternalRedirectPath('/login'), null);
  assert.equal(sanitizeInternalRedirectPath(''), null);

  // 2. QR URL builders with APP_BASE_URL
  assert.equal(
    buildFranchiseeOrderQrUrl('https://aicehub.example.com/'),
    'https://aicehub.example.com/franchisee/order'
  );
  assert.equal(
    buildStorePosterQrUrl('https://aicehub.example.com/', 'FR-2026-0001'),
    'https://aicehub.example.com/qr/FR-2026-0001'
  );

  // 3. Route behavior for /franchisee/order and /qr/{store_code}
  // Logged out -> redirect to /login?redirect=/franchisee/order
  assert.deepEqual(resolveFranchiseeQrRouteAccess(null, true), {
    action: 'redirect_login',
    targetPath: '/login?redirect=/franchisee/order',
  });

  // Active franchisee -> allow ordering page
  assert.deepEqual(
    resolveFranchiseeQrRouteAccess(
      {
        role: 'franchisee',
        franchisee: {
          application_status: 'Active',
          can_order_replenishment: true,
        },
      },
      true
    ),
    {
      action: 'allow_order',
      targetPath: '/franchisee/order',
    }
  );

  // Non-Active franchisee -> show "Your account is not active yet."
  assert.deepEqual(
    resolveFranchiseeQrRouteAccess(
      {
        role: 'franchisee',
        franchisee: {
          application_status: 'Approved',
          can_order_replenishment: false,
        },
      },
      true
    ),
    {
      action: 'show_inactive',
      targetPath: '/franchisee/order',
      message: 'Your account is not active yet.',
    }
  );

  // Admin, Agent, Delivery Staff -> redirect to own dashboard with "This QR is for franchisees."
  assert.deepEqual(resolveFranchiseeQrRouteAccess({ role: 'admin' }, true), {
    action: 'redirect_role_dashboard',
    targetPath: '/admin/dashboard',
    message: 'This QR is for franchisees.',
  });
  assert.deepEqual(resolveFranchiseeQrRouteAccess({ role: 'agent' }, true), {
    action: 'redirect_role_dashboard',
    targetPath: '/agent/dashboard',
    message: 'This QR is for franchisees.',
  });
  assert.deepEqual(resolveFranchiseeQrRouteAccess({ role: 'delivery' }, true), {
    action: 'redirect_role_dashboard',
    targetPath: '/delivery/dashboard',
    message: 'This QR is for franchisees.',
  });
});

test('production role labels and sidebar user footer format cleanly for all roles with neutral User fallback', () => {
  assert.equal(formatRoleDisplayLabel('admin'), 'Administrator');
  assert.equal(formatRoleDisplayLabel('agent'), 'Sales Agent');
  assert.equal(formatRoleDisplayLabel('franchisee'), 'Franchisee');
  assert.equal(formatRoleDisplayLabel('delivery'), 'Delivery Rider');
  assert.equal(formatRoleDisplayLabel(''), 'User');

  assert.deepEqual(
    formatSidebarUserFooter({
      full_name: 'Maria Santos',
      role: 'agent',
    }),
    {
      primaryName: 'Maria Santos',
      secondaryLabel: 'Sales Agent',
    }
  );

  assert.deepEqual(
    formatSidebarUserFooter({
      full_name: 'Juan Dela Cruz',
      role: 'franchisee',
      franchisee: { store_name: 'AICE Notre Dame Avenue Corner Store' },
    }),
    {
      primaryName: 'Juan Dela Cruz',
      secondaryLabel: 'AICE Notre Dame Avenue Corner Store',
    }
  );

  assert.deepEqual(
    formatSidebarUserFooter({
      full_name: '',
      role: 'admin',
    }),
    {
      primaryName: 'User',
      secondaryLabel: 'Administrator',
    }
  );
});
