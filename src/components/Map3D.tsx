/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";

/**
 * Map3D — GPU vector 3D view (MapLibre GL, no Leaflet). Village polygons are
 * extruded by complaint count into glowing "data columns" on a dark pitched
 * basemap. Same scoped data as the 2D Command Map. Indian basemap (Mappls /
 * Bhuvan) can replace the free CARTO dark style once an API key is provided.
 */

interface VPoint {
  code: string; name: string; lat: number; lng: number;
  total: number; active: number; critical: number; resolved: number; slaBreached: number;
}

const RED = "#ef4444", AMBER = "#f59e0b", CYAN = "#22d3ee";

export function Map3D({ points, boundaries }: { points: VPoint[]; boundaries: any }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);

  useEffect(() => {
    let map: any; let cancelled = false; let ro: ResizeObserver | null = null;
    (async () => {
      const maplibregl: any = (await import("maplibre-gl")).default;
      if (cancelled || !ref.current) return;

      map = new maplibregl.Map({
        container: ref.current,
        style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
        center: [86.36, 23.33],
        zoom: 8.2, pitch: 58, bearing: -17,
        attributionControl: false,
        antialias: true,
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-left");
      map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "JanSunwai WB · © CARTO © OSM" }));

      map.on("load", () => {
        if (cancelled) return;
        // join complaint counts onto the village polygons
        const byCode: Record<string, VPoint> = {};
        for (const p of points) byCode[p.code] = p;
        const feats = ((boundaries && boundaries.features) || []).map((f: any) => {
          const c = byCode[f.properties?.v];
          const cnt = c ? c.total : 0;
          const col = !c || cnt === 0 ? CYAN : c.critical > 0 ? RED : c.active > 0 ? AMBER : CYAN;
          return { ...f, properties: { ...f.properties, cnt, col } };
        });
        map.addSource("vil", { type: "geojson", data: { type: "FeatureCollection", features: feats } });

        // flat faint footprint for every village (context)
        map.addLayer({ id: "vil-base", type: "fill", source: "vil",
          paint: { "fill-color": CYAN, "fill-opacity": 0.05, "fill-outline-color": "rgba(34,211,238,0.18)" } });

        // 3D glowing columns for villages WITH complaints — height by count
        map.addLayer({ id: "vil-3d", type: "fill-extrusion", source: "vil",
          filter: [">", ["get", "cnt"], 0],
          paint: {
            "fill-extrusion-color": ["get", "col"],
            "fill-extrusion-height": ["*", ["to-number", ["get", "cnt"]], 1800],
            "fill-extrusion-base": 0,
            "fill-extrusion-opacity": 0.85,
          } });

        try {
          map.setSky?.({ "sky-color": "#0a1020", "horizon-color": "#0e1b30", "fog-color": "#070b14", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6 });
        } catch { /* sky optional */ }

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
        🧊 3D · MapLibre GPU · column height = complaints · drag to rotate
      </div>
    </div>
  );
}
