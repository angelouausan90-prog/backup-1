import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAvailableStock,
  computeAvgDailyOrders,
  computeReorderPoint,
  classifyStockStatus,
  getRestockRecommendationLabel,
  computeRestockQuantity,
  allocateBatchQuantitiesWithinCapacity,
  validateCapacityForIncoming,
  checkTargetsAgainstCapacity,
  isWithinMonthlyTriggerWindow,
  computeExpectedArrivalDate,
  isRestockOverdue,
  getFranchiseeStockMessage,
  sortRestockRecommendations,
} from './restockingRules';

test('computeAvailableStock subtracts reserved stock and floors at 0', () => {
  assert.equal(computeAvailableStock(100, 89), 11);
  assert.equal(computeAvailableStock(15, 15), 0);
  assert.equal(computeAvailableStock(10, 25), 0);
  assert.equal(computeAvailableStock(50, 0), 50);
});

test('computeAvgDailyOrders computes 30-day average with safe fallback', () => {
  assert.equal(computeAvgDailyOrders(90), 3);
  assert.equal(computeAvgDailyOrders(60), 2);
  assert.equal(computeAvgDailyOrders(0), 0);
  assert.equal(computeAvgDailyOrders(0, 1.5), 1.5);
});

test('computeReorderPoint uses (avgDailyOrders * leadTimeDays) + safetyStock', () => {
  // 3/day * 7 days + 15 safety = 36
  assert.equal(computeReorderPoint(3, 7, 15), 36);
  // 0/day * 7 days + 10 safety = 10
  assert.equal(computeReorderPoint(0, 7, 10), 10);
  // Fractional rounds up via ceil: 1.5 * 7 = 10.5 + 10 = 20.5 -> 21
  assert.equal(computeReorderPoint(1.5, 7, 10), 21);
});

test('classifyStockStatus enforces exact labels In Stock, Low Stock, and No Stock', () => {
  assert.equal(classifyStockStatus(0, 20), 'No Stock');
  assert.equal(classifyStockStatus(0, 0), 'No Stock');
  assert.equal(classifyStockStatus(1, 20), 'Low Stock');
  assert.equal(classifyStockStatus(20, 20), 'Low Stock');
  assert.equal(classifyStockStatus(21, 20), 'In Stock');
});

test('getRestockRecommendationLabel matches required wording', () => {
  assert.equal(getRestockRecommendationLabel('No Stock'), 'Urgent restock needed');
  assert.equal(getRestockRecommendationLabel('Low Stock'), 'Restock recommended');
  assert.equal(getRestockRecommendationLabel('In Stock'), null);
});

test('Scenario 1: computeRestockQuantity keeps leftover stock and adds lead-time demand', () => {
  // Target 100, 89 reserved/ordered leaving 11 available, no lead-time demand => 89
  const exactLeftover = computeRestockQuantity({
    targetQty: 100,
    availableStock: 11,
    avgDailyOrders: 0,
    leadTimeDays: 7,
    currentWarehouseTotalStock: 100,
    warehouseCapacity: 1000,
  });
  assert.equal(exactLeftover.rawQty, 89);
  assert.equal(exactLeftover.cappedQty, 89);
  assert.equal(exactLeftover.wasCapped, false);

  // Target 100, 11 available, 2/day * 7 days = 14 expected demand => 100 - 11 + 14 = 103
  const withLeadDemand = computeRestockQuantity({
    targetQty: 100,
    availableStock: 11,
    avgDailyOrders: 2,
    leadTimeDays: 7,
    currentWarehouseTotalStock: 100,
    warehouseCapacity: 1000,
  });
  assert.equal(withLeadDemand.rawQty, 103);
  assert.equal(withLeadDemand.cappedQty, 103);
  assert.equal(withLeadDemand.wasCapped, false);

  // Never negative when available stock exceeds target + demand
  const overTarget = computeRestockQuantity({
    targetQty: 50,
    availableStock: 80,
    avgDailyOrders: 1,
    leadTimeDays: 7,
    currentWarehouseTotalStock: 80,
    warehouseCapacity: 500,
  });
  assert.equal(overTarget.rawQty, 0);
  assert.equal(overTarget.cappedQty, 0);
});

test('Scenario 5: capacity capping and over-capacity validation', () => {
  // Warehouse capacity 500, current total stock 460 -> max incoming 40
  const capped = computeRestockQuantity({
    targetQty: 100,
    availableStock: 10,
    avgDailyOrders: 2,
    leadTimeDays: 7,
    currentWarehouseTotalStock: 460,
    warehouseCapacity: 500,
  });
  assert.equal(capped.rawQty, 104);
  assert.equal(capped.cappedQty, 40);
  assert.equal(capped.wasCapped, true);
  assert.equal(capped.remainingCapacity, 40);

  const checkFail = validateCapacityForIncoming({
    currentWarehouseTotalStock: 460,
    incomingTotalQty: 50,
    warehouseCapacity: 500,
  });
  assert.equal(checkFail.ok, false);
  assert.equal(checkFail.excess, 10);
  assert.match(checkFail.error || '', /Exceeds warehouse capacity by 10/);

  const checkPass = validateCapacityForIncoming({
    currentWarehouseTotalStock: 460,
    incomingTotalQty: 40,
    warehouseCapacity: 500,
  });
  assert.equal(checkPass.ok, true);
  assert.equal(checkPass.projectedTotal, 500);
});

