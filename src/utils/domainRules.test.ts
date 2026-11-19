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
