import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { api } from '../services/api';
import { User } from '../types';

export const StoreMapView: React.FC<{ user: User }> = ({ user }) => {
  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [data, setData] = useState<{
    warehouses: any[];
    stores: any[];
    myStore: any;
    nearbyStores: any[];
  } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/map/stores')
      .then((res) => setData(res))
      .catch((err) => setError(err.message || 'Failed to load store map.'));
  }, []);

  useEffect(() => {
    if (!data || !mapDiv.current) return;
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const first = data.myStore || data.warehouses[0] || data.stores[0];
    const center: [number, number] = first
      ? [Number(first.lat), Number(first.lng)]
      : [14.5995, 120.9842];

    const map = L.map(mapDiv.current).setView(center, 12);
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

    data.warehouses.forEach((w) => {
      L.marker([Number(w.lat), Number(w.lng)], {
        icon: makeIcon('#0F172A', 'WAREHOUSE'),
      })
        .addTo(map)
        .bindPopup(
          `<strong>Warehouse: ${w.name}</strong><br/>${w.address}<br/>Contact: ${w.contact_person} (${w.contact_number})`
        );
    });

    data.stores.forEach((s) => {
      const isMine = data.myStore && data.myStore.id === s.id;
      L.marker([Number(s.lat), Number(s.lng)], {
        icon: makeIcon(isMine ? '#16A34A' : '#DC2626', isMine ? 'MY STORE' : 'AICE STORE'),
      })
        .addTo(map)
        .bindPopup(
          `<strong>${s.store_name}</strong><br/>Owner: ${s.owner_name}<br/>${s.address}<br/>Contact: ${s.contact_number}`
        );
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [data]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Store & Warehouse Network Map</h1>
          <p className="text-sm text-slate-600">
            Click any marker to inspect warehouse origin details or approved AICE franchisee stores.
          </p>
        </div>
        {data && (
          <div className="flex items-center gap-4 text-xs text-slate-600">
            <span>
              <strong className="text-slate-900 font-mono">{data.warehouses.length}</strong> Active Warehouse(s)
            </span>
            <span>·</span>
            <span>
              <strong className="text-rose-700 font-mono">{data.stores.length}</strong> Approved Franchisee Store(s)
            </span>
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-800">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div
          ref={mapDiv}
          style={{ height: 480 }}
          className="w-full rounded-lg border border-slate-200 overflow-hidden z-0"
        />
        <div className="flex flex-wrap items-center gap-6 mt-3 text-xs text-slate-600">
          <span>
            <strong className="text-slate-900">WAREHOUSE</strong> (Slate Marker) — Stock & Delivery Origin
          </span>
          <span>·</span>
          <span>
            <strong className="text-rose-700">AICE STORE</strong> (Crimson Marker) — Approved Franchisee Store
          </span>
          {user.role === 'franchisee' && (
            <>
              <span>·</span>
              <span>
                <strong className="text-emerald-700">MY STORE</strong> (Green Marker) — Your Franchise Location
              </span>
            </>
          )}
        </div>
      </div>

      {user.role === 'franchisee' && data && (
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h2 className="text-base font-semibold text-slate-900 mb-3">
            Approved AICE Stores Near Your Location
          </h2>
          {data.nearbyStores.length === 0 ? (
            <p className="text-sm text-slate-500">No other approved stores registered yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                    <th className="py-2.5 pr-4">Store Name</th>
                    <th className="py-2.5 pr-4">Owner</th>
                    <th className="py-2.5 pr-4">Address</th>
                    <th className="py-2.5 pr-4">Contact</th>
                    <th className="py-2.5 text-right">Distance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.nearbyStores.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="py-2.5 pr-4 font-medium text-slate-900">{s.store_name}</td>
                      <td className="py-2.5 pr-4 text-slate-700">{s.owner_name}</td>
                      <td className="py-2.5 pr-4 text-slate-600">{s.address}</td>
                      <td className="py-2.5 pr-4 font-mono text-xs text-slate-700">{s.contact_number}</td>
                      <td className="py-2.5 text-right font-mono text-xs font-semibold text-slate-900">
                        {s.distance_km} km
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
