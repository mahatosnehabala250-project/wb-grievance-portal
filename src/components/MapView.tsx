/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import "leaflet/dist/leaflet.css";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { authHeaders } from "@/lib/helpers";

/**
 * Command Map (room) — dark, glowing, village-level intelligence map.
 * Data: /api/map/villages (scope-locked points + categories + trend).
 * Everything keys off resolved Purulia village_codes, so out-of-district
 * test/junk complaints simply don't plot — the map stays clean.
 */

// ---- Types ----
interface VPoint {
  code: string; name: string; lat: number; lng: number;
  total: number; active: number; critical: number; resolved: number; slaBreached: number;
}
type Mode = "density" | "active" | "sla" | "resolution";
interface MapData {
  points: VPoint[];
  categories: { label: string; n: number }[];
  trend: { last7: number; prior7: number; pct: number };
  meta: { villagesWithComplaints: number; plottable: number; activeTotal: number; criticalTotal: number };
}

// ---- Palette (dark console) ----
const CYAN = "#22D3EE", AMBER = "#F59E0B", RED = "#EF4444", GREEN = "#34D399";
const PANEL = "#0c1322", MAPBG = "#070b14", LINE = "rgba(34,211,238,0.35)";

// Deterministic colour per Gram Panchayat — so adjacent villages of the same GP
// share a hue and GP clusters are visible when boundaries are on.
function gpColor(gp: string | null): string {
  if (!gp) return "#475569";
  let h = 0; for (let i = 0; i < gp.length; i++) h = (h * 31 + gp.charCodeAt(i)) % 360;
  return `hsl(${h}, 72%, 62%)`;
}
const esc = (s: string) => String(s || "").replace(/[&<>]/g, (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;" } as Record<string, string>)[c]));

const MODES: { key: Mode; label: string; icon: string }[] = [
  { key: "density", label: "Density", icon: "◍" },
  { key: "active", label: "Active", icon: "▲" },
  { key: "sla", label: "SLA breach", icon: "⏱" },
  { key: "resolution", label: "Resolved", icon: "✓" },
];

function metricFor(p: VPoint, m: Mode): number {
  return m === "density" ? p.total : m === "active" ? p.active : m === "sla" ? p.slaBreached : p.resolved;
}
function colorFor(p: VPoint, m: Mode, ratio: number): string {
  if (m === "resolution") return GREEN;
  if (m === "sla") return ratio > 0.5 ? RED : ratio > 0 ? AMBER : CYAN;
  if (p.critical > 0) return RED;
  if (ratio >= 0.66) return RED;
  if (ratio >= 0.33) return AMBER;
  return CYAN;
}

const PURULIA_CENTER: [number, number] = [23.33, 86.36];

// ---- Inner map (client-only) ----
const InnerMap = dynamic(
  () =>
    import("leaflet").then((L) =>
      import("react-leaflet").then(({ MapContainer, TileLayer, CircleMarker, GeoJSON, Tooltip, Marker, useMap }) => {
        function Fit({ points }: { points: VPoint[] }) {
          const map = useMap();
          useEffect(() => {
            if (points.length === 0) { map.setView(PURULIA_CENTER, 9); return; }
            if (points.length === 1) { map.setView([points[0].lat, points[0].lng], 12); return; }
            const b = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
            map.fitBounds(b.pad(0.25), { animate: true });
          }, [points, map]);
          return null;
        }

        function ZoomWatcher({ onZoom }: { onZoom: (z: number) => void }) {
          const map = useMap();
          useEffect(() => {
            const u = () => onZoom(map.getZoom());
            u(); map.on("zoomend", u);
            return () => { map.off("zoomend", u); };
          }, [map, onZoom]);
          return null;
        }

        // Village-name labels — only when zoomed in (>=12) and only for villages
        // currently in view (viewport-limited, capped) so 2,689 labels never all
        // render at once. At >=13 the Gram Panchayat name shows underneath.
        function Labels({ pts }: { pts: { lat: number; lng: number; name: string; gp: string | null }[] }) {
          const map = useMap();
          const [vis, setVis] = useState<{ lat: number; lng: number; name: string; gp: string | null }[]>([]);
          useEffect(() => {
            const upd = () => {
              if (map.getZoom() < 12) { setVis([]); return; }
              const b = map.getBounds(); const out: { lat: number; lng: number; name: string; gp: string | null }[] = [];
              for (const p of pts) { if (b.contains([p.lat, p.lng])) { out.push(p); if (out.length >= 130) break; } }
              setVis(out);
            };
            upd(); map.on("moveend zoomend", upd);
            return () => { map.off("moveend zoomend", upd); };
          }, [map, pts]);
          const z = map.getZoom();
          return (<>{vis.map((p, i) => (
            <Marker key={i} position={[p.lat, p.lng]} interactive={false}
              icon={L.divIcon({ className: "", iconSize: [0, 0], html: `<div style="transform:translate(-50%,-50%);white-space:nowrap;font-family:ui-sans-serif,system-ui;font-size:11px;font-weight:600;color:#e2e8f0;text-shadow:0 0 4px #000,0 0 3px #000">${esc(p.name)}${z >= 13 && p.gp ? `<div style='font-size:9px;font-weight:400;color:#93c5fd;text-shadow:0 0 4px #000'>GP: ${esc(p.gp)}</div>` : ""}</div>` })} />
          ))}</>);
        }

        const Component = ({ points, mode, basemap, boundaries, showBoundaries, onSelect, gpMap, labelPts, blockBoundaries, blockLabelPts }: {
          points: VPoint[]; mode: Mode; basemap: "dark" | "satellite";
          boundaries: any; showBoundaries: boolean; onSelect: (p: VPoint) => void;
          gpMap: Record<string, string[]>; labelPts: { lat: number; lng: number; name: string; gp: string | null }[];
          blockBoundaries: any; blockLabelPts: { lat: number; lng: number; name: string }[];
        }) => {
          const [zoom, setZoom] = useState(9);
          const max = Math.max(1, ...points.map((p) => metricFor(p, mode)));
          return (
            <MapContainer preferCanvas center={PURULIA_CENTER} zoom={9} zoomControl
              style={{ height: "100%", width: "100%", minHeight: "500px", background: MAPBG }}>
              {basemap === "satellite" ? (
                <>
                  <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                    attribution="Imagery &copy; Esri, Maxar" maxZoom={19} />
                  <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}" maxZoom={19} />
                </>
              ) : (
                <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                  attribution='&copy; OpenStreetMap, &copy; CARTO' maxZoom={20} />
              )}

              <ZoomWatcher onZoom={setZoom} />

              {/* BLOCK boundaries — always (clean overview, just 20 outlines) */}
              {blockBoundaries && (
                <GeoJSON data={blockBoundaries}
                  style={() => ({ color: CYAN, weight: 1.3, opacity: 0.6, fillColor: CYAN, fillOpacity: 0.02 })}
                  onEachFeature={(f: any, layer: any) => { const nm = f?.properties?.block || f?.properties?.BLOCK || ""; if (nm) layer.bindTooltip(nm, { sticky: true }); }} />
              )}
              {/* Block-name labels when zoomed OUT */}
              {zoom < 12 && blockLabelPts.map((b, i) => (
                <Marker key={"bl" + i} position={[b.lat, b.lng]} interactive={false}
                  icon={L.divIcon({ className: "", iconSize: [0, 0], html: `<div style="transform:translate(-50%,-50%);white-space:nowrap;font-family:ui-sans-serif,system-ui;font-size:12px;font-weight:600;letter-spacing:0.04em;color:#bae6fd;text-shadow:0 0 5px #000,0 0 3px #000">${esc(b.name)}</div>` })} />
              ))}

              {/* VILLAGE detail — ONLY when zoomed IN (>=12) and toggle on */}
              {showBoundaries && zoom >= 12 && boundaries && (
                <GeoJSON key={"v" + Object.keys(gpMap).length} data={boundaries}
                  style={(f: any) => {
                    const code = f?.properties?.v;
                    const gp = code && gpMap[code] ? gpMap[code][0] : null;
                    const col = gpColor(gp);
                    return { color: col, weight: 0.7, opacity: 0.55, fillColor: col, fillOpacity: 0.05 };
                  }}
                  onEachFeature={(f: any, layer: any) => {
                    const p = f?.properties || {};
                    const m = p.v && gpMap[p.v] ? gpMap[p.v] : null;
                    layer.bindTooltip(
                      `${(m && m[2]) || p.n || "Village"}${m ? ` · GP: ${m[0]}` : ""}${p.b ? ` · ${p.b}` : ""}${m && m[1] ? ` · ${m[1]} AC` : ""}`,
                      { sticky: true }
                    );
                  }} />
              )}

              {points.map((p) => {
                const v = metricFor(p, mode);
                const ratio = v / max;
                const color = colorFor(p, mode, ratio);
                const halo = 10 + ratio * 36;
                return (
                  <CircleMarker key={"h" + p.code} center={[p.lat, p.lng]} radius={halo}
                    pathOptions={{ stroke: false, fillColor: color, fillOpacity: 0.12 + ratio * 0.16 }}
                    eventHandlers={{ click: () => onSelect(p) }}>
                    <Tooltip direction="top" opacity={0.95}>
                      <span style={{ fontFamily: "ui-sans-serif, system-ui", fontSize: 12 }}>
                        <strong>{p.name}</strong> · {v} {mode === "sla" ? "SLA breach" : mode === "resolution" ? "resolved" : mode}
                        {p.critical > 0 && mode !== "resolution" ? ` · ${p.critical} critical` : ""}
                      </span>
                    </Tooltip>
                  </CircleMarker>
                );
              })}
              {points.map((p) => {
                const v = metricFor(p, mode);
                const ratio = v / max;
                const color = colorFor(p, mode, ratio);
                const core = 3.5 + ratio * 5;
                if (v === 0) return null;
                return (
                  <CircleMarker key={"c" + p.code} center={[p.lat, p.lng]} radius={core}
                    pathOptions={{ color: "#0a0f1e", weight: 0.5, fillColor: color, fillOpacity: 0.96 }}
                    eventHandlers={{ click: () => onSelect(p) }} />
                );
              })}
              {showBoundaries && <Labels pts={labelPts} />}
              <Fit points={points} />
            </MapContainer>
          );
        };
        return Component;
      })
    ),
  { ssr: false, loading: () => <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", background: MAPBG }}>Loading command map…</div> }
);

// ---- Main export ----
export function MapView() {
  const [data, setData] = useState<MapData | null>(null);
  const [boundaries, setBoundaries] = useState<any>(null);
  const [mode, setMode] = useState<Mode>("density");
  const [basemap, setBasemap] = useState<"dark" | "satellite">("dark");
  const [showBoundaries, setShowBoundaries] = useState(true);
  const [selected, setSelected] = useState<VPoint | null>(null);
  const [loading, setLoading] = useState(true);
  const [gpMap, setGpMap] = useState<Record<string, string[]>>({});
  const [blocks, setBlocks] = useState<any>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/map/villages", { headers: authHeaders() });
        const json = await res.json();
        if (json?.points) setData(json);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
      fetch("/purulia-villages.geojson").then((r) => (r.ok ? r.json() : null)).then(setBoundaries).catch(() => {});
      fetch("/purulia-gp.json").then((r) => (r.ok ? r.json() : null)).then((j) => j && setGpMap(j)).catch(() => {});
      fetch("/purulia-blocks.geojson").then((r) => (r.ok ? r.json() : null)).then(setBlocks).catch(() => {});
    })();
  }, []);

  const blockLabelPts = useMemo(() => {
    const b: any = blocks;
    if (!b?.features) return [] as { lat: number; lng: number; name: string }[];
    const out: { lat: number; lng: number; name: string }[] = [];
    for (const f of b.features) {
      const g = f.geometry; if (!g) continue;
      const ring = g.type === "Polygon" ? g.coordinates[0] : g.type === "MultiPolygon" ? g.coordinates[0][0] : null;
      if (!ring || !ring.length) continue;
      let sx = 0, sy = 0; for (const c of ring) { sx += c[0]; sy += c[1]; }
      out.push({ lat: sy / ring.length, lng: sx / ring.length, name: f.properties?.block || f.properties?.BLOCK || "" });
    }
    return out;
  }, [blocks]);

  const points = data?.points || [];
  const labelPts = useMemo(() => {
    const b: any = boundaries;
    if (!b?.features) return [] as { lat: number; lng: number; name: string; gp: string | null }[];
    const out: { lat: number; lng: number; name: string; gp: string | null }[] = [];
    for (const f of b.features) {
      const g = f.geometry; if (!g) continue;
      const ring = g.type === "Polygon" ? g.coordinates[0] : g.type === "MultiPolygon" ? g.coordinates[0][0] : null;
      if (!ring || !ring.length) continue;
      let sx = 0, sy = 0; for (const c of ring) { sx += c[0]; sy += c[1]; }
      const code = f.properties?.v;
      const meta = code ? gpMap[code] : null;
      const gp = meta ? meta[0] : null;
      // Name comes from our authoritative DB (by LGD code), NOT the shapefile's
      // vilnam_soi — some shapefile polygons pair the wrong name with a code.
      out.push({ lat: sy / ring.length, lng: sx / ring.length, name: (meta && meta[2]) || f.properties?.n || "", gp });
    }
    return out;
  }, [boundaries, gpMap]);
  const hotspots = useMemo(
    () => [...points].sort((a, b) => metricFor(b, mode) - metricFor(a, mode)).filter((p) => metricFor(p, mode) > 0).slice(0, 6),
    [points, mode]
  );
  const activeTotal = data?.meta.activeTotal ?? 0;
  const criticalTotal = data?.meta.criticalTotal ?? 0;
  const pct = data?.trend.pct ?? 0;
  const topCats = data?.categories || [];
  const maxCat = Math.max(1, ...topCats.map((c) => c.n));

  const summary = useMemo(() => {
    if (points.length === 0) return "No complaints plotted in your jurisdiction yet. As complaints come in, hotspots will light up here.";
    const top = hotspots[0];
    const second = hotspots[1];
    const cat = topCats[0]?.label?.toLowerCase();
    const where = second ? `${top?.name} and ${second.name}` : top?.name;
    return `Complaints are concentrated around ${where}` + (cat ? `, led by ${cat} issues` : "") + `. ${activeTotal.toLocaleString()} active across ${points.length} villages` + (criticalTotal ? `, ${criticalTotal} critical` : "") + ".";
  }, [points, hotspots, topCats, activeTotal, criticalTotal]);

  const dim = (s: string) => ({ color: s });

  return (
    <div className="flex flex-col h-full" style={{ background: MAPBG }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 flex-wrap flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: PANEL }}>
        <span className="font-semibold text-sm flex items-center gap-2" style={dim("#e2e8f0")}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: RED, display: "inline-block", boxShadow: `0 0 8px ${RED}` }} /> Command Map
        </span>
        <div className="flex gap-1">
          {MODES.map((m) => (
            <button key={m.key} onClick={() => setMode(m.key)}
              className="px-2.5 py-1 rounded text-xs font-medium transition-all"
              style={mode === m.key
                ? { background: "rgba(34,211,238,0.16)", color: CYAN, border: `1px solid ${LINE}` }
                : { background: "transparent", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.08)" }}>
              {m.icon} {m.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {(["dark", "satellite"] as const).map((b) => (
            <button key={b} onClick={() => setBasemap(b)}
              className="px-2.5 py-1 rounded text-xs font-medium transition-all"
              style={basemap === b
                ? { background: "rgba(34,211,238,0.16)", color: CYAN, border: `1px solid ${LINE}` }
                : { background: "transparent", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.08)" }}>
              {b === "dark" ? "🌑 Dark" : "🛰 Satellite"}
            </button>
          ))}
          <button onClick={() => setShowBoundaries((v) => !v)}
            className="px-2.5 py-1 rounded text-xs font-medium transition-all"
            style={showBoundaries
              ? { background: "rgba(34,211,238,0.16)", color: CYAN, border: `1px solid ${LINE}` }
              : { background: "transparent", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.08)" }}>
            ⬡ Villages
          </button>
        </div>
        <div className="ml-auto flex gap-3 text-xs items-center">
          <span style={dim("#f87171")}>● {criticalTotal} critical</span>
          <span style={dim("#38bdf8")}>● {activeTotal} active</span>
          <span style={dim("#94a3b8")}>{points.length} villages lit</span>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 relative">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm" style={{ color: "#64748b", background: MAPBG }}>Loading command map…</div>
          ) : (
            <InnerMap points={points} mode={mode} basemap={basemap} boundaries={boundaries} showBoundaries={showBoundaries} onSelect={setSelected} gpMap={gpMap} labelPts={labelPts} blockBoundaries={blocks} blockLabelPts={blockLabelPts} />
          )}

          {/* Density legend */}
          <div className="absolute bottom-4 left-4 z-[500] rounded-lg p-3 text-xs"
            style={{ background: "rgba(12,19,34,0.88)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(6px)", color: "#cbd5e1" }}>
            <div className="font-semibold uppercase tracking-wider mb-2" style={{ fontSize: 10, color: "#64748b" }}>
              {mode === "resolution" ? "Resolved" : mode === "sla" ? "SLA breaches" : "Complaint density"}
            </div>
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 10, color: "#64748b" }}>Low</span>
              <div style={{ width: 90, height: 8, borderRadius: 4, background: mode === "resolution" ? GREEN : `linear-gradient(90deg, ${CYAN}, ${AMBER}, ${RED})` }} />
              <span style={{ fontSize: 10, color: "#64748b" }}>High</span>
            </div>
          </div>
        </div>

        {/* AI Insight panel */}
        <div className="w-80 flex-shrink-0 overflow-y-auto" style={{ background: PANEL, borderLeft: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold tracking-widest" style={dim(CYAN)}>AI INSIGHT</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(34,211,238,0.12)", color: CYAN }}>BETA</span>
            </div>

            {selected ? (
              <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <div className="text-xs" style={dim("#64748b")}>Selected village</div>
                <div className="text-lg font-semibold" style={dim("#e2e8f0")}>{selected.name}</div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {[["Total", selected.total, "#38bdf8"], ["Active", selected.active, "#22d3ee"], ["Critical", selected.critical, "#f87171"], ["Resolved", selected.resolved, "#34d399"]].map(([l, v, c]) => (
                    <div key={l as string} className="rounded p-2" style={{ background: "rgba(255,255,255,0.03)" }}>
                      <div className="text-base font-semibold" style={dim(c as string)}>{v as number}</div>
                      <div style={{ fontSize: 10, color: "#64748b" }}>{l as string}</div>
                    </div>
                  ))}
                </div>
                <button onClick={() => setSelected(null)} className="text-xs mt-2" style={dim("#64748b")}>← back to overview</button>
              </div>
            ) : (
              <>
                <div>
                  <div className="text-xs" style={dim("#64748b")}>Active complaints</div>
                  <div className="text-4xl font-bold tracking-tight" style={dim("#f1f5f9")}>{activeTotal.toLocaleString()}</div>
                  <div className="text-xs mt-1" style={dim(pct > 0 ? "#f87171" : pct < 0 ? "#34d399" : "#94a3b8")}>
                    {pct > 0 ? "↑" : pct < 0 ? "↓" : "→"} {Math.abs(pct)}% vs last 7 days
                  </div>
                </div>

                <div className="rounded-lg p-3" style={{ background: "rgba(34,211,238,0.05)", border: "1px solid rgba(34,211,238,0.12)" }}>
                  <div className="text-xs font-medium mb-1 flex items-center gap-1" style={dim(CYAN)}>✦ AI summary</div>
                  <div className="text-xs leading-relaxed" style={dim("#cbd5e1")}>{summary}</div>
                </div>

                <div>
                  <div className="text-xs font-semibold mb-2" style={dim("#94a3b8")}>Top hotspots</div>
                  <div className="space-y-1.5">
                    {hotspots.length === 0 && <div className="text-xs" style={dim("#64748b")}>No active hotspots.</div>}
                    {hotspots.map((p, i) => (
                      <div key={p.code} onClick={() => setSelected(p)}
                        className="flex items-center justify-between rounded px-2 py-1.5 cursor-pointer"
                        style={{ background: "rgba(255,255,255,0.03)" }}>
                        <span className="flex items-center gap-2 text-xs" style={dim("#e2e8f0")}>
                          <span style={{ color: "#64748b", width: 14 }}>{String(i + 1).padStart(2, "0")}</span>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: p.critical > 0 ? RED : CYAN, display: "inline-block" }} />
                          {p.name}
                        </span>
                        <span className="text-xs font-semibold" style={dim("#f1f5f9")}>{metricFor(p, mode)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {topCats.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold mb-2" style={dim("#94a3b8")}>Top issue categories</div>
                    <div className="space-y-1.5">
                      {topCats.map((c) => (
                        <div key={c.label}>
                          <div className="flex justify-between text-xs mb-0.5" style={dim("#cbd5e1")}>
                            <span>{c.label}</span><span style={dim("#64748b")}>{c.n}</span>
                          </div>
                          <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.06)" }}>
                            <div style={{ width: `${Math.round((c.n / maxCat) * 100)}%`, height: 4, borderRadius: 2, background: CYAN }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
