/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useEffect, useMemo, useState } from "react";
import { authHeaders } from "@/lib/helpers";

/**
 * OverviewDashboard — the dark "Command Center" home (Overview room).
 * Scope-locked stats from /api/dashboard: KPIs + sparklines, top areas,
 * AI insight, complaints-over-time + by-category charts, critical ticker.
 * Self-contained dark theme (matches the Command Map). No chart dependency.
 */

const CYAN = "#22D3EE", AMBER = "#F59E0B", RED = "#EF4444", GREEN = "#34D399", BLUE = "#38BDF8";
const PANEL = "#0c1322", BG = "#070b14", CARD = "rgba(255,255,255,0.025)", HAIR = "rgba(255,255,255,0.07)";

type C = Record<string, unknown>;
const sf = (c: C, ...k: string[]): string => { for (const x of k) { const v = c[x]; if (typeof v === "string" && v) return v; } return ""; };

interface Dash {
  stats: { total: number; open: number; inProgress: number; resolved: number; rejected: number; critical: number; todayComplaints: number; resolutionRate: number; slaBreaches: number; avgSatisfaction: number | null; ratedCount: number };
  byCategory: { category: string; count: number }[];
  byGroup: { name: string; count: number; open: number; inProgress: number; resolved: number }[];
  groupByField: string;
  monthlyTrend: { label: string; total: number; resolved: number; open: number }[];
  criticalComplaints: C[];
  userRole: string;
}

// ---- tiny SVG charts ----
function Spark({ values, color, w = 96, h = 28 }: { values: number[]; color: string; w?: number; h?: number }) {
  if (!values.length) return <svg width={w} height={h} />;
  const max = Math.max(1, ...values), min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * w},${h - 3 - ((v - min) / span) * (h - 6)}`).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
      <circle cx={(values.length - 1) / Math.max(1, values.length - 1) * w} cy={h - 3 - ((values[values.length - 1] - min) / span) * (h - 6)} r={2} fill={color} />
    </svg>
  );
}

function AreaChart({ data }: { data: { label: string; total: number }[] }) {
  const W = 520, H = 180, pad = 28;
  if (data.length < 2) return <div style={{ color: "#64748b", fontSize: 13, padding: "2rem 0", textAlign: "center" }}>Not enough history yet — trend appears as complaints accumulate.</div>;
  const max = Math.max(1, ...data.map((d) => d.total));
  const x = (i: number) => pad + (i / (data.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  const line = data.map((d, i) => `${x(i)},${y(d.total)}`).join(" ");
  const area = `${pad},${H - pad} ${line} ${W - pad},${H - pad}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
      {[0, 0.5, 1].map((f) => (<line key={f} x1={pad} x2={W - pad} y1={y(max * f)} y2={y(max * f)} stroke={HAIR} strokeWidth={1} />))}
      <polygon points={area} fill={CYAN} opacity={0.08} />
      <polyline points={line} fill="none" stroke={CYAN} strokeWidth={2} strokeLinejoin="round" />
      {data.map((d, i) => (<circle key={i} cx={x(i)} cy={y(d.total)} r={2.5} fill={CYAN} />))}
      {data.map((d, i) => (<text key={i} x={x(i)} y={H - 8} fill="#64748b" fontSize={10} textAnchor="middle">{d.label}</text>))}
      <text x={pad} y={y(max) - 4} fill="#64748b" fontSize={10}>{max}</text>
    </svg>
  );
}

