"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LMap, Marker, LayerGroup, Layer, LatLngBounds, Circle } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { PinSummary, Theme, Vibe } from "@/lib/api";
import type { Pos } from "@/lib/geolocation";

type Props = {
  initialCenter: { lat: number; lng: number } | null;
  pins: PinSummary[];
  me: Pos | null;
  listenRadiusM: number;
  onMoveEnd: (b: { minLat: number; minLng: number; maxLat: number; maxLng: number }) => void;
  onPinClick: (id: string) => void;
  focusTo?: { lat: number; lng: number; key: number } | null;
};

// Tailwind hex equivalents (Leaflet markers use inline styles, not classes).
const THEME_COLORS: Record<Theme, string> = {
  love: "#fb7185",     // rose-400
  secret: "#a78bfa",   // violet-400
  story: "#fbbf24",    // amber-400
  art: "#34d399",      // emerald-400
  advice: "#38bdf8",   // sky-400
  warning: "#f97316",  // orange-500
};
const VIBE_COLORS: Record<Vibe, string> = {
  joy: "#facc15",      // yellow-400
  grief: "#94a3b8",    // slate-400
  awe: "#a78bfa",      // violet-400
  anger: "#f87171",    // red-400
  calm: "#67e8f9",     // cyan-300
  playful: "#f472b6",  // pink-400
  mundane: "#9ca3af",  // gray-400
};
const DEFAULT_PIN = "#fbbf24"; // amber-400

function pinColor(p: PinSummary): string {
  if (p.theme && THEME_COLORS[p.theme]) return THEME_COLORS[p.theme];
  if (p.vibe && VIBE_COLORS[p.vibe]) return VIBE_COLORS[p.vibe];
  return DEFAULT_PIN;
}

const HEATMAP_MAX_ZOOM = 13; // below this zoom, show heatmap instead of pins

