import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";
import "leaflet/dist/leaflet.css";

export type MapPoint = { latitude: number; longitude: number };

const tilesKey = import.meta.env.VITE_YANDEX_TILES_KEY ?? "";
const moscow: MapPoint = { latitude: 55.751244, longitude: 37.618423 };
const pin = L.icon({
  iconUrl,
  iconRetinaUrl,
  shadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

export function SiteMap({ point, onPoint }: { point: MapPoint | null; onPoint: (point: MapPoint) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onPointRef = useRef(onPoint);
  const initialPoint = useRef(point);
  const [ready, setReady] = useState(false);
  const [tileError, setTileError] = useState(false);
  const [view, setView] = useState({ ...moscow, zoom: 11 });
  onPointRef.current = onPoint;

  useEffect(() => {
    const node = host.current;
    if (!node || !tilesKey) return;
    const start = initialPoint.current ?? moscow;
    const map = L.map(node, { attributionControl: true }).setView([start.latitude, start.longitude], initialPoint.current ? 16 : 11);
    map.attributionControl.setPrefix(false);
    const layer = L.tileLayer(tileUrl(tilesKey), {
      minZoom: 0,
      maxZoom: 20,
      attribution: '<a href="https://yandex.ru/legal/maps_termsofuse/" target="_blank" rel="noopener noreferrer">Условия использования</a>',
    });
    layer.on("tileerror", () => setTileError(true));
    layer.addTo(map);
    map.on("click", (event) => {
      onPointRef.current({
        latitude: Math.round(event.latlng.lat * 1e6) / 1e6,
        longitude: Math.round(event.latlng.lng * 1e6) / 1e6,
      });
    });
    const remember = () => {
      const center = map.getCenter();
      setView({ latitude: center.lat, longitude: center.lng, zoom: map.getZoom() });
    };
    map.on("moveend", remember);
    remember();
    mapRef.current = map;
    setReady(true);
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (!point) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    const latlng = L.latLng(point.latitude, point.longitude);
    if (!markerRef.current) markerRef.current = L.marker(latlng, { icon: pin, alt: "Точка объекта" }).addTo(map);
    else markerRef.current.setLatLng(latlng);
  }, [ready, point]);

  if (!tilesKey) {
    return (
      <div className="map-blank">
        <p>Ключ Яндекс Tiles API не задан</p>
        <p className="quiet">Добавьте VITE_YANDEX_TILES_KEY в .env и перезапустите веб.</p>
      </div>
    );
  }

  const mapsLink = `https://yandex.ru/maps/?ll=${view.longitude}%2C${view.latitude}&z=${view.zoom}&l=map`;
  return (
    <div className="site-map">
      <div ref={host} className="site-map-canvas" role="application" aria-label="Карта объекта. Нажмите, чтобы поставить точку." />
      <a className="yandex-mark" href={mapsLink} target="_blank" rel="noopener noreferrer">
        <img src="/yandex-logo.svg" alt="Яндекс" width={88} height={48} />
      </a>
      {tileError ? <p className="map-note">Тайлы не загрузились. Ключ может активироваться до 15 минут, либо Яндекс отклонил запрос.</p> : null}
    </div>
  );
}

function tileUrl(key: string) {
  const params = new URLSearchParams({
    apikey: key,
    lang: "ru_RU",
    l: "map",
    projection: "web_mercator",
    scale: "1",
  });
  return `https://tiles.api-maps.yandex.ru/v1/tiles/?${params}&x={x}&y={y}&z={z}`;
}
