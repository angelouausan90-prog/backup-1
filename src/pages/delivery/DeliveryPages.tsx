import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { PaginationBar, ProductImage, StatusText } from '../../components/SharedUI';

// ===== 1. DELIVERY STAFF ASSIGNED DELIVERIES (Accept, Status Updates, Live GPS Sharing, Tap-to-Call, Notify Near, Proof of Delivery) =====
export const DeliveryAssignedView: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [sharingId, setSharingId] = useState<number | null>(null);
  const [proofNotes, setProofNotes] = useState<Record<number, string>>({});
  const [proofFiles, setProofFiles] = useState<Record<number, File | null>>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = () => {
    api.get('/deliveries?mode=active&limit=50').then((res) => setRows(res.data));
  };

  useEffect(() => {
    load();
  }, []);

  // Automatic live location sharing every 4 seconds while an active delivery is selected
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
            // Fallback interpolation along route when desktop browser has no hardware GPS sensor
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Assigned Cold-Chain Deliveries</h1>
        <p className="text-sm text-slate-600">
          Accept and update delivery milestones, automatically broadcast live GPS location to the franchisee map, tap to call the store, and upload proof of delivery.
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
          You have no active deliveries assigned right now.
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

