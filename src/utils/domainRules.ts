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
