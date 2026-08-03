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
  cats?: Record<string, number>;
}
type Mode = "density" | "active" | "sla" | "resolution";
interface MapData {
  points: VPoint[];
  categories: { label: string; n: number }[];
  trend: { last7: number; prior7: number; pct: number };
  meta: { villagesWithComplaints: number; plottable: number; activeTotal: number; criticalTotal: number };
  series?: { code: string; ts: number; crit: boolean; active: boolean }[];
  hotspots?: { name: string; active: number; total: number; pct: number | null }[];
  range?: { min: number; max: number };
}

// ---- Palette (dark console) ----
const CYAN = "#22D3EE", AMBER = "#F59E0B", RED = "#EF4444", GREEN = "#34D399";
const PANEL = "#0c1322", MAPBG = "#070b14", LINE = "rgba(34,211,238,0.35)";

// ---- Politics layer (2021 verified results) ----
interface PolAc {
  ac: string; reservation: string;
  winner: string; winnerParty: string; winnerVotes: number;
  runnerUp: string; runnerUpParty: string; runnerUpVotes: number;
  margin: number; marginPct: number;
  grievance: { total: number; active: number; critical: number; topCategory: string | null };
  battleground: number;
  booths?: { booths: number; winnerWon: number; runnerWon: number; razorThin: number } | null;
}
interface PoliticsData { year: number; source: string; acs: PolAc[]; note: string }
const PARTY_COLOR: Record<string, string> = { AITC: "#1B9E4B", BJP: "#F97316", INC: "#38BDF8", AJSU: "#A78BFA", CPM: "#EF4444" };
const partyColor = (p: string) => PARTY_COLOR[p] || "#94A3B8";

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

function metricFor(p: VPoint, m: Mode, cat?: string | null): number {
  if (cat) return p.cats?.[cat] || 0;
  return m === "density" ? p.total : m === "active" ? p.active : m === "sla" ? p.slaBreached : p.resolved;
}
/**
 * Colour bands, in absolute complaint counts rather than rank.
 *
 * These used to be shares of whatever the busiest village happened to be, so
 * with a live range of 1–4 a village with four complaints turned the same red
 * as one with forty, and six of eleven villages lit red on a seat carrying 24
 * open cases. Red has to mean the same thing on every screen and every day, so
 * it now means a count, not a position in today's range.
 */
const BANDS: { min: number; color: string; label: string }[] = [
  { min: 10, color: RED, label: "10+" },
  { min: 5, color: AMBER, label: "5–9" },
  { min: 1, color: CYAN, label: "1–4" },
];
function bandColor(v: number): string {
  for (const b of BANDS) if (v >= b.min) return b.color;
  return CYAN;
}
function colorFor(p: VPoint, m: Mode, _ratio: number): string {
  if (m === "resolution") return GREEN;
  if (m === "sla") return bandColor(p.slaBreached);
  // A critical case is red on its own merit — that is a severity fact, not a volume one.
  if (p.critical > 0) return RED;
  return bandColor(metricFor(p, m));
}

const PURULIA_CENTER: [number, number] = [23.33, 86.36];

