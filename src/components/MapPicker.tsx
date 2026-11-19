import React, { useEffect, useRef } from 'react';
import L from 'leaflet';

interface MapPickerProps {
  lat: number | null;
  lng: number | null;
  onPick: (lat: number, lng: number) => void;
  height?: number;
}

const pinIcon = L.divIcon({
  className: '',
  html: '<div style="background:#DC2626;color:#fff;padding:4px 8px;border-radius:6px;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);white-space:nowrap;">PINNED</div>',
  iconSize: [58, 24],
  iconAnchor: [29, 12],
});

export const MapPicker: React.FC<MapPickerProps> = ({
  lat,
  lng,
  onPick,
  height = 280,
}) => {
  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (!mapDiv.current || mapRef.current) return;
    const center: [number, number] =
      lat !== null && lng !== null ? [lat, lng] : [14.5995, 120.9842];
    const map = L.map(mapDiv.current).setView(center, 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    map.on('click', (e: L.LeafletMouseEvent) => {
      const cLat = Number(e.latlng.lat.toFixed(7));
      const cLng = Number(e.latlng.lng.toFixed(7));
      onPick(cLat, cLng);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (lat === null || lng === null) {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      return;
    }
    if (!markerRef.current) {
      markerRef.current = L.marker([lat, lng], { icon: pinIcon }).addTo(map);
    } else {
      markerRef.current.setLatLng([lat, lng]);
    }
    map.setView([lat, lng], Math.max(map.getZoom(), 14));
  }, [lat, lng]);

  return (
    <div className="space-y-2">
      <div
        ref={mapDiv}
        style={{ height }}
        className="w-full rounded-lg border border-slate-300 overflow-hidden z-0"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <span>
          Click on the map to pin coordinates{' '}
          {lat !== null && lng !== null ? (
            <strong className="font-mono text-slate-900">
              ({lat}, {lng})
            </strong>
          ) : (
            <span className="text-amber-700 font-medium">· No location pinned yet</span>
          )}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPick(14.5995, 120.9842)}
            className="px-2.5 py-1 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 font-medium whitespace-nowrap shrink-0"
          >
            Pin Manila Hub (14.5995, 120.9842)
          </button>
          <button
            type="button"
            onClick={() => onPick(14.6507, 121.0494)}
            className="px-2.5 py-1 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 font-medium whitespace-nowrap shrink-0"
          >
            Pin QC North (14.6507, 121.0494)
          </button>
        </div>
      </div>
    </div>
  );
};
