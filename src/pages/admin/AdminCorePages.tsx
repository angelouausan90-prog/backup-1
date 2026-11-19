import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { MapPicker } from '../../components/MapPicker';
import { PaginationBar, ProductImage, StatusText } from '../../components/SharedUI';
import { Warehouse } from '../../types';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

// ===== 1. ADMIN DASHBOARD =====
export const AdminDashboard: React.FC<{ onNavigate: (path: string) => void }> = ({
  onNavigate,
}) => {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/admin/dashboard')
      .then((res) => setData(res))
      .catch((err) => setError(err.message || 'Failed to load dashboard.'));
  }, []);

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
          <div className="text-xs font-medium text-slate-500">Warehouse Low-Stock Alerts</div>
          <div className="mt-1 text-2xl font-bold text-amber-700 font-mono tabular-nums">
            {data.lowStockCount || 0} SKU(s)
          </div>
          <div className="mt-1 text-xs text-slate-500">At or below threshold</div>
        </div>
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
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => {
    api.get('/warehouses').then((res) => setWarehouses(res.data));
  };

  useEffect(() => {
    load();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    if (form.lat === null || form.lng === null) {
      setError('Please click on the map to pin the warehouse coordinates.');
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
              placeholder="e.g. AICE Metro Manila Central Cold Storage"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-rose-600"
            />
          </div>

          <div>
            <label htmlFor="wh-address" className="block text-xs font-semibold text-slate-700 mb-1">
              Full Street Address
            </label>
            <input
              id="wh-address"
              type="text"
              required
              placeholder="e.g. 410 Quirino Highway, Novaliches, Quezon City"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-rose-600"
            />
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
                placeholder="e.g. Engr. Roberto Lim"
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
                placeholder="e.g. 09178001122"
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
              placeholder="e.g. Paolo Villanueva"
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
              placeholder="e.g. 09178889900"
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
              placeholder="e.g. paolo@aicehub.local"
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
              placeholder="e.g. agent_paolo"
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
                    <div className="font-medium text-slate-900">{a.full_name}</div>
                    <div className="text-xs text-slate-500">{a.email}</div>
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-xs text-slate-800">@{a.username}</td>
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

// ===== 4. PENDING FRANCHISEE APPROVALS =====
export const PendingFranchiseesView: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = () => {
    api.get('/admin/franchisees?status=Pending&limit=50').then((res) => setRows(res.data));
  };

  useEffect(() => {
    load();
  }, []);

  const handleReview = async (id: number, decision: 'Approved' | 'Rejected') => {
    setError('');
    setMessage('');
    if (decision === 'Rejected' && !reasons[id]?.trim()) {
      setError('Please enter a rejection reason before rejecting a franchisee registration.');
      return;
    }
    try {
      await api.post(`/admin/franchisees/${id}/review`, {
        decision,
        rejection_reason: reasons[id] || '',
      });
      setMessage(`Franchisee registration ${decision.toLowerCase()} successfully.`);
      load();
    } catch (err: any) {
      setError(err.message || 'Failed to review franchisee.');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Pending Franchisee Approvals</h1>
        <p className="text-sm text-slate-600">
          Review franchisees recruited by field agents. Only approved franchisees can log in and appear on the Store Map.
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

      {rows.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-6 text-sm text-slate-500">
          All caught up! There are no pending franchisee registrations waiting for review.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rows.map((f) => (
            <div
              key={f.id}
              className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between space-y-4"
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-slate-900">{f.store_name}</h2>
                  <StatusText status={f.status} />
                </div>
                <p className="text-xs text-slate-600">
                  Owner: <strong className="text-slate-900">{f.owner_name}</strong> · Username:{' '}
                  <span className="font-mono text-slate-800">@{f.username}</span>
                </p>
                <p className="text-xs text-slate-600">Address: {f.address}</p>
                <p className="text-xs text-slate-600">
                  Contact: <span className="font-mono">{f.contact_number}</span> · Coordinates:{' '}
                  <span className="font-mono">
                    ({f.lat}, {f.lng})
                  </span>
                </p>
                <p className="text-xs font-medium text-blue-800 pt-1">
                  Recruited by Agent: <strong>{f.agent_name}</strong> (@{f.agent_username})
                </p>
              </div>

              <div className="space-y-2 pt-3 border-t border-slate-100">
                <input
                  type="text"
                  aria-label={`Rejection reason for ${f.store_name}`}
                  placeholder="Rejection reason (required if rejecting)..."
                  value={reasons[f.id] || ''}
                  onChange={(e) => setReasons({ ...reasons, [f.id]: e.target.value })}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleReview(f.id, 'Approved')}
                    className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 whitespace-nowrap shrink-0"
                  >
                    Approve Franchisee
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReview(f.id, 'Rejected')}
                    className="px-4 py-1.5 rounded-lg border border-rose-300 bg-white text-rose-700 text-xs font-semibold hover:bg-rose-50 whitespace-nowrap shrink-0"
                  >
                    Reject with Reason
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ===== 5. ALL FRANCHISEES MANAGEMENT =====
export const FranchiseesManagementView: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const load = (page = 1) => {
    api
      .get(
        `/admin/franchisees?page=${page}&search=${encodeURIComponent(search)}&status=${status}`
      )
      .then((res) => {
        setRows(res.data);
        setPagination(res.pagination);
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
      <div>
        <h1 className="text-xl font-bold text-slate-900">Franchisee Directory</h1>
        <p className="text-sm text-slate-600">
          Search, filter, and activate or deactivate franchisee accounts across the network.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <input
            type="search"
            aria-label="Search franchisees"
            placeholder="Search store name, owner, or username..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-72 px-3 py-1.5 rounded-lg border border-slate-300 text-sm"
          />
          <select
            aria-label="Filter franchisees by approval status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm bg-white"
          >
            <option value="">All Approval Statuses</option>
            <option value="Approved">Approved</option>
            <option value="Pending">Pending</option>
            <option value="Rejected">Rejected</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-2.5 pr-4">Store Name & Address</th>
                <th className="py-2.5 pr-4">Owner & Username</th>
                <th className="py-2.5 pr-4">Recruiting Agent</th>
                <th className="py-2.5 pr-4">Approval Status</th>
                <th className="py-2.5 pr-4">Login Status</th>
                <th className="py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((f) => (
                <tr key={f.id} className="hover:bg-slate-50">
                  <td className="py-2.5 pr-4">
                    <div className="font-semibold text-slate-900">{f.store_name}</div>
                    <div className="text-xs text-slate-500">{f.address}</div>
                  </td>
                  <td className="py-2.5 pr-4">
                    <div className="text-slate-800">{f.owner_name}</div>
                    <div className="text-xs font-mono text-slate-500">
                      @{f.username} · {f.contact_number}
                    </div>
                  </td>
                  <td className="py-2.5 pr-4 text-xs text-slate-700">
                    {f.agent_name} (@{f.agent_username})
                  </td>
                  <td className="py-2.5 pr-4">
                    <StatusText status={f.status} />
                    {f.rejection_reason && (
                      <div className="text-[11px] text-rose-700">Reason: {f.rejection_reason}</div>
                    )}
                  </td>
                  <td className="py-2.5 pr-4">
                    <StatusText status={f.is_active ? 'Active' : 'Inactive'} />
                  </td>
                  <td className="py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => toggleUser(f.user_id)}
                      className="px-2.5 py-1 rounded border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
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
                  <td className="py-2.5 pr-4 font-medium text-slate-900">{u.full_name}</td>
                  <td className="py-2.5 pr-4 font-mono text-xs text-slate-700">@{u.username}</td>
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
