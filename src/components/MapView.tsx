/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import "leaflet/dist/leaflet.css";
import dynamic from "next/dynamic";
import { useEffect, useState, useMemo } from "react";
import { authHeaders } from "@/lib/helpers";

// ---- Types ----
interface BlockData {
  district: string;
  block: string;
  constituency: string | null;
  lat: number;
  lng: number;
  total: number;
  active: number;
  resolved: number;
  critical: number;
  slaBreached: number;
  resolutionRate: number;
  avgAnger: number | null;
  angerRated: number;
  risk: number;
  cats: Record<string, number>;
}

type ViewMode = "risk" | "anger" | "resolution";

// ---- Geocode table for WB blocks ----
const BLOCK_COORDS: Record<string, [number, number]> = {
  "Manbazar I": [23.065, 86.670], "Manbazar II": [23.020, 86.720], "Manbazar 1": [23.065, 86.670], "Manbazar": [23.045, 86.695],
  "Puncha": [23.090, 86.590], "Hura": [23.110, 86.760], "Arsha": [23.220, 86.580], "Balarampur": [23.278, 86.498],
  "Baghmundi": [23.180, 86.450], "Joypur": [23.378, 86.395], "Jhalda I": [23.358, 86.488], "Jhalda II": [23.340, 86.510],
  "Purulia I": [23.332, 86.365], "Purulia -1": [23.332, 86.365], "Purulia II": [23.290, 86.390], "Bandwan": [22.960, 86.620],
  "Barabazar": [23.010, 86.680], "Kashipur": [23.430, 86.620], "Para": [23.410, 86.810], "Raghunathpur I": [23.547, 86.672],
  "Raghunathpur II": [23.520, 86.700], "Neturia": [23.567, 86.755], "Santuri": [23.530, 86.780],
  "Bankura I": [23.232, 87.071], "Bolpur": [23.669, 87.717], "Rampurhat": [24.175, 87.782], "Dinhata": [26.133, 89.469],
  "Mathabhanga": [26.350, 89.220], "Siliguri": [26.717, 88.428], "Kaliganj": [23.454, 88.491], "Krishnanagar": [23.400, 88.495],
  "Tehatta": [23.714, 88.524], "Barasat": [22.723, 88.481], "Dunlop": [22.620, 88.370], "Habra": [22.842, 88.657],
};

const CAT_COLORS: Record<string, string> = {
  WATER: "#3b9eff", ROAD: "#ff9f3b", HEALTH: "#ff3baa", ELECTRICITY: "#ffe03b", OTHER: "#9b8fff",
  PENSION: "#3bffcc", EDUCATION: "#ff6b6b", RATION: "#ff8c00", SANITATION: "#00e5cc", HOUSING: "#e066ff", LAND: "#ff4444",
};

const GREY = "#4a5568";
// Heat ramp: green (calm) → amber → red (hot)
function heatColor(v: number | null, hi = 60, mid = 35): string {
  if (v === null || v === undefined) return GREY;
  if (v >= hi) return "#ff3b3b";
  if (v >= mid) return "#ffb000";
  if (v > 0) return "#00c96e";
  return GREY;
}
function colorFor(b: BlockData, mode: ViewMode): string {
  if (b.total === 0) return GREY;
  if (mode === "risk") return heatColor(b.risk, 60, 35);
  if (mode === "anger") return b.avgAnger === null ? GREY : heatColor(b.avgAnger, 60, 35);
  // resolution: high rate = green, low = red (inverted)
  if (b.active === 0) return "#00c96e";
  if (b.resolutionRate >= 40) return "#ffb000";
  return "#ff3b3b";
}
function metricFor(b: BlockData, mode: ViewMode): number {
  if (mode === "risk") return b.risk;
  if (mode === "anger") return b.avgAnger ?? 0;
  return b.resolutionRate;
}

// Match a boundary polygon's block name to the API block data — tolerant of
// case / hyphen / spacing AND roman-vs-digit suffix (Manbazar I == Manbazar 1).
function normBlock(s: string): string {
  let x = String(s || "").toUpperCase().replace(/[\s\-_.]/g, "");
  x = x.replace(/III$/, "3").replace(/II$/, "2").replace(/I$/, "1");
  return x;
}