test('allocateBatchQuantitiesWithinCapacity prioritizes No Stock then Low Stock within capacity', () => {
  const allocated = allocateBatchQuantitiesWithinCapacity(
    [
      { product_id: 1, stock_status: 'In Stock', raw_qty: 50 },
      { product_id: 2, stock_status: 'No Stock', raw_qty: 60 },
      { product_id: 3, stock_status: 'Low Stock', raw_qty: 40 },
    ],
    420,
    500
  );
  // Remaining capacity = 80 -> No Stock gets 60, Low Stock gets 20 (capped), In Stock gets 0 (capped)
  const p1 = allocated.find((a) => a.product_id === 1)!;
  const p2 = allocated.find((a) => a.product_id === 2)!;
  const p3 = allocated.find((a) => a.product_id === 3)!;
  assert.equal(p2.allocated_qty, 60);
  assert.equal(p2.was_capped, false);
  assert.equal(p3.allocated_qty, 20);
  assert.equal(p3.was_capped, true);
  assert.equal(p1.allocated_qty, 0);
  assert.equal(p1.was_capped, true);
});

test('checkTargetsAgainstCapacity warns when sum of targets exceeds warehouse capacity', () => {
  assert.deepEqual(checkTargetsAgainstCapacity(1200, 1000), { exceeds: true, excess: 200 });
  assert.deepEqual(checkTargetsAgainstCapacity(800, 1000), { exceeds: false, excess: 0 });
});

test('isWithinMonthlyTriggerWindow triggers within leadTimeDays before month end', () => {
  // April has 30 days; leadTime=7 -> days 23..30 trigger
  assert.equal(isWithinMonthlyTriggerWindow('2026-04-22', 7), false);
  assert.equal(isWithinMonthlyTriggerWindow('2026-04-23', 7), true);
  assert.equal(isWithinMonthlyTriggerWindow('2026-04-30', 7), true);
  // February 2026 has 28 days; leadTime=7 -> day 21 triggers
  assert.equal(isWithinMonthlyTriggerWindow('2026-02-20', 7), false);
  assert.equal(isWithinMonthlyTriggerWindow('2026-02-21', 7), true);
});

test('computeExpectedArrivalDate and isRestockOverdue handle lead time and overdue alerts', () => {
  assert.equal(computeExpectedArrivalDate('2026-04-24', 7), '2026-05-01');
  assert.equal(isRestockOverdue('Approved/In Transit', '2026-05-01', '2026-05-01'), false);
  assert.equal(isRestockOverdue('Approved/In Transit', '2026-05-01', '2026-05-02'), true);
  assert.equal(isRestockOverdue('Received', '2026-05-01', '2026-05-10'), false);
  assert.equal(isRestockOverdue('Draft', '2026-05-01', '2026-05-10'), false);
});

test('Scenario 6: getFranchiseeStockMessage enforces No Stock blocking and Low Stock warning', () => {
  const noStockInTransit = getFranchiseeStockMessage('No Stock', 0, {
    status: 'Approved/In Transit',
    expected_arrival_date: '2026-05-05',
  });
  assert.equal(noStockInTransit.blocked, true);
  assert.equal(noStockInTransit.message, 'No Stock. Restock expected on 2026-05-05');

  const noStockDraft = getFranchiseeStockMessage('No Stock', 0, {
    status: 'Draft',
    expected_arrival_date: null,
  });
  assert.equal(noStockDraft.blocked, true);
  assert.equal(noStockDraft.message, 'No Stock. Restock requested');

  const lowStock = getFranchiseeStockMessage('Low Stock', 7, null);
  assert.equal(lowStock.blocked, false);
  assert.equal(lowStock.message, 'Low Stock. Only 7 left');

  const lowStockInTransit = getFranchiseeStockMessage('Low Stock', 7, {
    status: 'Approved/In Transit',
    expected_arrival_date: '2026-05-05',
  });
  assert.equal(lowStockInTransit.blocked, false);
  assert.equal(
    lowStockInTransit.message,
    'Low Stock. Only 7 left · Restock expected on 2026-05-05'
  );
});

test('sortRestockRecommendations lists No Stock first, then Low Stock', () => {
  const sorted = sortRestockRecommendations([
    { stock_status: 'Low Stock', available_stock: 5, name: 'Vanilla Cone' },
    { stock_status: 'No Stock', available_stock: 0, name: 'Strawberry Cup' },
    { stock_status: 'No Stock', available_stock: 0, name: 'Chocolate Stick' },
    { stock_status: 'Low Stock', available_stock: 2, name: 'Mango Mochi' },
  ]);
  assert.deepEqual(
    sorted.map((s) => s.name),
    ['Chocolate Stick', 'Strawberry Cup', 'Mango Mochi', 'Vanilla Cone']
  );
});
