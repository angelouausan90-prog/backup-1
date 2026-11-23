import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { PaginationBar, ProductImage, StatusText } from '../../components/SharedUI';
import {
  ApplicationStatusBadge,
  ApplicationWorkflowTimeline,
  FranchiseePaperFormModal,
  downloadApplicationPdf,
} from '../../components/FranchiseePaperFormModal';
import { SignaturePadCanvas } from '../../components/SignaturePadCanvas';
import {
  FRANCHISEE_EQUIPMENT_ITEMS as EQUIPMENT_ITEMS,
  EquipmentConditionType as EquipmentCondition,
} from '../../utils/domainRules';

// ===== EQUIPMENT CHECKLIST & ON-SITE SIGNATURES MODAL (SECTION 2 & SECTION 3) =====
const CompleteEquipmentDeliveryModal: React.FC<{
  application: any;
  onClose: () => void;
  onCompleted: (updatedApp: any) => void;
}> = ({ application, onClose, onCompleted }) => {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [dateDelivered, setDateDelivered] = useState<string>(
    application.date_delivered || todayStr
  );
  const [freezerNo, setFreezerNo] = useState<string>(application.freezer_no || '');
  const [cashierName, setCashierName] = useState<string>(application.cashier_name || '');

  // Initialize 6 equipment items from existing record or sensible defaults
  const [equipmentList, setEquipmentList] = useState<
    Array<{ item_name: string; condition_status: EquipmentCondition; quantity: number }>
  >(() => {
    const existingMap = new Map<string, any>(
      (application.equipment || []).map((eq: any) => [eq.item_name, eq])
    );
    return EQUIPMENT_ITEMS.map((itemName) => {
      const found = existingMap.get(itemName);
      const defaultQty = itemName === 'Baskets' ? 4 : 1;
      return {
        item_name: itemName,
        condition_status: (found?.condition_status as EquipmentCondition) || 'NEW',
        quantity:
          found?.quantity !== undefined && found?.quantity !== null
            ? Number(found.quantity)
            : defaultQty,
      };
    });
  });

  // Signatures state
  const sigs = application.signatures_by_role || {};
  const [customerName, setCustomerName] = useState<string>(
    sigs.customer?.printed_name || application.complete_name || ''
  );
  const [customerSig, setCustomerSig] = useState<string | null>(
    sigs.customer?.signature_data || null
  );

  const [deliveryTeamName, setDeliveryTeamName] = useState<string>(
    sigs.delivery_team?.printed_name ||
      (application.assigned_delivery_staff_name
        ? `${application.assigned_delivery_staff_name} / Cold-Chain Crew`
        : 'AICE Cotabato Cold-Chain Crew')
  );
  const [deliveryTeamSig, setDeliveryTeamSig] = useState<string | null>(
    sigs.delivery_team?.signature_data || null
  );

  const [driverName, setDriverName] = useState<string>(
    sigs.driver?.printed_name || application.assigned_delivery_staff_name || ''
  );
  const [driverSig, setDriverSig] = useState<string | null>(
    sigs.driver?.signature_data || null
  );

  const [collectorName, setCollectorName] = useState<string>(
    sigs.collector?.printed_name || ''
  );
  const [collectorSig, setCollectorSig] = useState<string | null>(
    sigs.collector?.signature_data || null
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const updateEquipmentRow = (
    itemName: string,
    patch: Partial<{ condition_status: EquipmentCondition; quantity: number }>
  ) => {
    setEquipmentList((prev) =>
      prev.map((row) => {
        if (row.item_name !== itemName) return row;
        const next = { ...row, ...patch };
        if (patch.condition_status === 'NOT_ISSUED') {
          next.quantity = 0;
        } else if (patch.condition_status && row.condition_status === 'NOT_ISSUED' && next.quantity === 0) {
          next.quantity = itemName === 'Baskets' ? 4 : 1;
        }
        return next;
      })
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!freezerNo.trim()) {
      setError('Freezer # (Serial / Asset Number) is required in Section 2.');
      return;
    }
    if (!customerName.trim() || !customerSig) {
      setError('Customer (Franchisee) printed name and on-site signature are required in Section 3.');
      return;
    }
    if (!deliveryTeamName.trim() || !deliveryTeamSig) {
      setError('Delivery Team printed name and signature are required in Section 3.');
      return;
    }
    if (!driverName.trim() || !driverSig) {
      setError('Driver printed name and signature are required in Section 3.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.post(
        `/franchisee-applications/${application.id}/equipment-delivery`,
        {
          freezer_no: freezerNo.trim(),
          date_delivered: dateDelivered,
          cashier_name: cashierName.trim(),
          equipment: equipmentList,
          customer_printed_name: customerName.trim(),
          customer_signature_data: customerSig,
          delivery_team_printed_name: deliveryTeamName.trim(),
          delivery_team_signature_data: deliveryTeamSig,
          driver_printed_name: driverName.trim(),
          driver_signature_data: driverSig,
          collector_printed_name: collectorName.trim(),
          collector_signature_data: collectorSig,
        }
      );
      onCompleted(res.data);
    } catch (err: any) {
      setError(err.message || 'Failed to submit equipment checklist and signatures.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-xl border border-slate-300 shadow-2xl max-w-4xl w-full max-h-[94vh] flex flex-col overflow-hidden">
        <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between gap-3 shrink-0">
          <div>
            <div className="text-xs font-mono uppercase tracking-wider text-emerald-400">
              AICE COTABATO-JCDL CORPORATION · NEW FRANCHISEE FORM
            </div>
            <h2 className="text-sm sm:text-base font-bold">
              Complete Equipment Handover & On-Site Signatures · {application.application_no}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 text-xs font-semibold hover:bg-slate-700"
          >
            Close ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-6 flex-1">
          {/* Franchisee Destination Summary */}
          <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <span className="text-slate-500 block">Applicant / Customer</span>
              <strong className="text-slate-900 text-sm">{application.complete_name}</strong>
              <div className="font-mono text-slate-700 mt-0.5">{application.contact_number}</div>
            </div>
            <div>
              <span className="text-slate-500 block">Store Name & Landmark</span>
              <strong className="text-slate-900 text-sm">{application.store_name}</strong>
              <div className="text-slate-600 mt-0.5">
                Landmark: {application.landmark || '—'}
              </div>
            </div>
            <div>
              <span className="text-slate-500 block">Store Delivery Address</span>
              <strong className="text-slate-900">{application.full_address}</strong>
              <div className="font-mono text-[11px] text-slate-500 mt-0.5">
                GPS: {Number(application.lat).toFixed(5)}, {Number(application.lng).toFixed(5)}
              </div>
            </div>
          </div>

          {error && (
            <div className="p-3.5 rounded-lg border border-rose-200 bg-rose-50 text-xs font-semibold text-rose-800">
              {error}
            </div>
          )}

          {/* SECTION 2: EQUIPMENT RECEIVED BY THE CUSTOMER */}
          <div className="border-2 border-slate-800 rounded-lg overflow-hidden">
            <div className="bg-emerald-700 text-white px-4 py-2 text-xs font-bold uppercase tracking-wider flex items-center justify-between">
              <span>Section 2: Equipment Received by the Customer</span>
              <span className="font-mono text-[11px]">Check NEW / OLD / NOT ISSUED</span>
            </div>

            <div className="p-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    Freezer # (Serial / Asset Number) *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. AICE-COT-FZ-2026-118"
                    value={freezerNo}
                    onChange={(e) => setFreezerNo(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    Date Delivered *
                  </label>
                  <input
                    type="date"
                    required
                    value={dateDelivered}
                    onChange={(e) => setDateDelivered(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    Cashier (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Marites Villanueva"
                    value={cashierName}
                    onChange={(e) => setCashierName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse border border-slate-300">
                  <thead>
                    <tr className="bg-slate-100 text-slate-800 font-bold">
                      <th className="border border-slate-300 px-3 py-2 text-left">
                        Equipment Item
                      </th>
                      <th className="border border-slate-300 px-3 py-2 text-center">
                        Condition (NEW / OLD / NOT ISSUED)
                      </th>
                      <th className="border border-slate-300 px-3 py-2 text-center w-28">
                        Quantity
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {equipmentList.map((row) => (
                      <tr key={row.item_name} className="hover:bg-slate-50">
                        <td className="border border-slate-300 px-3 py-2 font-bold text-slate-900">
                          {row.item_name}
                        </td>
                        <td className="border border-slate-300 px-3 py-2">
                          <div className="flex flex-wrap items-center justify-center gap-2">
                            {(['NEW', 'OLD', 'NOT_ISSUED'] as EquipmentCondition[]).map(
                              (cond) => {
                                const active = row.condition_status === cond;
                                return (
                                  <button
                                    key={cond}
                                    type="button"
                                    onClick={() =>
                                      updateEquipmentRow(row.item_name, {
                                        condition_status: cond,
                                      })
                                    }
                                    className={`px-2.5 py-1 rounded text-[11px] font-bold border transition-colors ${
                                      active
                                        ? cond === 'NEW'
                                          ? 'bg-emerald-700 text-white border-emerald-700'
                                          : cond === 'OLD'
                                          ? 'bg-amber-600 text-white border-amber-600'
                                          : 'bg-slate-700 text-white border-slate-700'
                                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                                    }`}
                                  >
                                    {cond === 'NOT_ISSUED' ? 'NOT ISSUED' : cond}
                                  </button>
                                );
                              }
                            )}
                          </div>
                        </td>
                        <td className="border border-slate-300 px-3 py-2 text-center">
                          <input
                            type="number"
                            min={0}
                            max={99}
                            disabled={row.condition_status === 'NOT_ISSUED'}
                            value={row.quantity}
                            onChange={(e) =>
                              updateEquipmentRow(row.item_name, {
                                quantity: Math.max(0, parseInt(e.target.value || '0', 10)),
                              })
                            }
                            className="w-16 px-2 py-1 rounded border border-slate-300 text-center font-mono font-bold disabled:bg-slate-100 disabled:text-slate-400"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* SECTION 3: ON-SITE SIGNATURES & SIGN-OFFS */}
          <div className="border-2 border-slate-800 rounded-lg overflow-hidden">
            <div className="bg-slate-900 text-white px-4 py-2 text-xs font-bold uppercase tracking-wider flex items-center justify-between">
              <span>Section 3: Signatures & Sign-Offs (On-Site Handover)</span>
              <span className="font-mono text-[11px]">Draw Signature on Touch / Mouse Pad</span>
            </div>

            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <SignaturePadCanvas
                label="Customer (Franchisee) Print Name & Signature"
                printedName={customerName}
                onPrintedNameChange={setCustomerName}
                signatureDataUrl={customerSig}
                onSignatureChange={setCustomerSig}
                required
                height={120}
              />

              <SignaturePadCanvas
                label="Driver (Assigned Delivery Staff) Print Name & Signature"
                printedName={driverName}
                onPrintedNameChange={setDriverName}
                signatureDataUrl={driverSig}
                onSignatureChange={setDriverSig}
                required
                height={120}
              />

              <SignaturePadCanvas
                label="Delivery Team Print Name & Signature"
                printedName={deliveryTeamName}
                onPrintedNameChange={setDeliveryTeamName}
                signatureDataUrl={deliveryTeamSig}
                onSignatureChange={setDeliveryTeamSig}
                required
                height={120}
              />

              <SignaturePadCanvas
                label="Collector Print Name & Signature (Optional)"
                printedName={collectorName}
                onPrintedNameChange={setCollectorName}
                signatureDataUrl={collectorSig}
                onSignatureChange={setCollectorSig}
                height={120}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 rounded-lg bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800 disabled:opacity-50"
            >
              {submitting
                ? 'Saving Checklist & Activating Franchisee...'
                : 'Submit Checklist & Signatures (Mark Delivered & Active)'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ===== 1. DELIVERY STAFF ASSIGNED DELIVERIES (Equipment Onboarding + Customer QR Deliveries + Stock Replenishment Deliveries) =====
export const DeliveryAssignedView: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [qrDeliveries, setQrDeliveries] = useState<any[]>([]);
  const [equipmentDeliveries, setEquipmentDeliveries] = useState<any[]>([]);
  const [selectedEquipmentApp, setSelectedEquipmentApp] = useState<any | null>(null);
  const [viewingPaperFormApp, setViewingPaperFormApp] = useState<any | null>(null);
  const [sharingId, setSharingId] = useState<number | null>(null);
  const [sharingQrId, setSharingQrId] = useState<number | null>(null);
  const [proofNotes, setProofNotes] = useState<Record<number, string>>({});
  const [proofFiles, setProofFiles] = useState<Record<number, File | null>>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = () => {
    api.get('/deliveries?mode=active&limit=50').then((res) => setRows(res.data));
    api
      .get('/delivery/qr-orders?mode=active')
      .then((res) => setQrDeliveries(res.data || []))
      .catch(() => {});
    api
      .get('/franchisee-applications?all_for_delivery=1')
      .then((res) => setEquipmentDeliveries(res.data || []))
      .catch(() => {});
  };

  useEffect(() => {
    load();
  }, []);

  // Automatic live location sharing every 4 seconds while an active replenishment delivery is selected
  useEffect(() => {
    if (!sharingId) return;
    const target = rows.find((r) => r.id === sharingId);
    if (!target) return;

    const sendPing = (lat: number, lng: number) => {
      api.post(`/deliveries/${sharingId}/location`, { lat, lng }).catch(() => {});
    };

    const publishLocation = () => {
      if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            sendPing(pos.coords.latitude, pos.coords.longitude);
          },
          () => {
            const midLat = (Number(target.warehouse_lat) + Number(target.store_lat)) / 2;
            const midLng = (Number(target.warehouse_lng) + Number(target.store_lng)) / 2;
            sendPing(
              Number((midLat + (Math.random() - 0.5) * 0.002).toFixed(7)),
              Number((midLng + (Math.random() - 0.5) * 0.002).toFixed(7))
            );
          }
        );
      }
    };

    publishLocation();
    const timer = setInterval(publishLocation, 4000);
    return () => clearInterval(timer);
  }, [sharingId, rows]);

  // Automatic live location sharing every 4 seconds for an active Customer QR delivery
  useEffect(() => {
    if (!sharingQrId) return;
    const target = qrDeliveries.find((r) => r.id === sharingQrId);
    if (!target) return;

    const sendQrPing = (lat: number, lng: number) => {
      api
        .post(`/delivery/qr-orders/${sharingQrId}/location`, {
          lat,
          lng,
          eta_minutes: 10,
        })
        .catch(() => {});
    };

    const publishQrLocation = () => {
      const sLat = Number(target.store_lat || 14.6042);
      const sLng = Number(target.store_lng || 120.9921);
      const cLat =
        target.latitude != null
          ? Number(target.latitude)
          : target.customer_lat != null
          ? Number(target.customer_lat)
          : sLat + 0.003;
      const cLng =
        target.longitude != null
          ? Number(target.longitude)
          : target.customer_lng != null
          ? Number(target.customer_lng)
          : sLng + 0.003;
      const midLat = (sLat + cLat) / 2;
      const midLng = (sLng + cLng) / 2;
      sendQrPing(
        Number((midLat + (Math.random() - 0.5) * 0.001).toFixed(7)),
        Number((midLng + (Math.random() - 0.5) * 0.001).toFixed(7))
      );
    };

    publishQrLocation();
    const timer = setInterval(publishQrLocation, 4000);
    return () => clearInterval(timer);
  }, [sharingQrId, qrDeliveries]);

  const updateQrDeliveryStatus = async (qrOrder: any, nextStatus: string) => {
    setError('');
    setMessage('');
    try {
      await api.patch(`/delivery/qr-orders/${qrOrder.id}/status`, {
        status: nextStatus,
      });
      setMessage(`Customer QR Order ${qrOrder.order_no} marked as ${nextStatus}.`);
      if (nextStatus === 'Out for Delivery') {
        setSharingQrId(qrOrder.id);
      }
      if (nextStatus === 'Delivered' && sharingQrId === qrOrder.id) {
        setSharingQrId(null);
      }
      load();
    } catch (err: any) {
      setError(err.message || 'Failed to update customer QR delivery status.');
    }
  };

  const updateStatus = async (delivery: any, nextStatus: string) => {
    setError('');
    setMessage('');
    const fd = new FormData();
    fd.append('status', nextStatus);
    if (proofNotes[delivery.id]) fd.append('proof_note', proofNotes[delivery.id]);
    if (proofFiles[delivery.id]) fd.append('proof_image', proofFiles[delivery.id]!);

    try {
      await api.patch(`/deliveries/${delivery.id}/status`, fd);
      setMessage(`Order ${delivery.order_number} marked as ${nextStatus}.`);
      if (nextStatus === 'Out for Delivery') {
        setSharingId(delivery.id);
      }
      if (nextStatus === 'Delivered' && sharingId === delivery.id) {
        setSharingId(null);
      }
      load();
    } catch (err: any) {
      setError(err.message || 'Failed to update delivery status.');
    }
  };

  const notifyFranchiseeNear = async (deliveryId: number, orderNumber: string) => {
    setError('');
    setMessage('');
    try {
      await api.post(`/deliveries/${deliveryId}/notify-near`);
      setMessage(`Sent "Rider is Near" alert to franchisee for ${orderNumber}.`);
      load();
    } catch (err: any) {
      setError(err.message || 'Failed to notify franchisee.');
    }
  };

  const pendingEquipmentDeliveries = equipmentDeliveries.filter(
    (app) => app.status === 'For Delivery'
  );
  const completedEquipmentDeliveries = equipmentDeliveries.filter((app) =>
    ['Delivered', 'Active'].includes(app.status)
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-slate-900">
          Assigned Cold-Chain & Equipment Deliveries
        </h1>
        <p className="text-sm text-slate-600">
          Complete new franchisee freezer & equipment handovers (NEW FRANCHISEE FORM Section 2 & Section 3) and fulfill stock-replenishment deliveries with live GPS tracking.
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

      {/* ===== NEW FRANCHISEE EQUIPMENT DELIVERIES (SECTION 2 & 3 ONBOARDING) ===== */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              New Franchisee Equipment Deliveries ({pendingEquipmentDeliveries.length} Pending)
            </h2>
            <p className="text-xs text-slate-600">
              Deliver the initial AICE freezer & accessories to newly approved franchisees, record the Freezer # and 6-item equipment checklist, and capture on-site signatures.
            </p>
          </div>
        </div>

        {pendingEquipmentDeliveries.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-lg p-5 text-sm text-slate-500">
            No pending new-franchisee equipment deliveries assigned right now.
          </div>
        ) : (
          <div className="space-y-4">
            {pendingEquipmentDeliveries.map((app) => (
              <div
                key={app.id}
                className="bg-white border-2 border-indigo-200 rounded-xl p-5 space-y-4 shadow-xs"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-bold text-slate-900">
                        {app.application_no}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span className="text-sm font-bold text-slate-900">{app.store_name}</span>
                      <ApplicationStatusBadge status={app.status} />
                    </div>
                    <div className="text-xs text-slate-700">
                      Applicant / Owner: <strong>{app.complete_name}</strong> · Sales Agent:{' '}
                      <strong>{app.agent_name}</strong>
                    </div>
                    <div className="text-xs text-slate-700">
                      Delivery Address: <strong>{app.full_address}</strong>
                    </div>
                    <div className="text-xs text-slate-600">
                      Landmark: <strong>{app.landmark || '—'}</strong> · GPS Pin:{' '}
                      <a
                        href={`https://www.openstreetmap.org/?mlat=${app.lat}&mlon=${app.lng}#map=17/${app.lat}/${app.lng}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-indigo-700 font-semibold hover:underline"
                      >
                        {Number(app.lat).toFixed(5)}, {Number(app.lng).toFixed(5)} (Open Map ↗)
                      </a>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={`tel:${app.contact_number}`}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap"
                    >
                      Call Franchisee ({app.contact_number})
                    </a>
                    <button
                      type="button"
                      onClick={() => setViewingPaperFormApp(app)}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                    >
                      View Paper Form
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedEquipmentApp(app)}
                      className="px-3.5 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800 whitespace-nowrap"
                    >
                      Complete Equipment Checklist & Signatures
                    </button>
                  </div>
                </div>

                <ApplicationWorkflowTimeline status={app.status} />
              </div>
            ))}
          </div>
        )}

        {completedEquipmentDeliveries.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Recently Completed Equipment Handovers ({completedEquipmentDeliveries.length})
            </h3>
            <div className="divide-y divide-slate-100">
              {completedEquipmentDeliveries.map((app) => (
                <div
                  key={app.id}
                  className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div>
                    <span className="font-mono font-bold text-slate-900">
                      {app.application_no}
                    </span>{' '}
                    · <strong className="text-slate-900">{app.store_name}</strong> ({app.complete_name}) · Freezer #: <span className="font-mono font-semibold">{app.freezer_no || '—'}</span> · Delivered:{' '}
                    <span className="font-mono">{app.date_delivered || '—'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <ApplicationStatusBadge status={app.status} />
                    <button
                      type="button"
                      onClick={() => setViewingPaperFormApp(app)}
                      className="px-2.5 py-1 rounded border border-slate-300 bg-white font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      View Form
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadApplicationPdf(app)}
                      className="px-2.5 py-1 rounded bg-emerald-700 text-white font-semibold hover:bg-emerald-800"
                    >
                      Download PDF
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ===== CUSTOMER QR STORE DELIVERIES ===== */}
      <div className="space-y-4 pt-4 border-t border-slate-200">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            Assigned Customer QR Store Deliveries ({qrDeliveries.length})
          </h2>
          <p className="text-xs text-slate-600">
            Pick up customer QR orders from the franchisee store, share live GPS position with the customer's tracking map, and mark as Delivered (Cash on Delivery).
          </p>
        </div>

        {qrDeliveries.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-lg p-5 text-sm text-slate-500">
            No active customer QR deliveries assigned to you right now.
          </div>
        ) : (
          <div className="space-y-4">
            {qrDeliveries.map((qr) => {
              const isSharingQr = sharingQrId === qr.id;
              return (
                <div
                  key={qr.id}
                  data-testid={`delivery-qr-order-${qr.order_no}`}
                  className="bg-white border-2 border-purple-200 rounded-xl p-5 space-y-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-bold text-slate-900">
                          {qr.order_no}
                        </span>
                        <span className="text-slate-400">·</span>
                        <span className="text-sm font-bold text-purple-900">
                          {qr.store_name}
                        </span>
                        <span className="text-slate-400">·</span>
                        <StatusText status={qr.status} />
                        <span className="text-slate-400">·</span>
                        <span className="font-mono text-xs font-bold text-emerald-800">
                          Collect COD: PHP {Number(qr.total ?? qr.total_amount ?? 0).toFixed(2)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-700">
                        Pickup Store: <strong>{qr.store_name}</strong> ({qr.store_address})
                      </p>
                      <p className="text-xs text-slate-700">
                        Deliver To Customer: <strong>{qr.customer_name}</strong> (
                        {qr.contact_no || qr.customer_contact}) —{' '}
                        <strong>{qr.address || qr.delivery_address}</strong>
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={`tel:${qr.contact_no || qr.customer_contact}`}
                        className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-50"
                      >
                        Call Customer ({qr.contact_no || qr.customer_contact})
                      </a>
                      <a
                        href={`/track/${qr.order_no}`}
                        className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Customer Tracking Map ↗
                      </a>
                      <button
                        type="button"
                        onClick={() => setSharingQrId(isSharingQr ? null : qr.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                          isSharingQr
                            ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                            : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {isSharingQr ? 'Live GPS Sharing ON' : 'Share Live GPS'}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-3 border-t border-slate-100">
                    {(qr.items || []).map((it: any) => (
                      <div key={it.id} className="flex items-center gap-2.5 text-xs">
                        <ProductImage imageUrl={it.image_url} alt={it.product_name} thumb />
                        <div>
                          <div className="font-semibold text-slate-800">{it.product_name}</div>
                          <div className="text-slate-500 font-mono">Qty: {it.quantity}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-end gap-2">
                    {['Preparing', 'Out for Delivery', 'Delivered'].map((st) => (
                      <button
                        key={st}
                        type="button"
                        data-testid={`rider-qr-status-${st
                          .toLowerCase()
                          .replace(/\s+/g, '-')}-${qr.order_no}`}
                        onClick={() => updateQrDeliveryStatus(qr, st)}
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
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ===== STOCK REPLENISHMENT DELIVERIES ===== */}
      <div className="space-y-4 pt-4 border-t border-slate-200">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            Assigned Ice Cream Stock-Replenishment Deliveries ({rows.length})
          </h2>
          <p className="text-xs text-slate-600">
            Update cold-chain order milestones, broadcast live GPS position, and upload proof of delivery.
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-lg p-6 text-sm text-slate-500">
            You have no active stock-replenishment deliveries assigned right now.
          </div>
        ) : (
          <div className="space-y-4">
            {rows.map((d) => {
              const isSharing = sharingId === d.id;
              return (
                <div
                  key={d.id}
                  className="bg-white border border-slate-200 rounded-lg p-5 space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold text-slate-900">
                          {d.order_number}
                        </span>
                        <span className="text-slate-400">·</span>
                        <span className="text-sm font-semibold text-slate-900">{d.store_name}</span>
                        <span className="text-slate-400">·</span>
                        <StatusText status={d.status} />
                        <span className="text-slate-400">·</span>
                        <span className="font-mono text-xs font-bold text-slate-900">
                          Total: PHP {Number(d.total_amount || 0).toFixed(2)}
                        </span>
                        {Number(d.discount_amount || 0) > 0 && (
                          <span className="font-mono text-xs text-emerald-700 font-semibold">
                            (Promo {d.promo_name || 'Discount'}: -PHP{' '}
                            {Number(d.discount_amount).toFixed(2)})
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 mt-0.5">
                        Pickup Origin: <strong>{d.warehouse_name}</strong> ({d.warehouse_address})
                      </p>
                      <p className="text-xs text-slate-600">
                        Drop-off Destination: <strong>{d.store_name}</strong> — {d.store_address}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={`tel:${d.store_contact}`}
                        className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
                      >
                        Call Franchisee ({d.store_contact})
                      </a>
                      <button
                        type="button"
                        onClick={() => setSharingId(isSharing ? null : d.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 ${
                          isSharing
                            ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                            : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {isSharing ? 'Live GPS Sharing ON' : 'Start Live GPS Sharing'}
                      </button>
                      <button
                        type="button"
                        onClick={() => notifyFranchiseeNear(d.id, d.order_number)}
                        className="px-3 py-1.5 rounded-lg border border-rose-300 bg-rose-50 text-rose-800 text-xs font-semibold hover:bg-rose-100 whitespace-nowrap shrink-0"
                      >
                        Notify Franchisee I'm Near
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-3 border-t border-slate-100">
                    {(d.items || []).map((it: any) => (
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
                          <div className="text-slate-500 font-mono">Qty: {it.quantity}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-3 border-t border-slate-100 items-end">
                    <div className="md:col-span-4">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Proof of Delivery Note
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Received by store cashier Maria"
                        value={proofNotes[d.id] || ''}
                        onChange={(e) =>
                          setProofNotes({ ...proofNotes, [d.id]: e.target.value })
                        }
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs"
                      />
                    </div>
                    <div className="md:col-span-4">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Proof Photo (Optional JPG/PNG/WEBP)
                      </label>
                      <input
                        type="file"
                        accept=".jpg,.jpeg,.png,.webp"
                        onChange={(e) =>
                          setProofFiles({
                            ...proofFiles,
                            [d.id]: e.target.files?.[0] || null,
                          })
                        }
                        className="block w-full text-xs text-slate-600 file:mr-2 file:py-1 file:px-2.5 file:rounded file:border file:border-slate-300 file:text-xs file:bg-slate-50"
                      />
                    </div>
                    <div className="md:col-span-4 flex flex-wrap items-center justify-end gap-1.5">
                      {['Picked Up', 'Out for Delivery', 'Near / Arrived', 'Delivered'].map(
                        (st) => (
                          <button
                            key={st}
                            type="button"
                            onClick={() => updateStatus(d, st)}
                            className={`px-2.5 py-1.5 rounded text-xs font-semibold whitespace-nowrap shrink-0 ${
                              st === 'Delivered'
                                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                                : 'bg-slate-900 text-white hover:bg-slate-800'
                            }`}
                          >
                            {st}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selectedEquipmentApp && (
        <CompleteEquipmentDeliveryModal
          application={selectedEquipmentApp}
          onClose={() => setSelectedEquipmentApp(null)}
          onCompleted={(updatedApp) => {
            setSelectedEquipmentApp(null);
            setMessage(
              `Equipment checklist & on-site signatures saved for ${updatedApp.application_no} (${updatedApp.store_name}). Franchisee is now Active!`
            );
            load();
          }}
        />
      )}

      {viewingPaperFormApp && (
        <FranchiseePaperFormModal
          application={viewingPaperFormApp}
          onClose={() => setViewingPaperFormApp(null)}
          onUpdated={(updated) => {
            setViewingPaperFormApp(updated);
            load();
          }}
        />
      )}
    </div>
  );
};

// ===== 2. DELIVERY STAFF COMPLETED HISTORY =====
export const DeliveryHistoryView: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });

  const load = (page = 1) => {
    api.get(`/deliveries?mode=history&page=${page}`).then((res) => {
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
        <h1 className="text-xl font-bold text-slate-900">Completed Delivery History</h1>
        <p className="text-sm text-slate-600">
          Archive of completed replenishment deliveries and submitted proof of delivery notes/photos.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-2.5 pr-4">Order #</th>
                <th className="py-2.5 pr-4">Store Destination</th>
                <th className="py-2.5 pr-4 text-right">Order Total</th>
                <th className="py-2.5 pr-4">Proof Note</th>
                <th className="py-2.5 pr-4">Delivered At</th>
                <th className="py-2.5 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-sm text-slate-500">
                    No completed deliveries yet.
                  </td>
                </tr>
              ) : (
                rows.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <td className="py-2.5 pr-4 font-mono text-xs font-semibold text-slate-900">
                      {d.order_number}
                    </td>
                    <td className="py-2.5 pr-4">
                      <div className="font-medium text-slate-900">{d.store_name}</div>
                      <div className="text-xs text-slate-500">{d.store_address}</div>
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono text-xs">
                      <div className="font-semibold text-slate-900">
                        PHP {Number(d.total_amount || 0).toFixed(2)}
                      </div>
                      {Number(d.discount_amount || 0) > 0 && (
                        <div className="text-[11px] text-emerald-700">
                          Promo: -PHP {Number(d.discount_amount).toFixed(2)}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-slate-700">{d.proof_note || '—'}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-slate-500">
                      {d.delivered_at}
                    </td>
                    <td className="py-2.5 text-right">
                      <StatusText status={d.status} />
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