// ---- Inner map (client-only) ----
const InnerMap = dynamic(
  () =>
    import("leaflet").then((L) => {
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
        iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
        shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
      });
      return import("react-leaflet").then(({ MapContainer, TileLayer, CircleMarker, Popup, Tooltip, GeoJSON }) => {
        const Component = ({ blocks, mode, onSelect, selectedKey, center, zoom, basemap, satYear, boundaries }: {
          blocks: BlockData[]; mode: ViewMode; onSelect: (b: BlockData) => void;
          selectedKey: string | null; center: [number, number]; zoom: number;
          basemap: "street" | "satellite"; satYear: "recent" | "2018" | "2020" | "2023"; boundaries: any;
        }) => (
          <MapContainer center={center} zoom={zoom} style={{ height: "100%", width: "100%", minHeight: "500px" }} zoomControl>
            {basemap === "satellite" ? (
              <>
                {/* Recent = Esri World Imagery (current, high-res, free). 2018/2020/2023 =
                    EOX Sentinel-2 cloudless yearly mosaics (10m, free, no key) — flip years
                    to visually verify if infra (road / pond / building) appeared over time.
                    Reference overlay keeps place/boundary labels on top either way. */}
                <TileLayer
                  key={satYear}
                  url={satYear === "recent"
                    ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                    : `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-${satYear}_3857/default/g/{z}/{y}/{x}.jpg`}
                  attribution={satYear === "recent"
                    ? "Imagery &copy; Esri, Maxar, Earthstar Geographics"
                    : `Sentinel-2 cloudless ${satYear} &copy; EOX (modified Copernicus data)`}
                  maxZoom={satYear === "recent" ? 19 : 16}
                />
                <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}" maxZoom={19} />
              </>
            ) : (
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" opacity={0.9} />
            )}
            {/* Choropleth — real CD-block boundary polygons (LGD), shaded by the current mode */}
            {boundaries && (
              <GeoJSON
                key={mode}
                data={boundaries}
                style={(feat: any) => {
                  const b = blocks.find((x) => normBlock(x.block) === normBlock(feat?.properties?.block || ""));
                  if (!b || b.total === 0) return { color: "#94a3b8", weight: 1, fillColor: "#94a3b8", fillOpacity: 0.06 };
                  const c = colorFor(b, mode);
                  return { color: c, weight: 1.5, fillColor: c, fillOpacity: 0.45 };
                }}
                onEachFeature={(feat: any, layer: any) => {
                  const name = feat?.properties?.block || "";
                  const b = blocks.find((x) => normBlock(x.block) === normBlock(name));
                  const tip = b
                    ? `${name} · ${mode === "resolution" ? metricFor(b, mode) + "% resolved" : mode === "anger" ? (b.avgAnger === null ? "no anger data" : "anger " + metricFor(b, mode)) : "risk " + metricFor(b, mode)}`
                    : `${name} · no complaints`;
                  layer.bindTooltip(tip, { sticky: true });
                  if (b) layer.on("click", () => onSelect(b));
                }}
              />
            )}
            {blocks.map((b) => {
              const key = b.district + "||" + b.block;
              const color = colorFor(b, mode);
              const metric = metricFor(b, mode);
              // size by active load so big problem-areas pop
              const radius = Math.max(9, Math.min(34, 9 + b.active * 2.2 + b.critical * 3));
              const isSelected = key === selectedKey;
              return (
                <CircleMarker key={key} center={[b.lat, b.lng]} radius={radius}
                  pathOptions={{ color, fillColor: color, fillOpacity: 0.4, weight: isSelected ? 3.5 : 1.5, opacity: 0.95 }}
                  eventHandlers={{ click: () => onSelect(b) }}>
                  <Tooltip direction="top" offset={[0, -radius]} opacity={0.95}>
                    <span style={{ fontFamily: "monospace", fontSize: 12 }}>
                      <strong>{b.block}</strong> · {mode === "risk" ? `risk ${metric}` : mode === "anger" ? (b.avgAnger === null ? "no anger data" : `anger ${metric}`) : `${metric}% resolved`}
                    </span>
                  </Tooltip>
                  <Popup>
                    <div style={{ minWidth: 190, fontFamily: "sans-serif" }}>
                      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{b.block}</div>
                      <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>{b.constituency || b.district} · {b.district}</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
                        {[
                          { label: "Risk", val: b.risk, color: heatColor(b.risk) },
                          { label: "Anger", val: b.avgAnger ?? "—", color: b.avgAnger === null ? "#888" : heatColor(b.avgAnger) },
                          { label: "Active", val: b.active, color: "#ff3b3b" },
                          { label: "Critical", val: b.critical, color: b.critical > 0 ? "#ff3b3b" : "#00c96e" },
                          { label: "SLA breach", val: b.slaBreached, color: "#ff8c00" },
                          { label: "Resolved", val: `${b.resolutionRate}%`, color: "#00c96e" },
                        ].map(({ label, val, color }) => (
                          <div key={label} style={{ background: "#f5f5f5", borderRadius: 6, padding: "5px 7px", textAlign: "center" }}>
                            <div style={{ fontWeight: 700, fontSize: 15, color }}>{val}</div>
                            <div style={{ fontSize: 8.5, color: "#888", textTransform: "uppercase" }}>{label}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {Object.entries(b.cats).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([cat, cnt]) => (
                          <span key={cat} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: (CAT_COLORS[cat] || "#8090ff") + "22", color: CAT_COLORS[cat] || "#8090ff", border: "1px solid " + (CAT_COLORS[cat] || "#8090ff") + "44" }}>
                            {cat} x{cnt}
                          </span>
                        ))}
                      </div>
                    </div>
                  </Popup>
                </CircleMarker>
              );
            })}
          </MapContainer>
        );
        return Component;
      });
    }),
  { ssr: false, loading: () => <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#666" }}>Loading map…</div> }
);

