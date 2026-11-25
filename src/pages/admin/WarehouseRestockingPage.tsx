import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';
import { PaginationBar, StockStatusBadge, StatusText } from '../../components/SharedUI';
import { checkTargetsAgainstCapacity } from '../../utils/restockingRules';

interface WarehouseRestockingPageProps {
  initialRequestId?: number | null;
  onRequestConsumed?: () => void;
  onBadgeRefresh?: () => void;
}

const TRIGGER_LABELS: Record<string, string> = {
  monthly: 'Monthly Schedule',
  low_stock: 'Low Stock Alert',
  no_stock: 'No Stock (Urgent)',
};

export const WarehouseRestockingPage: React.FC<WarehouseRestockingPageProps> = ({
  initialRequestId,
  onRequestConsumed,
  onBadgeRefresh,
}) => {
  const [activeTab, setActiveTab] = useState<'requests' | 'settings'>('requests');
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [selectedWh, setSelectedWh] = useState<string>('');

  // Overview & Recommendations
  const [overview, setOverview] = useState<any>(null);
  const [recommendations, setRecommendations] = useState<any[]>([]);

  // Requests table & filters
  const [requests, setRequests] = useState<any[]>([]);
  const [summary, setSummary] = useState({
    draft_count: 0,
    high_priority_drafts: 0,
    in_transit_count: 0,
    overdue_count: 0,
    received_count: 0,
  });
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [triggerFilter, setTriggerFilter] = useState('');
  const [search, setSearch] = useState('');

  // Settings tab state
  const [leadTimeDays, setLeadTimeDays] = useState<string>('7');
  const [capacityLimit, setCapacityLimit] = useState<string>('1000');
  const [productSettings, setProductSettings] = useState<
    Array<{
      id: number;
      sku: string;
      name: string;
      flavor: string;
      size: string;
      category_name: string;
      target_quantity: string;
      safety_stock: string;
      max_reservation_qty: string;
    }>
  >([]);
  const [previewMap, setPreviewMap] = useState<Record<number, any>>({});
  const [savingSettings, setSavingSettings] = useState(false);

  // Page feedback & action busy flags
  const [runningMonthly, setRunningMonthly] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Detail modal state
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState<any>(null);
  const [detailError, setDetailError] = useState('');
  const [detailBusy, setDetailBusy] = useState(false);
  const [draftQtyMap, setDraftQtyMap] = useState<Record<number, string>>({});
  const [actionMode, setActionMode] = useState<
    'view' | 'confirm_approve' | 'reject' | 'cancel' | 'receive'
  >('view');
  const [reasonInput, setReasonInput] = useState('');
  const [remarksInput, setRemarksInput] = useState('');
  const [receiveInputs, setReceiveInputs] = useState<
    Record<number, { received_qty: string; difference_remark: string }>
  >({});

  // Initial load of warehouses
  useEffect(() => {
    api
      .get('/warehouses')
      .then((res) => {
        const list = Array.isArray(res?.data) ? res.data : [];
        setWarehouses(list);
        if (list.length > 0 && !selectedWh) {
          setSelectedWh(String(list[0].id));
        }
      })
      .catch((err) => setError(err.message || 'Failed to load warehouses.'));
  }, []);

  const loadRecommendations = async (whId = selectedWh) => {
    if (!whId) return;
    try {
      const res = await api.get(`/restocking/recommendations?warehouse_id=${whId}`);
      setOverview(res.overview || null);
      setRecommendations(Array.isArray(res.recommendations) ? res.recommendations : []);
    } catch (err: any) {
      setError(err.message || 'Failed to load restock recommendations.');
    }
  };

  const loadRequests = async (page = 1, whId = selectedWh) => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', '10');
    if (whId) params.set('warehouse_id', whId);
    if (statusFilter) params.set('status', statusFilter);
    if (priorityFilter) params.set('priority', priorityFilter);
    if (triggerFilter) params.set('trigger_type', triggerFilter);
    if (search.trim()) params.set('search', search.trim());

    try {
      const res = await api.get(`/restocking/requests?${params.toString()}`);
      setRequests(Array.isArray(res.data) ? res.data : []);
      if (res.summary) setSummary(res.summary);
      if (res.pagination) setPagination(res.pagination);
    } catch (err: any) {
      setError(err.message || 'Failed to load restock requests.');
    }
  };

  const loadSettings = async (whId = selectedWh) => {
    try {
      const qs = whId ? `?warehouse_id=${whId}` : '';
      const res = await api.get(`/restocking/settings${qs}`);
      setLeadTimeDays(String(res.lead_time_days ?? 7));
      const activeWh =
        (res.warehouses || []).find((w: any) => String(w.id) === String(whId)) ||
        res.warehouses?.[0];
      if (activeWh) {
        setCapacityLimit(String(activeWh.capacity_limit ?? 1000));
      }
      setProductSettings(
        (res.products || []).map((p: any) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          flavor: p.flavor,
          size: p.size,
          category_name: p.category_name,
          target_quantity: String(p.target_quantity ?? 100),
          safety_stock: String(p.safety_stock ?? 15),
          max_reservation_qty:
            p.max_reservation_qty === null || p.max_reservation_qty === undefined
              ? ''
              : String(p.max_reservation_qty),
        }))
      );
      const map: Record<number, any> = {};
      if (res.preview?.products) {
        for (const p of res.preview.products) {
          map[p.product_id] = p;
        }
      }
      setPreviewMap(map);
    } catch (err: any) {
      setError(err.message || 'Failed to load restocking settings.');
    }
  };

  const refreshAll = async (page = pagination.page) => {
    await Promise.all([
      loadRecommendations(selectedWh),
      loadRequests(page, selectedWh),
      loadSettings(selectedWh),
    ]);
    onBadgeRefresh?.();
  };

  useEffect(() => {
    if (!selectedWh) return;
    loadRecommendations(selectedWh);
    loadRequests(1, selectedWh);
    loadSettings(selectedWh);
  }, [selectedWh]);

  useEffect(() => {
    if (!selectedWh) return;
    loadRequests(1, selectedWh);
  }, [statusFilter, priorityFilter, triggerFilter, search]);

  const openRequestDetail = async (
    requestId: number,
    initialMode: 'view' | 'receive' = 'view'
  ) => {
    setDetailModalOpen(true);
    setDetailLoading(true);
    setDetailError('');
    setActionMode(initialMode);
    setReasonInput('');
    setRemarksInput('');
    try {
      const res = await api.get(`/restocking/requests/${requestId}`);
      setDetailData(res);
      const qtyInit: Record<number, string> = {};
      const recInit: Record<number, { received_qty: string; difference_remark: string }> = {};
      for (const it of res.items || []) {
        qtyInit[it.id] = String(it.approved_qty ?? it.suggested_qty ?? 0);
        recInit[it.id] = {
          received_qty: String(it.received_qty ?? it.approved_qty ?? 0),
          difference_remark: it.difference_remark || '',
        };
      }
      setDraftQtyMap(qtyInit);
      setReceiveInputs(recInit);
    } catch (err: any) {
      setDetailError(err.message || 'Failed to load restock request details.');
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    if (initialRequestId) {
      openRequestDetail(initialRequestId, 'view');
      onRequestConsumed?.();
    }
  }, [initialRequestId]);

  const handleRunMonthlyCheck = async () => {
    setError('');
    setMessage('');
    setRunningMonthly(true);
    try {
      const res = await api.post('/restocking/run-monthly-check', {
        warehouse_id: selectedWh ? Number(selectedWh) : null,
        force: true,
      });
      setMessage(res.message || 'Monthly restock check completed.');
      await refreshAll(1);
    } catch (err: any) {
      setError(err.message || 'Failed to run monthly restock check.');
    } finally {
      setRunningMonthly(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setSavingSettings(true);
    try {
      await api.put('/restocking/settings', {
        lead_time_days: Number(leadTimeDays),
        warehouse_id: Number(selectedWh),
        capacity_limit: Number(capacityLimit),
        products: productSettings.map((p) => ({
          id: p.id,
          target_quantity: Number(p.target_quantity),
          safety_stock: Number(p.safety_stock),
          max_reservation_qty:
            p.max_reservation_qty.trim() === '' ? null : Number(p.max_reservation_qty),
        })),
      });
      setMessage('Warehouse Restocking settings updated.');
      await refreshAll(pagination.page);
    } catch (err: any) {
      setError(err.message || 'Failed to save restocking settings.');
    } finally {
      setSavingSettings(false);
    }
  };

  // Live capacity check in Settings tab
  const settingsTotalTargets = useMemo(
    () =>
      productSettings.reduce((sum, p) => {
        const n = parseInt(p.target_quantity || '0', 10);
        return sum + (Number.isFinite(n) && n > 0 ? n : 0);
      }, 0),
    [productSettings]
  );
  const parsedCapacity = parseInt(capacityLimit || '0', 10) || 0;
  const settingsCapacityWarning = checkTargetsAgainstCapacity(
    settingsTotalTargets,
    parsedCapacity
  );

  // Live capacity projection inside the Request Detail modal
  const draftItemsPayload = useMemo<Array<{ item_id: number; approved_qty: number }>>(() => {
    if (!detailData?.items) return [];
    return detailData.items.map((it: any) => ({
      item_id: Number(it.id),
      approved_qty: Math.max(0, parseInt(draftQtyMap[it.id] || '0', 10) || 0),
    }));
  }, [detailData, draftQtyMap]);

  const draftTotalQty = useMemo(
    () => draftItemsPayload.reduce((sum: number, it) => sum + it.approved_qty, 0),
    [draftItemsPayload]
  );

  const receiveTotalQty = useMemo(() => {
    if (!detailData?.items) return 0;
    return detailData.items.reduce((sum: number, it: any) => {
      const val = parseInt(receiveInputs[it.id]?.received_qty || '0', 10);
      return sum + (Number.isFinite(val) && val > 0 ? val : 0);
    }, 0);
  }, [detailData, receiveInputs]);

  const modalCapCtx = detailData?.warehouse_capacity_context;
  const activeIncomingQty =
    detailData?.request?.status === 'Draft'
      ? draftTotalQty
      : actionMode === 'receive'
      ? receiveTotalQty
      : Number(modalCapCtx?.total_approved_qty || 0);
  const modalProjectedTotal =
    Number(modalCapCtx?.current_total_stock || 0) + activeIncomingQty;
  const modalCapacityLimit = Number(modalCapCtx?.capacity_limit || 1000);
  const modalExceedsCapacity = modalProjectedTotal > modalCapacityLimit;

  const handleSaveDraftQuantities = async () => {
    if (!detailData?.request?.id) return;
    setDetailError('');
    setDetailBusy(true);
    try {
      await api.patch(`/restocking/requests/${detailData.request.id}/items`, {
        items: draftItemsPayload,
      });
      await openRequestDetail(detailData.request.id, 'view');
      await refreshAll(pagination.page);
      setMessage(`Updated quantities on ${detailData.request.request_number}.`);
    } catch (err: any) {
      setDetailError(err.message || 'Failed to save draft quantities.');
    } finally {
      setDetailBusy(false);
    }
  };

  const handleApproveDraft = async () => {
    if (!detailData?.request?.id) return;
    setDetailError('');
    setDetailBusy(true);
    try {
      const res = await api.post(`/restocking/requests/${detailData.request.id}/approve`, {
        items: draftItemsPayload,
        remarks: remarksInput.trim() || null,
      });
      setMessage(res.message || 'Restock request approved.');
      setDetailModalOpen(false);
      await refreshAll(pagination.page);
    } catch (err: any) {
      setDetailError(err.message || 'Failed to approve restock request.');
    } finally {
      setDetailBusy(false);
    }
  };

  const handleRejectDraft = async () => {
    if (!detailData?.request?.id) return;
    if (!reasonInput.trim()) {
      setDetailError('Please provide a reason for rejecting this draft.');
      return;
    }
    setDetailError('');
    setDetailBusy(true);
    try {
      const res = await api.post(`/restocking/requests/${detailData.request.id}/reject`, {
        reason: reasonInput.trim(),
      });
      setMessage(res.message || 'Restock draft rejected.');
      setDetailModalOpen(false);
      await refreshAll(pagination.page);
    } catch (err: any) {
      setDetailError(err.message || 'Failed to reject restock draft.');
    } finally {
      setDetailBusy(false);
    }
  };

  const handleCancelInTransit = async () => {
    if (!detailData?.request?.id) return;
    if (!reasonInput.trim()) {
      setDetailError('Please provide a reason for cancelling this delivery.');
      return;
    }
    setDetailError('');
    setDetailBusy(true);
    try {
      const res = await api.post(`/restocking/requests/${detailData.request.id}/cancel`, {
        reason: reasonInput.trim(),
      });
      setMessage(res.message || 'In-transit delivery cancelled.');
      setDetailModalOpen(false);
      await refreshAll(pagination.page);
    } catch (err: any) {
      setDetailError(err.message || 'Failed to cancel delivery.');
    } finally {
      setDetailBusy(false);
    }
  };

  const handleConfirmReceive = async () => {
    if (!detailData?.request?.id || !detailData?.items) return;
    setDetailError('');

    const payloadItems: Array<{
      item_id: number;
      received_qty: number;
      difference_remark: string | null;
    }> = [];

    for (const it of detailData.items) {
      const raw = receiveInputs[it.id] || {
        received_qty: String(it.approved_qty),
        difference_remark: '',
      };
      const rqty = parseInt(raw.received_qty, 10);
      if (!Number.isInteger(rqty) || rqty < 0) {
        setDetailError(`Received quantity for ${it.product_name} must be a non-negative integer.`);
        return;
      }
      if (rqty !== Number(it.approved_qty) && !raw.difference_remark.trim()) {
        setDetailError(
          `Please enter a remark explaining the difference for ${it.product_name} (approved ${it.approved_qty}, received ${rqty}).`
        );
        return;
      }
      payloadItems.push({
        item_id: it.id,
        received_qty: rqty,
        difference_remark: raw.difference_remark.trim() || null,
      });
    }

    setDetailBusy(true);
    try {
      const res = await api.post(`/restocking/requests/${detailData.request.id}/receive`, {
        items: payloadItems,
        remarks: remarksInput.trim() || null,
      });
      setMessage(res.message || 'Delivery confirmed received.');
      setDetailModalOpen(false);
      await refreshAll(pagination.page);
    } catch (err: any) {
      setDetailError(err.message || 'Failed to confirm delivery receiving.');
    } finally {
      setDetailBusy(false);
    }
  };

  const capacityPct = overview
    ? Math.min(
        100,
        Math.round(
          (Number(overview.total_physical_stock || 0) /
            Math.max(1, Number(overview.capacity_limit || 1))) *
            100
        )
      )
    : 0;

  const noStockCount = recommendations.filter((r) => r.stock_status === 'No Stock').length;
  const lowStockCount = recommendations.filter((r) => r.stock_status === 'Low Stock').length;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Warehouse Restocking (Supplier → Warehouse)
          </h1>
          <p className="text-sm text-slate-600">
            Manage inbound supplier restock drafts, approvals, capacity limits, and receiving confirmations. Distinct from franchisee Replenishment Orders.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="restock-wh-select" className="text-xs font-semibold text-slate-700">
              Warehouse:
            </label>
            <select
              id="restock-wh-select"
              value={selectedWh}
              onChange={(e) => setSelectedWh(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium bg-white"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            disabled={runningMonthly || !selectedWh}
            onClick={handleRunMonthlyCheck}
            className="px-3.5 py-2 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {runningMonthly ? 'Checking Monthly Targets...' : 'Run Monthly Check Now'}
          </button>
        </div>
      </div>

      {/* Feedback Banners */}
      {message && (
        <div
          role="status"
          className="p-3.5 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-900 flex items-center justify-between gap-3"
        >
          <span>{message}</span>
          <button
            type="button"
            onClick={() => setMessage('')}
            className="text-xs font-semibold text-emerald-800 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="p-3.5 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-800 flex items-center justify-between gap-3"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError('')}
            className="text-xs font-semibold text-rose-800 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Capacity Warning Banner when total targets > capacity */}
      {overview?.targets_exceed_capacity && (
        <div
          role="alert"
          data-testid="capacity-target-warning"
          className="p-4 rounded-lg border border-amber-300 bg-amber-50 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="text-xs text-amber-950">
            <strong className="font-bold">Warehouse Capacity Warning:</strong> Combined product
            target quantities (
            <span className="font-mono font-bold">
              {overview.total_target_qty ?? overview.total_targets}
            </span>{' '}
            units) exceed <strong>{overview.warehouse_name}</strong> capacity limit (
            <span className="font-mono font-bold">{overview.capacity_limit}</span> units) by{' '}
            <span className="font-mono font-bold">{overview.targets_excess}</span> units. Restock
            quantities will be capped automatically so deliveries never exceed capacity.
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className="px-3 py-1.5 rounded-md border border-amber-400 bg-white text-xs font-semibold text-amber-900 hover:bg-amber-100 whitespace-nowrap"
          >
            Adjust Capacity &amp; Targets
          </button>
        </div>
      )}

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-500">Warehouse Capacity</span>
            <span className="font-mono font-semibold text-slate-700">{capacityPct}%</span>
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-900">
            {overview?.total_physical_stock ?? 0}{' '}
            <span className="text-xs font-normal text-slate-500">
              / {overview?.capacity_limit ?? 1000} units
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-full transition-all ${
                capacityPct >= 90
                  ? 'bg-rose-600'
                  : capacityPct >= 75
                  ? 'bg-orange-500'
                  : 'bg-emerald-600'
              }`}
              style={{ width: `${capacityPct}%` }}
            />
          </div>
          <div className="text-[11px] text-slate-500 font-mono">
            {overview?.remaining_capacity ?? 0} units space left · Lead time:{' '}
            {overview?.lead_time_days ?? 7}d
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">Pending Draft Requests</div>
          <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-amber-800">
            {summary.draft_count}
          </div>
          <div className="mt-1 text-xs text-rose-700 font-semibold">
            {summary.high_priority_drafts} High Priority (No Stock)
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">Approved / In Transit</div>
          <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-blue-700">
            {summary.in_transit_count}
          </div>
          <div
            className={`mt-1 text-xs font-semibold ${
              summary.overdue_count > 0 ? 'text-rose-700' : 'text-slate-500'
            }`}
          >
            {summary.overdue_count > 0
              ? `${summary.overdue_count} overdue delivery alert(s)`
              : `${summary.received_count} completed deliveries`}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">Restock Alerts (Available Stock)</div>
          <div className="mt-1 flex items-baseline gap-3 font-mono tabular-nums">
            <span className="text-2xl font-bold text-rose-700">{noStockCount}</span>
            <span className="text-xs font-semibold text-rose-700">No Stock</span>
            <span className="text-2xl font-bold text-orange-600">{lowStockCount}</span>
            <span className="text-xs font-semibold text-orange-700">Low Stock</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Based on physical minus franchisee reservations
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setActiveTab('requests')}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === 'requests'
              ? 'border-rose-600 text-rose-700'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          Requests &amp; Recommendations
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('settings')}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === 'settings'
              ? 'border-rose-600 text-rose-700'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          Settings &amp; Calculation Preview
        </button>
      </div>

      {activeTab === 'requests' ? (
        <div className="space-y-6">
          {/* Restock Recommendations Section (No Stock First) */}
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Restock Recommendations
                </h2>
                <p className="text-xs text-slate-500">
                  All Low Stock and No Stock products for this warehouse, prioritized with No Stock first.
                </p>
              </div>
              <span className="text-xs font-mono text-slate-500">
                {recommendations.length} product(s) requiring attention
              </span>
            </div>

            {recommendations.length === 0 ? (
              <div className="p-4 rounded-lg bg-emerald-50/70 border border-emerald-200 text-xs text-emerald-900">
                All active products in this warehouse are currently <strong>In Stock</strong> above
                their reorder points.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-slate-200 font-semibold text-slate-500">
                      <th className="py-2.5 pr-3">Product</th>
                      <th className="py-2.5 pr-3">Status</th>
                      <th className="py-2.5 pr-3 text-right">Available (Phys − Res)</th>
                      <th className="py-2.5 pr-3 text-right">Reorder Pt</th>
                      <th className="py-2.5 pr-3 text-right">Recommended Qty</th>
                      <th className="py-2.5 pr-3">Recommendation</th>
                      <th className="py-2.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {recommendations.map((rec) => (
                      <tr
                        key={rec.product_id}
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
                          <div className="font-mono text-[11px] text-slate-500">
                            {rec.sku} · Target {rec.target_quantity}
                          </div>
                        </td>
                        <td className="py-2.5 pr-3">
                          <StockStatusBadge status={rec.stock_status} />
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                          <strong className="text-slate-900">{rec.available_stock}</strong>
                          <div className="text-[10px] text-slate-500">
                            ({rec.physical_stock} − {rec.reserved_stock})
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-slate-700">
                          {rec.reorder_point}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums font-bold text-slate-900">
                          {rec.suggested_qty}
                          {(rec.was_capped || rec.was_capped_by_capacity) && (
                            <span className="ml-1 text-[10px] font-semibold text-amber-700">
                              (capped)
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3">
                          <span
                            className={`font-semibold ${
                              rec.stock_status === 'No Stock'
                                ? 'text-rose-700'
                                : 'text-orange-700'
                            }`}
                          >
                            {rec.recommendation_label}
                          </span>
                          {rec.active_restock && (
                            <div className="text-[11px] font-mono text-slate-500">
                              {rec.active_restock.request_number} ({rec.active_restock.status})
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 text-right">
                          {rec.active_restock ? (
                            <button
                              type="button"
                              onClick={() =>
                                openRequestDetail(
                                  rec.active_restock.id ?? rec.active_restock.request_id,
                                  rec.active_restock.status === 'Approved/In Transit'
                                    ? 'receive'
                                    : 'view'
                                )
                              }
                              className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap ${
                                rec.stock_status === 'No Stock'
                                  ? 'bg-rose-600 text-white hover:bg-rose-700'
                                  : 'bg-slate-900 text-white hover:bg-slate-800'
                              }`}
                            >
                              {rec.active_restock.status === 'Draft'
                                ? `Open Draft (${rec.active_restock.request_number})`
                                : `View Transit (${rec.active_restock.request_number})`}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={handleRunMonthlyCheck}
                              className="px-3 py-1.5 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                            >
                              Create Draft
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Restock Requests List */}
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Supplier Restock Requests
                </h2>
                <p className="text-xs text-slate-500">
                  Review drafts, approve deliveries within warehouse capacity, and confirm received shipments.
                </p>
              </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="search"
                aria-label="Search restock requests"
                placeholder="Search request #, product, or SKU..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full sm:w-64 px-3 py-1.5 rounded-lg border border-slate-300 text-xs"
              />
              <select
                aria-label="Filter by status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
              >
                <option value="">All Statuses</option>
                <option value="Draft">Draft</option>
                <option value="Approved/In Transit">Approved/In Transit</option>
                <option value="Received">Received</option>
                <option value="Rejected">Rejected</option>
                <option value="Cancelled">Cancelled</option>
              </select>
              <select
                aria-label="Filter by priority"
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
              >
                <option value="">All Priorities</option>
                <option value="high">High Priority</option>
                <option value="normal">Normal Priority</option>
              </select>
              <select
                aria-label="Filter by trigger"
                value={triggerFilter}
                onChange={(e) => setTriggerFilter(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
              >
                <option value="">All Triggers</option>
                <option value="monthly">Monthly Schedule</option>
                <option value="low_stock">Low Stock Alert</option>
                <option value="no_stock">No Stock (Urgent)</option>
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-slate-200 font-semibold text-slate-500">
                    <th className="py-2.5 pr-3">Request #</th>
                    <th className="py-2.5 pr-3">Trigger &amp; Priority</th>
                    <th className="py-2.5 pr-3">Products</th>
                    <th className="py-2.5 pr-3 text-right">Approved / Suggested</th>
                    <th className="py-2.5 pr-3">Expected Arrival</th>
                    <th className="py-2.5 pr-3">Status</th>
                    <th className="py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {requests.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500">
                        No restock requests match the current filter.
                      </td>
                    </tr>
                  ) : (
                    requests.map((reqRow) => (
                      <tr key={reqRow.id} className="hover:bg-slate-50">
                        <td className="py-2.5 pr-3">
                          <div className="font-mono font-bold text-slate-900">
                            {reqRow.request_number}
                          </div>
                          <div className="text-[11px] text-slate-500">{reqRow.warehouse_name}</div>
                        </td>
                        <td className="py-2.5 pr-3">
                          <div className="font-medium text-slate-800">
                            {TRIGGER_LABELS[reqRow.trigger_type] || reqRow.trigger_type}
                          </div>
                          <span
                            className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                              reqRow.priority === 'high'
                                ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                : 'bg-slate-100 text-slate-600 border border-slate-200'
                            }`}
                          >
                            {reqRow.priority === 'high' ? 'HIGH PRIORITY' : 'Normal'}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 max-w-xs">
                          <div className="text-slate-800 font-medium truncate">
                            {reqRow.product_names || `${reqRow.items_count} item(s)`}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {reqRow.items_count} SKU(s)
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                          <div className="font-bold text-slate-900">
                            {reqRow.total_approved_qty} units
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {reqRow.status === 'Received'
                              ? `Received: ${reqRow.total_received_qty}`
                              : `Suggested: ${reqRow.total_suggested_qty}`}
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 font-mono">
                          {reqRow.expected_arrival_date ? (
                            <div className="flex items-center gap-1.5">
                              <span>{reqRow.expected_arrival_date}</span>
                              {reqRow.is_overdue && (
                                <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold">
                                  OVERDUE
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400">Pending approval</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3">
                          <StatusText status={reqRow.status} />
                        </td>
                        <td className="py-2.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {reqRow.status === 'Draft' ? (
                              <button
                                type="button"
                                onClick={() => openRequestDetail(reqRow.id, 'view')}
                                className="px-3 py-1.5 rounded-md bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 whitespace-nowrap"
                              >
                                Review {reqRow.request_number}
                              </button>
                            ) : reqRow.status === 'Approved/In Transit' ? (
                              <button
                                type="button"
                                onClick={() => openRequestDetail(reqRow.id, 'receive')}
                                className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 whitespace-nowrap"
                              >
                                Receive {reqRow.request_number}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => openRequestDetail(reqRow.id, 'view')}
                                className="px-3 py-1.5 rounded-md border border-slate-300 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 whitespace-nowrap"
                              >
                                Details {reqRow.request_number}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <PaginationBar pagination={pagination} onPageChange={(p) => loadRequests(p)} />
          </div>
        </div>
      ) : (
        /* TAB 2: SETTINGS & LIVE CALCULATION PREVIEW */
        <form onSubmit={handleSaveSettings} className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Warehouse Capacity &amp; Lead Time Settings
                </h2>
                <p className="text-xs text-slate-500">
                  Set supplier delivery lead time and warehouse maximum storage capacity.
                </p>
              </div>
              <button
                type="submit"
                disabled={savingSettings}
                className="px-4 py-2 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 disabled:opacity-50"
              >
                {savingSettings ? 'Saving Settings...' : 'Save Restocking Settings'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label
                  htmlFor="setting-capacity"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Warehouse Capacity Limit (Total Units)
                </label>
                <input
                  id="setting-capacity"
                  type="number"
                  min={1}
                  required
                  value={capacityLimit}
                  onChange={(e) => setCapacityLimit(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
                />
              </div>

              <div>
                <label
                  htmlFor="setting-lead-time"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Supplier Delivery Lead Time (Days)
                </label>
                <input
                  id="setting-lead-time"
                  type="number"
                  min={1}
                  max={90}
                  required
                  value={leadTimeDays}
                  onChange={(e) => setLeadTimeDays(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
                />
              </div>

              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex flex-col justify-center">
                <div className="text-[11px] font-semibold text-slate-500 uppercase">
                  Sum of Product Targets
                </div>
                <div
                  className={`text-lg font-bold font-mono tabular-nums ${
                    settingsCapacityWarning.exceeds ? 'text-rose-700' : 'text-emerald-700'
                  }`}
                >
                  {settingsTotalTargets} / {parsedCapacity} units
                </div>
              </div>
            </div>

            {settingsCapacityWarning.exceeds && (
              <div
                role="alert"
                className="p-3.5 rounded-lg border border-rose-300 bg-rose-50 text-xs text-rose-900"
              >
                <strong>Warning:</strong> Total product targets ({settingsTotalTargets} units)
                exceed the configured warehouse capacity ({parsedCapacity} units) by{' '}
                <strong>{settingsCapacityWarning.excess} units</strong>. Consider raising warehouse
                capacity or lowering targets.
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Per-Product Targets, Safety Stock &amp; Live Formula Preview
              </h2>
              <p className="text-xs text-slate-500">
                Formula: Reorder Point = (Avg Daily Orders × Lead Time) + Safety Stock · Suggested
                Qty = max(0, Target − Available + Avg Daily Orders × Lead Time), capped to capacity.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-slate-200 font-semibold text-slate-500">
                    <th className="py-2.5 pr-3">Product</th>
                    <th className="py-2.5 pr-3">Target Qty</th>
                    <th className="py-2.5 pr-3">Safety Stock</th>
                    <th className="py-2.5 pr-3">Max / Franchisee</th>
                    <th className="py-2.5 pr-3 text-right">Available</th>
                    <th className="py-2.5 pr-3 text-right">Avg/Day (30d)</th>
                    <th className="py-2.5 pr-3 text-right">Reorder Pt</th>
                    <th className="py-2.5 pr-3">Status</th>
                    <th className="py-2.5 text-right">Suggested Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {productSettings.map((ps, idx) => {
                    const live = previewMap[ps.id];
                    return (
                      <tr key={ps.id} className="hover:bg-slate-50">
                        <td className="py-2.5 pr-3">
                          <div className="font-semibold text-slate-900">{ps.name}</div>
                          <div className="font-mono text-[11px] text-slate-500">{ps.sku}</div>
                        </td>
                        <td className="py-2.5 pr-3">
                          <input
                            type="number"
                            min={0}
                            aria-label={`Target quantity for ${ps.name}`}
                            value={ps.target_quantity}
                            onChange={(e) => {
                              const next = [...productSettings];
                              next[idx] = { ...next[idx], target_quantity: e.target.value };
                              setProductSettings(next);
                            }}
                            className="w-20 px-2 py-1 rounded border border-slate-300 font-mono text-xs"
                          />
                        </td>
                        <td className="py-2.5 pr-3">
                          <input
                            type="number"
                            min={0}
                            aria-label={`Safety stock for ${ps.name}`}
                            value={ps.safety_stock}
                            onChange={(e) => {
                              const next = [...productSettings];
                              next[idx] = { ...next[idx], safety_stock: e.target.value };
                              setProductSettings(next);
                            }}
                            className="w-20 px-2 py-1 rounded border border-slate-300 font-mono text-xs"
                          />
                        </td>
                        <td className="py-2.5 pr-3">
                          <input
                            type="number"
                            min={1}
                            placeholder="No limit"
                            aria-label={`Max reservation limit for ${ps.name}`}
                            value={ps.max_reservation_qty}
                            onChange={(e) => {
                              const next = [...productSettings];
                              next[idx] = { ...next[idx], max_reservation_qty: e.target.value };
                              setProductSettings(next);
                            }}
                            className="w-24 px-2 py-1 rounded border border-slate-300 font-mono text-xs"
                          />
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                          <strong>{live?.available_stock ?? 0}</strong>
                          <div className="text-[10px] text-slate-500">
                            {live?.physical_stock ?? 0}p − {live?.reserved_stock ?? 0}r
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-slate-700">
                          {live?.avg_daily_orders ?? 0}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-slate-700">
                          {live?.reorder_point ?? 0}
                        </td>
                        <td className="py-2.5 pr-3">
                          <StockStatusBadge status={live?.stock_status || 'In Stock'} />
                        </td>
                        <td className="py-2.5 text-right font-mono tabular-nums font-bold text-slate-900">
                          {live?.suggested_qty ?? 0}
                          {(live?.was_capped || live?.was_capped_by_capacity) && (
                            <span className="ml-1 text-[10px] text-amber-700">(capped)</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </form>
      )}

      {/* REQUEST DETAIL / APPROVAL / RECEIVING MODAL */}
      {detailModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="restock-modal-title"
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <h2 id="restock-modal-title" className="text-base font-bold text-slate-900">
                  {detailData?.request
                    ? `${detailData.request.request_number} — ${detailData.request.warehouse_name}`
                    : 'Restock Request Details'}
                </h2>
                {detailData?.request && (
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <StatusText status={detailData.request.status} />
                    <span>·</span>
                    <span>
                      Trigger:{' '}
                      <strong>
                        {TRIGGER_LABELS[detailData.request.trigger_type] ||
                          detailData.request.trigger_type}
                      </strong>
                    </span>
                    <span>·</span>
                    <span
                      className={
                        detailData.request.priority === 'high'
                          ? 'text-rose-700 font-bold'
                          : 'text-slate-600 font-medium'
                      }
                    >
                      Priority: {detailData.request.priority === 'high' ? 'HIGH' : 'Normal'}
                    </span>
                    {detailData.request.expected_arrival_date && (
                      <>
                        <span>·</span>
                        <span className="font-mono">
                          Expected: {detailData.request.expected_arrival_date}
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setDetailModalOpen(false)}
                className="px-3 py-1.5 rounded-md border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              {detailLoading ? (
                <div className="py-10 text-center text-sm text-slate-500">
                  Loading restock request...
                </div>
              ) : !detailData?.request ? (
                <div className="p-4 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-800">
                  {detailError || 'Could not load restock request.'}
                </div>
              ) : (
                <>
                  {detailError && (
                    <div
                      role="alert"
                      className="p-3.5 rounded-lg border border-rose-200 bg-rose-50 text-xs font-medium text-rose-800"
                    >
                      {detailError}
                    </div>
                  )}

                  {/* Warehouse Capacity Meter for Draft / In Transit */}
                  {(detailData.request.status === 'Draft' ||
                    detailData.request.status === 'Approved/In Transit') && (
                    <div
                      className={`p-3.5 rounded-lg border text-xs space-y-1.5 ${
                        modalExceedsCapacity
                          ? 'border-rose-300 bg-rose-50 text-rose-900'
                          : 'border-slate-200 bg-slate-50 text-slate-800'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">
                          Capacity Check (Current Physical + Delivery Qty ≤ Warehouse Limit)
                        </span>
                        <span className="font-mono font-bold">
                          {modalCapCtx?.current_total_stock ?? 0} + {activeIncomingQty} ={' '}
                          {modalProjectedTotal} / {modalCapacityLimit} units
                        </span>
                      </div>
                      {modalExceedsCapacity && (
                        <div className="font-semibold text-rose-800">
                          Exceeds warehouse capacity by {modalProjectedTotal - modalCapacityLimit}{' '}
                          unit(s). Reduce item quantities below capacity before{' '}
                          {detailData.request.status === 'Draft' ? 'approving' : 'receiving'}.
                        </div>
                      )}
                    </div>
                  )}

                  {detailData.request.rejection_reason && (
                    <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-700">
                      <strong>Reason / Notes:</strong> {detailData.request.rejection_reason}
                    </div>
                  )}

                  {/* Items Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead>
                        <tr className="border-b border-slate-200 font-semibold text-slate-500">
                          <th className="py-2 pr-3">Product</th>
                          <th className="py-2 pr-3">Live Status</th>
                          <th className="py-2 pr-3 text-right">Target / Avail</th>
                          <th className="py-2 pr-3 text-right">Suggested</th>
                          <th className="py-2 pr-3 text-right">Approved Qty</th>
                          {(actionMode === 'receive' ||
                            detailData.request.status === 'Received') && (
                            <>
                              <th className="py-2 pr-3 text-right">Received Qty</th>
                              <th className="py-2 pr-3 text-right">Diff</th>
                              <th className="py-2">Difference Remark</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(detailData.items || []).map((it: any) => {
                          const recState = receiveInputs[it.id] || {
                            received_qty: String(it.approved_qty),
                            difference_remark: '',
                          };
                          const parsedRec = parseInt(recState.received_qty || '0', 10);
                          const liveDiff =
                            detailData.request.status === 'Received'
                              ? Number(it.difference_qty || 0)
                              : (Number.isFinite(parsedRec) ? parsedRec : 0) -
                                Number(it.approved_qty || 0);

                          return (
                            <tr key={it.id}>
                              <td className="py-2.5 pr-3">
                                <div className="font-semibold text-slate-900">
                                  {it.product_name}
                                </div>
                                <div className="font-mono text-[11px] text-slate-500">
                                  {it.sku}
                                </div>
                              </td>
                              <td className="py-2.5 pr-3">
                                <StockStatusBadge status={it.live_stock_status} />
                              </td>
                              <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-slate-700">
                                {it.live_target_quantity} / {it.live_available_stock}
                              </td>
                              <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-slate-600">
                                {it.suggested_qty}
                              </td>
                              <td className="py-2.5 pr-3 text-right font-mono">
                                {detailData.request.status === 'Draft' ? (
                                  <input
                                    type="number"
                                    min={0}
                                    aria-label={`Approved quantity for ${it.product_name}`}
                                    value={draftQtyMap[it.id] ?? String(it.approved_qty)}
                                    onChange={(e) =>
                                      setDraftQtyMap({
                                        ...draftQtyMap,
                                        [it.id]: e.target.value,
                                      })
                                    }
                                    className="w-20 px-2 py-1 rounded border border-slate-300 text-right font-mono text-xs"
                                  />
                                ) : (
                                  <strong className="text-slate-900">{it.approved_qty}</strong>
                                )}
                              </td>

                              {actionMode === 'receive' &&
                                detailData.request.status === 'Approved/In Transit' && (
                                  <>
                                    <td className="py-2.5 pr-3 text-right">
                                      <input
                                        type="number"
                                        min={0}
                                        aria-label={`Received quantity for ${it.product_name}`}
                                        value={recState.received_qty}
                                        onChange={(e) =>
                                          setReceiveInputs({
                                            ...receiveInputs,
                                            [it.id]: {
                                              ...recState,
                                              received_qty: e.target.value,
                                            },
                                          })
                                        }
                                        className="w-20 px-2 py-1 rounded border border-slate-300 text-right font-mono text-xs"
                                      />
                                    </td>
                                    <td
                                      className={`py-2.5 pr-3 text-right font-mono font-semibold ${
                                        liveDiff === 0
                                          ? 'text-emerald-700'
                                          : 'text-amber-700'
                                      }`}
                                    >
                                      {liveDiff > 0 ? `+${liveDiff}` : liveDiff}
                                    </td>
                                    <td className="py-2.5">
                                      <input
                                        type="text"
                                        aria-label={`Difference remark for ${it.product_name}`}
                                        placeholder={
                                          liveDiff !== 0
                                            ? 'Required: reason for difference'
                                            : 'Optional note'
                                        }
                                        value={recState.difference_remark}
                                        onChange={(e) =>
                                          setReceiveInputs({
                                            ...receiveInputs,
                                            [it.id]: {
                                              ...recState,
                                              difference_remark: e.target.value,
                                            },
                                          })
                                        }
                                        className={`w-full min-w-[160px] px-2 py-1 rounded border text-xs ${
                                          liveDiff !== 0 && !recState.difference_remark.trim()
                                            ? 'border-rose-400 bg-rose-50'
                                            : 'border-slate-300'
                                        }`}
                                      />
                                    </td>
                                  </>
                                )}

                              {detailData.request.status === 'Received' && (
                                <>
                                  <td className="py-2.5 pr-3 text-right font-mono font-bold text-emerald-700">
                                    {it.received_qty ?? it.approved_qty}
                                  </td>
                                  <td className="py-2.5 pr-3 text-right font-mono text-slate-600">
                                    {liveDiff > 0 ? `+${liveDiff}` : liveDiff}
                                  </td>
                                  <td className="py-2.5 text-slate-600">
                                    {it.difference_remark || '—'}
                                  </td>
                                </>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Inline Action Panels */}
                  {detailData.request.status === 'Draft' && (
                    <div className="pt-3 border-t border-slate-200 space-y-3">
                      {actionMode === 'reject' ? (
                        <div className="p-3.5 rounded-lg border border-rose-200 bg-rose-50 space-y-3">
                          <label
                            htmlFor="reject-reason-input"
                            className="block text-xs font-semibold text-rose-900"
                          >
                            Rejection Reason (Required)
                          </label>
                          <textarea
                            id="reject-reason-input"
                            rows={2}
                            value={reasonInput}
                            onChange={(e) => setReasonInput(e.target.value)}
                            placeholder="Explain why this restock draft is being rejected..."
                            className="w-full px-3 py-2 rounded-lg border border-rose-300 bg-white text-xs"
                          />
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setActionMode('view')}
                              className="px-3 py-1.5 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-700"
                            >
                              Back
                            </button>
                            <button
                              type="button"
                              disabled={detailBusy}
                              onClick={handleRejectDraft}
                              className="px-3.5 py-1.5 rounded-md bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 disabled:opacity-50"
                            >
                              {detailBusy ? 'Rejecting...' : 'Confirm Reject Draft'}
                            </button>
                          </div>
                        </div>
                      ) : actionMode === 'confirm_approve' ? (
                        <div className="p-3.5 rounded-lg border border-blue-200 bg-blue-50 space-y-3">
                          <div className="text-xs text-blue-950">
                            <strong>Confirm Approval:</strong> Approving{' '}
                            <strong>{detailData.request.request_number}</strong> for{' '}
                            <strong className="font-mono">{draftTotalQty} total units</strong> will
                            mark it <strong>Approved/In Transit</strong> with expected arrival in{' '}
                            {modalCapCtx?.lead_time_days ?? 7} day(s).
                          </div>
                          <div>
                            <label
                              htmlFor="approve-remarks"
                              className="block text-xs font-semibold text-blue-900 mb-1"
                            >
                              Optional Delivery Remarks
                            </label>
                            <input
                              id="approve-remarks"
                              type="text"
                              value={remarksInput}
                              onChange={(e) => setRemarksInput(e.target.value)}
                              placeholder="Supplier PO reference or cold-chain note..."
                              className="w-full px-3 py-1.5 rounded-lg border border-blue-300 bg-white text-xs"
                            />
                          </div>
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setActionMode('view')}
                              className="px-3 py-1.5 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-700"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              disabled={detailBusy}
                              onClick={handleApproveDraft}
                              className="px-4 py-1.5 rounded-md bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 disabled:opacity-50"
                            >
                              {detailBusy ? 'Approving...' : 'Confirm & Approve Delivery'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <button
                            type="button"
                            disabled={detailBusy}
                            onClick={() => {
                              setDetailError('');
                              setActionMode('reject');
                            }}
                            className="px-3.5 py-2 rounded-lg border border-rose-300 bg-white text-rose-700 text-xs font-semibold hover:bg-rose-50"
                          >
                            Reject Draft
                          </button>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={detailBusy}
                              onClick={handleSaveDraftQuantities}
                              className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50"
                            >
                              Save Quantities
                            </button>
                            <button
                              type="button"
                              disabled={detailBusy || modalExceedsCapacity || draftTotalQty <= 0}
                              onClick={() => {
                                setDetailError('');
                                setActionMode('confirm_approve');
                              }}
                              className="px-4 py-2 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Approve Delivery ({draftTotalQty} units)
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {detailData.request.status === 'Approved/In Transit' && (
                    <div className="pt-3 border-t border-slate-200 space-y-3">
                      {actionMode === 'cancel' ? (
                        <div className="p-3.5 rounded-lg border border-rose-200 bg-rose-50 space-y-3">
                          <label
                            htmlFor="cancel-reason-input"
                            className="block text-xs font-semibold text-rose-900"
                          >
                            Cancellation Reason (Required)
                          </label>
                          <textarea
                            id="cancel-reason-input"
                            rows={2}
                            value={reasonInput}
                            onChange={(e) => setReasonInput(e.target.value)}
                            placeholder="Explain why this in-transit supplier delivery is cancelled..."
                            className="w-full px-3 py-2 rounded-lg border border-rose-300 bg-white text-xs"
                          />
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setActionMode('receive')}
                              className="px-3 py-1.5 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-700"
                            >
                              Back
                            </button>
                            <button
                              type="button"
                              disabled={detailBusy}
                              onClick={handleCancelInTransit}
                              className="px-3.5 py-1.5 rounded-md bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 disabled:opacity-50"
                            >
                              {detailBusy ? 'Cancelling...' : 'Confirm Cancel Delivery'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {actionMode === 'receive' && (
                            <div>
                              <label
                                htmlFor="receive-remarks"
                                className="block text-xs font-semibold text-slate-700 mb-1"
                              >
                                Receiving Notes (Optional)
                              </label>
                              <input
                                id="receive-remarks"
                                type="text"
                                value={remarksInput}
                                onChange={(e) => setRemarksInput(e.target.value)}
                                placeholder="Delivery receipt #, driver, or freezer temperature check..."
                                className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs"
                              />
                            </div>
                          )}

                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <button
                              type="button"
                              disabled={detailBusy}
                              onClick={() => {
                                setDetailError('');
                                setActionMode('cancel');
                              }}
                              className="px-3.5 py-2 rounded-lg border border-rose-300 bg-white text-rose-700 text-xs font-semibold hover:bg-rose-50"
                            >
                              Cancel Delivery
                            </button>

                            {actionMode === 'receive' ? (
                              <button
                                type="button"
                                disabled={detailBusy || modalExceedsCapacity}
                                onClick={handleConfirmReceive}
                                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {detailBusy
                                  ? 'Confirming Receipt...'
                                  : `Confirm Received (+${receiveTotalQty} units)`}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setActionMode('receive')}
                                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
                              >
                                Enter Received Quantities
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
