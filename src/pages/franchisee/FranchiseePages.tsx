import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { api } from '../../services/api';
import { PaginationBar, ProductImage, StatusText } from '../../components/SharedUI';
import { ORDER_TIMELINE_STEPS, getTimelineStepIndex } from '../../utils/domainRules';
import {
  ApplicationStatusBadge,
  ApplicationWorkflowTimeline,
  FranchiseePaperFormModal,
  downloadApplicationPdf,
} from '../../components/FranchiseePaperFormModal';
import { User } from '../../types';

// ===== 1. FRANCHISEE DASHBOARD =====
export const FranchiseeDashboard: React.FC<{
  user: User;
  onNavigate: (path: string) => void;
  onTrackOrder: (orderId: number) => void;
}> = ({ user, onNavigate, onTrackOrder }) => {
  const [orders, setOrders] = useState<any[]>([]);
  const [activePromos, setActivePromos] = useState<any[]>([]);
  const [myApplication, setMyApplication] = useState<any | null>(null);
  const [showPaperForm, setShowPaperForm] = useState(false);

  useEffect(() => {
    api.get('/orders?limit=8').then((res) => setOrders(res.data));
    api
      .get('/promos')
      .then((res) => setActivePromos(res.data || []))
      .catch(() => {});
    api
      .get('/franchisee-applications/my')
      .then((res) => setMyApplication(res.data || null))
      .catch(() => {});
  }, []);

  const activeOrders = orders.filter(
    (o) => !['Delivered', 'Cancelled', 'Rejected'].includes(o.status)
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {user.franchisee?.store_name || 'Franchisee Portal'}
          </h1>
          <p className="text-sm text-slate-600">
            {user.franchisee?.address} · Place online ice cream stock-replenishment orders and track live delivery progress.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('/franchisee/catalog')}
          className="px-4 py-2 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 whitespace-nowrap shrink-0"
        >
          Order Ice Cream Stock
        </button>
      </div>

      {/* OFFICIAL NEW FRANCHISEE FORM & EQUIPMENT HANDOVER RECORD */}
      {myApplication && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-800">
                  AICE COTABATO-JCDL CORPORATION · NEW FRANCHISEE FORM
                </span>
                <span className="font-mono text-xs font-bold text-slate-900">
                  ({myApplication.application_no})
                </span>
                <ApplicationStatusBadge status={myApplication.status} />
              </div>
              <h2 className="text-base font-bold text-slate-900 mt-1">
                My Official Registration & Equipment Handover Record
              </h2>
              <p className="text-xs text-slate-600">
                Date Applied: <strong className="font-mono">{myApplication.date_applied}</strong> ·
                Sales Agent: <strong>{myApplication.agent_name}</strong> · Freezer #:{' '}
                <strong className="font-mono text-slate-900">
                  {myApplication.freezer_no || 'Pending Delivery Handover'}
                </strong>{' '}
                · Date Delivered:{' '}
                <strong className="font-mono">
                  {myApplication.date_delivered || 'Pending'}
                </strong>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowPaperForm(true)}
                className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
              >
                View Official Paper Form / Print
              </button>
              <button
                type="button"
                onClick={() => downloadApplicationPdf(myApplication)}
                className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800"
              >
                Download PDF
              </button>
            </div>
          </div>

          <ApplicationWorkflowTimeline status={myApplication.status} />

          {!myApplication.can_order_replenishment && (
            <div className="p-3.5 rounded-lg border border-amber-300 bg-amber-50 text-xs text-amber-950">
              <strong>Initial Freezer & Equipment Delivery Pending:</strong> Your franchisee account is approved, and online stock-replenishment ordering will unlock automatically as soon as our Delivery Staff delivers your AICE freezer & accessories and completes Section 2 (Equipment Checklist) and Section 3 (On-Site Signatures).
              {myApplication.assigned_delivery_staff_name && (
                <span className="block mt-1">
                  Assigned Equipment Delivery Staff:{' '}
                  <strong>{myApplication.assigned_delivery_staff_name}</strong> (
                  {myApplication.assigned_delivery_staff_contact || '—'})
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {showPaperForm && myApplication && (
        <FranchiseePaperFormModal
          application={myApplication}
          onClose={() => setShowPaperForm(false)}
        />
      )}

      {/* ACTIVE PROMOTIONS BANNER / SECTION */}
      <div className="bg-white border border-emerald-200 rounded-lg p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Active Stock-Replenishment Promotions
            </h2>
            <p className="text-xs text-slate-600">
              Eligible discounts and free cartons are applied automatically in your replenishment cart.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/franchisee/catalog')}
            className="text-xs font-semibold text-emerald-800 hover:underline"
          >
            Shop With Active Promos →
          </button>
        </div>

        {activePromos.length === 0 ? (
          <div className="p-4 rounded-lg border border-dashed border-slate-200 text-xs text-slate-500">
            No active promos right now. Check back soon for new replenishment discounts.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {activePromos.map((p) => (
              <div
                key={p.id}
                className="p-3.5 rounded-lg border border-emerald-200 bg-emerald-50/60 flex flex-col justify-between gap-2"
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-slate-900">{p.name}</span>
                    {p.days_remaining !== null && p.days_remaining <= 7 && (
                      <span className="font-mono text-[11px] font-bold text-amber-800">
                        {p.days_remaining === 0
                          ? 'Ends today!'
                          : `Ends in ${p.days_remaining} day${p.days_remaining === 1 ? '' : 's'}`}
                      </span>
                    )}
                  </div>
                  <div className="text-xs font-semibold text-emerald-900">{p.how_it_works}</div>
                  {p.description && <p className="text-xs text-slate-600">{p.description}</p>}
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-emerald-200/70 text-[11px] text-slate-600">
                  <span>
                    Valid until: <strong className="font-mono text-slate-900">{p.end_date}</strong>
                  </span>
                  <span className="font-semibold text-emerald-800">Auto-Applied in Cart</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">Recent Replenishment Orders</div>
          <div className="mt-1 text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {orders.length}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">Active / In-Transit Orders</div>
          <div className="mt-1 text-2xl font-bold text-blue-700 font-mono tabular-nums">
            {activeOrders.length}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">Delivered Orders</div>
          <div className="mt-1 text-2xl font-bold text-emerald-700 font-mono tabular-nums">
            {orders.filter((o) => o.status === 'Delivered').length}
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-slate-900">Recent Orders</h2>
          <button
            type="button"
            onClick={() => onNavigate('/franchisee/orders')}
            className="text-xs font-semibold text-rose-700 hover:underline"
          >
            View All Order History
          </button>
        </div>

        {orders.length === 0 ? (
          <div className="text-sm text-slate-500 space-y-2">
            <p>You have not placed any stock-replenishment orders yet.</p>
            <button
              type="button"
              onClick={() => onNavigate('/franchisee/catalog')}
              className="px-3 py-1.5 rounded bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700"
            >
              Browse Product Catalog
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                  <th className="py-2.5 pr-4">Order Number</th>
                  <th className="py-2.5 pr-4">Warehouse Origin</th>
                  <th className="py-2.5 pr-4">Status</th>
                  <th className="py-2.5 pr-4 text-right">Promo Discount</th>
                  <th className="py-2.5 pr-4 text-right">Total</th>
                  <th className="py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="py-2.5 pr-4 font-mono text-xs font-semibold text-slate-900">
                      {o.order_number}
                    </td>
                    <td className="py-2.5 pr-4 text-slate-700">{o.warehouse_name}</td>
                    <td className="py-2.5 pr-4">
                      <StatusText status={o.status} />
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono text-xs text-emerald-700">
                      {Number(o.discount_amount || 0) > 0
                        ? `-PHP ${Number(o.discount_amount).toFixed(2)} (${o.promo_name || 'Promo'})`
                        : '—'}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono text-xs font-semibold">
                      PHP {Number(o.total_amount).toFixed(2)}
                    </td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => onTrackOrder(o.id)}
                        className="px-3 py-1 rounded bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 whitespace-nowrap shrink-0"
                      >
                        Track My Order
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

// ===== 2. FRANCHISEE PRODUCT CATALOG & CART (REPLENISHMENT ORDERING PAGE) =====
export const CatalogAndCartView: React.FC<{
  onTrackOrder: (orderId: number) => void;
}> = ({ onTrackOrder }) => {
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [selectedWh, setSelectedWh] = useState<string>('');
  const [categories, setCategories] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [activePromos, setActivePromos] = useState<any[]>([]);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [myApplication, setMyApplication] = useState<any | null>(null);
  const [appLoading, setAppLoading] = useState<boolean>(true);
  const [showPaperForm, setShowPaperForm] = useState(false);
  const [orderTab, setOrderTab] = useState<'direct' | 'reorder'>('direct');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [cart, setCart] = useState<Record<number, { product: any; quantity: number }>>({});
  const [promoEvaluation, setPromoEvaluation] = useState<any>(null);
  const [deliveryDateTime, setDeliveryDateTime] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reorderingId, setReorderingId] = useState<number | null>(null);

  useEffect(() => {
    api.get('/warehouses').then((res) => {
      const active = res.data.filter((w: any) => w.is_active);
      setWarehouses(active);
      if (active.length > 0) setSelectedWh(String(active[0].id));
    });
    api.get('/categories').then((res) => setCategories(res.data));
    api
      .get('/promos')
      .then((res) => setActivePromos(res.data || []))
      .catch(() => {});
    api
      .get('/orders?limit=6')
      .then((res) => setRecentOrders(res.data || []))
      .catch(() => {});
    api
      .get('/franchisee-applications/my')
      .then((res) => setMyApplication(res.data || null))
      .catch(() => {})
      .finally(() => setAppLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedWh) return;
    api
      .get(
        `/products?warehouse_id=${selectedWh}&active_only=1&limit=100&search=${encodeURIComponent(search)}&category_id=${categoryId}`
      )
      .then((res) => setProducts(res.data));
  }, [selectedWh, search, categoryId]);

  const cartEntries = Object.values(cart);
  const cartSubtotal = cartEntries.reduce(
    (sum, e) => sum + Number(e.product.price) * e.quantity,
    0
  );

  // Automatically evaluate eligible promos and upsell hints whenever cart changes
  useEffect(() => {
    const itemsPayload = Object.values(cart).map((c) => ({
      product_id: c.product.id,
      quantity: c.quantity,
    }));
    api
      .post('/promos/evaluate-cart', { items: itemsPayload })
      .then((res) => setPromoEvaluation(res?.data || res || null))
      .catch(() => setPromoEvaluation(null));
  }, [cart]);

  const addToCart = (product: any) => {
    const currentQty = cart[product.id]?.quantity || 0;
    if (currentQty + 1 > Number(product.stock_qty || 0)) {
      setError(`Only ${product.stock_qty} units of ${product.name} available in the selected warehouse.`);
      return;
    }
    setError('');
    setCart({
      ...cart,
      [product.id]: { product, quantity: currentQty + 1 },
    });
  };

  const updateCartQty = (productId: number, qty: number) => {
    const entry = cart[productId];
    if (!entry) return;
    if (qty <= 0) {
      const next = { ...cart };
      delete next[productId];
      setCart(next);
      return;
    }
    if (qty > Number(entry.product.stock_qty || 0)) {
      setError(`Max available stock for ${entry.product.name} is ${entry.product.stock_qty}.`);
      return;
    }
    setError('');
    setCart({
      ...cart,
      [productId]: { ...entry, quantity: qty },
    });
  };

  const discountAmount = Number(promoEvaluation?.discount_amount || 0);
  const finalTotal =
    promoEvaluation && cartEntries.length > 0
      ? Number(promoEvaluation.final_total)
      : cartSubtotal;

  const placeOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (cartEntries.length === 0) {
      setError('Add at least one ice cream product to your cart.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post('/orders', {
        warehouse_id: Number(selectedWh),
        requested_delivery_datetime: deliveryDateTime || null,
        notes,
        items: cartEntries.map((c) => ({
          product_id: c.product.id,
          quantity: c.quantity,
        })),
      });
      setCart({});
      onTrackOrder(res.id);
    } catch (err: any) {
      setError(err.message || 'Failed to place replenishment order.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickReorder = async (order: any) => {
    setError('');
    setReorderingId(order.id);
    try {
      const paidItems = (order.items || []).filter((it: any) => !it.is_free_item);
      const res = await api.post('/orders', {
        warehouse_id: order.warehouse_id,
        notes: `Reorder of ${order.order_number}`,
        items: paidItems.map((it: any) => ({
          product_id: it.product_id,
          quantity: it.quantity,
        })),
      });
      onTrackOrder(res.id);
    } catch (err: any) {
      setError(err.message || 'Could not reorder items.');
    } finally {
      setReorderingId(null);
    }
  };

  // If the logged-in franchisee is not Active yet (e.g. Pending, Approved, or For Delivery), show "Your account is not active yet."
  if (!appLoading && myApplication && !myApplication.can_order_replenishment) {
    return (
      <div className="space-y-6">
        <div
          role="alert"
          data-testid="franchisee-not-active-yet-banner"
          className="p-6 rounded-xl border-2 border-amber-300 bg-amber-50 space-y-3"
        >
          <div className="text-lg font-bold text-amber-950">
            Your account is not active yet.
          </div>
          <p className="text-sm text-amber-900 max-w-2xl">
            Your NEW FRANCHISEE FORM ({myApplication.application_no}) for{' '}
            <strong>{myApplication.store_name}</strong> is currently in{' '}
            <strong>{myApplication.status}</strong> status. Online stock-replenishment ordering unlocks automatically once our Delivery Staff completes your initial freezer &amp; equipment handover checklist and on-site signatures.
          </p>
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowPaperForm(true)}
              className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
            >
              View My New Franchisee Form
            </button>
          </div>
        </div>

        {showPaperForm && (
          <FranchiseePaperFormModal
            application={myApplication}
            onClose={() => setShowPaperForm(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">
              AICE Stock-Replenishment Ordering
            </h1>
            {myApplication?.store_name && (
              <span
                data-testid="ordering-own-store-name"
                className="text-xs font-mono font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-md"
              >
                Store: {myApplication.store_name}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-600">
            Re-order from a previous delivery in one click or place a direct stock-replenishment order from live warehouse inventory.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Toggle between Direct Order and Re-order options */}
          <div
            role="tablist"
            aria-label="Ordering Mode"
            className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={orderTab === 'direct'}
              data-testid="tab-direct-order"
              onClick={() => setOrderTab('direct')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                orderTab === 'direct'
                  ? 'bg-emerald-700 text-white shadow-sm'
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              Direct Order (Catalog)
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={orderTab === 'reorder'}
              data-testid="tab-quick-reorder"
              onClick={() => setOrderTab('reorder')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                orderTab === 'reorder'
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              Re-order ({recentOrders.length})
            </button>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="cat-wh" className="text-xs font-semibold text-slate-700">
              Origin Warehouse:
            </label>
            <select
              id="cat-wh"
              value={selectedWh}
              onChange={(e) => {
                setSelectedWh(e.target.value);
                setCart({});
              }}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm bg-white font-medium"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Quick Re-order Panel (always accessible via Re-order tab or top card when past orders exist) */}
      {(orderTab === 'reorder' || recentOrders.length > 0) && (
        <div
          data-testid="quick-reorder-section"
          className="bg-white border border-emerald-200 rounded-xl p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Quick Re-order from Your Previous Orders
              </h2>
              <p className="text-xs text-slate-600">
                Repeat any previous stock replenishment order for your store in one tap.
              </p>
            </div>
            {orderTab === 'reorder' && (
              <button
                type="button"
                onClick={() => setOrderTab('direct')}
                className="text-xs font-semibold text-emerald-800 hover:underline"
              >
                Switch to Direct Catalog Order →
              </button>
            )}
          </div>

          {recentOrders.length === 0 ? (
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600">
              No previous orders found for your store yet. Use the Direct Order catalog below to place your first stock order.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {recentOrders.slice(0, orderTab === 'reorder' ? 6 : 3).map((ord) => {
                const paidItems = (ord.items || []).filter((it: any) => !it.is_free_item);
                return (
                  <div
                    key={ord.id}
                    className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/70 flex flex-col justify-between gap-2.5"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-bold text-slate-900">
                          {ord.order_number}
                        </span>
                        <StatusText status={ord.status} />
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {ord.warehouse_name} · <span className="font-mono">{ord.created_at}</span>
                      </div>
                      <div className="text-xs text-slate-700 line-clamp-2">
                        {paidItems
                          .map((it: any) => `${it.quantity}x ${it.product_name}`)
                          .join(', ') || 'Replenishment items'}
                      </div>
                    </div>
                    <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-bold text-slate-900">
                        PHP {Number(ord.total_amount).toFixed(2)}
                      </span>
                      <button
                        type="button"
                        disabled={reorderingId === ord.id}
                        onClick={() => handleQuickReorder(ord)}
                        className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 disabled:opacity-50"
                      >
                        {reorderingId === ord.id ? 'Re-ordering...' : 'Re-order Now'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {showPaperForm && myApplication && (
        <FranchiseePaperFormModal
          application={myApplication}
          onClose={() => setShowPaperForm(false)}
        />
      )}

      {activePromos.length > 0 && (
        <div className="p-3.5 rounded-lg border border-emerald-200 bg-emerald-50/70 space-y-1">
          <div className="text-xs font-bold text-emerald-900">
            Active Promotions ({activePromos.length}) — Automatically Applied at Checkout:
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-800">
            {activePromos.map((p) => (
              <span key={p.id}>
                <strong className="text-emerald-900">{p.name}:</strong> {p.how_it_works}{' '}
                <span className="font-mono text-[11px] text-slate-500">(until {p.end_date})</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
            <input
              type="search"
              aria-label="Search catalog"
              placeholder="Search AICE products or flavors..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full sm:w-64 px-3 py-1.5 rounded-lg border border-slate-300 text-sm"
            />
            <select
              aria-label="Filter catalog by category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm bg-white"
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {products.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-lg p-6 text-sm text-slate-500">
              No products available in the catalog yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {products.map((p) => {
                const stock = Number(p.stock_qty || 0);
                return (
                  <div
                    key={p.id}
                    className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col justify-between space-y-3"
                  >
                    <div className="space-y-2">
                      <ProductImage imageUrl={p.image_url} alt={p.name} />
                      <div className="text-xs text-slate-500">
                        {p.category_name} · {p.flavor} · {p.size}
                      </div>
                      <h3 className="text-sm font-bold text-slate-900">{p.name}</h3>
                    </div>

                    <div className="pt-2 border-t border-slate-100 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono font-bold text-slate-900 text-sm">
                          PHP {Number(p.price).toFixed(2)}
                        </span>
                        <span
                          className={`font-mono font-medium ${
                            stock > 0 ? 'text-emerald-700' : 'text-rose-700'
                          }`}
                        >
                          {stock > 0 ? `${stock} in stock` : 'Out of stock'}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={stock <= 0}
                        onClick={() => addToCart(p)}
                        className="w-full py-2 px-3 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-40"
                      >
                        {stock > 0 ? 'Add to Replenishment Cart' : 'Unavailable'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <form
          onSubmit={placeOrder}
          className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-5 space-y-4"
        >
          <h2 className="text-base font-bold text-slate-900">
            Replenishment Cart ({cartEntries.length})
          </h2>

          {/* Upsell Hints */}
          {Array.isArray(promoEvaluation?.hints) && promoEvaluation.hints.length > 0 && (
            <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 space-y-1">
              <div className="text-[11px] font-bold uppercase tracking-wider text-amber-900">
                Promo Unlock Hint
              </div>
              {promoEvaluation.hints.map((hint: string, i: number) => (
                <div key={i} className="text-xs font-medium text-amber-950">
                  • {hint}
                </div>
              ))}
            </div>
          )}

          {cartEntries.length === 0 ? (
            <p className="text-xs text-slate-500">
              Your cart is empty. Select products on the left to build your order.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 space-y-3">
              {cartEntries.map(({ product, quantity }) => (
                <div key={product.id} className="pt-3 first:pt-0 flex items-center gap-3">
                  <ProductImage imageUrl={product.image_url} alt={product.name} thumb />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-slate-900 truncate">
                      {product.name}
                    </div>
                    <div className="text-[11px] font-mono text-slate-500">
                      PHP {Number(product.price).toFixed(2)} each
                    </div>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={product.stock_qty}
                    aria-label={`Quantity for ${product.name}`}
                    value={quantity}
                    onChange={(e) =>
                      updateCartQty(product.id, parseInt(e.target.value || '0', 10))
                    }
                    className="w-16 px-2 py-1 rounded border border-slate-300 text-xs font-mono text-right"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Free Promo Items Granted (Buy X Get Y) */}
          {Array.isArray(promoEvaluation?.free_items) &&
            promoEvaluation.free_items.length > 0 && (
              <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50 space-y-1.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-900">
                  Free Promo Items Included
                </div>
                {promoEvaluation.free_items.map((fi: any, idx: number) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between text-xs text-emerald-950"
                  >
                    <span>
                      <strong>+{fi.quantity} FREE</strong> {fi.product_name}
                    </span>
                    <span className="font-mono font-semibold text-emerald-800">
                      PHP 0.00 (Value PHP {(Number(fi.unit_price) * Number(fi.quantity)).toFixed(2)})
                    </span>
                  </div>
                ))}
              </div>
            )}

          <div className="pt-3 border-t border-slate-200 space-y-3">
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-slate-600">
                <span>Subtotal</span>
                <span className="font-mono">
                  PHP{' '}
                  {cartSubtotal.toLocaleString('en-PH', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>

              {Array.isArray(promoEvaluation?.applied_promos) &&
                promoEvaluation.applied_promos.length > 0 && (
                  <div className="space-y-1">
                    {promoEvaluation.applied_promos.map((ap: any) => (
                      <div
                        key={ap.promo_id}
                        className="flex items-center justify-between text-emerald-700 font-semibold"
                      >
                        <span>Promo: {ap.name || ap.promo_name}</span>
                        <span className="font-mono">
                          {ap.free_items && ap.free_items.length > 0 && ap.discount_amount === 0
                            ? 'FREE ITEMS'
                            : `-PHP ${Number(ap.discount_amount).toLocaleString('en-PH', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

              {discountAmount > 0 && (
                <div className="flex items-center justify-between text-emerald-700 font-semibold">
                  <span>Total Discount</span>
                  <span className="font-mono">
                    -PHP{' '}
                    {discountAmount.toLocaleString('en-PH', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between text-slate-600">
                <span>Delivery Fee</span>
                <span className="font-mono">
                  {promoEvaluation?.free_delivery_applied ? (
                    <strong className="text-emerald-700">FREE DELIVERY</strong>
                  ) : (
                    'PHP 0.00'
                  )}
                </span>
              </div>

              <div className="pt-1.5 border-t border-slate-200 flex items-center justify-between text-sm font-bold text-slate-900">
                <span>Final Total to Pay</span>
                <span className="font-mono">
                  PHP{' '}
                  {finalTotal.toLocaleString('en-PH', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
            </div>

            <div>
              <label htmlFor="ord-dt" className="block text-xs font-semibold text-slate-700 mb-1">
                Preferred Delivery Date & Time
              </label>
              <input
                id="ord-dt"
                type="datetime-local"
                value={deliveryDateTime}
                onChange={(e) => setDeliveryDateTime(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-mono"
              />
            </div>

            <div>
              <label htmlFor="ord-notes" className="block text-xs font-semibold text-slate-700 mb-1">
                Delivery Instructions / Notes
              </label>
              <textarea
                id="ord-notes"
                rows={2}
                placeholder="e.g. Call 10 minutes before arrival; unload at side freezer gate"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
              />
            </div>

            <button
              type="submit"
              disabled={submitting || cartEntries.length === 0}
              className="w-full py-2.5 px-4 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 disabled:opacity-50"
            >
              {submitting ? 'Submitting Order...' : 'Place Replenishment Order'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ===== 3. FRANCHISEE ORDER HISTORY & ONE-CLICK REORDER =====
export const FranchiseeOrdersView: React.FC<{
  onTrackOrder: (orderId: number) => void;
}> = ({ onTrackOrder }) => {
  const [rows, setRows] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState('');

  const load = (page = 1) => {
    api
      .get(
        `/orders?page=${page}&search=${encodeURIComponent(search)}&status=${encodeURIComponent(statusFilter)}`
      )
      .then((res) => {
        setRows(res.data);
        setPagination(res.pagination);
      });
  };

  useEffect(() => {
    load(1);
  }, [search, statusFilter]);

  const handleReorder = async (order: any) => {
    setError('');
    try {
      const paidItems = (order.items || []).filter((it: any) => !it.is_free_item);
      const res = await api.post('/orders', {
        warehouse_id: order.warehouse_id,
        notes: `Reorder of ${order.order_number}`,
        items: paidItems.map((it: any) => ({
          product_id: it.product_id,
          quantity: it.quantity,
        })),
      });
      onTrackOrder(res.id);
    } catch (err: any) {
      setError(err.message || 'Could not reorder items.');
    }
  };

  const handleCancelOrder = async (orderId: number) => {
    setError('');
    try {
      await api.post(`/orders/${orderId}/cancel`, { reason: 'Cancelled by franchisee' });
      load(pagination.page);
    } catch (err: any) {
      setError(err.message || 'Could not cancel order.');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">My Order History</h1>
        <p className="text-sm text-slate-600">
          Review past replenishment orders, inspect applied promo discounts and free items, reorder in one click, or open Track My Order.
        </p>
      </div>

      {error && (
        <div className="p-4 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-800">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <input
            type="search"
            aria-label="Search my orders"
            placeholder="Search order number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-64 px-3 py-1.5 rounded-lg border border-slate-300 text-sm"
          />
          <select
            aria-label="Filter my orders by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm bg-white"
          >
            <option value="">All Statuses</option>
            {ORDER_TIMELINE_STEPS.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
            <option value="Cancelled">Cancelled</option>
            <option value="Rejected">Rejected</option>
          </select>
        </div>

        <div className="space-y-4">
          {rows.length === 0 ? (
            <p className="text-sm text-slate-500">No replenishment orders found.</p>
          ) : (
            rows.map((o) => (
              <div key={o.id} className="border border-slate-200 rounded-lg p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-slate-900">
                        {o.order_number}
                      </span>
                      <span className="text-slate-400">·</span>
                      <StatusText status={o.status} />
                      {o.promo_name && (
                        <>
                          <span className="text-slate-400">·</span>
                          <span className="text-xs font-semibold text-emerald-700">
                            Promo: {o.promo_name}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="text-xs text-slate-500">
                      Origin: {o.warehouse_name} · Placed:{' '}
                      <span className="font-mono">{o.created_at}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-right mr-2">
                      {Number(o.discount_amount || 0) > 0 && (
                        <div className="text-[11px] font-mono text-slate-500">
                          Subtotal: PHP {Number(o.subtotal ?? o.total_amount).toFixed(2)} ·{' '}
                          <span className="text-emerald-700 font-semibold">
                            -PHP {Number(o.discount_amount).toFixed(2)}
                          </span>
                        </div>
                      )}
                      <div className="font-mono text-sm font-bold text-slate-900">
                        PHP {Number(o.total_amount).toFixed(2)}
                      </div>
                    </div>
                    {o.status === 'Placed' && (
                      <button
                        type="button"
                        onClick={() => handleCancelOrder(o.id)}
                        className="px-3 py-1.5 rounded border border-rose-300 bg-white text-xs font-semibold text-rose-700 hover:bg-rose-50"
                      >
                        Cancel Order
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleReorder(o)}
                      className="px-3 py-1.5 rounded border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Reorder
                    </button>
                    <button
                      type="button"
                      onClick={() => onTrackOrder(o.id)}
                      className="px-3 py-1.5 rounded bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700"
                    >
                      Track My Order
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-2 border-t border-slate-100">
                  {(o.items || []).map((it: any) => (
                    <div key={it.id} className="flex items-center gap-2.5 text-xs">
                      <ProductImage imageUrl={it.image_url} alt={it.product_name} thumb />
                      <div>
                        <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                          <span>{it.product_name}</span>
                          {Boolean(it.is_free_item) && (
                            <span className="text-[10px] font-bold text-emerald-700 uppercase">
                              [FREE PROMO]
                            </span>
                          )}
                        </div>
                        <div className="text-slate-500 font-mono">
                          {Boolean(it.is_free_item) ? (
                            <span className="text-emerald-700 font-semibold">
                              {it.quantity} free box(es) · PHP 0.00
                            </span>
                          ) : (
                            <>
                              {it.quantity} x PHP {Number(it.unit_price).toFixed(2)}
                              {Number(it.discount_amount || 0) > 0 && (
                                <span className="text-emerald-700 ml-1">
                                  (-PHP {Number(it.discount_amount).toFixed(2)})
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
        <PaginationBar pagination={pagination} onPageChange={load} />
      </div>
    </div>
  );
};

// ===== 4. TRACK MY ORDER (Timeline + Live Leaflet Map with Origin, Store, Rider GPS & Route Line) =====
export const TrackOrderView: React.FC<{
  orderId: number;
  onBack: () => void;
}> = ({ orderId, onBack }) => {
  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [payload, setPayload] = useState<any>(null);
  const [error, setError] = useState('');

  const loadTracking = () => {
    api
      .get(`/orders/${orderId}/tracking`)
      .then((res) => setPayload(res))
      .catch((err) => setError(err.message || 'Failed to load tracking details.'));
  };

  useEffect(() => {
    loadTracking();
    const timer = setInterval(loadTracking, 4000);
    return () => clearInterval(timer);
  }, [orderId]);

  useEffect(() => {
    if (!payload || !mapDiv.current) return;
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const { order, liveLocation } = payload;
    const whLat = Number(order.warehouse_lat);
    const whLng = Number(order.warehouse_lng);
    const stLat = Number(order.store_lat);
    const stLng = Number(order.store_lng);

    const map = L.map(mapDiv.current).setView([(whLat + stLat) / 2, (whLng + stLng) / 2], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    const makeIcon = (bg: string, label: string) =>
      L.divIcon({
        className: '',
        html: `<div style="background:${bg};color:#fff;padding:4px 8px;border-radius:6px;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);white-space:nowrap;text-align:center;">${label}</div>`,
        iconSize: [96, 24],
        iconAnchor: [48, 12],
      });

    L.marker([whLat, whLng], { icon: makeIcon('#0F172A', 'WAREHOUSE') })
      .addTo(map)
      .bindPopup(`<strong>Origin Warehouse: ${order.warehouse_name}</strong><br/>${order.warehouse_address}`);

    L.marker([stLat, stLng], { icon: makeIcon('#16A34A', 'DEST STORE') })
      .addTo(map)
      .bindPopup(`<strong>Destination Store: ${order.store_name}</strong><br/>${order.store_address}`);

    const routeCoords: [number, number][] = [[whLat, whLng]];
    if (liveLocation) {
      const rLat = Number(liveLocation.lat);
      const rLng = Number(liveLocation.lng);
      routeCoords.push([rLat, rLng]);
      L.marker([rLat, rLng], { icon: makeIcon('#DC2626', 'RIDER LIVE') })
        .addTo(map)
        .bindPopup(
          `<strong>Delivery Rider: ${order.delivery_staff_name || 'Assigned'}</strong><br/>Updated: ${liveLocation.recorded_at}`
        );
    }
    routeCoords.push([stLat, stLng]);

    const polyline = L.polyline(routeCoords, {
      color: '#DC2626',
      weight: 4,
      dashArray: '8, 6',
    }).addTo(map);

    map.fitBounds(polyline.getBounds(), { padding: [45, 45] });
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [payload]);

  if (error) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={onBack}
          className="text-xs font-semibold text-slate-600 hover:underline"
        >
          ← Back to Orders
        </button>
        <div className="p-4 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-800">
          {error}
        </div>
      </div>
    );
  }

  if (!payload) {
    return <div className="text-sm text-slate-500">Loading live order tracker...</div>;
  }

  const { order, items, history, liveLocation, etaMinutes } = payload;
  const activeIdx = getTimelineStepIndex(order.status);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="text-xs font-semibold text-rose-700 hover:underline mb-1 inline-block"
          >
            ← Back to Orders
          </button>
          <h1 className="text-xl font-bold text-slate-900">
            Track My Order · <span className="font-mono">{order.order_number}</span>
          </h1>
          <p className="text-sm text-slate-600">
            Origin: {order.warehouse_name} → Destination: {order.store_name}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">Current Status</div>
          <div className="text-base font-bold">
            <StatusText status={order.status} />
          </div>
        </div>
      </div>

      {Boolean(order.near_notified) && order.status !== 'Delivered' && (
        <div className="p-4 rounded-lg border border-rose-300 bg-rose-50 text-sm text-rose-950 font-medium">
          Heads up! Your delivery rider ({order.delivery_staff_name}) has signaled they are near or arrived at your store.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-5 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900 mb-3">Order Status Timeline</h2>
            {['Cancelled', 'Rejected'].includes(order.status) ? (
              <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-xs text-rose-900">
                This order was <strong>{order.status}</strong>.{' '}
                {order.cancel_reason && `Reason: ${order.cancel_reason}`}
              </div>
            ) : (
              <ol className="space-y-2.5">
                {ORDER_TIMELINE_STEPS.map((step, idx) => {
                  const isDone = activeIdx >= idx;
                  const isCurrent = activeIdx === idx;
                  return (
                    <li
                      key={step}
                      className={`flex items-center justify-between text-xs p-2 rounded-md border ${
                        isCurrent
                          ? 'border-rose-300 bg-rose-50 font-bold text-rose-950'
                          : isDone
                          ? 'border-emerald-200 bg-emerald-50/50 text-emerald-900 font-medium'
                          : 'border-slate-200 text-slate-400'
                      }`}
                    >
                      <span>
                        {idx + 1}. {step}
                      </span>
                      <span className="font-mono text-[11px]">
                        {isCurrent ? 'CURRENT' : isDone ? 'DONE' : 'PENDING'}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          <div className="pt-4 border-t border-slate-200 space-y-2">
            <h3 className="text-xs font-semibold text-slate-500">Delivery Rider & ETA</h3>
            {order.delivery_staff_name ? (
              <div className="space-y-1 text-sm">
                <div className="font-semibold text-slate-900">{order.delivery_staff_name}</div>
                <div className="text-xs text-slate-600">
                  Contact:{' '}
                  <a
                    href={`tel:${order.delivery_staff_contact}`}
                    className="font-mono text-rose-700 font-semibold hover:underline"
                  >
                    {order.delivery_staff_contact}
                  </a>
                </div>
                <div className="text-xs text-slate-600">
                  Estimated Arrival (ETA):{' '}
                  <strong className="font-mono text-slate-900">
                    {order.status === 'Delivered'
                      ? 'Delivered'
                      : etaMinutes
                      ? `~${etaMinutes} mins`
                      : 'Calculating...'}
                  </strong>
                </div>
                {liveLocation && (
                  <div className="text-[11px] font-mono text-slate-500">
                    Live GPS: ({liveLocation.lat}, {liveLocation.lng}) at {liveLocation.recorded_at}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                Waiting for Admin to assign a delivery staff member.
              </p>
            )}
          </div>

          {(order.proof_note || order.proof_image_url) && (
            <div className="pt-4 border-t border-slate-200 space-y-2">
              <h3 className="text-xs font-semibold text-slate-500">Proof of Delivery</h3>
              {order.proof_note && <p className="text-xs text-slate-800">{order.proof_note}</p>}
              {order.proof_image_url && (
                <img
                  src={order.proof_image_url}
                  alt="Proof of delivery"
                  className="w-full rounded-lg border border-slate-200 object-cover max-h-48"
                />
              )}
            </div>
          )}
        </div>

        <div className="lg:col-span-8 space-y-6">
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <div
              ref={mapDiv}
              style={{ height: 420 }}
              className="w-full rounded-lg border border-slate-200 overflow-hidden z-0"
            />
            <div className="flex flex-wrap items-center gap-5 mt-3 text-xs text-slate-600">
              <span>
                <strong className="text-slate-900">WAREHOUSE</strong> — Origin ({order.warehouse_name})
              </span>
              <span>·</span>
              <span>
                <strong className="text-emerald-700">DEST STORE</strong> — Destination ({order.store_name})
              </span>
              <span>·</span>
              <span>
                <strong className="text-rose-700">RIDER LIVE</strong> — Delivery Staff Live Position & Route Line
              </span>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900">
                Ordered Products ({items.length})
              </h2>
              <div className="text-right font-mono text-xs">
                {Number(order.discount_amount || 0) > 0 && (
                  <div className="text-slate-500">
                    Subtotal: PHP {Number(order.subtotal ?? order.total_amount).toFixed(2)} ·{' '}
                    <span className="text-emerald-700 font-semibold">
                      Promo ({order.promo_name || 'Discount'}): -PHP{' '}
                      {Number(order.discount_amount).toFixed(2)}
                    </span>
                  </div>
                )}
                <div className="text-sm font-bold text-slate-900">
                  Final Total: PHP {Number(order.total_amount).toFixed(2)}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {items.map((it: any) => (
                <div
                  key={it.id}
                  className="flex items-center gap-3 p-2.5 rounded-lg border border-slate-200"
                >
                  <ProductImage imageUrl={it.image_url} alt={it.product_name} thumb />
                  <div>
                    <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <span>{it.product_name}</span>
                      {Boolean(it.is_free_item) && (
                        <span className="text-[10px] font-bold text-emerald-700 uppercase">
                          [FREE PROMO]
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {it.flavor} · {it.size}
                    </div>
                    <div className="text-xs font-mono text-slate-800">
                      {Boolean(it.is_free_item) ? (
                        <span className="text-emerald-700 font-semibold">
                          {it.quantity} free box(es) · PHP 0.00
                        </span>
                      ) : (
                        <>
                          {it.quantity} x PHP {Number(it.unit_price).toFixed(2)} = PHP{' '}
                          {Number(it.subtotal).toFixed(2)}
                          {Number(it.discount_amount || 0) > 0 && (
                            <span className="text-emerald-700 ml-1">
                              (-PHP {Number(it.discount_amount).toFixed(2)})
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-2">
            <h2 className="text-sm font-semibold text-slate-900">Status History Audit</h2>
            <div className="divide-y divide-slate-100 text-xs">
              {history.map((h: any) => (
                <div key={h.id} className="py-2 flex items-center justify-between">
                  <div>
                    <strong className="text-slate-900">{h.status}</strong> — {h.notes}
                  </div>
                  <span className="font-mono text-slate-500">{h.created_at}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ===== 5. FRANCHISEE PROFILE & PASSWORD =====
export const FranchiseeProfileView: React.FC<{
  user: User;
  onProfileUpdated: () => Promise<void>;
}> = ({ user, onProfileUpdated }) => {
  const [profileForm, setProfileForm] = useState({
    full_name: user.full_name,
    email: user.email || '',
    contact_number: user.contact_number || '',
  });
  const [pwdForm, setPwdForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [myApplication, setMyApplication] = useState<any | null>(null);
  const [showPaperForm, setShowPaperForm] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    api
      .get('/franchisee-applications/my')
      .then((res) => setMyApplication(res.data || null))
      .catch(() => {});
  }, []);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setMsg('');
    try {
      await api.put('/auth/profile', profileForm);
      setMsg('Profile details updated.');
      await onProfileUpdated();
    } catch (error: any) {
      setErr(error.message || 'Failed to update profile.');
    }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setMsg('');
    if (pwdForm.newPassword !== pwdForm.confirmPassword) {
      setErr('New passwords do not match.');
      return;
    }
    try {
      await api.post('/auth/change-password', {
        currentPassword: pwdForm.currentPassword,
        newPassword: pwdForm.newPassword,
      });
      setMsg('Password changed successfully.');
      setPwdForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (error: any) {
      setErr(error.message || 'Failed to change password.');
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold text-slate-900">
          Store Profile, Official Registration Record & Security
        </h1>
        <p className="text-sm text-slate-600">
          View or print your official AICE Cotabato-JCDL Corporation New Franchisee Form and equipment handover record, or update your contact details and password.
        </p>
      </div>

      {msg && (
        <div className="p-4 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-900">
          {msg}
        </div>
      )}
      {err && (
        <div className="p-4 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-800">
          {err}
        </div>
      )}

      {myApplication && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-bold text-emerald-800">
                  {myApplication.application_no}
                </span>
                <ApplicationStatusBadge status={myApplication.status} />
              </div>
              <h2 className="text-base font-bold text-slate-900 mt-1">
                Official Registration & Equipment Record (Read-Only)
              </h2>
              <p className="text-xs text-slate-600">
                Store: <strong>{myApplication.store_name}</strong> · Address:{' '}
                <strong>{myApplication.full_address}</strong> · Landmark:{' '}
                <strong>{myApplication.landmark || '—'}</strong> · Freezer #:{' '}
                <strong className="font-mono">{myApplication.freezer_no || '—'}</strong>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowPaperForm(true)}
                className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
              >
                Print / View Paper Form
              </button>
              <button
                type="button"
                onClick={() => downloadApplicationPdf(myApplication)}
                className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800"
              >
                Download PDF
              </button>
            </div>
          </div>

          <ApplicationWorkflowTimeline status={myApplication.status} />

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 pt-2 border-t border-slate-100">
            {(myApplication.equipment || []).map((eq: any) => (
              <div
                key={eq.item_name}
                className="p-2.5 rounded-lg border border-slate-200 bg-slate-50 text-xs"
              >
                <div className="font-bold text-slate-900">{eq.item_name}</div>
                <div className="font-mono text-[11px] text-slate-600 mt-0.5">
                  {eq.condition_status} · Qty: {eq.quantity}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showPaperForm && myApplication && (
        <FranchiseePaperFormModal
          application={myApplication}
          onClose={() => setShowPaperForm(false)}
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <form
          onSubmit={saveProfile}
          className="bg-white border border-slate-200 rounded-lg p-5 space-y-4"
        >
          <h2 className="text-base font-semibold text-slate-900">Owner & Store Information</h2>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Store Name</label>
            <input
              type="text"
              disabled
              value={user.franchisee?.store_name || ''}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-600"
            />
          </div>
          <div>
            <label htmlFor="prof-name" className="block text-xs font-semibold text-slate-700 mb-1">
              Owner Full Name
            </label>
            <input
              id="prof-name"
              type="text"
              required
              value={profileForm.full_name}
              onChange={(e) => setProfileForm({ ...profileForm, full_name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>
          <div>
            <label htmlFor="prof-phone" className="block text-xs font-semibold text-slate-700 mb-1">
              Contact Number
            </label>
            <input
              id="prof-phone"
              type="text"
              required
              value={profileForm.contact_number}
              onChange={(e) => setProfileForm({ ...profileForm, contact_number: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
            />
          </div>
          <div>
            <label htmlFor="prof-email" className="block text-xs font-semibold text-slate-700 mb-1">
              Email Address
            </label>
            <input
              id="prof-email"
              type="email"
              value={profileForm.email}
              onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
          >
            Save Profile
          </button>
        </form>

        <form
          onSubmit={savePassword}
          className="bg-white border border-slate-200 rounded-lg p-5 space-y-4"
        >
          <h2 className="text-base font-semibold text-slate-900">Change Password</h2>
          <div>
            <label htmlFor="pwd-cur" className="block text-xs font-semibold text-slate-700 mb-1">
              Current Password
            </label>
            <input
              id="pwd-cur"
              type="password"
              required
              value={pwdForm.currentPassword}
              onChange={(e) => setPwdForm({ ...pwdForm, currentPassword: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>
          <div>
            <label htmlFor="pwd-new" className="block text-xs font-semibold text-slate-700 mb-1">
              New Password (min 8 chars)
            </label>
            <input
              id="pwd-new"
              type="password"
              required
              minLength={8}
              value={pwdForm.newPassword}
              onChange={(e) => setPwdForm({ ...pwdForm, newPassword: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>
          <div>
            <label htmlFor="pwd-conf" className="block text-xs font-semibold text-slate-700 mb-1">
              Confirm New Password
            </label>
            <input
              id="pwd-conf"
              type="password"
              required
              value={pwdForm.confirmPassword}
              onChange={(e) => setPwdForm({ ...pwdForm, confirmPassword: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700"
          >
            Update Password
          </button>
        </form>
      </div>
    </div>
  );
};
