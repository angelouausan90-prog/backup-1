import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import { STORE_NOT_ACCEPTING_ORDERS_MESSAGE } from '../utils/domainRules';
import { ProductImage, StatusText } from './SharedUI';

// ===== REUSABLE STORE QR CODE & PRINTABLE POSTER COMPONENT =====
export const StoreQrPosterCard: React.FC<{
  storeData: any;
  onNavigate?: (path: string) => void;
}> = ({ storeData, onNavigate }) => {
  const [showPosterModal, setShowPosterModal] = useState(false);
  const [downloadedMsg, setDownloadedMsg] = useState(false);

  if (!storeData) return null;

  const acceptingOrders = Boolean(storeData.accepting_orders);
  const orderPath = `/order/${storeData.store_code}`;

  const handleDownloadPng = () => {
    if (!storeData.qr_data_url) return;
    const link = document.createElement('a');
    link.href = storeData.qr_data_url;
    link.download = `AICE-QR-${storeData.store_code || 'store'}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setDownloadedMsg(true);
    setTimeout(() => setDownloadedMsg(false), 3000);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold text-slate-900">{storeData.store_name}</h2>
            <span
              className={`px-2.5 py-0.5 rounded text-xs font-bold ${
                acceptingOrders
                  ? 'bg-emerald-100 text-emerald-900'
                  : 'bg-amber-100 text-amber-900'
              }`}
            >
              Status: {storeData.status}
            </span>
            {acceptingOrders && (
              <span
                className={`px-2.5 py-0.5 rounded text-xs font-bold ${
                  storeData.is_open
                    ? 'bg-emerald-600 text-white'
                    : 'bg-rose-600 text-white'
                }`}
              >
                {storeData.is_open ? 'Store Open' : 'Store Closed'}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-600 mt-1">
            {storeData.address}
            {storeData.landmark ? ` · Landmark: ${storeData.landmark}` : ''}
          </p>
          <p className="text-xs text-slate-500 font-mono mt-0.5">
            Store Code: <strong className="text-slate-800">{storeData.store_code}</strong> ·
            Encoded Public URL:{' '}
            <strong className="text-purple-800">{storeData.order_url}</strong>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onNavigate ? (
            <button
              type="button"
              data-testid="open-public-qr-url-btn"
              onClick={() => onNavigate(orderPath)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-50"
            >
              Open Ordering Page ({orderPath}) ↗
            </button>
          ) : (
            <a
              href={orderPath}
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-50"
            >
              Open Ordering Page ({orderPath}) ↗
            </a>
          )}
        </div>
      </div>

      {!acceptingOrders ? (
        <div
          data-testid="qr-not-accepting-message"
          className="p-6 rounded-xl border-2 border-amber-300 bg-amber-50 text-center space-y-2"
        >
          <div className="text-xs font-bold uppercase tracking-wider text-amber-800">
            QR Code Inactive ({storeData.status})
          </div>
          <div className="text-base font-bold text-amber-950">
            {storeData.message || STORE_NOT_ACCEPTING_ORDERS_MESSAGE}
          </div>
          <p className="text-xs text-amber-900">
            Only Active stores get a working customer ordering QR code. Once equipment delivery and activation are completed, the live QR code will appear here automatically.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
          {/* QR Image Preview */}
          <div className="md:col-span-5 flex flex-col items-center justify-center p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
            <img
              data-testid="store-qr-image"
              src={storeData.qr_data_url}
              alt={`QR Code for ${storeData.store_name}`}
              className="w-56 h-56 rounded-lg border border-slate-300 bg-white p-2 shadow-xs"
            />
            <div className="text-center">
              <div className="text-xs font-bold text-slate-900">Scan to order</div>
              <div className="text-[11px] font-mono text-slate-600 break-all">
                {storeData.order_url}
              </div>
            </div>
          </div>

          {/* QR Actions & Printable Poster Preview */}
          <div className="md:col-span-7 space-y-4">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-slate-900">
                Customer QR Ordering & Store Counter Poster
              </h3>
              <p className="text-xs text-slate-600">
                Print and display this QR poster at your store counter or tarpaulin. Customers scan it with their phone camera to browse flavors in stock and place a Cash on Delivery order.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                data-testid="download-qr-png-btn"
                onClick={handleDownloadPng}
                className="px-4 py-2 rounded-lg bg-purple-800 text-white text-xs font-bold hover:bg-purple-900"
              >
                Download PNG
              </button>
              <button
                type="button"
                data-testid="print-qr-poster-btn"
                onClick={() => setShowPosterModal(true)}
                className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800"
              >
                Print Poster
              </button>
            </div>

            {downloadedMsg && (
              <div
                data-testid="qr-download-success"
                className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-900"
              >
                Downloaded AICE-QR-{storeData.store_code}.png ({storeData.order_url})
              </div>
            )}

            <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
              <div>
                <strong>Public Ordering URL:</strong>{' '}
                <span className="font-mono text-slate-900">{storeData.order_url}</span>
              </div>
              <div>
                <strong>Environment Variable:</strong> Set{' '}
                <code className="font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200 text-slate-900">
                  APP_BASE_URL
                </code>{' '}
                on the server so generated QR codes point to your live deployed domain on customers' phones.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Printable AICE Store Counter Poster Modal */}
      {showPosterModal && acceptingOrders && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/75 flex items-center justify-center p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-2xl max-w-md w-full overflow-hidden shadow-2xl border-2 border-purple-900">
            <div className="bg-purple-950 text-white p-5 text-center space-y-2">
              <img
                src="/assets/aistudio/aice_brands_ice_cream_philippines_inc_cover_9b51f46b.jpg"
                alt="AICE Logo"
                className="h-14 w-auto mx-auto rounded-lg object-cover border border-purple-700"
              />
              <div className="text-xs font-bold uppercase tracking-widest text-amber-300">
                HAVE AN AICE DAY · OFFICIAL FRANCHISEE STORE
              </div>
              <h3 className="text-xl font-extrabold text-white">
                {storeData.store_name}
              </h3>
              <p className="text-xs text-purple-200">{storeData.address}</p>
            </div>

            <div className="p-6 text-center space-y-4 bg-white">
              <div className="inline-block px-4 py-1.5 rounded-md bg-rose-600 text-white text-sm font-extrabold uppercase tracking-wider">
                Scan to order
              </div>
              <div className="flex justify-center">
                <img
                  src={storeData.qr_data_url}
                  alt="Scan to order QR"
                  className="w-60 h-60 border-4 border-purple-900 rounded-xl p-2 bg-white"
                />
              </div>
              <p className="text-xs text-slate-700 font-medium">
                Scan with your phone camera to browse available AICE flavors and order for Cash on Delivery!
              </p>
              <div className="text-[11px] font-mono text-slate-500 break-all">
                {storeData.order_url}
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-100 border-t border-slate-200 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setShowPosterModal(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Close Poster
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="px-4 py-2 rounded-lg bg-purple-800 text-white text-xs font-bold hover:bg-purple-900"
              >
                Print Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ===== 1. FRANCHISEE STORE QR CODE & REAL-TIME STORE INVENTORY VIEW (/franchisee/store-qr) =====
export const FranchiseeStoreQrView: React.FC<{
  onNavigate?: (path: string) => void;
}> = ({ onNavigate }) => {
  const [storeData, setStoreData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editingStocks, setEditingStocks] = useState<Record<number, number>>({});

  const load = useCallback(() => {
    setLoading(true);
    api
      .get('/qr-store/my')
      .then((res) => {
        const payload = res?.store_id ? res : res?.data;
        setStoreData(payload);
        const map: Record<number, number> = {};
        (payload?.inventory || []).forEach((it: any) => {
          const pid = Number(it.product_id ?? it.id);
          map[pid] = Number(it.quantity ?? it.stock_quantity ?? 0);
        });
        setEditingStocks(map);
      })
      .catch((err) => setError(err.message || 'Failed to load Store QR Code.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleOpenStatus = async () => {
    if (!storeData) return;
    setError('');
    setMessage('');
    try {
      const nextOpen = !storeData.is_open;
      await api.patch('/qr-store/my/open-status', { is_open: nextOpen });
      setMessage(
        `Store is now marked as ${nextOpen ? 'OPEN' : 'CLOSED'} for customer QR ordering.`
      );
      load();
    } catch (err: any) {
      setError(err.message || 'Failed to update store open/closed status.');
    }
  };

  const updateProductStock = async (productId: number) => {
    setError('');
    setMessage('');
    try {
      const qty = Math.max(0, Number(editingStocks[productId] ?? 0));
      await api.post('/qr-store/my/stock', {
        product_id: productId,
        quantity: qty,
      });
      setMessage('Store freezer stock updated.');
      load();
    } catch (err: any) {
      setError(err.message || 'Failed to update product stock.');
    }
  };

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-slate-600">
        Loading your Store QR Code & Inventory...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Store QR Code & Freezer Stock</h1>
          <p className="text-sm text-slate-600">
            Download or print your store's unique customer ordering QR code and monitor real-time store inventory.
          </p>
        </div>
        {storeData && storeData.accepting_orders && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleOpenStatus}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold ${
                storeData.is_open
                  ? 'bg-rose-600 text-white hover:bg-rose-700'
                  : 'bg-emerald-700 text-white hover:bg-emerald-800'
              }`}
            >
              {storeData.is_open ? 'Set Store Temporarily Closed' : 'Set Store Open for Orders'}
            </button>
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('/franchisee/qr-orders')}
                className="px-3.5 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800"
              >
                Manage Customer QR Orders →
              </button>
            )}
          </div>
        )}
      </div>

      {message && (
        <div className="p-3.5 rounded-lg border border-emerald-200 bg-emerald-50 text-xs font-semibold text-emerald-900">
          {message}
        </div>
      )}
      {error && (
        <div className="p-3.5 rounded-lg border border-rose-200 bg-rose-50 text-xs font-semibold text-rose-800">
          {error}
        </div>
      )}

      {storeData && <StoreQrPosterCard storeData={storeData} onNavigate={onNavigate} />}

      {/* Real-time Store Freezer Stock Table */}
      {storeData && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Store Freezer Inventory (Auto-Deducted on Delivered QR Orders)
              </h2>
              <p className="text-xs text-slate-600">
                Customer cart quantities on your public QR page are capped by these available stock counts. When a customer QR order is marked Delivered, stock decreases automatically in real time.
              </p>
            </div>
            <button
              type="button"
              onClick={load}
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Refresh Stock
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 font-semibold">
                  <th className="py-2.5 pr-4">Product</th>
                  <th className="py-2.5 pr-4">Flavor / Size</th>
                  <th className="py-2.5 pr-4">Category</th>
                  <th className="py-2.5 pr-4 text-right">Price</th>
                  <th className="py-2.5 pr-4 text-right">Available Store Stock</th>
                  <th className="py-2.5 text-right">Adjust Stock</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(storeData.inventory || []).map((item: any) => {
                  const pid = Number(item.product_id ?? item.id);
                  const pName = item.name || item.product_name;
                  const currentStock = Number(item.quantity ?? item.stock_quantity ?? 0);
                  return (
                    <tr key={pid} className="hover:bg-slate-50">
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-2.5">
                          <ProductImage imageUrl={item.image_url} alt={pName} thumb />
                          <span className="font-bold text-slate-900">{pName}</span>
                        </div>
                      </td>
                      <td className="py-2.5 pr-4 text-slate-600">
                        {item.flavor} · {item.size}
                      </td>
                      <td className="py-2.5 pr-4 text-slate-600">
                        {item.category_name || item.category}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-mono font-semibold text-slate-900">
                        PHP {Number(item.price || 0).toFixed(2)}
                      </td>
                      <td
                        data-testid={`store-inventory-qty-${pid}`}
                        className="py-2.5 pr-4 text-right font-mono text-sm font-bold text-emerald-800"
                      >
                        {currentStock}
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <input
                            type="number"
                            min={0}
                            value={editingStocks[pid] ?? currentStock}
                            onChange={(e) =>
                              setEditingStocks({
                                ...editingStocks,
                                [pid]: Math.max(0, parseInt(e.target.value || '0', 10)),
                              })
                            }
                            className="w-20 px-2 py-1 rounded border border-slate-300 text-right font-mono"
                          />
                          <button
                            type="button"
                            onClick={() => updateProductStock(pid)}
                            className="px-2.5 py-1 rounded bg-slate-900 text-white font-semibold hover:bg-slate-800"
                          >
                            Save
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// ===== 2. FRANCHISEE CUSTOMER QR ORDERS MANAGEMENT VIEW (/franchisee/qr-orders) =====
export const FranchiseeCustomerOrdersView: React.FC<{
  onNavigate?: (path: string) => void;
}> = ({ onNavigate }) => {
  const [orders, setOrders] = useState<any[]>([]);
  const [riders, setRiders] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [selectedRiders, setSelectedRiders] = useState<Record<number, string>>({});
  const [rejectingOrderId, setRejectingOrderId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    const qs =
      statusFilter !== 'ALL' ? `?status=${encodeURIComponent(statusFilter)}` : '';
    api
      .get(`/franchisee/qr-orders${qs}`)
      .then((res) => {
        const list = res.data || [];
        setOrders(list);
        setSelectedRiders((prev) => {
          const next = { ...prev };
          list.forEach((o: any) => {
            if (o.delivery_staff_id && !next[o.id]) {
              next[o.id] = String(o.delivery_staff_id);
            }
          });
          return next;
        });
      })
      .catch((err) => setError(err.message || 'Failed to load customer QR orders.'));

    api
      .get('/franchisee/delivery-riders')
      .then((res) => {
        const riderList = res.data || [];
        setRiders(riderList);
      })
      .catch(() => {});
  }, [statusFilter]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  const handleDecision = async (order: any, decision: 'accept' | 'reject') => {
    setError('');
    setMessage('');
    try {
      const riderIdStr = selectedRiders[order.id] || (riders[0] ? String(riders[0].id) : '');
      const res = await api.post(`/franchisee/qr-orders/${order.id}/decision`, {
        decision,
        reason: decision === 'reject' ? rejectReason.trim() : undefined,
        delivery_staff_id:
          decision === 'accept' && riderIdStr ? Number(riderIdStr) : undefined,
      });
      setMessage(res.message || `Order ${order.order_no} updated.`);
      setRejectingOrderId(null);
      setRejectReason('');
      load();
    } catch (err: any) {
      setError(err.message || 'Failed to process order decision.');
    }
  };

  const handleAssignRider = async (order: any) => {
    setError('');
    setMessage('');
    const riderIdStr = selectedRiders[order.id] || (riders[0] ? String(riders[0].id) : '');
    if (!riderIdStr) {
      setError('Please select a Delivery Staff rider first.');
      return;
    }
    try {
      const res = await api.post(`/franchisee/qr-orders/${order.id}/assign-rider`, {
        delivery_staff_id: Number(riderIdStr),
      });
      setMessage(res.message || `Rider assigned to ${order.order_no}.`);
      load();
    } catch (err: any) {
      setError(err.message || 'Failed to assign rider.');
    }
  };

  const handleUpdateStatus = async (order: any, nextStatus: string) => {
    setError('');
    setMessage('');
    try {
      const res = await api.patch(`/franchisee/qr-orders/${order.id}/status`, {
        status: nextStatus,
      });
      setMessage(res.message || `Order ${order.order_no} marked as ${nextStatus}.`);
      load();
    } catch (err: any) {
      setError(err.message || 'Failed to update order status.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Customer QR Delivery Orders
          </h1>
          <p className="text-sm text-slate-600">
            Accept or reject incoming customer QR orders, assign a Delivery Staff rider, and track fulfillment. Marking an order Delivered automatically deducts items from your store inventory.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('/franchisee/store-qr')}
              className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              View Store QR & Inventory
            </button>
          )}
          <button
            type="button"
            onClick={load}
            className="px-3.5 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800"
          >
            Refresh Orders
          </button>
        </div>
      </div>

      {message && (
        <div className="p-3.5 rounded-lg border border-emerald-200 bg-emerald-50 text-xs font-semibold text-emerald-900">
          {message}
        </div>
      )}
      {error && (
        <div className="p-3.5 rounded-lg border border-rose-200 bg-rose-50 text-xs font-semibold text-rose-800">
          {error}
        </div>
      )}

      {/* Status Filter Bar */}
      <div className="flex flex-wrap items-center gap-1.5">
        {[
          'ALL',
          'Placed',
          'Accepted by store',
          'Preparing',
          'Out for Delivery',
          'Delivered',
          'Cancelled',
        ].map((st) => (
          <button
            key={st}
            type="button"
            onClick={() => setStatusFilter(st)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
              statusFilter === st
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {st}
          </button>
        ))}
      </div>

      {orders.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-slate-500">
          No customer QR orders matching "{statusFilter}".
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((ord) => {
            const selectedRiderId =
              selectedRiders[ord.id] ||
              (ord.delivery_staff_id
                ? String(ord.delivery_staff_id)
                : riders[0]
                ? String(riders[0].id)
                : '');

            return (
              <div
                key={ord.id}
                data-testid={`franchisee-qr-order-${ord.order_no}`}
                className={`bg-white border-2 rounded-xl p-5 space-y-4 ${
                  ord.status === 'Placed'
                    ? 'border-amber-400 shadow-xs'
                    : 'border-slate-200'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-bold text-slate-900">
                        {ord.order_no}
                      </span>
                      <span className="text-slate-400">·</span>
                      <StatusText status={ord.status} />
                      <span className="text-slate-400">·</span>
                      <span className="font-mono text-sm font-bold text-purple-900">
                        PHP {Number(ord.total ?? ord.total_amount ?? 0).toFixed(2)} (
                        {ord.payment_method})
                      </span>
                      {Boolean(ord.stock_deducted) && (
                        <span
                          data-testid={`stock-deducted-badge-${ord.order_no}`}
                          className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 text-[11px] font-bold"
                        >
                          Stock Deducted ✓
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-700">
                      Customer: <strong>{ord.customer_name}</strong> · Phone:{' '}
                      <strong className="font-mono">
                        {ord.contact_no || ord.customer_contact}
                      </strong>
                    </div>
                    <div className="text-xs text-slate-700">
                      Delivery Address:{' '}
                      <strong>{ord.address || ord.delivery_address}</strong>
                      {ord.notes ? ` · Notes: "${ord.notes}"` : ''}
                    </div>
                    {ord.rider_name && (
                      <div className="text-xs text-indigo-800 font-semibold">
                        Assigned Delivery Rider: {ord.rider_name}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {onNavigate ? (
                      <button
                        type="button"
                        data-testid={`view-tracking-btn-${ord.order_no}`}
                        onClick={() => onNavigate(`/track/${ord.order_no}`)}
                        className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Customer Tracking Page ↗
                      </button>
                    ) : (
                      <a
                        href={`/track/${ord.order_no}`}
                        className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Customer Tracking Page ↗
                      </a>
                    )}
                  </div>
                </div>

                {/* Ordered Items List */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-3 border-t border-slate-100">
                  {(ord.items || []).map((it: any) => (
                    <div
                      key={it.id}
                      className="flex items-center gap-2.5 p-2 rounded-lg bg-slate-50 border border-slate-100 text-xs"
                    >
                      <ProductImage
                        imageUrl={it.image_url}
                        alt={it.product_name}
                        thumb
                      />
                      <div>
                        <div className="font-bold text-slate-900">{it.product_name}</div>
                        <div className="text-slate-600 font-mono">
                          Qty: <strong>{it.quantity}</strong> × PHP{' '}
                          {Number(it.unit_price).toFixed(2)} = PHP{' '}
                          {Number(it.subtotal).toFixed(2)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Actions Footer for Placed or Active Orders */}
                {ord.status !== 'Delivered' && ord.status !== 'Cancelled' && (
                  <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
                    {/* Rider selector */}
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="text-xs font-semibold text-slate-700">
                        Delivery Staff Rider:
                      </label>
                      <select
                        data-testid={`rider-select-${ord.order_no}`}
                        value={selectedRiderId}
                        onChange={(e) =>
                          setSelectedRiders({
                            ...selectedRiders,
                            [ord.id]: e.target.value,
                          })
                        }
                        className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
                      >
                        {riders.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.full_name} (@{r.username})
                          </option>
                        ))}
                      </select>
                      {ord.status !== 'Placed' && (
                        <button
                          type="button"
                          data-testid={`assign-rider-btn-${ord.order_no}`}
                          onClick={() => handleAssignRider(ord)}
                          className="px-3 py-1.5 rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-900 text-xs font-semibold hover:bg-indigo-100"
                        >
                          Assign / Update Rider
                        </button>
                      )}
                    </div>

                    {/* Accept / Reject or Status Advancement Buttons */}
                    {ord.status === 'Placed' ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          data-testid={`accept-qr-order-btn-${ord.order_no}`}
                          onClick={() => handleDecision(ord, 'accept')}
                          className="px-4 py-2 rounded-lg bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800"
                        >
                          Accept Order & Assign Rider
                        </button>
                        <button
                          type="button"
                          data-testid={`reject-qr-order-btn-${ord.order_no}`}
                          onClick={() =>
                            setRejectingOrderId(
                              rejectingOrderId === ord.id ? null : ord.id
                            )
                          }
                          className="px-3.5 py-2 rounded-lg border border-rose-300 bg-rose-50 text-rose-800 text-xs font-bold hover:bg-rose-100"
                        >
                          Reject with Reason
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        {['Preparing', 'Out for Delivery', 'Delivered'].map((st) => (
                          <button
                            key={st}
                            type="button"
                            data-testid={`mark-status-${st
                              .toLowerCase()
                              .replace(/\s+/g, '-')}-${ord.order_no}`}
                            onClick={() => handleUpdateStatus(ord, st)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                              st === 'Delivered'
                                ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                                : 'bg-slate-900 text-white hover:bg-slate-800'
                            }`}
                          >
                            Mark {st}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Inline Rejection Reason Input */}
                {rejectingOrderId === ord.id && (
                  <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      placeholder="Enter reason for rejecting this order (e.g. Delivery address out of range)"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      className="flex-1 min-w-[220px] px-3 py-1.5 rounded-lg border border-rose-300 bg-white text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => handleDecision(ord, 'reject')}
                      className="px-3.5 py-1.5 rounded-lg bg-rose-700 text-white text-xs font-bold hover:bg-rose-800"
                    >
                      Confirm Reject
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ===== 3. ADMIN STORE QR CODES & CUSTOMER ORDERS VIEW (/admin/qr-orders) =====
export const AdminQrOrdersAndStoresView: React.FC<{
  onNavigate?: (path: string) => void;
}> = ({ onNavigate }) => {
  const [stores, setStores] = useState<any[]>([]);
  const [selectedStore, setSelectedStore] = useState<any | null>(null);
  const [qrOrders, setQrOrders] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'stores' | 'orders'>('stores');
  const [loadingStore, setLoadingStore] = useState(false);
  const [error, setError] = useState('');

  const inspectStoreQr = useCallback(async (storeId: number) => {
    setLoadingStore(true);
    setError('');
    try {
      const res = await api.get(`/admin/qr-stores/${storeId}`);
      setSelectedStore(res?.store_id ? res : res?.data);
    } catch (err: any) {
      setError(err.message || 'Failed to load store QR details.');
    } finally {
      setLoadingStore(false);
    }
  }, []);

  const loadAll = useCallback(() => {
    api
      .get('/admin/qr-stores')
      .then((res) => {
        const list = res.data || [];
        setStores(list);
        if (list.length > 0 && !selectedStore) {
          const firstId = Number(list[0].store_id ?? list[0].franchisee_id);
          if (firstId) inspectStoreQr(firstId);
        }
      })
      .catch((err) => setError(err.message || 'Failed to load stores.'));

    api
      .get('/admin/qr-orders')
      .then((res) => setQrOrders(res.data || []))
      .catch(() => {});
  }, [inspectStoreQr, selectedStore]);

  useEffect(() => {
    loadAll();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Store QR Codes & Customer QR Orders
          </h1>
          <p className="text-sm text-slate-600">
            Inspect or print any franchisee store's unique QR code and monitor customer QR delivery orders across all branches.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('stores')}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold ${
              activeTab === 'stores'
                ? 'bg-slate-900 text-white'
                : 'border border-slate-300 bg-white text-slate-700'
            }`}
          >
            Store QR Codes ({stores.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('orders')}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold ${
              activeTab === 'orders'
                ? 'bg-slate-900 text-white'
                : 'border border-slate-300 bg-white text-slate-700'
            }`}
          >
            All Customer QR Orders ({qrOrders.length})
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg border border-rose-200 bg-rose-50 text-xs font-semibold text-rose-800">
          {error}
        </div>
      )}

      {activeTab === 'stores' ? (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="text-base font-bold text-slate-900 mb-3">
              Select a Franchisee Store to Inspect QR Code
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 font-semibold">
                    <th className="py-2.5 pr-4">Store Name</th>
                    <th className="py-2.5 pr-4">Owner</th>
                    <th className="py-2.5 pr-4">Store Code</th>
                    <th className="py-2.5 pr-4">Onboarding Status</th>
                    <th className="py-2.5 pr-4">QR Ordering</th>
                    <th className="py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stores.map((st) => {
                    const sid = Number(st.store_id ?? st.franchisee_id);
                    const isSelected =
                      Number(selectedStore?.store_id ?? selectedStore?.franchisee_id) === sid;
                    return (
                      <tr
                        key={sid}
                        className={`hover:bg-slate-50 ${
                          isSelected ? 'bg-purple-50/60' : ''
                        }`}
                      >
                        <td className="py-2.5 pr-4 font-bold text-slate-900">
                          {st.store_name}
                        </td>
                        <td className="py-2.5 pr-4 text-slate-700">{st.owner_name}</td>
                        <td className="py-2.5 pr-4 font-mono text-slate-800">
                          {st.store_code}
                        </td>
                        <td className="py-2.5 pr-4">
                          <StatusText status={st.status} />
                        </td>
                        <td className="py-2.5 pr-4">
                          {st.accepting_orders ? (
                            <span className="text-emerald-700 font-bold">
                              Active QR ({st.is_open ? 'Open' : 'Closed'})
                            </span>
                          ) : (
                            <span className="text-amber-700 font-semibold">
                              Not accepting orders yet
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 text-right">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              data-testid={`admin-view-store-qr-${st.store_code}`}
                              onClick={() => inspectStoreQr(sid)}
                              className="px-3 py-1 rounded-md bg-slate-900 text-white font-semibold hover:bg-slate-800"
                            >
                              View QR Code
                            </button>
                            {onNavigate && (
                              <button
                                type="button"
                                onClick={() => onNavigate(`/order/${st.store_code}`)}
                                className="px-2.5 py-1 rounded-md border border-slate-300 bg-white text-slate-700 font-semibold hover:bg-slate-50"
                              >
                                Open URL ↗
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {loadingStore ? (
            <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-slate-600">
              Loading store QR details...
            </div>
          ) : (
            selectedStore && (
              <StoreQrPosterCard storeData={selectedStore} onNavigate={onNavigate} />
            )
          )}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 font-semibold">
                  <th className="py-2.5 pr-4">Order #</th>
                  <th className="py-2.5 pr-4">Store</th>
                  <th className="py-2.5 pr-4">Customer</th>
                  <th className="py-2.5 pr-4">Delivery Address</th>
                  <th className="py-2.5 pr-4">Rider</th>
                  <th className="py-2.5 pr-4 text-right">Total (COD)</th>
                  <th className="py-2.5 pr-4">Status</th>
                  <th className="py-2.5 text-right">Track</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {qrOrders.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="py-2.5 pr-4 font-mono font-bold text-slate-900">
                      {o.order_no}
                    </td>
                    <td className="py-2.5 pr-4 font-semibold text-slate-900">
                      {o.store_name}
                    </td>
                    <td className="py-2.5 pr-4">
                      <div className="font-semibold text-slate-900">{o.customer_name}</div>
                      <div className="font-mono text-slate-500">
                        {o.contact_no || o.customer_contact}
                      </div>
                    </td>
                    <td className="py-2.5 pr-4 text-slate-600">
                      {o.address || o.delivery_address}
                    </td>
                    <td className="py-2.5 pr-4 text-slate-700">{o.rider_name || '—'}</td>
                    <td className="py-2.5 pr-4 text-right font-mono font-bold text-slate-900">
                      PHP {Number(o.total ?? o.total_amount ?? 0).toFixed(2)}
                    </td>
                    <td className="py-2.5 pr-4">
                      <StatusText status={o.status} />
                    </td>
                    <td className="py-2.5 text-right">
                      {onNavigate ? (
                        <button
                          type="button"
                          onClick={() => onNavigate(`/track/${o.order_no}`)}
                          className="px-2.5 py-1 rounded bg-purple-700 text-white font-semibold hover:bg-purple-800"
                        >
                          Track ↗
                        </button>
                      ) : (
                        <a
                          href={`/track/${o.order_no}`}
                          className="px-2.5 py-1 rounded bg-purple-700 text-white font-semibold hover:bg-purple-800"
                        >
                          Track ↗
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// ===== 4. SIGNED-IN CUSTOMER ROLE ORDER HISTORY VIEW (/customer/orders) =====
export const CustomerOrdersDashboardView: React.FC<{
  onNavigate: (path: string) => void;
}> = ({ onNavigate }) => {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/customer/orders')
      .then((res) => setOrders(res.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">My AICE QR Delivery Orders</h1>
          <p className="text-sm text-slate-600">
            View your past and active QR delivery orders and open live rider tracking.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('/order/sampaloc-a8f3k9m2')}
          className="px-4 py-2 rounded-lg bg-purple-800 text-white text-xs font-bold hover:bg-purple-900"
        >
          Order from AICE Sampaloc Corner Store →
        </button>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-slate-500">
          Loading your orders...
        </div>
      ) : orders.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-slate-500">
          You have not placed any QR orders yet. Scan a store QR code to place your first order!
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((ord) => (
            <div
              key={ord.id}
              className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-bold text-slate-900">
                    {ord.order_no}
                  </span>
                  <span className="text-slate-400">·</span>
                  <strong className="text-sm text-slate-900">{ord.store_name}</strong>
                  <span className="text-slate-400">·</span>
                  <StatusText status={ord.status} />
                </div>
                <div className="text-xs text-slate-600">
                  Delivery Address: {ord.address || ord.delivery_address} · Payment:{' '}
                  {ord.payment_method}
                </div>
                <div className="text-xs font-mono font-bold text-purple-900">
                  Total: PHP {Number(ord.total ?? ord.total_amount ?? 0).toFixed(2)}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {ord.store_code && (
                  <button
                    type="button"
                    onClick={() => onNavigate(`/order/${ord.store_code}`)}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Order Again
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onNavigate(`/track/${ord.order_no}`)}
                  className="px-4 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800"
                >
                  Track Live Map ↗
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
