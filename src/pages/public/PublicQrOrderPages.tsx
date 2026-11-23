import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { MapPicker } from '../../components/MapPicker';
import { ProductImage, StatusText } from '../../components/SharedUI';
import { api } from '../../services/api';
import { User } from '../../types';
import {
  CUSTOMER_ORDER_TIMELINE_STEPS,
  STORE_NOT_ACCEPTING_ORDERS_MESSAGE,
  getCustomerOrderTimelineStepIndex,
} from '../../utils/domainRules';

// ===== TOP-LEVEL LEAFLET MAP FOR CUSTOMER ORDER TRACKING =====
export const CustomerOrderTrackingMap: React.FC<{
  storeName: string;
  storeLat: number;
  storeLng: number;
  customerLat: number | null;
  customerLng: number | null;
  deliveryAddress: string;
  riderName?: string | null;
  riderLat?: number | null;
  riderLng?: number | null;
  height?: number;
}> = ({
  storeName,
  storeLat,
  storeLng,
  customerLat,
  customerLng,
  deliveryAddress,
  riderName,
  riderLat,
  riderLng,
  height = 300,
}) => {
  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapDiv.current) return;
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const sLat = Number(storeLat || 14.6042);
    const sLng = Number(storeLng || 120.9921);
    const cLat = customerLat != null ? Number(customerLat) : sLat + 0.004;
    const cLng = customerLng != null ? Number(customerLng) : sLng + 0.004;

    const centerLat =
      riderLat != null ? Number(riderLat) : (sLat + cLat) / 2;
    const centerLng =
      riderLng != null ? Number(riderLng) : (sLng + cLng) / 2;

    const map = L.map(mapDiv.current).setView([centerLat, centerLng], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    const makeIcon = (bg: string, label: string) =>
      L.divIcon({
        className: '',
        html: `<div style="background:${bg};color:#fff;padding:4px 8px;border-radius:6px;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);white-space:nowrap;text-align:center;">${label}</div>`,
        iconSize: [108, 24],
        iconAnchor: [54, 12],
      });

    L.marker([sLat, sLng], {
      icon: makeIcon('#7E22CE', 'AICE STORE'),
    })
      .addTo(map)
      .bindPopup(`<strong>${storeName}</strong><br/>Store Origin`);

    L.marker([cLat, cLng], {
      icon: makeIcon('#16A34A', 'DELIVERY PIN'),
    })
      .addTo(map)
      .bindPopup(`<strong>Customer Delivery Pin</strong><br/>${deliveryAddress}`);

    const points: [number, number][] = [[sLat, sLng]];
    if (riderLat != null && riderLng != null) {
      const rLat = Number(riderLat);
      const rLng = Number(riderLng);
      points.push([rLat, rLng]);
      L.marker([rLat, rLng], {
        icon: makeIcon('#DC2626', 'RIDER LIVE'),
      })
        .addTo(map)
        .bindPopup(
          `<strong>Rider: ${riderName || 'Assigned Delivery Staff'}</strong><br/>Live GPS (${rLat.toFixed(5)}, ${rLng.toFixed(5)})`
        );
    }
    points.push([cLat, cLng]);

    L.polyline(points, {
      color: '#DC2626',
      weight: 3,
      dashArray: '6, 6',
    }).addTo(map);

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [
    storeName,
    storeLat,
    storeLng,
    customerLat,
    customerLng,
    deliveryAddress,
    riderName,
    riderLat,
    riderLng,
  ]);

  return (
    <div className="space-y-2">
      <div
        ref={mapDiv}
        style={{ height }}
        className="w-full rounded-xl border border-slate-200 overflow-hidden z-0"
      />
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
        <span>
          <strong className="text-purple-700">AICE STORE</strong> — Store Origin
        </span>
        <span>·</span>
        <span>
          <strong className="text-rose-700">RIDER LIVE</strong> — Delivery Staff GPS Location
        </span>
        <span>·</span>
        <span>
          <strong className="text-emerald-700">DELIVERY PIN</strong> — Your Delivery Address
        </span>
      </div>
    </div>
  );
};

