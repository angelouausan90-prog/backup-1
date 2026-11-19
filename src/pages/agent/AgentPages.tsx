import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { MapPicker } from '../../components/MapPicker';
import { PaginationBar, StatusText } from '../../components/SharedUI';

// ===== 1. AGENT RECRUITS DASHBOARD =====
export const AgentRecruitsView: React.FC<{ onNavigate: (path: string) => void }> = ({
  onNavigate,
}) => {
  const [rows, setRows] = useState<any[]>([]);
  const [summary, setSummary] = useState({ total: 0, approved: 0, pending: 0, rejected: 0 });
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const load = (page = 1) => {
    api
      .get(
        `/agent/recruits?page=${page}&search=${encodeURIComponent(search)}&status=${statusFilter}`
      )
      .then((res) => {
        setRows(res.data);
        if (res.summary) setSummary(res.summary);
        setPagination(res.pagination);
      });
  };

  useEffect(() => {
    load(1);
  }, [search, statusFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">My Recruited Franchisees</h1>
          <p className="text-sm text-slate-600">
            Track the approval status (Pending, Approved, Rejected) and rejection reasons for every franchisee you register.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('/agent/register-franchisee')}
          className="px-4 py-2 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 whitespace-nowrap shrink-0"
        >
          Register New Franchisee
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">Total Recruits</div>
          <div className="mt-1 text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {summary.total || 0}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">Approved & Active</div>
          <div className="mt-1 text-2xl font-bold text-emerald-700 font-mono tabular-nums">
            {summary.approved || 0}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">Pending Admin Review</div>
          <div className="mt-1 text-2xl font-bold text-amber-700 font-mono tabular-nums">
            {summary.pending || 0}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">Rejected</div>
          <div className="mt-1 text-2xl font-bold text-rose-700 font-mono tabular-nums">
            {summary.rejected || 0}
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <input
            type="search"
            aria-label="Search recruited franchisees"
            placeholder="Search store name or owner..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-72 px-3 py-1.5 rounded-lg border border-slate-300 text-sm"
          />
          <select
            aria-label="Filter recruits by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm bg-white"
          >
            <option value="">All Statuses</option>
            <option value="Pending">Pending</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-2.5 pr-4">Store Name & Address</th>
                <th className="py-2.5 pr-4">Owner</th>
                <th className="py-2.5 pr-4">Generated Username</th>
                <th className="py-2.5 pr-4">Contact</th>
                <th className="py-2.5 pr-4">Approval Status</th>
                <th className="py-2.5 text-right">Registered Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-sm text-slate-500">
                    No franchisee recruits found.
                  </td>
                </tr>
              ) : (
                rows.map((f) => (
                  <tr key={f.id} className="hover:bg-slate-50">
                    <td className="py-2.5 pr-4">
                      <div className="font-semibold text-slate-900">{f.store_name}</div>
                      <div className="text-xs text-slate-500">
                        {f.address} · <span className="font-mono">({f.lat}, {f.lng})</span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-4 text-slate-800">{f.owner_name}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-slate-800">@{f.username}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-slate-700">{f.contact_number}</td>
                    <td className="py-2.5 pr-4">
                      <StatusText status={f.status} />
                      {f.status === 'Rejected' && f.rejection_reason && (
                        <div className="text-xs text-rose-700 mt-0.5">
                          Reason: <strong>{f.rejection_reason}</strong>
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 text-right font-mono text-xs text-slate-500">
                      {f.created_at}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <PaginationBar pagination={pagination} onPageChange={load} />
      </div>
    </div>
  );
};

// ===== 2. AGENT REGISTER FRANCHISEE (With Map Pin, Auto-Generated Username, Initial Password) =====
export const RegisterFranchiseeView: React.FC = () => {
  const [form, setForm] = useState({
    owner_name: '',
    store_name: '',
    address: '',
    contact_number: '',
    email: '',
    initial_password: '',
    lat: null as number | null,
    lng: null as number | null,
  });
  const [createdInfo, setCreatedInfo] = useState<{
    username: string;
    storeName: string;
  } | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setCreatedInfo(null);
    if (form.lat === null || form.lng === null) {
      setError('Please pin the franchisee store location on the map.');
      return;
    }
    setSaving(true);
    try {
      const res = await api.post('/agent/franchisees', form);
      setCreatedInfo({
        username: res.generatedUsername,
        storeName: form.store_name,
      });
      setForm({
        owner_name: '',
        store_name: '',
        address: '',
        contact_number: '',
        email: '',
        initial_password: '',
        lat: null,
        lng: null,
      });
    } catch (err: any) {
      setError(err.message || 'Failed to register franchisee.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Register New AICE Franchisee</h1>
        <p className="text-sm text-slate-600">
          There is no public franchisee sign-up. Register the owner details, store address, map coordinates, and initial password here. The franchisee starts as Pending until approved by the Admin.
        </p>
      </div>

      {error && (
        <div className="p-4 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-800">
          {error}
        </div>
      )}

      {createdInfo && (
        <div className="p-4 rounded-lg border border-emerald-300 bg-emerald-50 text-sm text-emerald-950 space-y-1">
          <div className="font-bold">
            Franchisee "{createdInfo.storeName}" Registered (Status: Pending Admin Approval)
          </div>
          <div className="font-mono text-sm">
            Auto-Generated Username: <strong>{createdInfo.username}</strong>
          </div>
          <p className="text-xs text-emerald-800">
            Provide this generated username and the initial password you set to the franchisee. They will be able to log in once the Admin approves their application, and will be forced to change their password on first login.
          </p>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="bg-white border border-slate-200 rounded-lg p-5 space-y-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="fr-owner" className="block text-xs font-semibold text-slate-700 mb-1">
              Owner Full Name
            </label>
            <input
              id="fr-owner"
              type="text"
              required
              placeholder="e.g. Elena Bautista"
              value={form.owner_name}
              onChange={(e) => setForm({ ...form, owner_name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>
          <div>
            <label htmlFor="fr-store" className="block text-xs font-semibold text-slate-700 mb-1">
              Store Name
            </label>
            <input
              id="fr-store"
              type="text"
              required
              placeholder="e.g. AICE Makati Poblacion Mini Mart"
              value={form.store_name}
              onChange={(e) => setForm({ ...form, store_name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>
        </div>

        <div>
          <label htmlFor="fr-addr" className="block text-xs font-semibold text-slate-700 mb-1">
            Store Street Address
          </label>
          <input
            id="fr-addr"
            type="text"
            required
            placeholder="e.g. 5420 P. Burgos St, Poblacion, Makati City"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="fr-phone" className="block text-xs font-semibold text-slate-700 mb-1">
              Contact Number
            </label>
            <input
              id="fr-phone"
              type="text"
              required
              placeholder="e.g. 09176667788"
              value={form.contact_number}
              onChange={(e) => setForm({ ...form, contact_number: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>
          <div>
            <label htmlFor="fr-email" className="block text-xs font-semibold text-slate-700 mb-1">
              Owner Email (Optional)
            </label>
            <input
              id="fr-email"
              type="email"
              placeholder="e.g. elena@store.local"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>
          <div>
            <label htmlFor="fr-pwd" className="block text-xs font-semibold text-slate-700 mb-1">
              Initial Password (min 8 chars)
            </label>
            <input
              id="fr-pwd"
              type="password"
              required
              minLength={8}
              placeholder="Initial password for franchisee"
              value={form.initial_password}
              onChange={(e) => setForm({ ...form, initial_password: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>
        </div>

        <div>
          <span className="block text-xs font-semibold text-slate-700 mb-1">
            Pin Franchisee Store Location on Map
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
          className="px-5 py-2.5 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-50"
        >
          {saving ? 'Submitting Registration...' : 'Register Franchisee for Admin Approval'}
        </button>
      </form>
    </div>
  );
};

// ===== 3. AGENT COMMISSIONS VIEW =====
export const AgentCommissionsView: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });

  const load = (page = 1) => {
    api.get(`/commissions?page=${page}`).then((res) => {
      setRows(res.data);
      setPagination(res.pagination);
    });
  };

  useEffect(() => {
    load(1);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">My Commission Records</h1>
        <p className="text-sm text-slate-600">
          Commissions manually issued by the Admin based on your approved franchisee recruits.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-2.5 pr-4">Period</th>
                <th className="py-2.5 pr-4 text-right">Approved Recruits Count</th>
                <th className="py-2.5 pr-4 text-right">Commission Amount</th>
                <th className="py-2.5 pr-4">Status</th>
                <th className="py-2.5 pr-4">Notes</th>
                <th className="py-2.5 text-right">Recorded Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-sm text-slate-500">
                    No commission records issued yet.
                  </td>
                </tr>
              ) : (
                rows.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="py-2.5 pr-4 font-semibold text-slate-900">{c.period_label}</td>
                    <td className="py-2.5 pr-4 text-right font-mono text-xs">{c.recruits_count}</td>
                    <td className="py-2.5 pr-4 text-right font-mono text-xs font-bold text-slate-900">
                      PHP {Number(c.amount).toFixed(2)}
                    </td>
                    <td className="py-2.5 pr-4">
                      <StatusText status={c.status} />
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-slate-600">{c.notes || '—'}</td>
                    <td className="py-2.5 text-right font-mono text-xs text-slate-500">
                      {c.created_at}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <PaginationBar pagination={pagination} onPageChange={load} />
      </div>
    </div>
  );
};