const MODE_LABELS: Record<ViewMode, string> = { risk: "🎯 Risk", anger: "😡 Anger", resolution: "✅ Resolution" };

// ---- Main export ----
export function MapView() {
  const [blocks, setBlocks] = useState<BlockData[]>([]);
  const [mode, setMode] = useState<ViewMode>("risk");
  const [basemap, setBasemap] = useState<"street" | "satellite">("street");
  const [satYear, setSatYear] = useState<"recent" | "2018" | "2020" | "2023">("recent");
  const [selected, setSelected] = useState<BlockData | null>(null);
  const [boundaries, setBoundaries] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/map/risk", { headers: authHeaders() });
        const json = await res.json();
        const raw: Omit<BlockData, "lat" | "lng">[] = json.data || [];
        const result: BlockData[] = raw.map((d) => {
          const coords = BLOCK_COORDS[d.block] || [23.332, 86.365];
          return { ...d, lat: coords[0], lng: coords[1] };
        });
        setBlocks(result);
        // CD-block boundary polygons for the choropleth (static public file, best-effort)
        fetch("/purulia-blocks.geojson").then((r) => (r.ok ? r.json() : null)).then(setBoundaries).catch(() => {});
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const selectedKey = selected ? selected.district + "||" + selected.block : null;

  // Center the map on the scoped blocks (so an MLA lands on their AC, not all WB)
  const { center, zoom } = useMemo(() => {
    if (blocks.length === 0) return { center: [23.15, 86.5] as [number, number], zoom: 8 };
    const lat = blocks.reduce((s, b) => s + b.lat, 0) / blocks.length;
    const lng = blocks.reduce((s, b) => s + b.lng, 0) / blocks.length;
    return { center: [lat, lng] as [number, number], zoom: blocks.length <= 3 ? 11 : blocks.length <= 8 ? 9 : 8 };
  }, [blocks]);

  const totalActive = blocks.reduce((s, b) => s + b.active, 0);
  const totalCritical = blocks.reduce((s, b) => s + b.critical, 0);
  const redZones = blocks.filter((b) => b.risk >= 60).length;
  const angryAreas = blocks.filter((b) => (b.avgAnger ?? 0) >= 60).length;

  const legendItems = mode === "resolution"
    ? [["#ff3b3b", "Low resolution"], ["#ffb000", "Partly resolved"], ["#00c96e", "All resolved"], [GREY, "No complaints"]]
    : [["#ff3b3b", mode === "risk" ? "High risk (60+)" : "High anger (60+)"], ["#ffb000", "Elevated (35-59)"], ["#00c96e", "Calm (1-34)"], [GREY, mode === "anger" ? "No anger data" : "No complaints"]];

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b flex-shrink-0 flex-wrap">
        <h2 className="font-semibold text-sm">Risk Command Map</h2>
        <div className="flex gap-1">
          {(["risk", "anger", "resolution"] as ViewMode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-2.5 py-1 rounded text-xs font-medium border transition-all ${mode === m ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-foreground"}`}>
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {(["street", "satellite"] as const).map((bm) => (
            <button key={bm} onClick={() => setBasemap(bm)}
              className={`px-2.5 py-1 rounded text-xs font-medium border transition-all ${basemap === bm ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-foreground"}`}>
              {bm === "street" ? "🗺 Street" : "🛰 Satellite"}
            </button>
          ))}
        </div>
        {basemap === "satellite" && (
          <div className="flex items-center gap-1">
            {(["recent", "2023", "2020", "2018"] as const).map((y) => (
              <button key={y} onClick={() => setSatYear(y)}
                className={`px-2 py-1 rounded text-xs font-medium border transition-all ${satYear === y ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-foreground"}`}>
                {y === "recent" ? "Recent" : `’${y.slice(2)}`}
              </button>
            ))}
            <span className="text-[10px] text-muted-foreground ml-1 hidden md:inline">← saal flip karo, infra change dekho</span>
          </div>
        )}
        <div className="ml-auto flex gap-3 text-xs">
          <span className="text-red-400">🔴 {redZones} high-risk</span>
          <span className="text-orange-400">😡 {angryAreas} angry</span>
          <span className="text-yellow-400">⚠ {totalCritical} critical</span>
          <span className="text-blue-400">📋 {totalActive} active</span>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 relative">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">Loading risk map…</div>
          ) : blocks.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">No complaints in your jurisdiction yet.</div>
          ) : (
            <InnerMap blocks={blocks} mode={mode} onSelect={setSelected} selectedKey={selectedKey} center={center} zoom={zoom} basemap={basemap} satYear={satYear} boundaries={boundaries} />
          )}
          {/* Legend */}
          <div className="absolute bottom-4 left-4 z-[500] bg-background/90 backdrop-blur border border-border rounded-lg p-3 text-xs space-y-1">
            <div className="font-semibold text-muted-foreground uppercase tracking-wider mb-2" style={{ fontSize: 10 }}>{MODE_LABELS[mode].replace(/^[^ ]+ /, "")}</div>
            {legendItems.map(([c, l]) => (
              <div key={l} className="flex items-center gap-2"><div style={{ width: 10, height: 10, borderRadius: "50%", background: c, flexShrink: 0 }} /><span>{l}</span></div>
            ))}
            <div className="pt-1 text-muted-foreground" style={{ fontSize: 9 }}>○ size = active + critical load</div>
          </div>
        </div>

        {/* Sidebar — ranked by current mode */}
        <div className="w-72 border-l border-border flex flex-col overflow-hidden flex-shrink-0">
          <div className="px-4 py-3 border-b flex-shrink-0">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              {selected ? "Selected Block" : `Ranked by ${MODE_LABELS[mode].replace(/^[^ ]+ /, "")}`}
            </div>
            <div className="font-bold text-sm">{selected ? selected.block : "Your Jurisdiction"}</div>
            {selected && <div className="text-xs text-muted-foreground mt-0.5">{selected.constituency || selected.district}</div>}
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {[...blocks].sort((a, b) => metricFor(b, mode) - metricFor(a, mode)).map((b) => {
              const isS = selectedKey === b.district + "||" + b.block;
              const color = colorFor(b, mode);
              const metric = metricFor(b, mode);
              return (
                <div key={b.district + b.block} onClick={() => setSelected(b)}
                  className={`rounded-lg border p-3 cursor-pointer transition-all text-xs ${isS ? "border-primary/50 bg-primary/5" : "border-border hover:border-border/80 hover:bg-muted/30"}`}
                  style={{ borderLeftWidth: 3, borderLeftColor: color }}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-semibold text-sm">{b.block}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase font-mono" style={{ background: color + "22", color }}>
                      {mode === "resolution" ? `${metric}%` : mode === "anger" && b.avgAnger === null ? "—" : metric}
                    </span>
                  </div>
                  <div className="text-muted-foreground mb-2">{b.constituency || b.district} · {b.total} complaints</div>
                  <div className="flex justify-between text-muted-foreground" style={{ fontSize: 10 }}>
                    <span className="text-red-400">{b.active} active</span>
                    {b.critical > 0 && <span className="text-red-500 font-semibold">{b.critical} critical</span>}
                    {b.slaBreached > 0 && <span className="text-orange-400">{b.slaBreached} SLA</span>}
                    <span className="text-green-400">{b.resolutionRate}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