export default function MapView({
  initialCenter,
  pins,
  me,
  listenRadiusM,
  onMoveEnd,
  onPinClick,
  focusTo,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LMap | null>(null);
  const pinLayerRef = useRef<LayerGroup | null>(null);
  const heatLayerRef = useRef<Layer | null>(null);
  const meMarkerRef = useRef<Marker | null>(null);
  const meAccuracyRef = useRef<Circle | null>(null);
  const meRadiusRef = useRef<Circle | null>(null);
  const onMoveEndRef = useRef(onMoveEnd);
  const onPinClickRef = useRef(onPinClick);
  onMoveEndRef.current = onMoveEnd;
  onPinClickRef.current = onPinClick;

  const [zoom, setZoom] = useState<number>(2);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      // Side-effect import attaches L.heatLayer.
      await import("leaflet.heat");
      if (cancelled || !containerRef.current) return;

      const center: [number, number] = initialCenter
        ? [initialCenter.lat, initialCenter.lng]
        : [20, 0];
      const map = L.map(containerRef.current, {
        zoomControl: false,
        attributionControl: true,
      }).setView(center, initialCenter ? 17 : 2);

      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        {
          maxZoom: 19,
          subdomains: "abcd",
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        }
      ).addTo(map);

      L.control.zoom({ position: "bottomright" }).addTo(map);

      const layer = L.layerGroup().addTo(map);
      mapRef.current = map;
      pinLayerRef.current = layer;
      setZoom(map.getZoom());

      const fire = () => {
        const b: LatLngBounds = map.getBounds();
        onMoveEndRef.current({
          minLat: b.getSouth(),
          minLng: b.getWest(),
          maxLat: b.getNorth(),
          maxLng: b.getEast(),
        });
        setZoom(map.getZoom());
      };
      map.on("moveend", fire);
      fire();
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      pinLayerRef.current = null;
      heatLayerRef.current = null;
      meMarkerRef.current = null;
      meAccuracyRef.current = null;
      meRadiusRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const centeredRef = useRef(false);
  useEffect(() => {
    if (centeredRef.current || !mapRef.current || !initialCenter) return;
    mapRef.current.setView([initialCenter.lat, initialCenter.lng], 17);
    centeredRef.current = true;
  }, [initialCenter]);

  useEffect(() => {
    if (!mapRef.current || !focusTo) return;
    mapRef.current.flyTo([focusTo.lat, focusTo.lng], 17, { duration: 0.6 });
  }, [focusTo]);

  // Render pins (zoom >= HEATMAP_MAX_ZOOM) or heatmap (zoom < HEATMAP_MAX_ZOOM).
  useEffect(() => {
    const map = mapRef.current;
    const pinLayer = pinLayerRef.current;
    if (!map || !pinLayer) return;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled) return;

      pinLayer.clearLayers();
      if (heatLayerRef.current) {
        map.removeLayer(heatLayerRef.current);
        heatLayerRef.current = null;
      }

      if (zoom < HEATMAP_MAX_ZOOM && pins.length > 0) {
        const points = pins.map((p) => [p.lat, p.lng, 0.6] as [number, number, number]);
        // @ts-expect-error - leaflet.heat augments L at runtime
        const heat = L.heatLayer(points, {
          radius: 22,
          blur: 18,
          maxZoom: HEATMAP_MAX_ZOOM,
          gradient: { 0.2: "#fde68a", 0.5: "#fbbf24", 1.0: "#f59e0b" },
        }) as Layer;
        heat.addTo(map);
        heatLayerRef.current = heat;
        return;
      }

      for (const p of pins) {
        const color = pinColor(p);
        const isCapsule = p.audible_from && new Date(p.audible_from).getTime() > Date.now();
        const ring = isCapsule ? "ring-zinc-100/50" : "";
        const innerStyle = `background:${color};box-shadow:0 0 0 3px rgba(0,0,0,0.5);`;
        const outerStyle = isCapsule
          ? `outline:1.5px dashed ${color};outline-offset:3px;border-radius:9999px;`
          : "";
        const icon = L.divIcon({
          className: "echo-pin",
          html: `<div style="${outerStyle}"><div style="${innerStyle}" class="w-5 h-5 rounded-full ring-2 ring-white/20 ${ring}"></div></div>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        });
        const m = L.marker([p.lat, p.lng], { icon }).addTo(pinLayer);
        m.on("click", () => onPinClickRef.current(p.id));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pins, zoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !me) return;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled) return;
      const meIcon = L.divIcon({
        className: "echo-me",
        html:
          '<div class="w-3 h-3 rounded-full bg-sky-500 ring-4 ring-sky-500/25"></div>',
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      });
      if (!meMarkerRef.current) {
        meMarkerRef.current = L.marker([me.lat, me.lng], { icon: meIcon }).addTo(map);
      } else {
        meMarkerRef.current.setLatLng([me.lat, me.lng]);
      }
      if (!meAccuracyRef.current) {
        meAccuracyRef.current = L.circle([me.lat, me.lng], {
          radius: me.accuracyM,
          color: "#0ea5e9",
          weight: 1,
          opacity: 0.4,
          fillOpacity: 0.06,
        }).addTo(map);
      } else {
        meAccuracyRef.current.setLatLng([me.lat, me.lng]);
        meAccuracyRef.current.setRadius(me.accuracyM);
      }
      if (!meRadiusRef.current) {
        meRadiusRef.current = L.circle([me.lat, me.lng], {
          radius: listenRadiusM,
          color: "#f59e0b",
          weight: 1,
          opacity: 0.5,
          fillOpacity: 0.05,
          dashArray: "4 6",
        }).addTo(map);
      } else {
        meRadiusRef.current.setLatLng([me.lat, me.lng]);
        meRadiusRef.current.setRadius(listenRadiusM);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [me, listenRadiusM]);

  return <div ref={containerRef} className="absolute inset-0" />;
}
