/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";

/**
 * Map3D — GPU vector 3D view (MapLibre GL, no Leaflet). Each village WITH
 * complaints becomes a thin glowing column (height = complaint count) over the
 * Purulia block outline, on a dark pitched basemap. Same scoped data as the 2D
 * map. Indian basemap (Mappls / Bhuvan) can replace the free CARTO style once an
 * API key is provided.
 */

interface VPoint {
  code: string; name: string; lat: number; lng: number;
  total: number; active: number; critical: number; resolved: number; slaBreached: number;
}

const RED = "#ef4444", AMBER = "#f59e0b", CYAN = "#22d3ee";

// small circle polygon (meters) → thin column footprint
function circle(lng: number, lat: number, rMeters: number, n = 14): number[][] {
  const dLat = rMeters / 111320;
  const dLng = rMeters / (111320 * Math.cos((lat * Math.PI) / 180));
  const out: number[][] = [];
  for (let i = 0; i <= n; i++) { const a = (i / n) * 2 * Math.PI; out.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]); }
  return out;
}

export function Map3D({ points, boundaries }: { points: VPoint[]; boundaries: any }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let map: any; let cancelled = false; let ro: ResizeObserver | null = null;
    (async () => {
      const maplibregl: any = (await import("maplibre-gl")).default;
      if (cancelled || !ref.current) return;

      map = new maplibregl.Map({
        container: ref.current,
        style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
        center: [86.36, 23.33], zoom: 8.6, pitch: 52, bearing: -15,
        attributionControl: false, antialias: true,
      });
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-left");
      map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "JanSunwai WB · © CARTO © OSM" }));

      const hot = points.filter((p) => p.total > 0);
      const colOf = (p: VPoint) => (p.critical > 0 ? RED : p.active > 0 ? AMBER : CYAN);

      const colFeats = hot.map((p) => ({
        type: "Feature",
        properties: { cnt: p.total, col: colOf(p), name: p.name },
        geometry: { type: "Polygon", coordinates: [circle(p.lng, p.lat, 450)] },
      }));
      const ptFeats = hot.map((p) => ({
        type: "Feature",
        properties: { cnt: p.total, col: colOf(p), name: p.name },
        geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      }));

      map.on("load", () => {
        if (cancelled) return;

        // district / block outline for geographic reference
        if (boundaries && boundaries.features) {
          map.addSource("vil", { type: "geojson", data: boundaries });
          map.addLayer({ id: "vil-line", type: "line", source: "vil",
            paint: { "line-color": CYAN, "line-opacity": 0.18, "line-width": 0.4 } });
        }

        // soft glow footprint under each hotspot
        map.addSource("pts", { type: "geojson", data: { type: "FeatureCollection", features: ptFeats } });
        map.addLayer({ id: "glow", type: "circle", source: "pts",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, ["+", 5, ["*", ["get", "cnt"], 1.6]], 12, ["+", 16, ["*", ["get", "cnt"], 5]]],
            "circle-color": ["get", "col"], "circle-blur": 1, "circle-opacity": 0.4,
          } });

        // thin 3D columns — height by complaint count
        map.addSource("cols", { type: "geojson", data: { type: "FeatureCollection", features: colFeats } });
        map.addLayer({ id: "cols-3d", type: "fill-extrusion", source: "cols",
          paint: {
            "fill-extrusion-color": ["get", "col"],
            "fill-extrusion-height": ["*", ["to-number", ["get", "cnt"]], 900],
            "fill-extrusion-base": 0,
            "fill-extrusion-opacity": 0.9,
          } });

        // hover tooltip
        const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: "m3d-pop" });
        map.on("mousemove", "glow", (e: any) => {
          map.getCanvas().style.cursor = "pointer";
          const f = e.features?.[0]; if (!f) return;
          popup.setLngLat(e.lngLat).setHTML(`<div style="font:12px ui-sans-serif,system-ui;color:#0b1220"><b>${f.properties.name}</b> · ${f.properties.cnt} complaints</div>`).addTo(map);
        });
        map.on("mouseleave", "glow", () => { map.getCanvas().style.cursor = ""; popup.remove(); });

        try { map.setSky?.({ "sky-color": "#0a1020", "horizon-color": "#0e1b30", "fog-color": "#070b14", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6 }); } catch { /* optional */ }
        setTimeout(() => { try { map.resize(); } catch { /* noop */ } }, 200);
      });

      ro = new ResizeObserver(() => { try { map.resize(); } catch { /* noop */ } });
      ro.observe(ref.current);
    })();

    return () => { cancelled = true; if (ro) ro.disconnect(); if (map) map.remove(); };
  }, [points, boundaries]);

  return (
    <div style={{ position: "absolute", inset: 0, background: "#070b14" }}>
      <div ref={ref} style={{ position: "absolute", inset: 0 }} />
      <div style={{ position: "absolute", top: 10, right: 10, zIndex: 5, background: "rgba(12,19,34,0.85)", border: "1px solid rgba(34,211,238,0.25)", color: "#7dd3fc", fontSize: 11, padding: "4px 8px", borderRadius: 6, fontFamily: "ui-sans-serif, system-ui" }}>
        🧊 3D · tower height = complaints · drag to rotate, scroll to zoom
      </div>
    </div>
  );
}
