import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { MapPicker } from '../../components/MapPicker';
import { PaginationBar, ProductImage, StatusText, StockStatusBadge } from '../../components/SharedUI';
import { Warehouse } from '../../types';
import { resolveKnownLocationCoords } from '../../utils/domainRules';
import {
  FranchiseePaperFormModal,
  ApplicationStatusBadge,
  ApplicationWorkflowTimeline,
  downloadApplicationPdf,
} from '../../components/FranchiseePaperFormModal';
import { AdminQrPosterCard } from '../../components/FranchiseeQrSection';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

// ===== 1. ADMIN DASHBOARD =====
export const AdminDashboard: React.FC<{
  onNavigate: (path: string) => void;
  onOpenRestock?: (requestId?: number | null) => void;
}> = ({ onNavigate, onOpenRestock }) => {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [publicSettings, setPublicSettings] = useState({
    contact_email: '',
    contact_phone: '',
    show_public_prices: false,
  });
  const [approvedStores, setApprovedStores] = useState<
    { id: number; store_name: string; application_no?: string | null }[]
  >([]);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState('');

  useEffect(() => {
    api
      .get('/admin/dashboard')
      .then((res) => setData(res))
      .catch((err) => setError(err.message || 'Failed to load dashboard.'));
    api
      .get('/admin/settings')
      .then((res) => {
        if (res) {
          setPublicSettings({
            contact_email: res.contact_email || '',
            contact_phone: res.contact_phone || '',
            show_public_prices: Boolean(res.show_public_prices),
          });
        }
      })
      .catch(() => {});
    api
      .get('/franchisee-applications?limit=100')
      .then((res) => {
        const list = Array.isArray(res?.data) ? res.data : [];
        setApprovedStores(
          list
            .filter((r: any) => r.status !== 'Rejected')
            .map((r: any) => ({
              id: Number(r.franchisee_id || r.id),
              store_name: String(r.store_name || ''),
              application_no: r.application_no || null,
            }))
        );
      })
      .catch(() => {});
  }, []);

  const handleSavePublicSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsSaving(true);
    setSettingsMessage('');
    try {
      const res = await api.put('/admin/settings', publicSettings);
      setPublicSettings({
        contact_email: res.contact_email || publicSettings.contact_email,
        contact_phone: res.contact_phone || publicSettings.contact_phone,
        show_public_prices: Boolean(res.show_public_prices),
      });
      setSettingsMessage('Public landing page settings updated.');
    } catch (err: any) {
      setSettingsMessage(err.message || 'Failed to save settings.');
    } finally {
      setSettingsSaving(false);
    }
  };

  if (error) {
    return (
      <div className="p-4 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-800">
        {error}
      </div>
    );
  }
  if (!data) {
    return <div className="text-sm text-slate-500">Loading dashboard metrics...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Franchise Network Overview</h1>
          <p className="text-sm text-slate-600">
            Real-time replenishment order volume, warehouse stock alerts, and franchisee onboarding status.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('/admin/orders')}
          className="px-4 py-2 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 whitespace-nowrap shrink-0"
        >
          Manage Replenishment Orders
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">Confirmed Network Sales</div>
          <div className="mt-1 text-2xl font-bold text-slate-900 font-mono tabular-nums">
            PHP {Number(data.orders.total_sales || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {data.orders.total_orders || 0} total orders · {data.orders.delivered_orders || 0} delivered
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">Orders Awaiting Confirmation</div>
          <div className="mt-1 text-2xl font-bold text-rose-700 font-mono tabular-nums">
            {data.orders.pending_orders || 0}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {data.orders.in_transit || 0} currently in transit
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">Franchisee Stores</div>
          <div className="mt-1 text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {data.franchisees.approved || 0} Approved
          </div>
          <div className="mt-1 text-xs text-amber-700 font-medium">
            {data.franchisees.pending || 0} pending review · {data.franchisees.rejected || 0} rejected
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">Warehouse Restock Alerts</div>
          <div className="mt-1 flex items-baseline gap-2.5 font-mono tabular-nums">
            <span className="text-2xl font-bold text-rose-700">{data.noStockCount || 0}</span>
            <span className="text-xs font-semibold text-rose-700">No Stock</span>
            <span className="text-2xl font-bold text-orange-600">
              {data.lowStockOnlyCount ?? Math.max(0, (data.lowStockCount || 0) - (data.noStockCount || 0))}
            </span>
            <span className="text-xs font-semibold text-orange-700">Low Stock</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className="text-slate-500">
              {data.restockSummary?.pending_drafts ?? data.restockSummary?.draft_count ?? 0} draft ·{' '}
              {data.restockSummary?.in_transit ?? data.restockSummary?.in_transit_count ?? 0} in transit
            </span>
            <button
              type="button"
              onClick={() => onNavigate('/admin/restocking')}
              className="font-semibold text-rose-700 hover:underline"
            >
              Restock →
            </button>
          </div>
        </div>
      </div>

      {/* Restock Recommendations Section (No Stock First) */}
      <div
        data-testid="dashboard-restock-recommendations"
        className="bg-white border border-slate-200 rounded-lg p-5 space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Restock Recommendations</h2>
            <p className="text-xs text-slate-500">
              Low Stock and No Stock warehouse items prioritized with No Stock first.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/admin/restocking')}
            className="text-xs font-semibold text-rose-700 hover:underline whitespace-nowrap shrink-0"
          >
            Open Warehouse Restocking
          </button>
        </div>

        {!Array.isArray(data.restockRecommendations) || data.restockRecommendations.length === 0 ? (
          <p className="text-sm text-emerald-700">
            All warehouse products are currently In Stock above their reorder points.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200 font-semibold text-slate-500">
                  <th className="py-2 pr-3">Product</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3 text-right">Available Stock</th>
                  <th className="py-2 pr-3 text-right">Recommended Qty</th>
                  <th className="py-2 pr-3">Guidance</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.restockRecommendations.map((rec: any) => (
                  <tr
                    key={`${rec.warehouse_id}-${rec.product_id}`}
                    className={
                      rec.stock_status === 'No Stock'
                        ? 'bg-rose-50/40 hover:bg-rose-50/70'
                        : 'hover:bg-slate-50'
                    }
                  >
                    <td className="py-2.5 pr-3">
                      <div className="font-semibold text-slate-900">
                        {rec.product_name || rec.name}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {rec.warehouse_name} · <span className="font-mono">{rec.sku}</span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3">
                      <StockStatusBadge status={rec.stock_status} />
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {rec.available_stock}
                      <span className="text-[10px] font-normal text-slate-500">
                        {' '}
                        / RP {rec.reorder_point}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono tabular-nums font-bold text-slate-900">
                      {rec.suggested_qty}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={`font-semibold ${
                          rec.stock_status === 'No Stock' ? 'text-rose-700' : 'text-orange-700'
                        }`}
                      >
                        {rec.recommendation_label}
                      </span>
                    </td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          onOpenRestock
                            ? onOpenRestock(
                                rec.active_restock?.id ?? rec.active_restock?.request_id ?? null
                              )
                            : onNavigate('/admin/restocking')
                        }
                        className={`px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap ${
                          rec.stock_status === 'No Stock'
                            ? 'bg-rose-600 text-white hover:bg-rose-700'
                            : 'bg-slate-900 text-white hover:bg-slate-800'
                        }`}
                      >
                        {rec.active_restock?.status === 'Draft'
                          ? `Open Draft (${rec.active_restock.request_number})`
                          : rec.active_restock?.status === 'Approved/In Transit'
                          ? `View In Transit (${rec.active_restock.request_number})`
                          : `Open Restocking`}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-slate-900">Recent Replenishment Orders</h2>
          <button
            type="button"
            onClick={() => onNavigate('/admin/orders')}
            className="text-xs font-semibold text-rose-700 hover:underline whitespace-nowrap shrink-0"
          >
            View All Orders
          </button>
        </div>

        {data.recentOrders.length === 0 ? (
          <p className="text-sm text-slate-500">No replenishment orders placed yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                  <th className="py-2.5 pr-4">Order Number</th>
                  <th className="py-2.5 pr-4">Franchisee Store</th>
                  <th className="py-2.5 pr-4">Status</th>
                  <th className="py-2.5 pr-4 text-right">Amount</th>
                  <th className="py-2.5 text-right">Placed At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.recentOrders.map((o: any) => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="py-2.5 pr-4 font-mono text-xs font-semibold text-slate-900">
                      {o.order_number}
                    </td>
                    <td className="py-2.5 pr-4 text-slate-800">{o.store_name}</td>
                    <td className="py-2.5 pr-4">
                      <StatusText status={o.status} />
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono text-xs text-slate-900">
                      PHP {Number(o.total_amount).toFixed(2)}
                    </td>
                    <td className="py-2.5 text-right font-mono text-xs text-slate-500">
                      {o.created_at}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Public Landing Page Settings (Editable by Admin) */}
      <form
        onSubmit={handleSavePublicSettings}
        className="bg-white border border-slate-200 rounded-lg p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Public Landing Page Settings
            </h2>
            <p className="text-xs text-slate-600">
              Configure the franchise inquiry contact details and whether product prices are shown on the public catalog at <span className="font-mono">/</span>.
            </p>
          </div>
          {settingsMessage && (
            <span className="text-xs font-semibold text-emerald-700">
              {settingsMessage}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <label
              htmlFor="public-contact-email"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Franchise Inquiry Email
            </label>
            <input
              id="public-contact-email"
              type="email"
              required
              value={publicSettings.contact_email}
              onChange={(e) =>
                setPublicSettings((prev) => ({
                  ...prev,
                  contact_email: e.target.value,
                }))
              }
              className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-sm"
            />
          </div>

          <div>
            <label
              htmlFor="public-contact-phone"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Franchise Inquiry Phone
            </label>
            <input
              id="public-contact-phone"
              type="text"
              required
              value={publicSettings.contact_phone}
              onChange={(e) =>
                setPublicSettings((prev) => ({
                  ...prev,
                  contact_phone: e.target.value,
                }))
              }
              className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-sm"
            />
          </div>

          <div className="flex items-center justify-between gap-3 pt-2">
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={publicSettings.show_public_prices}
                onChange={(e) =>
                  setPublicSettings((prev) => ({
                    ...prev,
                    show_public_prices: e.target.checked,
                  }))
                }
                className="w-4 h-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
              />
              <span>Show prices on public catalog</span>
            </label>
            <button
              type="submit"
              disabled={settingsSaving}
              className="px-4 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {settingsSaving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
      </form>

      {/* Admin-only Franchisee Ordering QR Download & Poster Print Card */}
      <AdminQrPosterCard stores={approvedStores} />
    </div>
  );
};

// ===== 2. WAREHOUSE SETUP & MANAGEMENT =====
export const WarehouseSetupView: React.FC<{
  hasWarehouse: boolean;
  onWarehouseSaved: () => Promise<void>;
}> = ({ hasWarehouse, onWarehouseSaved }) => {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [form, setForm] = useState({
    name: '',
    address: '',
    contact_person: '',
    contact_number: '',
    lat: null as number | null,
    lng: null as number | null,
  });
  const [autoPinStatus, setAutoPinStatus] = useState<string>('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => {
    api.get('/warehouses').then((res) => setWarehouses(res.data));
  };

  useEffect(() => {
    load();
  }, []);

  // Automatically pin location on the map when Admin enters a warehouse address
  useEffect(() => {
    const query = form.address.trim();
    if (query.length < 3) {
      setAutoPinStatus('');
      return;
    }

    // 1. Instant local dictionary match for common Philippine / Cotabato locations
    const localMatch = resolveKnownLocationCoords(query);
    if (localMatch) {
      setForm((prev) => ({ ...prev, lat: localMatch.lat, lng: localMatch.lng }));
      setAutoPinStatus(`Auto-pinned on map: ${localMatch.label} (${localMatch.lat}, ${localMatch.lng})`);
    }

    // 2. Debounced OpenStreetMap Nominatim lookup for exact street/city geocoding
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`,
          { signal: controller.signal }
        );
        if (!res.ok) return;
        const results = await res.json();
        if (Array.isArray(results) && results.length > 0 && results[0].lat && results[0].lon) {
          const lat = Number(parseFloat(results[0].lat).toFixed(7));
          const lng = Number(parseFloat(results[0].lon).toFixed(7));
          setForm((prev) => ({ ...prev, lat, lng }));
          setAutoPinStatus(`Auto-pinned on map from address (${lat}, ${lng})`);
        }
      } catch {
        // Keep instant local match or manual map pin if network geocoder is unavailable
      }
    }, 550);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [form.address]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    if (form.lat === null || form.lng === null) {
      setError('Please enter a recognizable location or click on the map to pin the warehouse coordinates.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/warehouses', form);
      setMessage('Warehouse registered! All ordering, inventory, and delivery features are now unlocked.');
      setForm({
        name: '',
        address: '',
        contact_person: '',
        contact_number: '',
        lat: null,
        lng: null,
      });
      setAutoPinStatus('');
      load();
      await onWarehouseSaved();
    } catch (err: any) {
      setError(err.message || 'Failed to register warehouse.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Warehouse Setup & Origins</h1>
        <p className="text-sm text-slate-600">
          Every replenishment order and delivery originates from an active AICE distribution warehouse.
        </p>
      </div>

      {!hasWarehouse && (
        <div className="p-4 rounded-lg border border-amber-300 bg-amber-50 text-sm text-amber-900">
          <strong className="font-semibold">First-Run Lock Active:</strong> The system is locked until you register at least one Warehouse below (name, address, contact person, and map pin). No ordering, inventory, or delivery features work until this step is completed.
        </div>
      )}

      {message && (
        <div className="p-4 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-900">
          {message}
        </div>
      )}
      {error && (
        <div className="p-4 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <form
          onSubmit={handleSubmit}
          className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 space-y-4"
        >
          <h2 className="text-base font-semibold text-slate-900">Register Distribution Warehouse</h2>

          <div>
            <label htmlFor="wh-name" className="block text-xs font-semibold text-slate-700 mb-1">
              Warehouse Name
            </label>
            <input
              id="wh-name"
              type="text"
              required
              placeholder="Enter warehouse name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-rose-600"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="wh-address" className="block text-xs font-semibold text-slate-700">
                Full Street Address
              </label>
              <span className="text-[11px] text-slate-500">Auto-pins map location</span>
            </div>
            <input
              id="wh-address"
              type="text"
              required
              placeholder="Street, barangay, city or municipality"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-rose-600"
            />
            {autoPinStatus && (
              <p className="mt-1.5 text-xs font-medium text-emerald-700">{autoPinStatus}</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="wh-person" className="block text-xs font-semibold text-slate-700 mb-1">
                Contact Person
              </label>
              <input
                id="wh-person"
                type="text"
                required
                placeholder="Enter contact person full name"
                value={form.contact_person}
                onChange={(e) => setForm({ ...form, contact_person: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-rose-600"
              />
            </div>
            <div>
              <label htmlFor="wh-phone" className="block text-xs font-semibold text-slate-700 mb-1">
                Contact Number
              </label>
              <input
                id="wh-phone"
                type="text"
                required
                placeholder="09XXXXXXXXX"
                value={form.contact_number}
                onChange={(e) => setForm({ ...form, contact_number: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-rose-600"
              />
            </div>
          </div>

          <div>
            <span className="block text-xs font-semibold text-slate-700 mb-1">
              Pin Warehouse Location on Map
            </span>
            <MapPicker
              lat={form.lat}
              lng={form.lng}
              onPick={(lat, lng) => setForm({ ...form, lat, lng })}
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full py-2.5 px-4 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-50"
          >
            {saving ? 'Registering Warehouse...' : 'Register Warehouse'}
          </button>
        </form>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5">
          <h2 className="text-base font-semibold text-slate-900 mb-3">
            Registered Warehouses ({warehouses.length})
          </h2>
          {warehouses.length === 0 ? (
            <p className="text-sm text-slate-500">
              No warehouses registered yet. Add your primary warehouse on the left to unlock the platform.
            </p>
          ) : (
            <div className="divide-y divide-slate-200">
              {warehouses.map((w) => (
                <div key={w.id} className="py-3 first:pt-0 last:pb-0 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-900">{w.name}</span>
                    <StatusText status={w.is_active ? 'Active' : 'Inactive'} />
                  </div>
                  <p className="text-xs text-slate-600">{w.address}</p>
                  <p className="text-xs text-slate-500">
                    {w.contact_person} · <span className="font-mono">{w.contact_number}</span> ·{' '}
                    <span className="font-mono">
                      ({w.lat}, {w.lng})
                    </span>
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ===== 3. AGENT ACCOUNTS (Admin creates agent accounts, one-time temp password, reset, deactivate) =====
export const AgentsManagementView: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [form, setForm] = useState({
    full_name: '',
    contact_number: '',
    email: '',
    username: '',
  });
  const [issuedCredentials, setIssuedCredentials] = useState<{
    username: string;
    password: string;
    context: string;
  } | null>(null);
  const [error, setError] = useState('');

  const load = (page = 1) => {
    api
      .get(
        `/admin/agents?page=${page}&search=${encodeURIComponent(search)}&status=${statusFilter}`
      )
      .then((res) => {
        setRows(res.data);
        setPagination(res.pagination);
      });
  };

  useEffect(() => {
    load(1);
  }, [search, statusFilter]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIssuedCredentials(null);
    try {
      const res = await api.post('/admin/agents', form);
      setIssuedCredentials({
        username: res.username,
        password: res.temporaryPassword,
        context: 'New Agent Account Created',
      });
      setForm({ full_name: '', contact_number: '', email: '', username: '' });
      load(1);
    } catch (err: any) {
      setError(err.message || 'Failed to create agent.');
    }
  };

  const handleResetPassword = async (userId: number, username: string) => {
    setError('');
    try {
      const res = await api.post(`/admin/agents/${userId}/reset-password`);
      setIssuedCredentials({
        username,
        password: res.temporaryPassword,
        context: 'Agent Temporary Password Reset',
      });
      load(pagination.page);
    } catch (err: any) {
      setError(err.message || 'Failed to reset password.');
    }
  };

  const handleToggleStatus = async (userId: number) => {
    await api.patch(`/admin/users/${userId}/toggle-status`);
    load(pagination.page);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Field Agent Accounts</h1>
        <p className="text-sm text-slate-600">
          Agents have no public sign-up. Create each agent account here and issue their one-time temporary password.
        </p>
      </div>

      {error && (
        <div className="p-4 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-800">
          {error}
        </div>
      )}

      {issuedCredentials && (
        <div className="p-4 rounded-lg border border-amber-300 bg-amber-50 text-sm text-amber-950 space-y-1">
          <div className="font-bold">
            {issuedCredentials.context} — One-Time Temporary Password (Shown Once Only)
          </div>
          <div className="font-mono text-sm">
            Username: <strong>{issuedCredentials.username}</strong> · Temporary Password:{' '}
            <strong className="bg-white px-2 py-0.5 rounded border border-amber-300">
              {issuedCredentials.password}
            </strong>
          </div>
          <p className="text-xs text-amber-800">
            Copy and hand this temporary password to the agent now. On first login, the agent is forced to change it before accessing any menu.
          </p>
        </div>
      )}

      <form
        onSubmit={handleCreate}
        className="bg-white border border-slate-200 rounded-lg p-5 space-y-4"
      >
        <h2 className="text-base font-semibold text-slate-900">Create New Agent Account</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label htmlFor="ag-name" className="block text-xs font-semibold text-slate-700 mb-1">
              Full Name
            </label>
            <input
              id="ag-name"
              type="text"
              required
              placeholder="Enter agent full name"
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>
          <div>
            <label htmlFor="ag-phone" className="block text-xs font-semibold text-slate-700 mb-1">
              Contact Number
            </label>
            <input
              id="ag-phone"
              type="text"
              required
              placeholder="09XXXXXXXXX"
              value={form.contact_number}
              onChange={(e) => setForm({ ...form, contact_number: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>
          <div>
            <label htmlFor="ag-email" className="block text-xs font-semibold text-slate-700 mb-1">
              Email Address
            </label>
            <input
              id="ag-email"
              type="email"
              required
              placeholder="Enter email address"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>
          <div>
            <label htmlFor="ag-user" className="block text-xs font-semibold text-slate-700 mb-1">
              Username
            </label>
            <input
              id="ag-user"
              type="text"
              required
              placeholder="Enter account username"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
            />
          </div>
        </div>
        <button
          type="submit"
          className="px-4 py-2 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 whitespace-nowrap shrink-0"
        >
          Create Agent & Generate Temporary Password
        </button>
      </form>

      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <input
            type="search"
            aria-label="Search agents"
            placeholder="Search agents by name, username, or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-72 px-3 py-1.5 rounded-lg border border-slate-300 text-sm"
          />
          <select
            aria-label="Filter agents by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm bg-white"
          >
            <option value="">All Statuses</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-2.5 pr-4">Agent Name</th>
                <th className="py-2.5 pr-4">Username</th>
                <th className="py-2.5 pr-4">Contact</th>
                <th className="py-2.5 pr-4 text-right">Recruits (Approved / Total)</th>
                <th className="py-2.5 pr-4">Status</th>
                <th className="py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((a) => (
                <tr key={a.agent_id} className="hover:bg-slate-50">
                  <td className="py-2.5 pr-4">
                    <div className="font-medium text-slate-900">
                      {a.full_name || 'User'}
                    </div>
                    <div className="text-xs text-slate-500">{a.email}</div>
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-xs text-slate-800">
                    {a.username}
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-xs text-slate-700">{a.contact_number}</td>
                  <td className="py-2.5 pr-4 text-right font-mono text-xs font-semibold text-slate-900">
                    {a.approved_recruits} / {a.total_recruits} ({a.pending_recruits} pending)
                  </td>
                  <td className="py-2.5 pr-4">
                    <StatusText status={a.is_active ? 'Active' : 'Inactive'} />
                  </td>
                  <td className="py-2.5 text-right space-x-2 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleResetPassword(a.user_id, a.username)}
                      className="px-2.5 py-1 rounded border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Reset Temp Password
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleStatus(a.user_id)}
                      className="px-2.5 py-1 rounded border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {a.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PaginationBar pagination={pagination} onPageChange={load} />
      </div>
    </div>
  );
};

// ===== 4. PENDING FRANCHISEE APPROVALS & EQUIPMENT DELIVERY DISPATCH =====
export const PendingFranchiseesView: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [riders, setRiders] = useState<any[]>([]);
  const [selectedRiders, setSelectedRiders] = useState<Record<number, string>>({});
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [selectedApplication, setSelectedApplication] = useState<any | null>(null);

  const load = () => {
    api.get('/franchisee-applications?limit=50').then((res) => {
      const all: any[] = res.data || [];
      setRows(
        all.filter(
          (r) =>
            r.status === 'Pending Admin Review' ||
            r.status === 'Approved' ||
            r.status === 'For Delivery'
        )
      );
    });
    api
      .get('/franchisee-applications/delivery-staff-options')
      .then((res) => setRiders(res.data || []))
      .catch(() => {});
  };

  useEffect(() => {
    load();
  }, []);

  const handleReview = async (appRecord: any, decision: 'Approved' | 'Rejected') => {
    setError('');
    setMessage('');
    const reason = reasons[appRecord.id]?.trim() || '';
    if (decision === 'Rejected' && !reason) {
      setError('Please enter a rejection reason before rejecting a franchisee application.');
      return;
    }
    const riderId = selectedRiders[appRecord.id]
      ? Number(selectedRiders[appRecord.id])
      : null;

    try {
      const res = await api.post(`/franchisee-applications/${appRecord.id}/review`, {
        decision,
        rejection_reason: reason,
        assigned_delivery_user_id: decision === 'Approved' ? riderId : null,
      });
      setMessage(res.message || `Application ${appRecord.application_no} updated.`);
      load();
    } catch (err: any) {
      setError(err.message || 'Failed to review franchisee application.');
    }
  };

  const handleAssignRider = async (appRecord: any) => {
    setError('');
    setMessage('');
    const riderId = selectedRiders[appRecord.id] || appRecord.assigned_delivery_user_id;
    if (!riderId) {
      setError('Please select a Delivery Staff rider first.');
      return;
    }
    try {
      const res = await api.post(`/franchisee-applications/${appRecord.id}/assign-delivery`, {
        assigned_delivery_user_id: Number(riderId),
      });
      setMessage(res.message || 'Equipment delivery rider assigned.');
      load();
    } catch (err: any) {
      setError(err.message || 'Failed to assign rider.');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-xs font-extrabold uppercase tracking-wider mb-1">
          AICE Cotabato-JCDL Corporation • Official Franchisee Onboarding
        </div>
        <h1 className="text-xl font-bold text-slate-900">
          Pending Franchisee Approvals & Equipment Delivery Dispatch
        </h1>
        <p className="text-sm text-slate-600">
          Review digitized NEW FRANCHISEE FORM submissions from Sales Agents, approve or reject
          applicants, assign a Delivery Staff rider to deliver the freezer &amp; equipment kit, and
          sign &ldquo;Noted By&rdquo;.
        </p>
      </div>

      {message && (
        <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50 text-sm font-semibold text-emerald-900">
          {message}
        </div>
      )}
      {error && (
        <div className="p-4 rounded-xl border border-rose-200 bg-rose-50 text-sm font-semibold text-rose-800">
          {error}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-slate-500">
          All caught up! There are no pending franchisee applications or unassigned equipment
          deliveries.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {rows.map((f) => (
            <div
              key={f.id}
              className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between space-y-4 shadow-xs"
            >
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-black px-2 py-0.5 rounded bg-slate-900 text-white">
                      {f.application_no || `FR-${f.id}`}
                    </span>
                    <h2 className="text-base font-bold text-slate-900">{f.store_name}</h2>
                  </div>
                  <ApplicationStatusBadge status={f.status} />
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                  <ApplicationWorkflowTimeline
                    status={f.status}
                    rejectionReason={f.rejection_reason}
                    compact
                  />
                </div>

                <div className="text-xs text-slate-600 space-y-1">
                  <p>
                    Applicant:{' '}
                    <strong className="text-slate-900">
                      {f.complete_name || f.owner_name || 'User'}
                    </strong>{' '}
                    · Account ID:{' '}
                    <span className="font-mono text-blue-700">
                      {f.username}
                    </span>{' '}
                    · Applied:{' '}
                    <span className="font-mono">{String(f.date_applied || '').slice(0, 10)}</span>
                  </p>
                  <p>
                    Store Address: <strong className="text-slate-800">{f.full_address || f.address}</strong>
                  </p>
                  <p>
                    Landmark: <span className="text-slate-800">{f.landmark || '—'}</span> · GPS:{' '}
                    <span className="font-mono">
                      ({Number(f.lat).toFixed(4)}, {Number(f.lng).toFixed(4)})
                    </span>
                  </p>
                  <p>
                    Contact: <span className="font-mono font-semibold">{f.contact_number}</span> ·
                    Email: <span>{f.email}</span> · FB: <span>{f.facebook_account || '—'}</span>
                  </p>
                  <p className="text-slate-700 italic">Remarks: &ldquo;{f.remarks}&rdquo;</p>
                  <p className="text-xs font-semibold text-blue-800 pt-0.5">
                    Sales Agent: <strong>{f.agent_name || 'User'}</strong>
                  </p>
                </div>
              </div>

              <div className="space-y-2.5 pt-3 border-t border-slate-100">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Assign Delivery Staff Rider for Freezer &amp; Equipment Handover:
                  </label>
                  <select
                    value={selectedRiders[f.id] ?? (f.assigned_delivery_user_id ? String(f.assigned_delivery_user_id) : '')}
                    onChange={(e) =>
                      setSelectedRiders({ ...selectedRiders, [f.id]: e.target.value })
                    }
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
                  >
                    <option value="">-- Select Delivery Staff Rider (Optional on Approve) --</option>
                    {riders.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.full_name || 'User'} ({r.contact_number})
                      </option>
                    ))}
                  </select>
                </div>

                {f.status === 'Pending Admin Review' ? (
                  <>
                    <input
                      type="text"
                      aria-label={`Rejection reason for ${f.store_name}`}
                      placeholder="Rejection reason (required if rejecting)..."
                      value={reasons[f.id] || ''}
                      onChange={(e) => setReasons({ ...reasons, [f.id]: e.target.value })}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleReview(f, 'Approved')}
                        className="px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 whitespace-nowrap"
                      >
                        {selectedRiders[f.id] ? 'Approve & Assign Rider' : 'Approve Franchisee'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReview(f, 'Rejected')}
                        className="px-3.5 py-1.5 rounded-lg border border-rose-300 bg-white text-rose-700 text-xs font-bold hover:bg-rose-50 whitespace-nowrap"
                      >
                        Reject with Reason
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedApplication(f)}
                        className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 ml-auto"
                      >
                        Full Form &amp; Sign &ldquo;Noted By&rdquo;
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => handleAssignRider(f)}
                      className="px-3.5 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700"
                    >
                      {f.status === 'Approved'
                        ? 'Dispatch Rider (Mark For Delivery)'
                        : 'Update Assigned Rider'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedApplication(f)}
                      className="px-3.5 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800"
                    >
                      Open Paper Form / Sign &ldquo;Noted By&rdquo;
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedApplication && (
        <FranchiseePaperFormModal
          applicationId={selectedApplication.id}
          initialApplication={selectedApplication}
          viewerRole="admin"
          onClose={() => setSelectedApplication(null)}
          onUpdated={load}
        />
      )}
    </div>
  );
};

// ===== 5. ALL FRANCHISEES & APPLICATIONS MANAGEMENT =====
export const FranchiseesManagementView: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({
    total: 0,
    pending_review: 0,
    approved_only: 0,
    for_delivery: 0,
    delivered: 0,
    active: 0,
    rejected: 0,
  });
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [selectedApplication, setSelectedApplication] = useState<any | null>(null);

  const load = (page = 1) => {
    api
      .get(
        `/franchisee-applications?page=${page}&search=${encodeURIComponent(
          search
        )}&status=${encodeURIComponent(status)}`
      )
      .then((res) => {
        setRows(res.data || []);
        if (res.summary) setSummary(res.summary);
        if (res.pagination) setPagination(res.pagination);
      });
  };

  useEffect(() => {
    load(1);
  }, [search, status]);

  const toggleUser = async (userId: number) => {
    await api.patch(`/admin/users/${userId}/toggle-status`);
    load(pagination.page);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-xs font-extrabold uppercase tracking-wider mb-1">
            AICE Cotabato-JCDL Corporation • NEW FRANCHISEE FORM Registry
          </div>
          <h1 className="text-xl font-bold text-slate-900">
            Franchisee Applications &amp; Equipment Directory
          </h1>
          <p className="text-sm text-slate-600">
            View all digitized NEW FRANCHISEE FORM records, filter by 5-step workflow status, assign
            Delivery Staff riders, sign &ldquo;Noted By&rdquo;, or print/export official PDF forms.
          </p>
        </div>
      </div>

      {/* Summary Counts */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-3.5">
          <div className="text-[11px] font-semibold text-slate-500">Total Forms</div>
          <div className="text-xl font-bold font-mono text-slate-900">{summary.total || 0}</div>
        </div>
        <div className="bg-white border border-amber-200 rounded-xl p-3.5">
          <div className="text-[11px] font-semibold text-amber-800">Pending Review</div>
          <div className="text-xl font-bold font-mono text-amber-700">
            {summary.pending_review || 0}
          </div>
        </div>
        <div className="bg-white border border-blue-200 rounded-xl p-3.5">
          <div className="text-[11px] font-semibold text-blue-800">Approved</div>
          <div className="text-xl font-bold font-mono text-blue-700">
            {summary.approved_only || 0}
          </div>
        </div>
        <div className="bg-white border border-indigo-200 rounded-xl p-3.5">
          <div className="text-[11px] font-semibold text-indigo-800">For Delivery</div>
          <div className="text-xl font-bold font-mono text-indigo-700">
            {summary.for_delivery || 0}
          </div>
        </div>
        <div className="bg-white border border-emerald-200 rounded-xl p-3.5">
          <div className="text-[11px] font-semibold text-emerald-800">Active Stores</div>
          <div className="text-xl font-bold font-mono text-emerald-700">
            {Number(summary.active || 0) + Number(summary.delivered || 0)}
          </div>
        </div>
        <div className="bg-white border border-rose-200 rounded-xl p-3.5">
          <div className="text-[11px] font-semibold text-rose-800">Rejected</div>
          <div className="text-xl font-bold font-mono text-rose-700">{summary.rejected || 0}</div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <input
            type="search"
            aria-label="Search franchisees"
            placeholder="Search application #, store name, applicant, or username..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-80 px-3.5 py-2 rounded-lg border border-slate-300 text-sm"
          />
          <select
            aria-label="Filter franchisees by approval status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="px-3.5 py-2 rounded-lg border border-slate-300 text-sm bg-white font-medium"
          >
            <option value="">All Workflow Statuses</option>
            <option value="Pending Admin Review">Pending Admin Review</option>
            <option value="Approved">Approved</option>
            <option value="For Delivery">For Delivery</option>
            <option value="Delivered">Delivered</option>
            <option value="Active">Active</option>
            <option value="Rejected">Rejected</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-2.5 pr-4">App No. &amp; Store</th>
                <th className="py-2.5 pr-4">Applicant &amp; Account</th>
                <th className="py-2.5 pr-4">Sales Agent &amp; Rider</th>
                <th className="py-2.5 pr-4">Freezer #</th>
                <th className="py-2.5 pr-4">Workflow Status</th>
                <th className="py-2.5 pr-4">Login Access</th>
                <th className="py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((f) => (
                <tr key={f.id} className="hover:bg-slate-50">
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded bg-slate-900 text-white">
                        {f.application_no || `FR-${f.id}`}
                      </span>
                      <span className="font-semibold text-slate-900">{f.store_name}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {f.full_address || f.address}
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    <div className="text-slate-900 font-medium">
                      {f.complete_name || f.owner_name || 'User'}
                    </div>
                    <div className="text-xs font-mono text-slate-500">
                      {f.username} · {f.contact_number}
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-xs text-slate-700">
                    <div>
                      Agent: <strong>{f.agent_name || 'User'}</strong>
                    </div>
                    <div className="text-slate-500">
                      Rider: {f.assigned_delivery_name || 'Unassigned'}
                    </div>
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs font-bold text-emerald-800">
                    {f.freezer_no || '—'}
                  </td>
                  <td className="py-3 pr-4">
                    <ApplicationStatusBadge status={f.status} />
                    {f.rejection_reason && (
                      <div className="text-[11px] text-rose-700 mt-0.5">
                        Reason: {f.rejection_reason}
                      </div>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    <StatusText status={f.is_active ? 'Active' : 'Inactive'} />
                  </td>
                  <td className="py-3 text-right space-x-1.5 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setSelectedApplication(f)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800"
                    >
                      Paper Form / Manage
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadApplicationPdf(f)}
                      className="px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700"
                    >
                      PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleUser(f.user_id)}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {f.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PaginationBar pagination={pagination} onPageChange={load} />
      </div>

      {selectedApplication && (
        <FranchiseePaperFormModal
          applicationId={selectedApplication.id}
          initialApplication={selectedApplication}
          viewerRole="admin"
          onClose={() => setSelectedApplication(null)}
          onUpdated={() => load(pagination.page)}
        />
      )}
    </div>
  );
};

// ===== 6. DELIVERY STAFF ACCOUNTS =====
export const DeliveryStaffView: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({
    full_name: '',
    username: '',
    contact_number: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = (page = 1) => {
    api
      .get(`/admin/delivery-staff?page=${page}&search=${encodeURIComponent(search)}`)
      .then((res) => {
        setRows(res.data);
        setPagination(res.pagination);
      });
  };

  useEffect(() => {
    load(1);
  }, [search]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await api.post('/admin/delivery-staff', form);
      setMessage('Delivery staff account created.');
      setForm({ full_name: '', username: '', contact_number: '', email: '', password: '' });
      load(1);
    } catch (err: any) {
      setError(err.message || 'Failed to create delivery staff.');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Delivery Staff Accounts</h1>
        <p className="text-sm text-slate-600">
          Manage cold-chain delivery riders who transport replenishment orders from warehouses to franchisees.
        </p>
      </div>

      {message && (
        <div className="p-4 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-900">
          {message}
        </div>
      )}
      {error && (
        <div className="p-4 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-800">
          {error}
        </div>
      )}

      <form
        onSubmit={handleCreate}
        className="bg-white border border-slate-200 rounded-lg p-5 space-y-4"
      >
        <h2 className="text-base font-semibold text-slate-900">Add Delivery Rider</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <input
            type="text"
            required
            placeholder="Full Name"
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm"
          />
          <input
            type="text"
            required
            placeholder="Username"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
          />
          <input
            type="text"
            required
            placeholder="Contact Number"
            value={form.contact_number}
            onChange={(e) => setForm({ ...form, contact_number: e.target.value })}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm"
          />
          <input
            type="email"
            placeholder="Email (optional)"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm"
          />
          <input
            type="password"
            required
            minLength={8}
            placeholder="Password (min 8 chars)"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm"
          />
        </div>
        <button
          type="submit"
          className="px-4 py-2 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700"
        >
          Create Delivery Staff Account
        </button>
      </form>

      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <input
          type="search"
          aria-label="Search delivery staff"
          placeholder="Search delivery riders..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:w-72 px-3 py-1.5 rounded-lg border border-slate-300 text-sm mb-4"
        />

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-2.5 pr-4">Rider Name</th>
                <th className="py-2.5 pr-4">Username</th>
                <th className="py-2.5 pr-4">Contact</th>
                <th className="py-2.5 pr-4 text-right">Active / Completed Deliveries</th>
                <th className="py-2.5 pr-4">Status</th>
                <th className="py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="py-2.5 pr-4 font-medium text-slate-900">
                    {u.full_name || 'User'}
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-xs text-slate-700">
                    {u.username}
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-xs text-slate-700">{u.contact_number}</td>
                  <td className="py-2.5 pr-4 text-right font-mono text-xs">
                    {u.active_deliveries} active · {u.completed_deliveries} completed
                  </td>
                  <td className="py-2.5 pr-4">
                    <StatusText status={u.is_active ? 'Active' : 'Inactive'} />
                  </td>
                  <td className="py-2.5 text-right">
                    <button
                      type="button"
                      onClick={async () => {
                        await api.patch(`/admin/users/${u.id}/toggle-status`);
                        load(pagination.page);
                      }}
                      className="px-2.5 py-1 rounded border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {u.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PaginationBar pagination={pagination} onPageChange={load} />
      </div>
    </div>
  );
};