// ---- Inner map (client-only) ----
const InnerMap = dynamic(
  () =>
    import("leaflet").then((L) =>
      import("react-leaflet").then(({ MapContainer, TileLayer, CircleMarker, GeoJSON, Tooltip, Marker, useMap }) => {
        function Fit({ points, freeze }: { points: VPoint[]; freeze?: boolean }) {
          const map = useMap();
          useEffect(() => {
            if (freeze) return; // don't re-fit while scrubbing the timeline
            if (points.length === 0) { map.setView(PURULIA_CENTER, 9); return; }
            if (points.length === 1) { map.setView([points[0].lat, points[0].lng], 12); return; }
            const b = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
            map.fitBounds(b.pad(0.25), { animate: true });
          }, [points, map, freeze]);
          return null;
        }

        function ZoomWatcher({ onZoom }: { onZoom: (z: number) => void }) {
          const map = useMap();
          useEffect(() => {
            // Hide the default "Leaflet" attribution prefix (keep tile credits for ToS)
            (map as any).attributionControl?.setPrefix("JanSunwai WB");
            const u = () => onZoom(map.getZoom());
            u(); map.on("zoomend", u);
            return () => { map.off("zoomend", u); };
          }, [map, onZoom]);
          return null;
        }

        // Fly the map to a searched village + drop a glowing locator reticle.
        function FlyTo({ target }: { target: { lat: number; lng: number; name: string } | null }) {
          const map = useMap();
          useEffect(() => {
            if (target) map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 14), { duration: 1.1 });
          }, [target, map]);
          if (!target) return null;
          return (
            <Marker position={[target.lat, target.lng]} interactive={false} zIndexOffset={1000}
              icon={L.divIcon({ className: "", iconSize: [0, 0], html: `<div style="position:relative;transform:translate(-50%,-50%);width:30px;height:30px"><div style="position:absolute;inset:0;border:2px solid #fff;border-radius:50%;box-shadow:0 0 12px #22d3ee,inset 0 0 6px #22d3ee;animation:reticle 1.6s ease-out infinite"></div><div style="position:absolute;top:50%;left:50%;width:6px;height:6px;background:#fff;border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 0 6px #fff"></div></div>` })} />
          );
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

        const Component = ({ points, mode, basemap, boundaries, showBoundaries, onSelect, gpMap, labelPts, blockBoundaries, blockLabelPts, acBoundaries, myAcs, catFilter, flyTarget, freezeFit, polByAc }: {
          points: VPoint[]; mode: Mode; basemap: "dark" | "satellite";
          boundaries: any; showBoundaries: boolean; onSelect: (p: VPoint) => void;
          gpMap: Record<string, string[]>; labelPts: { lat: number; lng: number; name: string; gp: string | null }[];
          blockBoundaries: any; blockLabelPts: { lat: number; lng: number; name: string }[];
          acBoundaries: any; myAcs: Set<string>;
          catFilter: string | null;
          flyTarget: { lat: number; lng: number; name: string } | null;
          freezeFit?: boolean;
          polByAc?: Record<string, PolAc> | null;
        }) => {
          const [zoom, setZoom] = useState(9);
          const visiblePoints = catFilter ? points.filter((p) => (p.cats?.[catFilter] || 0) > 0) : points;
          const max = Math.max(1, ...visiblePoints.map((p) => metricFor(p, mode, catFilter)));
          return (
            <MapContainer preferCanvas center={PURULIA_CENTER} zoom={9} zoomControl
              style={{ height: "100%", width: "100%", background: MAPBG }}>
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
              <FlyTo target={flyTarget} />

              {/* BLOCK boundaries — kept deliberately quiet. Blocks are the level
                  below the seat, and at full strength their cyan out-shouted the
                  constituency outline, so the map read bottom-up. */}
              {blockBoundaries && (
                <GeoJSON data={blockBoundaries}
                  style={() => ({ color: CYAN, weight: 0.8, opacity: 0.3, fillColor: CYAN, fillOpacity: 0.02 })}
                  onEachFeature={(f: any, layer: any) => { const nm = f?.properties?.block || f?.properties?.BLOCK || ""; if (nm) layer.bindTooltip(nm, { sticky: true }); }} />
              )}
              {/* Block-name labels when zoomed OUT */}
              {zoom < 12 && blockLabelPts.map((b, i) => (
                <Marker key={"bl" + i} position={[b.lat, b.lng]} interactive={false}
                  icon={L.divIcon({ className: "", iconSize: [0, 0], html: `<div style="transform:translate(-50%,-50%);white-space:nowrap;font-family:ui-sans-serif,system-ui;font-size:12px;font-weight:600;letter-spacing:0.04em;color:#bae6fd;text-shadow:0 0 5px #000,0 0 3px #000">${esc(b.name)}</div>` })} />
              ))}

              {/* POLITICS overlay — villages tinted by 2021 winning party (all zooms) */}
              {polByAc && boundaries && (
                <GeoJSON key={"pol" + Object.keys(gpMap).length} data={boundaries}
                  style={(f: any) => {
                    const code = f?.properties?.v;
                    const acName = code && gpMap[code] ? gpMap[code][1] : null;
                    const pa = acName ? polByAc[acName] : undefined;
                    const col = pa ? partyColor(pa.winnerParty) : "#475569";
                    // battleground (tight margin) glows hotter
                    const heat = pa ? 0.12 + (pa.battleground / 100) * 0.38 : 0.05;
                    return { color: col, weight: 0.3, opacity: 0.35, fillColor: col, fillOpacity: heat };
                  }}
                  onEachFeature={(f: any, layer: any) => {
                    const code = f?.properties?.v;
                    const m = code && gpMap[code] ? gpMap[code] : null;
                    const pa = m && m[1] ? polByAc[m[1]] : undefined;
                    if (pa) layer.bindTooltip(
                      `${(m && m[2]) || ""} · ${pa.ac} AC · ${pa.winnerParty} +${pa.margin.toLocaleString()} votes (2021) · BG ${pa.battleground}`,
                      { sticky: true }
                    );
                  }} />
              )}

              {/* VILLAGE detail — ONLY when zoomed IN (>=12) and toggle on */}
              {!polByAc && showBoundaries && zoom >= 12 && boundaries && (
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

              {/* CONSTITUENCY outlines — drawn over every other polygon so the
                  seat boundary is never buried. Your own AC keeps a bright, solid
                  edge; neighbours are dashed and dim, which answers the only
                  question the map was failing to answer: where does my seat end. */}
              {acBoundaries && (
                <GeoJSON data={acBoundaries} interactive={false}
                  style={(f: any) => {
                    const mine = myAcs.has(String(f?.properties?.ac || ""));
                    return mine
                      ? { color: "#FBBF24", weight: 3, opacity: 0.95, fill: false }
                      : { color: "#94A3B8", weight: 1.8, opacity: 0.6, dashArray: "6 6", fill: false };
                  }} />
              )}
              {acBoundaries?.features?.map((f: any, i: number) => {
                const at = f?.properties?.labelAt;
                if (!at) return null;
                const name = String(f.properties.ac || "");
                const mine = myAcs.has(name);
                // Neighbour names only help while zoomed out; up close they clutter.
                if (!mine && zoom >= 11) return null;
                return (
                  <Marker key={"ac" + i} position={[at[1], at[0]]} interactive={false}
                    icon={L.divIcon({ className: "", iconSize: [0, 0], html: `<div style="transform:translate(-50%,-50%);white-space:nowrap;font-family:ui-sans-serif,system-ui;font-size:${mine ? 13 : 11}px;font-weight:800;letter-spacing:0.10em;text-transform:uppercase;color:${mine ? "#FCD34D" : "#94A3B8"};opacity:${mine ? 1 : 0.6};text-shadow:0 0 6px #000,0 0 3px #000">${esc(name)}</div>` })} />
                );
              })}

              {visiblePoints.map((p) => {
                const v = metricFor(p, mode, catFilter);
                const ratio = v / max;
                const color = catFilter ? "#22D3EE" : colorFor(p, mode, ratio);
                const halo = 10 + ratio * 36;
                return (
                  <CircleMarker key={"h" + p.code} center={[p.lat, p.lng]} radius={halo}
                    pathOptions={{ stroke: false, fillColor: color, fillOpacity: 0.12 + ratio * 0.16 }}
                    eventHandlers={{ click: () => onSelect(p) }}>
                    <Tooltip direction="top" opacity={0.95}>
                      <span style={{ fontFamily: "ui-sans-serif, system-ui", fontSize: 12 }}>
                        <strong>{p.name}</strong> · {v} {catFilter ? catFilter.toLowerCase() : mode === "sla" ? "SLA breach" : mode === "resolution" ? "resolved" : mode}
                        {!catFilter && p.critical > 0 && mode !== "resolution" ? ` · ${p.critical} critical` : ""}
                      </span>
                    </Tooltip>
                  </CircleMarker>
                );
              })}
              {visiblePoints.map((p) => {
                const v = metricFor(p, mode, catFilter);
                const ratio = v / max;
                const color = catFilter ? "#22D3EE" : colorFor(p, mode, ratio);
                const core = 3.5 + ratio * 5;
                if (v === 0) return null;
                return (
                  <CircleMarker key={"c" + p.code} center={[p.lat, p.lng]} radius={core}
                    pathOptions={{ color: "#0a0f1e", weight: 0.5, fillColor: color, fillOpacity: 0.96 }}
                    eventHandlers={{ click: () => onSelect(p) }} />
                );
              })}
              {/* Pulsing ring on critical hotspots */}
              {!catFilter && mode !== "resolution" && visiblePoints.filter((p) => p.critical > 0).map((p) => (
                <Marker key={"p" + p.code} position={[p.lat, p.lng]} interactive={false}
                  icon={L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="crit-pulse"></div>` })} />
              ))}
              {showBoundaries && <Labels pts={labelPts} />}
              <Fit points={visiblePoints.length ? visiblePoints : points} freeze={freezeFit} />
            </MapContainer>
          );
        };
        return Component;
      })
    ),
  { ssr: false, loading: () => <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", background: MAPBG }}>Loading command map…</div> }
);

const Map3D = dynamic(() => import("@/components/Map3D").then((m) => m.Map3D), {
  ssr: false,
  loading: () => <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", background: MAPBG }}>Loading 3D engine…</div>,
});

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
  const [acShapes, setAcShapes] = useState<any>(null);
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const [view3d, setView3d] = useState(false);
  const [query, setQuery] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lng: number; name: string; code: string } | null>(null);
  const [timeMode, setTimeMode] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [polMode, setPolMode] = useState(false);
  const [politics, setPolitics] = useState<PoliticsData | null>(null);
  const [polLoading, setPolLoading] = useState(false);

  const togglePolitics = () => {
    setPolMode((v) => {
      const nv = !v;
      if (nv) { setView3d(false); setTimeMode(false); setPlaying(false); }
      return nv;
    });
    if (!politics && !polLoading) {
      setPolLoading(true);
      fetch('/api/map/politics', { headers: authHeaders() })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j?.data && setPolitics(j.data))
        .catch(() => {})
        .finally(() => setPolLoading(false));
    }
  };
  const [windowDays, setWindowDays] = useState(14);
  const [speed, setSpeed] = useState(1);

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
      fetch("/purulia-ac.geojson").then((r) => (r.ok ? r.json() : null)).then(setAcShapes).catch(() => {});
    })();
  }, []);

  /**
   * Which constituencies are actually mine.
   *
   * Read off the data rather than off the profile: the API already returns only
   * villages inside the caller's scope, so the ACs those villages sit in *are*
   * the caller's seats — one for an MLA, all nine for a district account. That
   * keeps the highlight honest even when a user record has no AC filled in.
   */
  const myAcs = useMemo(() => {
    const out = new Set<string>();
    for (const p of data?.points || []) {
      const m = gpMap[p.code];
      if (m && m[1]) out.add(m[1]);
    }
    return out;
  }, [data, gpMap]);

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

  // Searchable index of EVERY Purulia village (name + GP + centroid), built from
  // our own boundary geojson + authoritative GP map — no external geocoder.
  const villageIndex = useMemo(() => {
    const b: any = boundaries;
    if (!b?.features) return [] as { code: string; name: string; gp: string | null; lat: number; lng: number }[];
    const out: { code: string; name: string; gp: string | null; lat: number; lng: number }[] = [];
    for (const f of b.features) {
      const g = f.geometry; if (!g) continue;
      const ring = g.type === "Polygon" ? g.coordinates[0] : g.type === "MultiPolygon" ? g.coordinates[0][0] : null;
      if (!ring || !ring.length) continue;
      let sx = 0, sy = 0; for (const c of ring) { sx += c[0]; sy += c[1]; }
      const code = f.properties?.v || "";
      const meta = code ? gpMap[code] : null;
      out.push({ code, name: (meta && meta[2]) || f.properties?.n || "", gp: meta ? meta[0] : null, lat: sy / ring.length, lng: sx / ring.length });
    }
    return out;
  }, [boundaries, gpMap]);

  const pointByCode = useMemo(() => { const m: Record<string, VPoint> = {}; for (const p of points) m[p.code] = p; return m; }, [points]);

  // ---- Time-slider: rolling 14-day heat window over the complaint event stream ----
  const DAY_MS = 86400000;
  const TIME_WINDOW = windowDays * DAY_MS;
  const series = useMemo(() => data?.series || [], [data]);
  const range = data?.range && data.range.max ? data.range : null;

  const timePoints = useMemo(() => {
    if (!timeMode || !series.length) return [] as VPoint[];
    const m: Record<string, VPoint> = {};
    const lo = cursor - TIME_WINDOW;
    for (const e of series) {
      if (e.ts > cursor || e.ts <= lo) continue;
      const meta = pointByCode[e.code]; if (!meta) continue;
      const v = m[e.code] || (m[e.code] = { code: e.code, name: meta.name, lat: meta.lat, lng: meta.lng, total: 0, active: 0, critical: 0, resolved: 0, slaBreached: 0, cats: {} });
      v.total++; if (e.active) v.active++; if (e.crit && e.active) v.critical++;
    }
    return Object.values(m);
  }, [timeMode, series, cursor, pointByCode, TIME_WINDOW]);

  const windowTotal = useMemo(() => timePoints.reduce((s, p) => s + p.total, 0), [timePoints]);
  const displayPoints = timeMode ? timePoints : points;
  const fmtDate = (ts: number) => (ts ? new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");

  // when timeline turns on, start at the latest date (familiar full state)
  useEffect(() => { if (timeMode && range) setCursor(range.max); }, [timeMode, range]);
  // playback: advance one day every 220ms, loop back to start at the end
  useEffect(() => {
    if (!playing || !timeMode || !range) return;
    const id = setInterval(() => {
      setCursor((c) => { const next = c + DAY_MS; return next > range.max ? range.min : next; });
    }, Math.max(40, Math.round(220 / speed)));
    return () => clearInterval(id);
  }, [playing, timeMode, range, DAY_MS, speed]);

  const nq = query.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const searchResults = useMemo(() => {
    if (nq.length < 2) return [] as typeof villageIndex;
    const starts: typeof villageIndex = [], incl: typeof villageIndex = [];
    for (const v of villageIndex) {
      const key = v.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!key) continue;
      if (key.startsWith(nq)) starts.push(v);
      else if (key.includes(nq)) incl.push(v);
    }
    return [...starts, ...incl].slice(0, 8);
  }, [nq, villageIndex]);

  const gotoVillage = (v: { code: string; name: string; gp: string | null; lat: number; lng: number }) => {
    setView3d(false);
    setQuery(v.name);
    setShowResults(false);
    setFlyTarget({ lat: v.lat, lng: v.lng, name: v.name, code: v.code });
    const pt = pointByCode[v.code];
    setSelected(pt || { code: v.code, name: v.name, lat: v.lat, lng: v.lng, total: 0, active: 0, critical: 0, resolved: 0, slaBreached: 0, cats: {} });
  };

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
    () => [...points].sort((a, b) => metricFor(b, mode, catFilter) - metricFor(a, mode, catFilter)).filter((p) => metricFor(p, mode, catFilter) > 0).slice(0, 6),
    [points, mode, catFilter]
  );

  /**
   * Per-village week-on-week change, from the event stream the API already
   * sends for the timeline. A count alone says which village is loudest; the
   * change says which one is getting worse, and that is the one to visit.
   *
   * A village with no complaints in the prior week reports null rather than
   * +100% — a first-ever complaint is not a surge.
   */
  const trendByCode = useMemo(() => {
    const series = data?.series;
    if (!series?.length) return {} as Record<string, number | null>;
    const now = Date.now(), DAY = 86400000;
    const buckets: Record<string, { last7: number; prior7: number }> = {};
    for (const e of series) {
      const age = (now - e.ts) / DAY;
      if (age > 14) continue;
      const b = buckets[e.code] || (buckets[e.code] = { last7: 0, prior7: 0 });
      if (age <= 7) b.last7++; else b.prior7++;
    }
    const out: Record<string, number | null> = {};
    for (const [code, b] of Object.entries(buckets)) {
      out[code] = b.prior7 > 0 ? Math.round(((b.last7 - b.prior7) / b.prior7) * 100) : null;
    }
    return out;
  }, [data?.series]);
  const activeTotal = data?.meta.activeTotal ?? 0;
  const criticalTotal = data?.meta.criticalTotal ?? 0;
  const pct = data?.trend.pct ?? 0;
  const topCats = data?.categories || [];
  const maxCat = Math.max(1, ...topCats.map((c) => c.n));

  const summary = useMemo(() => {
    if (points.length === 0) return "No complaints plotted in your jurisdiction yet. As complaints come in, hotspots will light up here.";
    // Blocks, not villages: a letter goes to a BDO, so the block is the unit
    // this sentence is useful in. Falls back to village names if the rollup is
    // unavailable.
    const blocks = data?.hotspots || [];
    const where = blocks.length >= 2
      ? `${blocks[0].name} and ${blocks[1].name} blocks`
      : blocks.length === 1
        ? `${blocks[0].name} block`
        : hotspots[1] ? `${hotspots[0]?.name} and ${hotspots[1].name}` : hotspots[0]?.name;
    const cat = topCats[0]?.label?.toLowerCase();
    return `Complaints are concentrated in ${where}` + (cat ? `, led by ${cat} issues` : "") + `. ${activeTotal.toLocaleString()} active across ${points.length} villages` + (criticalTotal ? `, ${criticalTotal} critical` : "") + ".";
  }, [points, hotspots, topCats, activeTotal, criticalTotal, data?.hotspots]);

  const dim = (s: string) => ({ color: s });

  return (
    // Sized to the viewport rather than to its content: as `h-full` inside an
    // auto-height parent the panel grew past the fold and dragged the whole page
    // into scrolling. (Sticky was tried here and does nothing — the panel fills
    // its containing block exactly, so it has no room to slide within it. The
    // smearing it was meant to fix came from the header's transparency, which is
    // fixed in globals.css instead.)
    <div className="flex flex-col h-[calc(100svh-13rem)] lg:h-[calc(100svh-8.5rem)] min-h-[520px]" style={{ background: MAPBG }}>
      <style>{`.crit-pulse{width:8px;height:8px;border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 0 0 0 rgba(239,68,68,0.5);animation:critpulse 1.8s ease-out infinite}@keyframes critpulse{0%{box-shadow:0 0 0 0 rgba(239,68,68,0.5)}70%{box-shadow:0 0 0 15px rgba(239,68,68,0)}100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}}.v-search-item:hover{background:rgba(34,211,238,0.12)}@keyframes reticle{0%{box-shadow:0 0 12px #22d3ee,inset 0 0 6px #22d3ee}50%{box-shadow:0 0 22px #22d3ee,inset 0 0 11px #22d3ee}100%{box-shadow:0 0 12px #22d3ee,inset 0 0 6px #22d3ee}}`}</style>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 flex-wrap flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: PANEL }}>
        <span className="font-semibold text-sm flex items-center gap-2" style={dim("#e2e8f0")}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: RED, display: "inline-block", boxShadow: `0 0 8px ${RED}` }} /> Command Map
        </span>

        {/* Village search — local, no external geocoder */}
        <div className="relative" style={{ width: 210 }}>
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setShowResults(true); }}
            onFocus={() => setShowResults(true)}
            onBlur={() => setTimeout(() => setShowResults(false), 160)}
            onKeyDown={(e) => { if (e.key === "Enter" && searchResults[0]) gotoVillage(searchResults[0]); if (e.key === "Escape") { setQuery(""); setShowResults(false); } }}
            placeholder="🔍 Search any village…"
            className="w-full px-2.5 py-1 rounded text-xs"
            style={{ background: "rgba(255,255,255,0.05)", color: "#e2e8f0", border: "1px solid rgba(255,255,255,0.12)", outline: "none" }}
          />
          {query && (
            <button onMouseDown={(e) => { e.preventDefault(); setQuery(""); setFlyTarget(null); setShowResults(false); }}
              className="absolute" style={{ right: 6, top: 4, color: "#64748b", fontSize: 13 }}>×</button>
          )}
          {showResults && searchResults.length > 0 && (
            <div className="absolute left-0 mt-1 rounded-lg overflow-hidden" style={{ top: "100%", zIndex: 1000, minWidth: 230, background: PANEL, border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 8px 24px rgba(0,0,0,0.55)" }}>
              {searchResults.map((v) => {
                const pt = pointByCode[v.code];
                return (
                  <button key={v.code} className="v-search-item block w-full text-left px-3 py-1.5 text-xs" style={{ color: "#e2e8f0" }}
                    onMouseDown={(e) => { e.preventDefault(); gotoVillage(v); }}>
                    <span className="font-medium">{v.name}</span>
                    {pt && pt.total > 0 && <span style={{ color: pt.critical > 0 ? "#f87171" : "#38bdf8" }}> · {pt.total}</span>}
                    {v.gp && <span style={{ color: "#64748b" }}> · GP {v.gp}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

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
          <button onClick={() => setView3d((v) => { const nv = !v; if (nv) { setTimeMode(false); setPlaying(false); } return nv; })}
            className="px-2.5 py-1 rounded text-xs font-semibold transition-all"
            style={view3d ? { background: "rgba(34,211,238,0.2)", color: CYAN, border: `1px solid ${LINE}` } : { background: "transparent", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.08)" }}>
            {view3d ? "🧊 3D" : "🗺 2D"}
          </button>
          <button onClick={() => setTimeMode((v) => { const nv = !v; if (nv) { setView3d(false); setPolMode(false); } else setPlaying(false); return nv; })}
            className="px-2.5 py-1 rounded text-xs font-semibold transition-all"
            style={timeMode ? { background: "rgba(34,211,238,0.2)", color: CYAN, border: `1px solid ${LINE}` } : { background: "transparent", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.08)" }}>
            ⏱ Timeline
          </button>
          <button onClick={togglePolitics}
            className="px-2.5 py-1 rounded text-xs font-semibold transition-all"
            style={polMode ? { background: "rgba(249,115,22,0.2)", color: "#fb923c", border: "1px solid rgba(249,115,22,0.4)" } : { background: "transparent", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.08)" }}>
            🗳 Politics
          </button>
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
        {topCats.length > 0 && (
          <div className="flex gap-1 items-center">
            <span className="text-[10px]" style={dim("#475569")}>filter</span>
            <button onClick={() => setCatFilter(null)} className="px-2 py-1 rounded text-xs font-medium transition-all"
              style={!catFilter ? { background: "rgba(34,211,238,0.16)", color: CYAN, border: `1px solid ${LINE}` } : { background: "transparent", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.08)" }}>All</button>
            {topCats.slice(0, 5).map((c) => (
              <button key={c.label} onClick={() => setCatFilter(catFilter === c.label ? null : c.label)}
                className="px-2 py-1 rounded text-xs font-medium transition-all"
                style={catFilter === c.label ? { background: "rgba(34,211,238,0.16)", color: CYAN, border: `1px solid ${LINE}` } : { background: "transparent", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.08)" }}>
                {c.label}
              </button>
            ))}
          </div>
        )}
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
          ) : view3d ? (
            <Map3D points={points} boundaries={boundaries} />
          ) : (
            <InnerMap points={displayPoints} mode={mode} basemap={basemap} boundaries={boundaries} showBoundaries={showBoundaries} onSelect={setSelected} gpMap={gpMap} labelPts={labelPts} blockBoundaries={blocks} blockLabelPts={blockLabelPts} acBoundaries={acShapes} myAcs={myAcs} catFilter={catFilter} flyTarget={flyTarget} freezeFit={timeMode} polByAc={polMode && politics ? Object.fromEntries(politics.acs.map((a) => [a.ac, a])) : null} />
          )}

          {/* Density legend (hidden while the timeline bar is up) */}
          {!timeMode && (
            <div className="absolute bottom-4 left-4 z-[500] rounded-lg p-3 text-xs"
              style={{ background: "rgba(12,19,34,0.88)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(6px)", color: "#cbd5e1" }}>
              <div className="font-semibold uppercase tracking-wider mb-2" style={{ fontSize: 10, color: "#64748b" }}>
                {mode === "resolution" ? "Resolved" : mode === "sla" ? "SLA breaches" : "Complaint density"}
              </div>
              {/* Named counts, not "Low → High": a gradient can't tell you whether
                  red means four complaints or forty, and that was the old flaw. */}
              {mode === "resolution" ? (
                <div className="flex items-center gap-2">
                  <span style={{ width: 9, height: 9, borderRadius: 9, background: GREEN, display: "inline-block" }} />
                  <span style={{ fontSize: 11 }}>Resolved cases</span>
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {BANDS.map((b) => (
                    <div key={b.label} className="flex items-center gap-2">
                      <span style={{ width: 9, height: 9, borderRadius: 9, background: b.color, display: "inline-block" }} />
                      <span style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{b.label}</span>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 mt-1 pt-1" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                    <span style={{ width: 9, height: 9, borderRadius: 9, background: RED, display: "inline-block" }} />
                    <span style={{ fontSize: 11 }}>any critical case</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Timeline scrubber — rolling 14-day heat window over the last ~75 days */}
          {timeMode && range && (
            <div className="absolute z-[600]" style={{ left: 16, right: 16, bottom: 16, background: "rgba(12,19,34,0.93)", border: "1px solid rgba(34,211,238,0.28)", borderRadius: 10, padding: "10px 14px", backdropFilter: "blur(6px)" }}>
              <div className="flex items-center gap-3">
                <button onClick={() => setPlaying((p) => !p)} className="rounded text-sm flex-shrink-0" style={{ width: 32, height: 28, background: "rgba(34,211,238,0.16)", color: CYAN, border: `1px solid ${LINE}` }}>{playing ? "⏸" : "▶"}</button>
                <input type="range" min={range.min} max={range.max} step={DAY_MS} value={cursor}
                  onChange={(e) => setCursor(Number(e.target.value))}
                  className="flex-1" style={{ accentColor: CYAN }} />
                <div style={{ minWidth: 160, textAlign: "right" }}>
                  <div className="text-xs font-semibold" style={{ color: "#e2e8f0" }}>{fmtDate(cursor)}</div>
                  <div style={{ fontSize: 10, color: "#64748b" }}>{windowDays}-day heat · {windowTotal} complaints · {timePoints.length} villages</div>
                </div>
              </div>
              <div className="flex items-center justify-between mt-2">
                <div className="flex items-center gap-1">
                  <span style={{ fontSize: 10, color: "#475569", marginRight: 2 }}>Window</span>
                  {[7, 14, 30].map((d) => (
                    <button key={d} onClick={() => setWindowDays(d)} className="px-2 py-0.5 rounded text-[11px] font-medium"
                      style={windowDays === d ? { background: "rgba(34,211,238,0.18)", color: CYAN, border: `1px solid ${LINE}` } : { background: "transparent", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.08)" }}>{d}d</button>
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  <span style={{ fontSize: 10, color: "#475569", marginRight: 2 }}>Speed</span>
                  {[0.5, 1, 2, 4].map((s) => (
                    <button key={s} onClick={() => setSpeed(s)} className="px-2 py-0.5 rounded text-[11px] font-medium"
                      style={speed === s ? { background: "rgba(34,211,238,0.18)", color: CYAN, border: `1px solid ${LINE}` } : { background: "transparent", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.08)" }}>{s}×</button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* AI Insight panel */}
        <div className="w-80 flex-shrink-0 overflow-y-auto" style={{ background: PANEL, borderLeft: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold tracking-widest" style={dim(polMode ? "#fb923c" : CYAN)}>{polMode ? "BATTLEGROUND 2021" : "AI INSIGHT"}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: polMode ? "rgba(249,115,22,0.12)" : "rgba(34,211,238,0.12)", color: polMode ? "#fb923c" : CYAN }}>{polMode ? "ECI" : "BETA"}</span>
            </div>

            {polMode ? (
              !politics ? (
                <div className="text-xs" style={dim("#64748b")}>{polLoading ? "Loading 2021 results…" : "Could not load the political layer."}</div>
              ) : (
                <>
                  <div className="rounded-lg p-3" style={{ background: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.18)" }}>
                    <div className="text-[10px] uppercase tracking-wider" style={dim("#94a3b8")}>Sabse garam seat</div>
                    <div className="text-lg font-black" style={dim("#f1f5f9")}>{politics.acs[0].ac}</div>
                    <div className="text-xs mt-0.5" style={dim("#cbd5e1")}>
                      {politics.acs[0].winnerParty} sirf <b style={{ color: "#fb923c" }}>{politics.acs[0].margin.toLocaleString()}</b> vote se jeeti ({politics.acs[0].marginPct}%)
                      {politics.acs[0].grievance.active > 0 && <> · now <b style={{ color: "#f87171" }}>{politics.acs[0].grievance.active}</b> active complaints{politics.acs[0].grievance.topCategory ? ` (top: ${politics.acs[0].grievance.topCategory})` : ""}</>}
                    </div>
                    {politics.acs[0].booths && (
                      <div className="text-[11px] mt-1.5 rounded px-2 py-1" style={{ background: "rgba(255,255,255,0.05)", color: "#e2e8f0" }}>
                        🗳 Booth-level (Form-20 EVM): {politics.acs[0].booths.booths} booths — {politics.acs[0].winnerParty} <b>{politics.acs[0].booths.winnerWon}</b> · {politics.acs[0].runnerUpParty} <b>{politics.acs[0].booths.runnerWon}</b> · <b style={{ color: "#fb923c" }}>{politics.acs[0].booths.razorThin}</b> booths ≤25 vote se decide
                      </div>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {politics.acs.map((a, i) => (
                      <div key={a.ac} className="rounded-lg px-2 py-1.5" style={{ background: "rgba(255,255,255,0.03)", borderLeft: `3px solid ${partyColor(a.winnerParty)}` }}>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono" style={dim("#64748b")}>{String(i + 1).padStart(2, "0")}</span>
                          <span className="text-xs font-bold flex-1 truncate" style={dim("#e2e8f0")}>{a.ac}{a.reservation !== "GENERAL" ? ` (${a.reservation})` : ""}</span>
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: partyColor(a.winnerParty) + "22", color: partyColor(a.winnerParty) }}>{a.winnerParty}</span>
                          <span className="text-sm font-black font-mono" style={{ color: a.battleground >= 60 ? "#fb923c" : "#94a3b8" }}>{a.battleground}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                            <div style={{ width: `${a.battleground}%`, height: "100%", borderRadius: 3, background: a.battleground >= 60 ? "#fb923c" : "#64748b" }} />
                          </div>
                          <span className="text-[10px] font-mono" style={dim("#94a3b8")}>±{a.margin.toLocaleString()}</span>
                          {a.booths && a.booths.razorThin > 0 && <span className="text-[10px]" title={`${a.booths.razorThin} booths ≤25 votes`} style={dim("#fb923c")}>🗳{a.booths.razorThin}</span>}
                          {a.grievance.active > 0 && <span className="text-[10px]" style={dim("#f87171")}>▲{a.grievance.active}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="text-[9px] leading-relaxed" style={dim("#475569")}>
                    BG score = 2021 margin ki tangi (60%) + aaj ka active-complaint pressure (40%). {politics.note}
                  </div>
                </>
              )
            ) : selected ? (
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
                    {hotspots.map((p, i) => {
                      const chg = trendByCode[p.code];
                      return (
                        <div key={p.code} onClick={() => setSelected(p)}
                          className="flex items-center justify-between rounded px-2 py-1.5 cursor-pointer"
                          style={{ background: "rgba(255,255,255,0.03)" }}>
                          <span className="flex items-center gap-2 text-xs" style={dim("#e2e8f0")}>
                            <span style={{ color: "#64748b", width: 14 }}>{String(i + 1).padStart(2, "0")}</span>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: p.critical > 0 ? RED : CYAN, display: "inline-block" }} />
                            {p.name}
                          </span>
                          <span className="text-right">
                            <span className="text-xs font-semibold block" style={dim("#f1f5f9")}>{metricFor(p, mode)}</span>
                            {chg !== null && chg !== undefined && chg !== 0 && (
                              <span className="text-[10px] font-mono" style={dim(chg > 0 ? "#f87171" : "#34d399")}>
                                {chg > 0 ? "↑" : "↓"} {Math.abs(chg)}%
                              </span>
                            )}
                          </span>
                        </div>
                      );
                    })}
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
