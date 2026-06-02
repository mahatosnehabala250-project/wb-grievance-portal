/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import "leaflet/dist/leaflet.css";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { authHeaders } from "@/lib/helpers";

// ---- Types ----
interface BlockData {
  district: string;
  block: string;
  constituency: string | null;
  lat: number;
  lng: number;
  total: number;
  resolved: number;
  active: number;
  cats: Record<string, number>;
  zone: "red" | "yellow" | "green" | "grey";
}

// ---- Geocode table for Purulia blocks ----
const BLOCK_COORDS: Record<string, [number, number]> = {
  "Manbazar I":     [23.065, 86.670],
  "Manbazar II":    [23.020, 86.720],
  "Manbazar 1":     [23.065, 86.670],
  "Manbazar":       [23.045, 86.695],
  "Puncha":         [23.090, 86.590],
  "Hura":           [23.110, 86.760],
  "Arsha":          [23.220, 86.580],
  "Balarampur":     [23.278, 86.498],
  "Baghmundi":      [23.180, 86.450],
  "Joypur":         [23.378, 86.395],
  "Jhalda I":       [23.358, 86.488],
  "Jhalda II":      [23.340, 86.510],
  "Purulia I":      [23.332, 86.365],
  "Purulia -1":     [23.332, 86.365],
  "Purulia II":     [23.290, 86.390],
  "Bandwan":        [22.960, 86.620],
  "Barabazar":      [23.010, 86.680],
  "Kashipur":       [23.430, 86.620],
  "Para":           [23.410, 86.810],
  "Raghunathpur I": [23.547, 86.672],
  "Raghunathpur II":[23.520, 86.700],
  "Neturia":        [23.567, 86.755],
  "Santuri":        [23.530, 86.780],
  // Other districts
  "Bankura I":      [23.232, 87.071],
  "Bolpur":         [23.669, 87.717],
  "Rampurhat":      [24.175, 87.782],
  "Dinhata":        [26.133, 89.469],
  "Mathabhanga":    [26.350, 89.220],
  "Siliguri":       [26.717, 88.428],
  "Kaliganj":       [23.454, 88.491],
  "Krishnanagar":   [23.400, 88.495],
  "Tehatta":        [23.714, 88.524],
  "Barasat":        [22.723, 88.481],
  "Dunlop":         [22.620, 88.370],
  "Habra":          [22.842, 88.657],
};

const CAT_COLORS: Record<string, string> = {
  WATER: "#3b9eff", ROAD: "#ff9f3b", HEALTH: "#ff3baa",
  ELECTRICITY: "#ffe03b", OTHER: "#9b8fff", PENSION: "#3bffcc",
  EDUCATION: "#ff6b6b", RATION: "#ff8c00", SANITATION: "#00e5cc",
  HOUSING: "#e066ff", LAND: "#ff4444",
};

function getZone(b: { total: number; resolved: number; active: number }): BlockData["zone"] {
  if (b.total === 0) return "grey";
  if (b.active === 0) return "green";
  if (b.resolved / b.total >= 0.4) return "yellow";
  return "red";
}

