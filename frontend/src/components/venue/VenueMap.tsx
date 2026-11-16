import { useEffect, useMemo } from 'react';
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type LatLng = { latitude: number; longitude: number };

// A CSS-only marker (Leaflet's default PNG icons don't resolve through bundlers).
const pin = L.divIcon({
  className: '',
  html: '<span style="display:block;width:22px;height:22px;border-radius:9999px;background:#1d4ed8;border:3px solid #fff;box-shadow:0 2px 8px rgb(0 0 0/.45)"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

function Recenter({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom, { animate: false });
  }, [center[0], center[1], zoom]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function ClickToPlace({ onPick }: { onPick: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onPick({ latitude: e.latlng.lat, longitude: e.latlng.lng }) });
  return null;
}

/**
 * OpenStreetMap view with the venue marker and the geofence circle.
 * `editable` lets the user click or drag to place the marker.
 */
export function VenueMap({
  point, radiusM, accuracyM, editable, onPick, height = 220, fallbackCenter,
}: {
  point: LatLng | null; radiusM: number; accuracyM?: number | null; editable?: boolean; onPick?: (p: LatLng) => void; height?: number; fallbackCenter?: LatLng | null;
}) {
  const center = useMemo<[number, number]>(() => {
    const c = point ?? fallbackCenter;
    return c ? [c.latitude, c.longitude] : [8.4844, -13.2344];
  }, [point, fallbackCenter]);
  const zoom = point ? 18 : fallbackCenter ? 16 : 13;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200" style={{ height }}>
      <MapContainer center={center} zoom={zoom} style={{ height: '100%', width: '100%' }} scrollWheelZoom={!!editable} dragging={!!editable || true} attributionControl>
        <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} attribution="&copy; OpenStreetMap contributors" />
        <Recenter center={center} zoom={zoom} />
        {editable && onPick && <ClickToPlace onPick={onPick} />}
        {point && (
          <>
            {/* Reported GPS uncertainty (dashed) vs the attendance boundary (solid). */}
            {accuracyM != null && accuracyM > 0 && (
              <Circle center={[point.latitude, point.longitude]} radius={accuracyM} pathOptions={{ color: '#f59e0b', weight: 1, dashArray: '4 4', fillOpacity: 0.05 }} />
            )}
            <Circle center={[point.latitude, point.longitude]} radius={radiusM} pathOptions={{ color: '#16a34a', weight: 2, fillColor: '#22c55e', fillOpacity: 0.18 }} />
            <Marker
              position={[point.latitude, point.longitude]}
              icon={pin}
              draggable={!!editable}
              eventHandlers={editable && onPick ? { dragend: (e) => { const ll = (e.target as L.Marker).getLatLng(); onPick({ latitude: ll.lat, longitude: ll.lng }); } } : undefined}
            />
          </>
        )}
      </MapContainer>
    </div>
  );
}