function Bars({ data }: { data: { category: string; count: number }[] }) {
  const top = data.slice(0, 6);
  if (!top.length) return <div style={{ color: "#64748b", fontSize: 13, padding: "2rem 0", textAlign: "center" }}>No category data yet.</div>;
  const max = Math.max(1, ...top.map((d) => d.count));
  const W = 520, H = 180, pad = 28, bw = (W - pad * 2) / top.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
      {top.map((d, i) => {
        const bh = (d.count / max) * (H - pad * 2);
        return (
          <g key={d.category}>
            <rect x={pad + i * bw + bw * 0.2} y={H - pad - bh} width={bw * 0.6} height={bh} rx={3} fill={CYAN} opacity={0.85} />
            <text x={pad + i * bw + bw * 0.5} y={H - pad - bh - 5} fill="#cbd5e1" fontSize={11} textAnchor="middle">{d.count}</text>
            <text x={pad + i * bw + bw * 0.5} y={H - 8} fill="#64748b" fontSize={9} textAnchor="middle">{d.category.slice(0, 8)}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function OverviewDashboard() {
  const [d, setD] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/dashboard", { headers: authHeaders() });
        const json = await res.json();
        if (json?.stats) setD(json);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, []);

  const active = (d?.stats.open ?? 0) + (d?.stats.inProgress ?? 0);
  const spark = useMemo(() => (d?.monthlyTrend || []).map((m) => m.total), [d]);
  const sparkRes = useMemo(() => (d?.monthlyTrend || []).map((m) => m.resolved), [d]);
  const areaLabel = d?.groupByField === "district" ? "Districts" : "Blocks";
  const maxCat = Math.max(1, ...(d?.byCategory || []).map((c) => c.count));
  const maxGroup = Math.max(1, ...(d?.byGroup || []).map((g) => g.count));

  const summary = useMemo(() => {
    if (!d || d.stats.total === 0) return "No complaints in your jurisdiction yet. KPIs and trends will populate as grievances arrive.";
    const topCat = d.byCategory[0];
    const topGrp = d.byGroup[0];
    const pct = topCat ? Math.round((topCat.count / d.stats.total) * 100) : 0;
    return `${active.toLocaleString()} active complaints across ${d.byGroup.length} ${areaLabel.toLowerCase()}` +
      (topGrp ? `, led by ${topGrp.name} (${topGrp.count})` : "") +
      (topCat ? `. ${topCat.category} is the top issue at ${pct}%.` : ".") +
      (d.stats.critical ? ` ${d.stats.critical} critical need attention.` : "");
  }, [d, active, areaLabel]);

  const KPIS = d ? [
    { label: "Active complaints", value: active, color: CYAN, sub: `${d.stats.todayComplaints} today`, spark, sparkColor: CYAN },
    { label: "Critical", value: d.stats.critical, color: RED, sub: "needs attention", spark, sparkColor: RED },
    { label: "Resolution rate", value: `${d.stats.resolutionRate}%`, color: GREEN, sub: `${d.stats.resolved} of ${d.stats.total} resolved`, spark: sparkRes, sparkColor: GREEN },
    { label: "SLA breaches", value: d.stats.slaBreaches, color: AMBER, sub: "open > 7 days", spark, sparkColor: AMBER },
  ] : [];

  if (loading) return <div className="h-full flex items-center justify-center text-sm" style={{ background: BG, color: "#64748b" }}>Loading command center…</div>;

  return (
    <div className="h-full overflow-y-auto" style={{ background: BG }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 flex-wrap" style={{ borderBottom: `1px solid ${HAIR}`, background: PANEL, position: "sticky", top: 0, zIndex: 10 }}>
        <span className="font-semibold text-sm flex items-center gap-2" style={{ color: "#e2e8f0" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: GREEN, display: "inline-block", boxShadow: `0 0 8px ${GREEN}` }} /> Command Center
        </span>
        <span className="text-xs" style={{ color: "#64748b" }}>Live · grievance intelligence</span>
        <span className="ml-auto text-xs px-2 py-1 rounded" style={{ background: "rgba(34,211,238,0.1)", color: CYAN }}>{d?.userRole || ""}</span>
      </div>

      <div className="p-5 space-y-5" style={{ maxWidth: 1280, margin: "0 auto" }}>
        {/* KPI row */}
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          {KPIS.map((k) => (
            <div key={k.label} className="rounded-xl p-4" style={{ background: PANEL, border: `1px solid ${HAIR}` }}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs" style={{ color: "#94a3b8" }}>{k.label}</div>
                  <div className="text-3xl font-bold mt-1" style={{ color: "#f1f5f9" }}>{typeof k.value === "number" ? k.value.toLocaleString() : k.value}</div>
                </div>
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: k.color, boxShadow: `0 0 10px ${k.color}`, marginTop: 4 }} />
              </div>
              <div className="flex items-end justify-between mt-2">
                <span className="text-xs" style={{ color: "#64748b" }}>{k.sub}</span>
                <Spark values={k.spark} color={k.sparkColor} />
              </div>
            </div>
          ))}
        </div>

        {/* Top areas + AI insight */}
        <div className="grid gap-4" style={{ gridTemplateColumns: "1.1fr 1fr" }}>
          <div className="rounded-xl p-4" style={{ background: PANEL, border: `1px solid ${HAIR}` }}>
            <div className="text-sm font-semibold mb-3" style={{ color: "#e2e8f0" }}>Top {areaLabel} by complaints</div>
            <div className="space-y-2">
              {(d?.byGroup || []).slice(0, 8).map((g, i) => (
                <div key={g.name} className="flex items-center gap-3">
                  <span style={{ color: "#64748b", fontSize: 11, width: 16 }}>{String(i + 1).padStart(2, "0")}</span>
                  <span className="text-xs flex-shrink-0" style={{ color: "#e2e8f0", width: 130 }}>{g.name || "—"}</span>
                  <div className="flex-1" style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.06)" }}>
                    <div style={{ width: `${Math.round((g.count / maxGroup) * 100)}%`, height: 6, borderRadius: 3, background: CYAN }} />
                  </div>
                  <span className="text-xs font-semibold" style={{ color: "#f1f5f9", width: 36, textAlign: "right" }}>{g.count}</span>
                </div>
              ))}
              {(d?.byGroup || []).length === 0 && <div className="text-xs" style={{ color: "#64748b" }}>No data yet.</div>}
            </div>
          </div>

          <div className="rounded-xl p-4" style={{ background: "rgba(34,211,238,0.04)", border: "1px solid rgba(34,211,238,0.14)" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold tracking-widest" style={{ color: CYAN }}>AI INSIGHT</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(34,211,238,0.12)", color: CYAN }}>BETA</span>
            </div>
            <div className="text-sm leading-relaxed" style={{ color: "#cbd5e1" }}>{summary}</div>
            <div className="mt-3">
              <div className="text-xs font-semibold mb-2" style={{ color: "#94a3b8" }}>Top problem categories</div>
              <div className="space-y-1.5">
                {(d?.byCategory || []).slice(0, 5).map((c) => (
                  <div key={c.category}>
                    <div className="flex justify-between text-xs mb-0.5" style={{ color: "#cbd5e1" }}>
                      <span>{c.category}</span><span style={{ color: "#64748b" }}>{Math.round((c.count / (d?.stats.total || 1)) * 100)}%</span>
                    </div>
                    <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.06)" }}>
                      <div style={{ width: `${Math.round((c.count / maxCat) * 100)}%`, height: 4, borderRadius: 2, background: CYAN }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="text-[10px] mt-3" style={{ color: "#475569" }}>Analysis based on {d?.stats.total ?? 0} complaints in your scope.</div>
          </div>
        </div>

        {/* Charts */}
        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="rounded-xl p-4" style={{ background: PANEL, border: `1px solid ${HAIR}` }}>
            <div className="text-sm font-semibold mb-2" style={{ color: "#e2e8f0" }}>Complaints over time</div>
            <AreaChart data={(d?.monthlyTrend || []).map((m) => ({ label: m.label, total: m.total }))} />
          </div>
          <div className="rounded-xl p-4" style={{ background: PANEL, border: `1px solid ${HAIR}` }}>
            <div className="text-sm font-semibold mb-2" style={{ color: "#e2e8f0" }}>Complaints by category</div>
            <Bars data={d?.byCategory || []} />
          </div>
        </div>

        {/* Critical alerts ticker */}
        <div className="rounded-xl p-4" style={{ background: PANEL, border: `1px solid ${HAIR}` }}>
          <div className="flex items-center gap-2 mb-3">
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: RED, boxShadow: `0 0 8px ${RED}` }} />
            <span className="text-sm font-semibold" style={{ color: "#e2e8f0" }}>Critical alerts</span>
            <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(239,68,68,0.12)", color: "#f87171" }}>{d?.stats.critical ?? 0}</span>
          </div>
          <div className="space-y-2">
            {(d?.criticalComplaints || []).slice(0, 5).map((c, i) => (
              <div key={i} className="flex items-center gap-3 text-xs rounded px-3 py-2" style={{ background: CARD }}>
                <span style={{ color: "#f87171", fontFamily: "ui-monospace, monospace" }}>{sf(c, "ticketNo", "ticket_no") || "—"}</span>
                <span style={{ color: "#e2e8f0" }}>{sf(c, "category") || "Issue"}</span>
                <span style={{ color: "#64748b" }}>{sf(c, "village")}{sf(c, "village") && sf(c, "block") ? " · " : ""}{sf(c, "block")}</span>
                <span className="ml-auto truncate" style={{ color: "#94a3b8", maxWidth: 340 }}>{(sf(c, "issue", "description") || "").slice(0, 80)}</span>
              </div>
            ))}
            {(d?.criticalComplaints || []).length === 0 && <div className="text-xs" style={{ color: "#64748b" }}>No critical alerts right now. ✓</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