const ZONE_COLORS = { red: "#ff3b3b", yellow: "#ffd700", green: "#00c96e", grey: "#4a5568" };

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
      return import("react-leaflet").then(({ MapContainer, TileLayer, CircleMarker, Popup, Tooltip }) => {
        const Component = ({ blocks, category, onSelect, selectedKey }: {
          blocks: BlockData[];
          category: string;
          onSelect: (b: BlockData) => void;
          selectedKey: string | null;
        }) => {
          return (
            <MapContainer
              center={[23.15, 86.5]}
              zoom={8}
              style={{ height: "100%", width: "100%", minHeight: "500px" }}
              zoomControl
            >
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                opacity={0.9}
              />
              {blocks.map((b) => {
                const key = b.district + "||" + b.block;
                const color = ZONE_COLORS[b.zone];
                const total = category === "ALL" ? b.total : (b.cats[category] || 0);
                const radius = Math.max(8, Math.min(28, 8 + total * 2.5));
                const isSelected = key === selectedKey;
                return (
                  <CircleMarker
                    key={key}
                    center={[b.lat, b.lng]}
                    radius={radius}
                    pathOptions={{
                      color,
                      fillColor: color,
                      fillOpacity: 0.25,
                      weight: isSelected ? 3 : 1.5,
                      opacity: 0.9,
                    }}
                    eventHandlers={{ click: () => onSelect(b) }}
                  >
                    <Tooltip direction="top" offset={[0, -radius]} opacity={0.95}>
                      <span style={{ fontFamily: "monospace", fontSize: 12 }}>
                        <strong>{b.block}</strong> &middot; {total} complaints
                        {b.constituency ? ` | ${b.constituency}` : ""}
                      </span>
                    </Tooltip>
                    <Popup>
                      <div style={{ minWidth: 180, fontFamily: "sans-serif" }}>
                        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{b.block}</div>
                        <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
                          {b.constituency || b.district} &middot; {b.district}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
                          {[
                            { label: "Active", val: b.active, color: "#ff3b3b" },
                            { label: "Resolved", val: b.resolved, color: "#00c96e" },
                            { label: "Total", val: b.total, color: "#5b6eff" },
                            { label: "Rate", val: b.total > 0 ? Math.round(b.resolved / b.total * 100) + "%" : String.fromCharCode(8212), color: "#ffd700" },
                          ].map(({ label, val, color }) => (
                            <div key={label} style={{ background: "#f5f5f5", borderRadius: 6, padding: "6px 8px", textAlign: "center" }}>
                              <div style={{ fontWeight: 700, fontSize: 16, color }}>{val}</div>
                              <div style={{ fontSize: 9, color: "#888", textTransform: "uppercase" }}>{label}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {Object.entries(b.cats).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([cat, cnt]) => (
                            <span key={cat} style={{
                              fontSize: 10, padding: "2px 6px", borderRadius: 4,
                              background: (CAT_COLORS[cat] || "#8090ff") + "22",
                              color: CAT_COLORS[cat] || "#8090ff",
                              border: "1px solid " + (CAT_COLORS[cat] || "#8090ff") + "44",
                            }}>
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
        };
        return Component;
      });
    }),
  { ssr: false, loading: () => <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#666" }}>Loading map...</div> }
);

// ---- Main export ----
export function MapView() {
  const [blocks, setBlocks] = useState<BlockData[]>([]);
  const [category, setCategory] = useState("ALL");
  const [selected, setSelected] = useState<BlockData | null>(null);
  const [loading, setLoading] = useState(true);
  const CATS = ["ALL", "WATER", "ROAD", "HEALTH", "ELECTRICITY", "SANITATION", "OTHER"];

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/map/block-stats", { headers: authHeaders() });
        const json = await res.json();
        const raw: Array<{ district: string; block: string; constituency: string | null; status: string; category: string; count: number }> = json.data || [];
        const map: Record<string, BlockData> = {};
        raw.forEach((d) => {
          const key = d.district + "||" + d.block;
          const coords = BLOCK_COORDS[d.block] || [23.332, 86.365];
          if (!map[key]) map[key] = { district: d.district, block: d.block, constituency: d.constituency, lat: coords[0], lng: coords[1], total: 0, resolved: 0, active: 0, cats: {}, zone: "grey" };
          const b = map[key];
          b.total += d.count;
          if (d.status === "RESOLVED") b.resolved += d.count;
          else if (d.status !== "REJECTED") b.active += d.count;
          b.cats[d.category] = (b.cats[d.category] || 0) + d.count;
        });
        const result = Object.values(map).map((b) => ({ ...b, zone: getZone(b) }));
        setBlocks(result);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const selectedKey = selected ? selected.district + "||" + selected.block : null;
  const puruliaBlocks = blocks.filter((b) => b.district === "Purulia");
  const totalActive = puruliaBlocks.reduce((s, b) => s + b.active, 0);
  const totalResolved = puruliaBlocks.reduce((s, b) => s + b.resolved, 0);
  const redZones = puruliaBlocks.filter((b) => b.zone === "red").length;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b flex-shrink-0 flex-wrap">
        <h2 className="font-semibold text-sm">Grievance Map</h2>
        <div className="flex gap-1 flex-wrap">
          {CATS.map((c) => (
            <button key={c} onClick={() => setCategory(c)}
              className={`px-2 py-1 rounded text-xs font-medium border transition-all ${category === c ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-foreground"}`}>
              {c === "ALL" ? "All" : c === "WATER" ? "💧" : c === "ROAD" ? "🛣" : c === "HEALTH" ? "🏥" : c === "ELECTRICITY" ? "⚡" : c === "SANITATION" ? "🚿" : "📋"} {c}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-3 text-xs">
          <span className="text-red-400">🔴 {redZones} red</span>
          <span className="text-yellow-400">🟡 {totalActive} active</span>
          <span className="text-green-400">🟢 {totalResolved} resolved</span>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Map */}
        <div className="flex-1 relative">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">Loading complaints data...</div>
          ) : (
            <InnerMap blocks={blocks} category={category} onSelect={setSelected} selectedKey={selectedKey} />
          )}
          {/* Legend */}
          <div className="absolute bottom-4 left-4 z-[500] bg-background/90 backdrop-blur border border-border rounded-lg p-3 text-xs space-y-1">
            <div className="font-semibold text-muted-foreground uppercase tracking-wider mb-2" style={{fontSize:10}}>Zone</div>
            {[["#ff3b3b","Red — Active problems"],["#ffd700","Yellow — Partly resolved"],["#00c96e","Green — All resolved"],["#4a5568","Grey — No complaints"]].map(([c,l])=>(
              <div key={l} className="flex items-center gap-2"><div style={{width:10,height:10,borderRadius:"50%",background:c,flexShrink:0}}></div><span>{l}</span></div>
            ))}
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-72 border-l border-border flex flex-col overflow-hidden flex-shrink-0">
          <div className="px-4 py-3 border-b flex-shrink-0">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              {selected ? "Selected Block" : "All Blocks"}
            </div>
            <div className="font-bold text-sm">{selected ? selected.block : "Purulia District"}</div>
            {selected && <div className="text-xs text-muted-foreground mt-0.5">{selected.constituency || selected.district}</div>}
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {[...blocks].sort((a,b)=>b.active-a.active).filter(b => category === "ALL" || (b.cats[category]||0) > 0).map((b) => {
              const rate = b.total > 0 ? Math.round(b.resolved / b.total * 100) : 0;
              const isS = selectedKey === b.district+"||"+b.block;
              const catEntries = Object.entries(b.cats).sort((a,b)=>b[1]-a[1]).slice(0,3);
              const maxCat = Math.max(...catEntries.map(c=>c[1]),1);
              return (
                <div key={b.district+b.block} onClick={() => setSelected(b)}
                  className={`rounded-lg border p-3 cursor-pointer transition-all text-xs ${isS ? "border-primary/50 bg-primary/5" : "border-border hover:border-border/80 hover:bg-muted/30"}`}
                  style={{ borderLeftWidth: 3, borderLeftColor: ZONE_COLORS[b.zone] }}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-semibold text-sm">{b.block}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase" style={{background:ZONE_COLORS[b.zone]+"22",color:ZONE_COLORS[b.zone]}}>{b.zone}</span>
                  </div>
                  <div className="text-muted-foreground mb-2">{b.constituency||b.district} · {category==="ALL"?b.total:(b.cats[category]||0)} complaints</div>
                  <div className="h-1 rounded bg-muted overflow-hidden mb-1">
                    <div style={{width:rate+"%",height:"100%",background:rate===100?"#00c96e":rate>40?"#ffd700":"#ff3b3b",borderRadius:4,transition:"width 0.5s"}}></div>
                  </div>
                  <div className="flex justify-between text-muted-foreground mb-2" style={{fontSize:10}}>
                    <span>{b.resolved} resolved</span><span>{rate}%</span>
                  </div>
                  {catEntries.map(([cat,cnt])=>(
                    <div key={cat} className="flex items-center gap-1 mb-0.5">
                      <span className="w-16 truncate text-muted-foreground" style={{fontSize:10}}>{cat}</span>
                      <div className="flex-1 h-1.5 rounded bg-muted overflow-hidden">
                        <div style={{width:Math.round(cnt/maxCat*100)+"%",height:"100%",background:CAT_COLORS[cat]||"#8090ff",borderRadius:3}}></div>
                      </div>
                      <span className="w-4 text-right text-muted-foreground" style={{fontSize:10}}>{cnt}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
