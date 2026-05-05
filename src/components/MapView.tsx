"use client";

import { useEffect, useRef } from "react";
import type { Map as LMap, Marker, LayerGroup, LatLngBounds, Circle } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { PinSummary } from "@/lib/api";
import type { Pos } from "@/lib/geolocation";

type Props = {
  initialCenter: { lat: number; lng: number } | null;
  pins: PinSummary[];
  me: Pos | null;
  listenRadiusM: number;
  onMoveEnd: (b: { minLat: number; minLng: number; maxLat: number; maxLng: number }) => void;
  onPinClick: (id: string) => void;
};

export default function MapView({
  initialCenter,
  pins,
  me,
  listenRadiusM,
  onMoveEnd,
  onPinClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LMap | null>(null);
  const pinLayerRef = useRef<LayerGroup | null>(null);
  const meMarkerRef = useRef<Marker | null>(null);
  const meAccuracyRef = useRef<Circle | null>(null);
  const meRadiusRef = useRef<Circle | null>(null);
  const onMoveEndRef = useRef(onMoveEnd);
  const onPinClickRef = useRef(onPinClick);
  onMoveEndRef.current = onMoveEnd;
  onPinClickRef.current = onPinClick;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current) return;

      const center: [number, number] = initialCenter
        ? [initialCenter.lat, initialCenter.lng]
        : [20, 0];
      const map = L.map(containerRef.current, {
        zoomControl: false,
        attributionControl: true,
      }).setView(center, initialCenter ? 17 : 2);

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);

      L.control.zoom({ position: "bottomright" }).addTo(map);

      const layer = L.layerGroup().addTo(map);
      mapRef.current = map;
      pinLayerRef.current = layer;

      const fire = () => {
        const b: LatLngBounds = map.getBounds();
        onMoveEndRef.current({
          minLat: b.getSouth(),
          minLng: b.getWest(),
          maxLat: b.getNorth(),
          maxLng: b.getEast(),
        });
      };
      map.on("moveend", fire);
      // Initial fetch.
      fire();
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      pinLayerRef.current = null;
      meMarkerRef.current = null;
      meAccuracyRef.current = null;
      meRadiusRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recenter once we get an initial fix (and no manual pan yet).
  const centeredRef = useRef(false);
  useEffect(() => {
    if (centeredRef.current || !mapRef.current || !initialCenter) return;
    mapRef.current.setView([initialCenter.lat, initialCenter.lng], 17);
    centeredRef.current = true;
  }, [initialCenter]);

  // Re-render pin markers on change.
  useEffect(() => {
    const layer = pinLayerRef.current;
    if (!layer) return;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled) return;
      layer.clearLayers();
      for (const p of pins) {
        const icon = L.divIcon({
          className: "echo-pin",
          html:
            '<div class="w-5 h-5 rounded-full bg-amber-400 shadow-[0_0_0_3px_rgba(0,0,0,0.45)] ring-2 ring-amber-200/80 animate-[pulse_2.5s_ease-in-out_infinite]"></div>',
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        });
        const m = L.marker([p.lat, p.lng], { icon }).addTo(layer);
        m.on("click", () => onPinClickRef.current(p.id));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pins]);

  // Update "me" marker and accuracy ring.
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