// ===== 1. PUBLIC STORE QR ORDERING PAGE (/order/:store_code) =====
export const PublicStoreOrderPage: React.FC<{
  storeCode: string;
  user: User | null;
  onNavigate: (path: string) => void;
}> = ({ storeCode, user, onNavigate }) => {
  const [loading, setLoading] = useState(true);
  const [store, setStore] = useState<any | null>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [loadError, setLoadError] = useState<string>('');

  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [cart, setCart] = useState<Record<number, number>>({});

  // Single top-level controlled checkout state object (prevents map clicks from resetting inputs)
  const [checkoutForm, setCheckoutForm] = useState<{
    customer_name: string;
    contact_no: string;
    address: string;
    latitude: number | null;
    longitude: number | null;
    notes: string;
    payment_method: 'Cash on Delivery';
  }>({
    customer_name: user?.role === 'customer' ? user.full_name || '' : '',
    contact_no: '',
    address: '',
    latitude: 14.6055,
    longitude: 120.9935,
    notes: '',
    payment_method: 'Cash on Delivery',
  });

  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [placedOrder, setPlacedOrder] = useState<any | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Customer Order History section (signed-in customer or guest phone lookup)
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [historyPhone, setHistoryPhone] = useState('');
  const [historyOrders, setHistoryOrders] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadStoreMenu = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await fetch(`/api/public/qr-store/${encodeURIComponent(storeCode)}/menu`);
      const data = await res.json();
      if (!res.ok) {
        setLoadError(data.message || data.error || 'Store QR code not found.');
        setStore(null);
        setProducts([]);
      } else {
        setStore({
          ...data.store,
          accepting_orders: Boolean(data.accepting_orders),
        });
        setProducts(Array.isArray(data.products) ? data.products : []);
        setStatusMessage(data.message || '');
        if (data.store?.lat && data.store?.lng) {
          setCheckoutForm((prev) => ({
            ...prev,
            latitude: prev.latitude ?? Number(data.store.lat),
            longitude: prev.longitude ?? Number(data.store.lng),
          }));
        }
      }
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load store ordering menu.');
    } finally {
      setLoading(false);
    }
  }, [storeCode]);

  useEffect(() => {
    loadStoreMenu();
  }, [loadStoreMenu]);

  useEffect(() => {
    if (user?.role === 'customer' && user.full_name) {
      setCheckoutForm((prev) => ({
        ...prev,
        customer_name: prev.customer_name || user.full_name,
      }));
    }
  }, [user]);

  const loadOrderHistory = useCallback(
    async (phoneOverride?: string) => {
      setHistoryLoading(true);
      try {
        if (user?.role === 'customer') {
          const res = await api.get('/customer/orders');
          setHistoryOrders(res.data || []);
        } else {
          const contact = (phoneOverride ?? historyPhone).trim();
          const qs = contact
            ? `?contact_no=${encodeURIComponent(contact)}&store_code=${encodeURIComponent(storeCode)}`
            : '';
          if (!qs) {
            setHistoryOrders([]);
            return;
          }
          const res = await fetch(`/api/public/qr-orders/history${qs}`);
          const data = await res.json();
          setHistoryOrders(Array.isArray(data.data) ? data.data : []);
        }
      } catch {
        setHistoryOrders([]);
      } finally {
        setHistoryLoading(false);
      }
    },
    [user, historyPhone, storeCode]
  );

  useEffect(() => {
    if (user?.role === 'customer') {
      loadOrderHistory();
    }
  }, [user, loadOrderHistory]);

  const handleMapPick = useCallback((lat: number, lng: number) => {
    setCheckoutForm((prev) => ({
      ...prev,
      latitude: lat,
      longitude: lng,
    }));
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      const cat = p.category || p.category_name;
      if (cat) set.add(cat);
    });
    return ['ALL', ...Array.from(set)];
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const cat = p.category || p.category_name || '';
      const name = p.name || p.product_name || '';
      if (selectedCategory !== 'ALL' && cat !== selectedCategory) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay = `${name} ${p.flavor} ${p.size} ${cat}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [products, selectedCategory, searchQuery]);

  const updateCartQuantity = (productId: number, desiredQty: number) => {
    const product = products.find((p) => Number(p.id ?? p.product_id) === Number(productId));
    if (!product) return;
    const maxAvail = Math.max(0, Number(product.available_stock || 0));
    const clamped = Math.max(0, Math.min(desiredQty, maxAvail));
    setCart((prev) => {
      const next = { ...prev };
      if (clamped <= 0) {
        delete next[productId];
      } else {
        next[productId] = clamped;
      }
      return next;
    });
  };

  const cartItems = useMemo(() => {
    return Object.entries(cart)
      .map(([pidStr, qty]) => {
        const pid = Number(pidStr);
        const product = products.find((p) => Number(p.id ?? p.product_id) === pid);
        if (!product || qty <= 0) return null;
        const unitPrice = Number(product.price || 0);
        return {
          product_id: pid,
          product_name: product.name || product.product_name,
          flavor: product.flavor,
          size: product.size,
          image_url: product.image_url,
          available_stock: Number(product.available_stock || 0),
          unit_price: unitPrice,
          quantity: qty,
          subtotal: Number((unitPrice * qty).toFixed(2)),
        };
      })
      .filter(Boolean) as Array<{
      product_id: number;
      product_name: string;
      flavor: string;
      size: string;
      image_url: string;
      available_stock: number;
      unit_price: number;
      quantity: number;
      subtotal: number;
    }>;
  }, [cart, products]);

  const cartTotalUnits = useMemo(
    () => cartItems.reduce((sum, it) => sum + it.quantity, 0),
    [cartItems]
  );
  const cartTotalAmount = useMemo(
    () => Number(cartItems.reduce((sum, it) => sum + it.subtotal, 0).toFixed(2)),
    [cartItems]
  );

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setCheckoutError('');

    if (cartItems.length === 0) {
      setCheckoutError('Please add at least one AICE ice cream item to your cart.');
      return;
    }

    setSubmittingOrder(true);
    try {
      const token = localStorage.getItem('aice_token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/public/qr-store/${encodeURIComponent(storeCode)}/orders`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          customer_name: checkoutForm.customer_name.trim(),
          contact_no: checkoutForm.contact_no.trim(),
          address: checkoutForm.address.trim(),
          latitude: checkoutForm.latitude,
          longitude: checkoutForm.longitude,
          notes: checkoutForm.notes.trim(),
          payment_method: 'Cash on Delivery',
          items: cartItems.map((it) => ({
            product_id: it.product_id,
            quantity: it.quantity,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCheckoutError(data.message || data.error || 'Failed to submit order.');
        return;
      }

      setPlacedOrder({
        order_id: data.order_id,
        order_no: data.order_no,
        total: data.total,
        status: 'Placed',
        tracking_url: `${window.location.origin}/track/${data.order_no}`,
      });
      setCart({});
      setHistoryPhone(checkoutForm.contact_no.trim());
      loadStoreMenu();
    } catch (err: any) {
      setCheckoutError(err.message || 'Network error while placing order.');
    } finally {
      setSubmittingOrder(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-slate-600 shadow-xs">
          Loading AICE Store Ordering Page...
        </div>
      </div>
    );
  }

  if (loadError || !store) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-rose-200 rounded-2xl p-6 text-center space-y-4 shadow-sm">
          <img
            src="/assets/aistudio/aice_brands_ice_cream_philippines_inc_cover_9b51f46b.jpg"
            alt="AICE Ice Cream"
            className="h-14 w-auto mx-auto rounded-lg object-cover"
          />
          <h1 className="text-lg font-bold text-slate-900">Store QR Not Found</h1>
          <p className="text-sm text-rose-700">{loadError || 'Invalid store code.'}</p>
          <button
            type="button"
            onClick={() => onNavigate('/')}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
          >
            Back to AICE Home
          </button>
        </div>
      </div>
    );
  }

  // NON-ACTIVE STORE GUARD: Show "This store is not accepting orders yet."
  if (!store.accepting_orders) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <header className="bg-purple-950 text-white px-4 py-3.5 border-b border-purple-900">
          <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <img
                src="/assets/aistudio/aice_brands_ice_cream_philippines_inc_cover_9b51f46b.jpg"
                alt="AICE Logo"
                className="h-9 w-16 object-cover rounded border border-purple-700"
              />
              <div>
                <div className="text-xs font-bold tracking-wider uppercase text-amber-300">
                  AICE Store QR Ordering
                </div>
                <div className="text-sm font-bold">{store.store_name}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('/')}
              className="px-3 py-1.5 rounded-lg bg-purple-900 text-purple-100 text-xs font-semibold hover:bg-purple-800"
            >
              AICE Home
            </button>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-4">
          <div
            data-testid="not-accepting-orders-banner"
            className="max-w-lg w-full bg-white border-2 border-amber-300 rounded-2xl p-6 text-center space-y-4 shadow-sm"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-amber-100 text-amber-900 text-xs font-bold uppercase tracking-wider">
              Store Status: {store.status}
            </div>
            <h1 className="text-xl font-bold text-slate-900">{store.store_name}</h1>
            {store.address && (
              <p className="text-xs text-slate-600">
                {store.address}
                {store.landmark ? ` · Landmark: ${store.landmark}` : ''}
              </p>
            )}
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-base font-bold text-amber-950">
              {statusMessage || STORE_NOT_ACCEPTING_ORDERS_MESSAGE}
            </div>
            <p className="text-xs text-slate-500">
              Only active AICE stores that have completed admin approval and freezer onboarding can accept customer QR delivery orders.
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top Mobile-First Store Header */}
      <header className="bg-purple-950 text-white sticky top-0 z-30 border-b border-purple-900 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img
              src="/assets/aistudio/aice_brands_ice_cream_philippines_inc_cover_9b51f46b.jpg"
              alt="AICE"
              className="h-10 w-18 object-cover rounded-md border border-purple-700 shrink-0"
            />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold text-white">
                  {store.store_name}
                </h1>
                <span
                  data-testid="store-open-status-badge"
                  className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase ${
                    store.is_open
                      ? 'bg-emerald-500 text-slate-950'
                      : 'bg-rose-600 text-white'
                  }`}
                >
                  {store.is_open ? 'OPEN FOR DELIVERY' : 'TEMPORARILY CLOSED'}
                </span>
              </div>
              <p className="text-xs text-purple-200">
                {store.address}
                {store.landmark ? ` · Landmark: ${store.landmark}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setShowHistoryPanel((prev) => !prev);
                if (!showHistoryPanel && (user?.role === 'customer' || historyPhone.trim())) {
                  loadOrderHistory();
                }
              }}
              className="px-3 py-1.5 rounded-lg bg-purple-900 hover:bg-purple-800 text-xs font-semibold text-white border border-purple-700"
            >
              {showHistoryPanel ? 'Hide Order History' : 'My Orders / Track'}
            </button>
            {user ? (
              <button
                type="button"
                onClick={() =>
                  onNavigate(
                    user.role === 'customer'
                      ? '/customer/orders'
                      : `/${user.role}/dashboard`
                  )
                }
                className="px-3 py-1.5 rounded-lg bg-amber-400 text-slate-950 text-xs font-bold hover:bg-amber-300"
              >
                {user.role === 'customer' ? 'My Account' : 'Back to Portal'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate('/login')}
                className="px-3 py-1.5 rounded-lg border border-purple-700 text-purple-100 text-xs font-semibold hover:bg-purple-900"
              >
                Customer Sign In
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl w-full mx-auto px-4 py-5 space-y-6 flex-1">
        {/* Order History Lookup / Signed-In Customer Orders Drawer */}
        {showHistoryPanel && (
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  {user?.role === 'customer'
                    ? `Your Customer Order History (${user.full_name})`
                    : 'Look Up Your QR Delivery Orders'}
                </h2>
                <p className="text-xs text-slate-600">
                  {user?.role === 'customer'
                    ? 'Signed-in Customer account order history across AICE stores.'
                    : 'Enter the mobile number you used at checkout to view and track your orders.'}
                </p>
              </div>
              {user?.role !== 'customer' && (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Enter phone (e.g. 0917...)"
                    value={historyPhone}
                    onChange={(e) => setHistoryPhone(e.target.value)}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => loadOrderHistory(historyPhone)}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
                  >
                    Find Orders
                  </button>
                </div>
              )}
            </div>

            {historyLoading ? (
              <p className="text-xs text-slate-500">Loading orders...</p>
            ) : historyOrders.length === 0 ? (
              <p className="text-xs text-slate-500">No matching QR orders found yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {historyOrders.map((ord) => (
                  <div
                    key={ord.id || ord.order_no}
                    className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <span className="font-mono font-bold text-slate-900">{ord.order_no}</span> ·{' '}
                      <strong className="text-slate-800">{ord.store_name}</strong> · PHP{' '}
                      <span className="font-mono font-semibold">
                        {Number(ord.total ?? ord.total_amount ?? 0).toFixed(2)}
                      </span>{' '}
                      · <StatusText status={ord.status} />
                    </div>
                    <button
                      type="button"
                      onClick={() => onNavigate(`/track/${ord.order_no}`)}
                      className="px-3 py-1 rounded-md bg-purple-700 text-white font-semibold hover:bg-purple-800"
                    >
                      Track Live ↗
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Order Confirmation Banner after Checkout */}
        {placedOrder && (
          <div
            data-testid="qr-order-confirmation-card"
            className="bg-emerald-50 border-2 border-emerald-500 rounded-2xl p-5 space-y-4 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                  Order Placed Successfully · Cash on Delivery
                </div>
                <h2
                  data-testid="placed-order-number"
                  className="text-xl font-bold text-slate-900 mt-0.5"
                >
                  Order #{placedOrder.order_no}
                </h2>
                <p className="text-xs text-slate-700 mt-1">
                  <strong>{store.store_name}</strong> has been notified and will confirm your order shortly.
                </p>
              </div>
              <span className="px-3 py-1 rounded-md bg-emerald-700 text-white text-xs font-bold">
                Status: {placedOrder.status}
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-white border border-emerald-200 space-y-2">
              <div className="text-xs font-semibold text-slate-700">
                Save Your Live Tracking Link:
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  readOnly
                  data-testid="placed-order-tracking-url"
                  value={placedOrder.tracking_url}
                  className="flex-1 min-w-[220px] px-3 py-1.5 rounded-lg border border-slate-300 bg-slate-50 font-mono text-xs text-slate-800"
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(placedOrder.tracking_url);
                    setCopiedLink(true);
                    setTimeout(() => setCopiedLink(false), 2500);
                  }}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {copiedLink ? 'Copied!' : 'Copy Link'}
                </button>
                <button
                  type="button"
                  data-testid="open-tracking-page-btn"
                  onClick={() => onNavigate(`/track/${placedOrder.order_no}`)}
                  className="px-4 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800"
                >
                  Open Live Tracking Page →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Store Closed Alert if store.is_open === false */}
        {!store.is_open && (
          <div className="p-4 rounded-xl border border-rose-300 bg-rose-50 text-sm font-semibold text-rose-900">
            This store is currently marked as Closed for walk-in/delivery right now. Please check back when the store opens.
          </div>
        )}

        {/* Main Mobile-First Two-Column Grid: Left = Flavors in Stock, Right = Cart & Cash on Delivery Checkout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT: Store Flavors & Stock Catalog */}
          <div className="lg:col-span-7 space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Available AICE Ice Cream Flavors
                  </h2>
                  <p className="text-xs text-slate-600">
                    Tap to add items to your delivery basket. Quantities are capped at the store's real-time freezer stock.
                  </p>
                </div>
                <input
                  type="text"
                  placeholder="Search flavor..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs w-full sm:w-48"
                />
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                      selectedCategory === cat
                        ? 'bg-purple-800 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {filteredProducts.map((product) => {
                const pid = Number(product.id ?? product.product_id);
                const pName = product.name || product.product_name;
                const pCat = product.category || product.category_name;
                const avail = Math.max(0, Number(product.available_stock || 0));
                const inCartQty = cart[pid] || 0;
                const outOfStock = avail <= 0;

                return (
                  <div
                    key={pid}
                    data-testid={`qr-product-card-${pid}`}
                    className={`bg-white border rounded-xl p-3.5 flex flex-col justify-between gap-3 transition-shadow ${
                      inCartQty > 0
                        ? 'border-purple-600 ring-1 ring-purple-600'
                        : 'border-slate-200'
                    }`}
                  >
                    <div className="space-y-2.5">
                      <ProductImage imageUrl={product.image_url} alt={pName} />
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-bold text-slate-900">{pName}</h3>
                          <span className="font-mono text-sm font-bold text-purple-800 shrink-0">
                            PHP {Number(product.price || 0).toFixed(2)}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600">
                          {product.flavor} · {product.size}
                        </p>
                        <div className="mt-1 flex items-center justify-between text-xs">
                          <span className="text-slate-500">{pCat}</span>
                          <span
                            data-testid={`product-stock-${pid}`}
                            className={`font-mono font-semibold ${
                              outOfStock
                                ? 'text-rose-700'
                                : avail <= 5
                                ? 'text-amber-700'
                                : 'text-emerald-700'
                            }`}
                          >
                            {outOfStock ? 'Out of stock' : `${avail} in stock`}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-100">
                      {outOfStock ? (
                        <button
                          type="button"
                          disabled
                          className="w-full py-2 rounded-lg bg-slate-100 text-slate-400 text-xs font-semibold cursor-not-allowed"
                        >
                          Out of Stock
                        </button>
                      ) : inCartQty === 0 ? (
                        <button
                          type="button"
                          data-testid={`add-to-cart-${pid}`}
                          disabled={!store.is_open}
                          onClick={() => updateCartQuantity(pid, 1)}
                          className="w-full py-2 rounded-lg bg-purple-800 text-white text-xs font-bold hover:bg-purple-900 disabled:opacity-50"
                        >
                          + Add to Order
                        </button>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            data-testid={`dec-cart-${pid}`}
                            onClick={() => updateCartQuantity(pid, inCartQty - 1)}
                            className="w-9 h-8 rounded-lg border border-slate-300 bg-white text-slate-800 font-bold hover:bg-slate-50"
                          >
                            −
                          </button>
                          <span
                            data-testid={`cart-qty-${pid}`}
                            className="font-mono text-xs font-bold text-slate-900"
                          >
                            {inCartQty} / {avail} max
                          </span>
                          <button
                            type="button"
                            data-testid={`inc-cart-${pid}`}
                            disabled={inCartQty >= avail}
                            onClick={() => updateCartQuantity(pid, inCartQty + 1)}
                            className="w-9 h-8 rounded-lg bg-purple-800 text-white font-bold hover:bg-purple-900 disabled:opacity-40"
                          >
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* RIGHT: Cart & Cash on Delivery Checkout Form */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-5 shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Your Delivery Basket ({cartTotalUnits} item{cartTotalUnits === 1 ? '' : 's'})
                  </h2>
                  <p className="text-xs text-slate-500">
                    Direct store delivery from {store.store_name}
                  </p>
                </div>
                {cartItems.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCart({})}
                    className="text-xs font-semibold text-rose-700 hover:underline"
                  >
                    Clear Cart
                  </button>
                )}
              </div>

              {cartItems.length === 0 ? (
                <div className="p-4 rounded-lg bg-slate-50 border border-dashed border-slate-300 text-center text-xs text-slate-500">
                  Your basket is empty. Select AICE flavors on the left to start your delivery order.
                </div>
              ) : (
                <div className="space-y-3">
                  {cartItems.map((item) => (
                    <div
                      key={item.product_id}
                      className="flex items-center justify-between gap-2 text-xs border-b border-slate-100 pb-2.5"
                    >
                      <div className="flex items-center gap-2.5">
                        <ProductImage
                          imageUrl={item.image_url}
                          alt={item.product_name}
                          thumb
                        />
                        <div>
                          <div className="font-bold text-slate-900">{item.product_name}</div>
                          <div className="text-slate-500 font-mono">
                            PHP {item.unit_price.toFixed(2)} × {item.quantity} (max{' '}
                            {item.available_stock})
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-slate-900">
                          PHP {item.subtotal.toFixed(2)}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateCartQuantity(item.product_id, 0)}
                          className="text-rose-600 hover:text-rose-800 font-bold px-1.5"
                          title="Remove item"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}

                  <div className="flex items-center justify-between pt-1 text-sm font-bold text-slate-900">
                    <span>Total Amount Due (COD)</span>
                    <span
                      data-testid="cart-total-amount"
                      className="font-mono text-base text-purple-900"
                    >
                      PHP {cartTotalAmount.toFixed(2)}
                    </span>
                  </div>
                </div>
              )}

              {/* Checkout Form */}
              <form onSubmit={handlePlaceOrder} className="space-y-3.5 pt-2 border-t border-slate-200">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Delivery Details & Cash on Delivery Checkout
                </h3>

                {checkoutError && (
                  <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-xs font-semibold text-rose-800">
                    {checkoutError}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Your Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    name="customer_name"
                    placeholder="e.g. Angela Villanueva"
                    value={checkoutForm.customer_name}
                    onChange={(e) =>
                      setCheckoutForm((prev) => ({
                        ...prev,
                        customer_name: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Contact / Mobile Number *
                  </label>
                  <input
                    type="text"
                    required
                    name="contact_no"
                    placeholder="e.g. 0917-555-0195"
                    value={checkoutForm.contact_no}
                    onChange={(e) =>
                      setCheckoutForm((prev) => ({
                        ...prev,
                        contact_no: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Complete Delivery Address (House/Unit, Street, Barangay) *
                  </label>
                  <input
                    type="text"
                    required
                    name="address"
                    placeholder="e.g. 5120 P. Noval St., Sampaloc, Manila"
                    value={checkoutForm.address}
                    onChange={(e) =>
                      setCheckoutForm((prev) => ({
                        ...prev,
                        address: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Pin Your Delivery Location on the Map
                  </label>
                  <MapPicker
                    lat={checkoutForm.latitude}
                    lng={checkoutForm.longitude}
                    onPick={handleMapPick}
                    height={210}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Delivery Notes / Landmark (Optional)
                  </label>
                  <input
                    type="text"
                    name="notes"
                    placeholder="e.g. Gate beside green bakery, call upon arrival"
                    value={checkoutForm.notes}
                    onChange={(e) =>
                      setCheckoutForm((prev) => ({
                        ...prev,
                        notes: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
                  />
                </div>

                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700">Payment Method</span>
                  <span className="font-bold text-emerald-800">
                    Cash on Delivery (COD Only)
                  </span>
                </div>

                <button
                  type="submit"
                  data-testid="submit-qr-order-btn"
                  disabled={submittingOrder || !store.is_open || cartItems.length === 0}
                  className="w-full py-3 rounded-xl bg-emerald-700 text-white text-sm font-bold hover:bg-emerald-800 disabled:opacity-50"
                >
                  {submittingOrder
                    ? 'Submitting Delivery Order...'
                    : `Place Order · PHP ${cartTotalAmount.toFixed(2)} (Cash on Delivery)`}
                </button>
              </form>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

// ===== 2. PUBLIC CUSTOMER ORDER TRACKING PAGE (/track/:order_no) =====
export const PublicOrderTrackPage: React.FC<{
  orderNo: string;
  onNavigate: (path: string) => void;
}> = ({ orderNo, onNavigate }) => {
  const [order, setOrder] = useState<any | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [liveLocation, setLiveLocation] = useState<{ lat: number; lng: number; recorded_at?: string } | null>(null);
  const [etaMinutes, setEtaMinutes] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const loadOrder = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/qr-orders/track/${encodeURIComponent(orderNo)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || data.error || 'Order not found.');
      } else {
        setOrder(data.order || data.data);
        setItems(Array.isArray(data.items) ? data.items : data.order?.items || []);
        setLiveLocation(data.live_location || null);
        setEtaMinutes(data.eta_minutes ?? null);
        setError('');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load order tracking details.');
    } finally {
      setLoading(false);
    }
  }, [orderNo]);

  useEffect(() => {
    loadOrder();
    const timer = setInterval(loadOrder, 4000);
    return () => clearInterval(timer);
  }, [loadOrder]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-slate-600">
          Loading Live Order Tracker for {orderNo}...
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-rose-200 rounded-xl p-6 text-center space-y-4">
          <h1 className="text-lg font-bold text-slate-900">Order Tracking Not Found</h1>
          <p className="text-sm text-rose-700">{error}</p>
          <button
            type="button"
            onClick={() => onNavigate('/')}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold"
          >
            Return to Home
          </button>
        </div>
      </div>
    );
  }

  const stepIndex = getCustomerOrderTimelineStepIndex(order.status);
  const isCancelled = order.status === 'Cancelled';
  const trackingUrl = `${window.location.origin}/track/${order.order_no}`;
  const deliveryAddr = order.address || order.delivery_address || '';
  const custLat = order.latitude != null ? Number(order.latitude) : null;
  const custLng = order.longitude != null ? Number(order.longitude) : null;
  const riderLat = liveLocation?.lat != null ? Number(liveLocation.lat) : null;
  const riderLng = liveLocation?.lng != null ? Number(liveLocation.lng) : null;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-purple-950 text-white px-4 py-3.5 border-b border-purple-900">
        <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img
              src="/assets/aistudio/aice_brands_ice_cream_philippines_inc_cover_9b51f46b.jpg"
              alt="AICE"
              className="h-9 w-16 object-cover rounded border border-purple-700"
            />
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-amber-300">
                AICE Live Delivery Tracker
              </div>
              <div className="text-sm sm:text-base font-bold font-mono">
                Order #{order.order_no}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {order.store_code && (
              <button
                type="button"
                onClick={() => onNavigate(`/order/${order.store_code}`)}
                className="px-3 py-1.5 rounded-lg bg-purple-900 text-purple-100 text-xs font-semibold hover:bg-purple-800 border border-purple-700"
              >
                ← Back to {order.store_name}
              </button>
            )}
            <button
              type="button"
              onClick={loadOrder}
              className="px-3 py-1.5 rounded-lg bg-amber-400 text-slate-950 text-xs font-bold hover:bg-amber-300"
            >
              Refresh Status
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl w-full mx-auto px-4 py-6 space-y-6 flex-1">
        {/* Saveable Tracking Link Bar */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-bold text-slate-900">
              Bookmark or Copy Your Tracking Link
            </div>
            <div className="text-xs text-slate-500 font-mono break-all">{trackingUrl}</div>
          </div>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(trackingUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            {copied ? 'Link Copied!' : 'Copy Tracking Link'}
          </button>
        </div>

        {/* Status Timeline Card */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-xs uppercase font-bold tracking-wider text-slate-500">
                Current Order Status
              </span>
              <div
                data-testid="tracked-order-status"
                className="text-lg font-bold text-slate-900 mt-0.5"
              >
                {order.status}
              </div>
            </div>
            {order.rider_name && (
              <div
                data-testid="tracked-order-rider"
                className="px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-xs text-indigo-950"
              >
                Assigned Rider: <strong>{order.rider_name}</strong>
                {etaMinutes ? ` · ETA ~${etaMinutes} mins` : ''}
              </div>
            )}
          </div>

          {isCancelled ? (
            <div className="p-4 rounded-lg border border-rose-200 bg-rose-50 text-xs text-rose-900 space-y-1">
              <div className="font-bold">This order was cancelled / rejected by the store.</div>
              {order.rejection_reason && (
                <div>
                  Reason: <strong>{order.rejection_reason}</strong>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 pt-2">
              {CUSTOMER_ORDER_TIMELINE_STEPS.map((step, idx) => {
                const done = stepIndex >= idx;
                const current = stepIndex === idx;
                return (
                  <div
                    key={step}
                    className={`p-3 rounded-lg border text-xs ${
                      current
                        ? 'border-purple-700 bg-purple-50 text-purple-950 font-bold'
                        : done
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-900 font-semibold'
                        : 'border-slate-200 bg-slate-50 text-slate-400'
                    }`}
                  >
                    <div className="font-mono text-[10px] uppercase">
                      Step {idx + 1} {done ? '✓' : ''}
                    </div>
                    <div className="mt-0.5">{step}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Leaflet Live Rider & Store Delivery Map */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Live Store & Delivery Rider Map
              </h2>
              <p className="text-xs text-slate-600">
                Shows {order.store_name}, your pinned delivery address, and the assigned rider's GPS location.
              </p>
            </div>
            {riderLat != null && riderLng != null && (
              <span
                data-testid="tracked-rider-gps"
                className="font-mono text-xs text-rose-700 font-semibold"
              >
                Rider GPS: ({riderLat.toFixed(5)}, {riderLng.toFixed(5)})
              </span>
            )}
          </div>

          <CustomerOrderTrackingMap
            storeName={order.store_name}
            storeLat={Number(order.store_lat || 14.6042)}
            storeLng={Number(order.store_lng || 120.9921)}
            customerLat={custLat}
            customerLng={custLng}
            deliveryAddress={deliveryAddr}
            riderName={order.rider_name}
            riderLat={riderLat}
            riderLng={riderLng}
            height={320}
          />
        </div>

        {/* Order Summary & Items */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs border-b border-slate-100 pb-4">
            <div>
              <span className="text-slate-500 block">Store</span>
              <strong className="text-slate-900 text-sm">{order.store_name}</strong>
              <div className="text-slate-600">{order.store_address}</div>
            </div>
            <div>
              <span className="text-slate-500 block">Customer & Delivery Address</span>
              <strong className="text-slate-900 text-sm">{order.customer_name}</strong>
              <div className="text-slate-600">{deliveryAddr}</div>
            </div>
            <div>
              <span className="text-slate-500 block">Payment Method & Total</span>
              <strong className="text-emerald-800 text-sm">{order.payment_method}</strong>
              <div className="font-mono text-sm font-bold text-slate-900">
                PHP {Number(order.total ?? order.total_amount ?? 0).toFixed(2)}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Ordered Items
            </h3>
            <div className="divide-y divide-slate-100">
              {items.map((it: any) => (
                <div
                  key={it.id}
                  className="py-2.5 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-center gap-3">
                    <ProductImage
                      imageUrl={it.image_url}
                      alt={it.product_name}
                      thumb
                    />
                    <div>
                      <div className="font-bold text-slate-900">{it.product_name}</div>
                      <div className="text-slate-500">
                        {it.flavor} · {it.size} · Qty: <strong>{it.quantity}</strong>
                      </div>
                    </div>
                  </div>
                  <div className="font-mono font-bold text-slate-900">
                    PHP {Number(it.subtotal || 0).toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
