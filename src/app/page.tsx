'use client';

import { useState, useCallback, useMemo, useRef, useEffect, useSyncExternalStore } from 'react';
import {
  AlertTriangle, CheckCircle2, Clock, FileText, LayoutDashboard, Shield,
  Activity, RefreshCw, Building2, MapPin, Search, Filter, X, Eye,
  Zap, BarChart3, Menu, Download, Plus, Send, Users,
  Target, ArrowUpRight, ArrowDownRight, TrendingUp, Bell, ChevronRight, ChevronDown,
  MoreHorizontal, CircleDot, Phone, Mail, Globe2,
  PieChart as PieChartIcon, Hash, Timer, Sun, Moon,
  ArrowUpDown, Printer, Undo2, Sparkles,
} from 'lucide-react';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent,
} from '@/components/ui/chart';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator, DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, PieChart, Pie, Cell,
  AreaChart, Area, Legend,
} from 'recharts';
import { toast } from 'sonner';
import { useTheme } from 'next-themes';

/* ═══════════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════════ */
interface Complaint {
  id: string; issueType: string; block: string;
  status: 'Open' | 'In Progress' | 'Resolved';
  urgency: 'Low' | 'Medium' | 'High' | 'Critical';
  createdAt: string; citizenName: string; phone: string; description: string;
}
interface StatusData { status: string; count: number; color: string }
interface IssueTypeData { name: string; count: number; icon: string; color: string }

/* ═══════════════════════════════════════════════════════════════════
   DESIGN TOKENS
   ═══════════════════════════════════════════════════════════════════ */
const T = {
  navy: '#0A2463', blueDark: '#0D47A1', blue: '#1565C0', blueMid: '#1E88E5',
  blueLight: '#42A5F5', bluePale: '#E3F2FD', surface: '#FFFFFF',
  bg: '#F1F5F9', border: '#E2E8F0', text: '#0F172A', textSec: '#64748B',
  textMuted: '#94A3B8', green: '#16A34A', greenLight: '#F0FDF4',
  red: '#DC2626', redLight: '#FEF2F2', amber: '#D97706', amberLight: '#FFFBEB',
  orange: '#EA580C', orangeLight: '#FFF7ED', purple: '#7C3AED', teal: '#0D9488',
};

const BLOCKS = ['Krishnanagar', 'Ranaghat', 'Kalyani', 'Shantipur', 'Chakdaha', 'Haringhata'] as const;
const ISSUE_TYPES = ['Water Supply', 'Road Damage', 'Electricity', 'Sanitation', 'Healthcare', 'Education'] as const;
const STATUSES = ['Open', 'In Progress', 'Resolved'] as const;
const URGENCIES = ['Critical', 'High', 'Medium', 'Low'] as const;

const ISSUE_META: Record<string, { icon: string; color: string }> = {
  'Water Supply': { icon: '💧', color: T.blueMid }, 'Road Damage': { icon: '🛣️', color: T.orange },
  'Electricity': { icon: '⚡', color: T.amber }, 'Sanitation': { icon: '🧹', color: T.teal },
  'Healthcare': { icon: '🏥', color: T.red }, 'Education': { icon: '📚', color: T.purple },
};

const NAMES = [
  'Amit Das', 'Priya Ghosh', 'Rajesh Sarkar', 'Sunita Mondal', 'Bikas Roy',
  'Tapasi Biswas', 'Sanjay Haldar', 'Mita Pal', 'Kartik Das', 'Ruma Khatun',
  'Debashis Adhikari', 'Anjana Dey', 'Swarup Bag', 'Nasreen Begam', 'Pranab Maitra',
  'Chaitali Saha', 'Nikhil Ghosh', 'Rashmi Barman', 'Subrata Sinha', 'Papiya Dolui',
];

function randomPhone() {
  const p = ['98', '97', '87', '86', '70', '63'];
  return `${p[Math.floor(Math.random() * p.length)]}${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`;
}

/* ═══════════════════════════════════════════════════════════════════
   MOCK DATA
   ═══════════════════════════════════════════════════════════════════ */
function daysAgoStr(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0]; }
function todayStr() { return new Date().toISOString().split('T')[0]; }
function fmtDate(s: string) { return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
function fmtTime(s: string) { const d = new Date(s); return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); }

function generateMockData(): Complaint[] {
  const sw = { Open: 5, 'In Progress': 3, Resolved: 7 };
  const uw = { Low: 2, Medium: 5, High: 3, Critical: 1 };
  const pick = <A,>(arr: readonly A[]): A => arr[Math.floor(Math.random() * arr.length)];
  const weighted = <K extends string>(m: Record<K, number>): K => {
    const e = Object.entries(m) as [K, number][];
    const t = e.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * t;
    for (const [k, w] of e) { r -= w; if (r <= 0) return k; }
    return e[e.length - 1][0];
  };
  const complaints: Complaint[] = [];
  for (let i = 0; i < 80; i++) {
    const off = Math.random() < 0.15 ? 0 : Math.random() < 0.3 ? 1 : Math.floor(Math.random() * 180);
    complaints.push({
      id: `WB-${String(1000 + i).padStart(5, '0')}`, issueType: pick(ISSUE_TYPES), block: pick(BLOCKS),
      status: weighted(sw), urgency: weighted(uw),
      createdAt: off === 0 ? todayStr() : daysAgoStr(off),
      citizenName: NAMES[i % NAMES.length], phone: randomPhone(),
      description: `${pick(ISSUE_TYPES)} issue reported from ${pick(BLOCKS)} block. Needs immediate attention from the block development officer.`,
    });
  }
  complaints.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return complaints;
}

const MOCK_COMPLAINTS = generateMockData();

const CHART_BAR = { complaints: { label: 'Complaints', color: T.blue } };
const CHART_TREND = { open: { label: 'Open', color: T.red }, resolved: { label: 'Resolved', color: T.green } };
const CHART_PIE = { Open: { label: 'Open', color: T.red }, 'In Progress': { label: 'In Progress', color: T.amber }, Resolved: { label: 'Resolved', color: T.green } };

/* ═══════════════════════════════════════════════════════════════════
   ANIMATED COUNTER
   ═══════════════════════════════════════════════════════════════════ */
function useCountUp(target: number, duration = 700, delay = 0) {
  const [v, setV] = useState(0);
  const prevRef = useRef(0);
  useEffect(() => {
    const start = prevRef.current;
    const startTime = performance.now() + delay;
    function tick(now: number) {
      const elapsed = now - startTime;
      if (elapsed < 0) { requestAnimationFrame(tick); return; }
      const p = Math.min(elapsed / duration, 1);
      setV(Math.round(start + (target - start) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(tick);
      else prevRef.current = target;
    }
    requestAnimationFrame(tick);
  }, [target, duration, delay]);
  return v;
}

/* ═══════════════════════════════════════════════════════════════════
   SUB-COMPONENTS
   ═══════════════════════════════════════════════════════════════════ */
function StatusBadge({ status }: { status: string }) {
  const m: Record<string, string> = { Open: 'bg-red-50 text-red-700 border-red-200', 'In Progress': 'bg-amber-50 text-amber-700 border-amber-200', Resolved: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  const dot: Record<string, string> = { Open: 'bg-red-500', 'In Progress': 'bg-amber-500', Resolved: 'bg-emerald-500' };
  return (
    <Badge variant="outline" className={`text-[11px] font-semibold px-2 py-0.5 gap-1 ${m[status] || ''}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot[status] || 'bg-gray-400'}`} />
      {status}
    </Badge>
  );
}

function UrgencyBadge({ urgency }: { urgency: string }) {
  const m: Record<string, { cls: string; icon: React.ReactNode }> = {
    Critical: { cls: 'bg-red-600 text-white border-red-700', icon: <AlertTriangle className="h-3 w-3 mr-0.5" /> },
    High: { cls: 'bg-orange-50 text-orange-700 border-orange-200', icon: <AlertTriangle className="h-3 w-3 mr-0.5" /> },
    Medium: { cls: 'bg-yellow-50 text-yellow-700 border-yellow-200', icon: <Clock className="h-3 w-3 mr-0.5" /> },
    Low: { cls: 'bg-sky-50 text-sky-700 border-sky-200', icon: <Clock className="h-3 w-3 mr-0.5" /> },
  };
  const v = m[urgency] || m.Medium;
  return <Badge variant="outline" className={`text-[11px] font-semibold px-2 py-0.5 ${v.cls}`}>{v.icon}{urgency}</Badge>;
}

function StatCard({ title, value, icon: Icon, trend, trendLabel, color, bgColor, subtitle, delay = 0 }: {
  title: string; value: number; icon: React.ElementType;
  trend?: string; trendLabel?: string; color: string; bgColor: string; subtitle?: string; delay?: number;
}) {
  const display = useCountUp(value, 700, delay);
  const isPositive = trend?.startsWith('+');
  const isNegative = trend?.startsWith('-');
  return (
    <Card className="border-0 shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden group relative bg-white/80 backdrop-blur-sm">
      <div className="absolute top-0 left-0 right-0 h-1" style={{ background: `linear-gradient(90deg, ${color}, ${color}44)` }} />
      <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: color }} />
      <CardContent className="p-5 pl-6">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5 flex-1 min-w-0">
            <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>{title}</p>
            <p className="text-2xl sm:text-3xl font-black tracking-tight" style={{ color: T.text }}>
              {subtitle ? `${display}%` : display}
            </p>
            {subtitle && <p className="text-[10px] sm:text-[11px] font-medium" style={{ color: T.textMuted }}>{subtitle}</p>}
            {trend && trendLabel && (
              <div className="flex items-center gap-1 text-[10px] sm:text-[11px]">
                {isPositive ? <ArrowUpRight className="h-3.5 w-3.5 text-emerald-500" /> : isNegative ? <ArrowDownRight className="h-3.5 w-3.5 text-emerald-500" /> : null}
                <span className={`font-bold ${isNegative ? 'text-emerald-600' : 'text-sky-600'}`}>{trend}</span>
                <span style={{ color: T.textMuted }}>{trendLabel}</span>
              </div>
            )}
          </div>
          <div className="flex items-center justify-center rounded-xl p-3 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300" style={{ backgroundColor: bgColor, boxShadow: `0 4px 12px ${color}22` }}>
            <Icon className="h-5 w-5" style={{ color }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value, icon: Icon, color, bgColor, delay }: {
  label: string; value: number; icon: React.ElementType; color: string; bgColor: string; delay: number;
}) {
  const display = useCountUp(value, 600, delay);
  return (
    <Card className="border-0 shadow-sm hover:shadow-md transition-all bg-white/80 backdrop-blur-sm">
      <CardContent className="p-3 sm:p-4 flex items-center gap-3">
        <div className="flex items-center justify-center rounded-lg p-2 sm:p-2.5 shrink-0" style={{ backgroundColor: bgColor, boxShadow: `0 2px 8px ${color}18` }}>
          <Icon className="h-4 w-4" style={{ color }} />
        </div>
        <div className="min-w-0">
          <p className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>{label}</p>
          <p className="text-lg sm:text-xl font-black tabular-nums" style={{ color: T.text }}>{display}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function PieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }: {
  cx: number; cy: number; midAngle: number; innerRadius: number; outerRadius: number; percent: number;
}) {
  const RADIAN = Math.PI / 180;
  const r = innerRadius + (outerRadius - innerRadius) * 0.5;
  return (
    <text x={cx + r * Math.cos(-midAngle * RADIAN)} y={cy + r * Math.sin(-midAngle * RADIAN)}
      fill="white" textAnchor="middle" dominantBaseline="central" className="text-[11px] font-bold">
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   COMPLAINT DETAIL DIALOG
   ═══════════════════════════════════════════════════════════════════ */
function ComplaintDetailDialog({ complaint, open, onOpenChange }: {
  complaint: Complaint | null; open: boolean; onOpenChange: (v: boolean) => void;
}) {
  if (!complaint) return null;
  const meta = ISSUE_META[complaint.issueType];
  const fields = [
    { label: 'Issue Type', val: <span className="flex items-center gap-1.5"><span>{meta?.icon}</span><span className="text-sm font-semibold">{complaint.issueType}</span></span> },
    { label: 'Block', val: <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" style={{ color: T.textMuted }} /><span className="text-sm font-semibold">{complaint.block}</span></span> },
    { label: 'Status', val: <StatusBadge status={complaint.status} /> },
    { label: 'Urgency', val: <UrgencyBadge urgency={complaint.urgency} /> },
    { label: 'Filed On', val: <span className="text-sm">{fmtDate(complaint.createdAt)}</span> },
    { label: 'ID', val: <span className="text-sm font-mono bg-slate-100 px-1.5 py-0.5 rounded">{complaint.id}</span> },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg border-0 shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <span className="text-lg">{meta?.icon || '📋'}</span>Complaint {complaint.id}
          </DialogTitle>
          <DialogDescription>Complete details of this citizen grievance</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-1">
          <div className="grid grid-cols-2 gap-2.5">
            {fields.map((f) => (
              <div key={f.label} className="p-3 rounded-xl bg-gradient-to-br from-slate-50 to-white border border-slate-100">
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: T.textMuted }}>{f.label}</p>
                {f.val}
              </div>
            ))}
          </div>
          <Separator />
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>Citizen Information</p>
            <div className="p-3 rounded-xl bg-gradient-to-br from-slate-50 to-white border border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: T.blue }}>{complaint.citizenName.split(' ').map(n => n[0]).join('')}</div>
                <div>
                  <p className="text-sm font-semibold" style={{ color: T.text }}>{complaint.citizenName}</p>
                  <p className="text-[11px] font-mono" style={{ color: T.textMuted }}>{complaint.phone}</p>
                </div>
              </div>
            </div>
          </div>
          <Separator />
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>Description</p>
            <p className="text-sm leading-relaxed p-3 rounded-xl bg-slate-50 border border-slate-100" style={{ color: T.textSec }}>{complaint.description}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   NEW COMPLAINT DIALOG
   ═══════════════════════════════════════════════════════════════════ */
function NewComplaintDialog({ open, onOpenChange, onAdd }: {
  open: boolean; onOpenChange: (v: boolean) => void; onAdd: (c: Complaint) => void;
}) {
  const [form, setForm] = useState({ issueType: '', block: '', urgency: '', citizenName: '', phone: '', description: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const handleSubmit = () => {
    const e: Record<string, string> = {};
    if (!form.issueType) e.issueType = 'Required';
    if (!form.block) e.block = 'Required';
    if (!form.urgency) e.urgency = 'Required';
    if (!form.citizenName.trim()) e.citizenName = 'Required';
    setErrors(e);
    if (Object.keys(e).length) return;
    const issueType = form.issueType;
    const block = form.block;
    onAdd({
      id: `WB-${String(2000 + Math.floor(Math.random() * 8000)).padStart(5, '0')}`,
      issueType, block, urgency: form.urgency as Complaint['urgency'], status: 'Open',
      createdAt: todayStr(), citizenName: form.citizenName,
      phone: form.phone || 'N/A', description: form.description || `${issueType} complaint from ${block} block.`,
    });
    setForm({ issueType: '', block: '', urgency: '', citizenName: '', phone: '', description: '' });
    setErrors({});
    onOpenChange(false);
    toast.success('Complaint filed successfully!', { description: `New ${issueType} complaint for ${block}` });
  };
  const fc = (err?: string) => `w-full h-10 px-3 rounded-lg border text-sm bg-white outline-none transition-all ${err ? 'border-red-400 focus:border-red-500 focus:ring-1 focus:ring-red-200' : 'border-slate-200 focus:border-blue-400 focus:ring-1 focus:ring-blue-200'}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg border-0 shadow-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold"><Plus className="h-5 w-5" style={{ color: T.blue }} />File New Complaint</DialogTitle>
          <DialogDescription>Submit a new citizen grievance to the system</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-1">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-[10px] font-bold uppercase tracking-widest block mb-1.5" style={{ color: T.textMuted }}>Issue Type *</label><select value={form.issueType} onChange={(e) => setForm({ ...form, issueType: e.target.value })} className={fc(errors.issueType)}><option value="">Select type...</option>{ISSUE_TYPES.map((t) => <option key={t} value={t}>{ISSUE_META[t].icon} {t}</option>)}</select>{errors.issueType && <p className="text-red-500 text-[11px] mt-1">{errors.issueType}</p>}</div>
            <div><label className="text-[10px] font-bold uppercase tracking-widest block mb-1.5" style={{ color: T.textMuted }}>Block *</label><select value={form.block} onChange={(e) => setForm({ ...form, block: e.target.value })} className={fc(errors.block)}><option value="">Select block...</option>{BLOCKS.map((b) => <option key={b} value={b}>{b}</option>)}</select>{errors.block && <p className="text-red-500 text-[11px] mt-1">{errors.block}</p>}</div>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest block mb-1.5" style={{ color: T.textMuted }}>Urgency *</label>
            <div className="grid grid-cols-4 gap-2">{URGENCIES.map((u) => {
              const c: Record<string, string> = { Low: 'border-sky-200 bg-sky-50 text-sky-700', Medium: 'border-yellow-200 bg-yellow-50 text-yellow-700', High: 'border-orange-200 bg-orange-50 text-orange-700', Critical: 'border-red-200 bg-red-50 text-red-700' };
              const a: Record<string, string> = { Low: 'border-sky-500 bg-sky-100 text-sky-800 ring-2 ring-sky-300/40', Medium: 'border-yellow-500 bg-yellow-100 text-yellow-800 ring-2 ring-yellow-300/40', High: 'border-orange-500 bg-orange-100 text-orange-800 ring-2 ring-orange-300/40', Critical: 'border-red-500 bg-red-100 text-red-800 ring-2 ring-red-300/40' };
              return (<button key={u} onClick={() => setForm({ ...form, urgency: u })} type="button" className={`px-2 py-2 rounded-lg border text-[11px] font-bold transition-all ${form.urgency === u ? a[u] : c[u]} hover:opacity-80`}>{u === 'Critical' || u === 'High' ? <AlertTriangle className="h-3 w-3 inline mr-0.5" /> : <Clock className="h-3 w-3 inline mr-0.5" />}{u}</button>);
            })}</div>
            {errors.urgency && <p className="text-red-500 text-[11px] mt-1">{errors.urgency}</p>}
          </div>
          <Separator />
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-[10px] font-bold uppercase tracking-widest block mb-1.5" style={{ color: T.textMuted }}>Citizen Name *</label><Input value={form.citizenName} onChange={(e) => setForm({ ...form, citizenName: e.target.value })} placeholder="Full name" className={fc(errors.citizenName)} />{errors.citizenName && <p className="text-red-500 text-[11px] mt-1">{errors.citizenName}</p>}</div>
            <div><label className="text-[10px] font-bold uppercase tracking-widest block mb-1.5" style={{ color: T.textMuted }}>Phone</label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Mobile number" className={fc()} /></div>
          </div>
          <div><label className="text-[10px] font-bold uppercase tracking-widest block mb-1.5" style={{ color: T.textMuted }}>Description</label><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} placeholder="Describe the issue..." className={fc()} style={{ resize: 'vertical' }} /></div>
        </div>
        <DialogFooter className="gap-2 mt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="text-sm">Cancel</Button>
          <Button onClick={handleSubmit} className="text-sm gap-1.5 min-w-[130px]" style={{ backgroundColor: T.blue, color: 'white' }}><Send className="h-4 w-4" />File Complaint</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* CSV EXPORT */
function exportCSV(complaints: Complaint[]) {
  const h = ['#', 'ID', 'Issue Type', 'Block', 'Status', 'Urgency', 'Citizen', 'Phone', 'Date'];
  const rows = complaints.map((c, i) => [i + 1, c.id, c.issueType, c.block, c.status, c.urgency, c.citizenName, c.phone, c.createdAt]);
  const csv = [h, ...rows].map((r) => r.map((v) => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `wb-complaints-${todayStr()}.csv`;
  a.click();
  toast.success('Export complete', { description: `${complaints.length} complaints exported as CSV` });
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN DASHBOARD
   ═══════════════════════════════════════════════════════════════════ */
type SortField = 'id' | 'issueType' | 'block' | 'status' | 'urgency' | 'createdAt';
type SortDir = 'asc' | 'desc';

export default function Dashboard() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [complaints, setComplaints] = useState<Complaint[]>(MOCK_COMPLAINTS);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [selectedComplaint, setSelectedComplaint] = useState<Complaint | null>(null);
  const [newComplaintOpen, setNewComplaintOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterBlock, setFilterBlock] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterUrgency, setFilterUrgency] = useState('');
  const [filterIssueType, setFilterIssueType] = useState('');
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [currentTime, setCurrentTime] = useState('');
  const pageSize = 8;

  // Clock
  useEffect(() => {
    if (!mounted) return;
    const update = () => setCurrentTime(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    update();
    const i = setInterval(update, 1000);
    return () => clearInterval(i);
  }, [mounted]);

  // Debounce search
  useEffect(() => { const t = setTimeout(() => setSearchQuery(debouncedSearch), 350); return () => clearTimeout(t); }, [debouncedSearch]);

  // Filter setters
  const updateBlock = useCallback((v: string) => { setFilterBlock(v); setPage(1); }, []);
  const updateStatus = useCallback((v: string) => { setFilterStatus(v); setPage(1); }, []);
  const updateUrgency = useCallback((v: string) => { setFilterUrgency(v); setPage(1); }, []);
  const updateIssueType = useCallback((v: string) => { setFilterIssueType(v); setPage(1); }, []);
  const updateSearch = useCallback((v: string) => { setDebouncedSearch(v); setPage(1); }, []);

  // Derived data
  const filtered = useMemo(() => {
    let list = [...complaints];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((c) => c.issueType.toLowerCase().includes(q) || c.block.toLowerCase().includes(q) || c.status.toLowerCase().includes(q) || c.citizenName.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
    }
    if (filterBlock) list = list.filter((c) => c.block === filterBlock);
    if (filterStatus) list = list.filter((c) => c.status === filterStatus);
    if (filterUrgency) list = list.filter((c) => c.urgency === filterUrgency);
    if (filterIssueType) list = list.filter((c) => c.issueType === filterIssueType);
    return list;
  }, [complaints, searchQuery, filterBlock, filterStatus, filterUrgency, filterIssueType]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      const va = a[sortField]; const vb = b[sortField];
      const cmp = sortField === 'createdAt' ? new Date(va).getTime() - new Date(vb).getTime() : String(va).localeCompare(String(vb));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [filtered, sortField, sortDir]);

  const totalPages = Math.ceil(sorted.length / pageSize);
  const paginated = sorted.slice((page - 1) * pageSize, page * pageSize);

  const activeFilterCount = [searchQuery, filterBlock, filterStatus, filterUrgency, filterIssueType].filter(Boolean).length;
  const clearFilters = useCallback(() => {
    setDebouncedSearch(''); setSearchQuery(''); setFilterBlock(''); setFilterStatus('');
    setFilterUrgency(''); setFilterIssueType(''); setPage(1);
  }, []);

  const handleAddComplaint = (c: Complaint) => { setComplaints((prev) => [c, ...prev]); };
  const handleStatusUpdate = (id: string, newStatus: string) => {
    setComplaints((prev) => prev.map((c) => c.id === id ? { ...c, status: newStatus as Complaint['status'] } : c));
    toast.success('Status updated', { description: `Complaint ${id} marked as ${newStatus}` });
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  // Stats
  const stats = useMemo(() => {
    const total = filtered.length;
    const critical = filtered.filter((c) => c.urgency === 'Critical').length;
    const today = todayStr();
    const resolvedToday = filtered.filter((c) => c.status === 'Resolved' && c.createdAt === today).length;
    const totalResolved = filtered.filter((c) => c.status === 'Resolved').length;
    const open = filtered.filter((c) => c.status === 'Open').length;
    const inProgress = filtered.filter((c) => c.status === 'In Progress').length;
    const resolutionRate = total > 0 ? Math.round((totalResolved / total) * 100) : 0;
    return { total, critical, resolvedToday, totalResolved, open, inProgress, resolutionRate };
  }, [filtered]);

  // Charts
  const blockChartData = useMemo(() => {
    const map: Record<string, { count: number; open: number; resolved: number }> = {};
    filtered.forEach((c) => { if (!map[c.block]) map[c.block] = { count: 0, open: 0, resolved: 0 }; map[c.block].count++; if (c.status === 'Open') map[c.block].open++; if (c.status === 'Resolved') map[c.block].resolved++; });
    return Object.entries(map).map(([block, v]) => ({ block, ...v })).sort((a, b) => b.count - a.count);
  }, [filtered]);

  const statusChartData = useMemo((): StatusData[] => {
    const map: Record<string, number> = {};
    filtered.forEach((c) => { map[c.status] = (map[c.status] || 0) + 1; });
    const colors: Record<string, string> = { Open: T.red, 'In Progress': T.amber, Resolved: T.green };
    return Object.entries(map).map(([status, count]) => ({ status, count, color: colors[status] || '#999' }));
  }, [filtered]);

  const trendData = useMemo(() => {
    const map: Record<string, { open: number; resolved: number }> = {};
    filtered.forEach((c) => { const d = new Date(c.createdAt); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; if (!map[k]) map[k] = { open: 0, resolved: 0 }; if (c.status === 'Open') map[k].open++; if (c.status === 'Resolved') map[k].resolved++; });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, label: new Date(month + '-15').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }), ...v, total: v.open + v.resolved }));
  }, [filtered]);

  const issueTypeData = useMemo((): IssueTypeData[] => {
    const map: Record<string, number> = {};
    filtered.forEach((c) => { map[c.issueType] = (map[c.issueType] || 0) + 1; });
    return Object.entries(map).map(([name, count]) => ({ name, count, icon: ISSUE_META[name]?.icon || '📋', color: ISSUE_META[name]?.color || '#999' })).sort((a, b) => b.count - a.count);
  }, [filtered]);

  // Notifications (recent critical + open)
  const notifications = useMemo(() => complaints.filter((c) => c.urgency === 'Critical' || c.status === 'Open').slice(0, 5), [complaints]);

  // Activity feed (recent actions)
  const recentActivity = useMemo(() => complaints.slice(0, 6), [complaints]);

  // ─── Loading skeleton ───
  if (!mounted) {
    return (
      <div className="min-h-screen flex flex-col" style={{ backgroundColor: T.bg }}>
        <div className="h-16" style={{ background: `linear-gradient(135deg, ${T.navy}, ${T.blue})` }} />
        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[120px] rounded-xl" />)}</div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">{[0, 1].map((i) => <Skeleton key={i} className="h-[340px] rounded-xl" />)}</div>
        </div>
      </div>
    );
  }

  const isDark = theme === 'dark';

  return (
    <div className="min-h-screen flex flex-col transition-colors duration-300" style={{ backgroundColor: isDark ? '#0F172A' : T.bg }}>
      {/* ═══ HEADER ═══ */}
      <header className="sticky top-0 z-50 shadow-lg" style={{ background: `linear-gradient(135deg, ${T.navy} 0%, ${T.blueDark} 50%, ${T.blue} 100%)` }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="md:hidden flex items-center justify-center rounded-lg bg-white/15 p-2 text-white transition-colors hover:bg-white/25">
                <Menu className="h-5 w-5" />
              </button>
              <div className="flex items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm p-2.5 shadow-inner">
                <Shield className="h-6 w-6 sm:h-7 sm:w-7 text-white" />
              </div>
              <div className="hidden sm:block">
                <h1 className="text-white font-bold text-base sm:text-lg leading-tight tracking-tight">West Bengal Grievance Portal</h1>
                <p className="text-blue-200/70 text-[11px]">District Administration Dashboard — Nadia</p>
              </div>
              <h1 className="sm:hidden text-white font-bold text-sm leading-tight">WB Grievance Portal</h1>
            </div>

            {/* Nav */}
            <nav className="hidden md:flex items-center gap-1">
              {[{ label: 'Dashboard', icon: LayoutDashboard, active: true }, { label: 'Analytics', icon: BarChart3 }, { label: 'Reports', icon: FileText }].map((item) => (
                <button key={item.label} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${item.active ? 'bg-white/20 text-white shadow-sm' : 'text-blue-100 hover:bg-white/10 hover:text-white'}`}>
                  <item.icon className="h-4 w-4" />{item.label}
                </button>
              ))}
            </nav>

            {/* Right actions */}
            <div className="flex items-center gap-1.5">
              {currentTime && <span className="text-blue-200/60 text-[10px] font-mono hidden lg:block tabular-nums">{currentTime}</span>}
              <Button variant="ghost" size="sm" onClick={() => { setComplaints(MOCK_COMPLAINTS); toast.info('Data refreshed'); }} className="text-white/80 hover:bg-white/15 hover:text-white" title="Refresh">
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => window.print()} className="text-white/80 hover:bg-white/15 hover:text-white" title="Print">
                <Printer className="h-4 w-4" />
              </Button>
              {/* Theme toggle */}
              <Button variant="ghost" size="sm" onClick={() => setTheme(isDark ? 'light' : 'dark')} className="text-white/80 hover:bg-white/15 hover:text-white" title="Toggle theme">
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              {/* Notification bell */}
              <DropdownMenu open={notifOpen} onOpenChange={setNotifOpen}>
                <DropdownMenuTrigger asChild>
                  <button className="relative flex items-center justify-center rounded-lg bg-white/15 p-2 text-white hover:bg-white/25 transition-colors">
                    <Bell className="h-4 w-4" />
                    {stats.critical > 0 && <span className="absolute -top-1 -right-1 flex items-center justify-center h-4.5 w-4.5 min-w-[18px] rounded-full bg-red-500 text-[9px] font-bold text-white px-1">{stats.critical}</span>}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80 p-0">
                  <DropdownMenuLabel className="px-4 py-2.5 font-semibold text-xs flex items-center justify-between">
                    <span>Notifications</span>
                    <Badge variant="secondary" className="text-[10px]">{stats.open + stats.critical} new</Badge>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <div className="max-h-64 overflow-y-auto">
                    {notifications.map((n) => (
                      <DropdownMenuItem key={n.id} className="px-4 py-2.5 cursor-pointer gap-3" onClick={() => { setSelectedComplaint(n); setNotifOpen(false); }}>
                        <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0 text-sm" style={{ backgroundColor: n.urgency === 'Critical' ? T.redLight : T.amberLight }}>
                          {ISSUE_META[n.issueType]?.icon || '📋'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold truncate" style={{ color: T.text }}>{n.issueType} — {n.block}</p>
                          <p className="text-[10px]" style={{ color: T.textMuted }}>{n.citizenName} • {fmtDate(n.createdAt)}</p>
                        </div>
                        <UrgencyBadge urgency={n.urgency} />
                      </DropdownMenuItem>
                    ))}
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-center text-xs font-medium py-2 justify-center text-blue-600">View all notifications</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/30">
                <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-emerald-300 text-[11px] font-medium">Live</span>
              </div>
            </div>
          </div>
        </div>
        {/* Mobile Nav */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-white/10" style={{ backgroundColor: `${T.navy}E6` }}>
            <nav className="max-w-7xl mx-auto px-4 py-3 space-y-1">
              {[{ label: 'Dashboard', icon: LayoutDashboard, active: true }, { label: 'Analytics', icon: BarChart3 }, { label: 'Reports', icon: FileText }].map((item) => (
                <button key={item.label} onClick={() => setMobileMenuOpen(false)} className={`flex items-center gap-3 w-full px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${item.active ? 'bg-white/20 text-white' : 'text-blue-100 hover:bg-white/10'}`}><item.icon className="h-4 w-4" />{item.label}</button>
              ))}
            </nav>
          </div>
        )}
      </header>

      {/* ═══ MAIN ═══ */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-6 space-y-5">
        {/* Title + Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight" style={{ color: T.text }}>Complaints Overview</h2>
            <p className="text-xs mt-0.5 flex items-center gap-1.5" style={{ color: T.textSec }}>
              <MapPin className="h-3.5 w-3.5" />Monitor and manage citizen grievances across all blocks
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: T.textMuted }} />
              <Input placeholder="Search complaints..." value={debouncedSearch} onChange={(e) => updateSearch(e.target.value)}
                className="pl-9 pr-8 h-9 w-44 sm:w-56 border-slate-200 text-sm focus:border-blue-400 focus:ring-blue-200" />
              {debouncedSearch && <button onClick={() => updateSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 hover:opacity-70" style={{ color: T.textMuted }}><X className="h-3.5 w-3.5" /></button>}
            </div>
            <Button variant="outline" size="sm" onClick={() => setFilterPanelOpen(!filterPanelOpen)}
              className={`h-9 gap-1.5 text-xs border-slate-200 ${filterPanelOpen || activeFilterCount > 0 ? 'bg-blue-50 border-blue-300 text-blue-700' : 'hover:bg-slate-50'}`}>
              <Filter className="h-3.5 w-3.5" /><span className="hidden sm:inline">Filters</span>
              {activeFilterCount > 0 && <span className="flex items-center justify-center h-4 w-4 rounded-full text-white text-[10px] font-bold" style={{ backgroundColor: T.blue }}>{activeFilterCount}</span>}
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportCSV(filtered)} className="h-9 gap-1.5 text-xs border-slate-200 hover:bg-slate-50"><Download className="h-3.5 w-3.5" /><span className="hidden sm:inline">Export</span></Button>
            <Button size="sm" onClick={() => setNewComplaintOpen(true)} className="h-9 gap-1.5 text-xs text-white shadow-sm hover:opacity-90" style={{ backgroundColor: T.blue }}><Plus className="h-3.5 w-3.5" /><span className="hidden sm:inline">New Complaint</span></Button>
          </div>
        </div>

        {/* Active Filters */}
        {activeFilterCount > 0 && (
          <div className="flex items-center gap-2 flex-wrap animate-in fade-in-0 slide-in-from-top-1 duration-200">
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: T.textMuted }}>Active:</span>
            {filterBlock && <Badge variant="secondary" className="gap-1 text-xs pr-1"><Building2 className="h-3 w-3" />{filterBlock}<button onClick={() => updateBlock('')} className="hover:bg-slate-200 rounded p-0.5"><X className="h-3 w-3" /></button></Badge>}
            {filterStatus && <Badge variant="secondary" className="gap-1 text-xs pr-1"><CircleDot className="h-3 w-3" />{filterStatus}<button onClick={() => updateStatus('')} className="hover:bg-slate-200 rounded p-0.5"><X className="h-3 w-3" /></button></Badge>}
            {filterUrgency && <Badge variant="secondary" className="gap-1 text-xs pr-1"><AlertTriangle className="h-3 w-3" />{filterUrgency}<button onClick={() => updateUrgency('')} className="hover:bg-slate-200 rounded p-0.5"><X className="h-3 w-3" /></button></Badge>}
            {filterIssueType && <Badge variant="secondary" className="gap-1 text-xs pr-1"><Hash className="h-3 w-3" />{filterIssueType}<button onClick={() => updateIssueType('')} className="hover:bg-slate-200 rounded p-0.5"><X className="h-3 w-3" /></button></Badge>}
            <button onClick={clearFilters} className="text-[10px] font-bold ml-1 hover:underline flex items-center gap-0.5" style={{ color: T.red }}><Undo2 className="h-3 w-3" />Clear all</button>
          </div>
        )}

        {/* Filter Panel */}
        {filterPanelOpen && (
          <Card className="border-0 shadow-sm bg-white/90 backdrop-blur-sm animate-in fade-in-0 slide-in-from-top-2 duration-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-bold" style={{ color: T.text }}>Filter Complaints</p>
                <button onClick={() => setFilterPanelOpen(false)} style={{ color: T.textMuted }}><X className="h-4 w-4" /></button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { label: 'Block', value: filterBlock, set: updateBlock, opts: [...BLOCKS] },
                  { label: 'Status', value: filterStatus, set: updateStatus, opts: [...STATUSES] },
                  { label: 'Urgency', value: filterUrgency, set: updateUrgency, opts: [...URGENCIES] },
                  { label: 'Issue Type', value: filterIssueType, set: updateIssueType, opts: [...ISSUE_TYPES] },
                ].map((f) => (
                  <div key={f.label}>
                    <label className="text-[10px] font-bold uppercase tracking-widest block mb-1.5" style={{ color: T.textMuted }}>{f.label}</label>
                    <select value={f.value} onChange={(e) => f.set(e.target.value)} className="w-full h-9 px-3 rounded-lg border border-slate-200 text-sm bg-white focus:border-blue-400 focus:ring-1 focus:ring-blue-200 outline-none">
                      <option value="">All {f.label}s</option>
                      {f.opts.map((o) => <option key={o} value={o}>{ISSUE_META[o]?.icon ? `${ISSUE_META[o].icon} ` : ''}{o}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ═══ KPI CARDS ═══ */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatCard title="Total Complaints" value={stats.total} icon={FileText} trend="+12%" trendLabel="vs last month" color={T.blue} bgColor={T.bluePale} delay={0} />
          <StatCard title="Critical Issues" value={stats.critical} icon={AlertTriangle} trend="-8%" trendLabel="from last week" color={T.red} bgColor={T.redLight} delay={80} />
          <StatCard title="Resolved Today" value={stats.resolvedToday} icon={CheckCircle2} trend="+23%" trendLabel="efficiency" color={T.green} bgColor={T.greenLight} delay={160} />
          <StatCard title="Resolution Rate" value={stats.resolutionRate} icon={Zap} color={T.amber} bgColor={T.amberLight} subtitle="Overall performance" delay={240} />
        </div>

        {/* Secondary Stats */}
        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          <MiniStat label="Open Issues" value={stats.open} icon={Activity} color={T.red} bgColor={T.redLight} delay={300} />
          <MiniStat label="In Progress" value={stats.inProgress} icon={Clock} color={T.amber} bgColor={T.amberLight} delay={380} />
          <MiniStat label="Total Resolved" value={stats.totalResolved} icon={CheckCircle2} color={T.green} bgColor={T.greenLight} delay={460} />
        </div>

        {/* ═══ CHARTS ROW 1 ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
          <Card className="lg:col-span-2 border-0 shadow-sm bg-white/80 backdrop-blur-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-bold flex items-center gap-2" style={{ color: T.text }}><Building2 className="h-4 w-4" style={{ color: T.blue }} />Complaints by Block</CardTitle>
                <button onClick={() => { updateBlock(filterBlock ? '' : 'Krishnanagar'); }} className="text-[10px] font-medium px-2 py-1 rounded-md hover:bg-slate-100 transition-colors flex items-center gap-1" style={{ color: T.textMuted }}><Sparkles className="h-3 w-3" />Drill down</button>
              </div>
              <CardDescription className="text-[11px]" style={{ color: T.textMuted }}>Click bars to filter by block</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <ChartContainer config={CHART_BAR} className="h-[300px] w-full">
                <BarChart data={blockChartData} margin={{ top: 10, right: 10, left: -10, bottom: 30 }} onClick={(d) => { if (d?.activePayload?.[0]) updateBlock(d.activePayload[0].payload.block === filterBlock ? '' : d.activePayload[0].payload.block); }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={T.border} />
                  <XAxis dataKey="block" tick={{ fontSize: 10, fill: T.textSec }} tickLine={false} axisLine={{ stroke: T.border }} angle={-30} textAnchor="end" height={55} />
                  <YAxis tick={{ fontSize: 10, fill: T.textSec }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <ChartTooltip cursor={{ fill: 'rgba(21,101,192,0.05)' }} content={<ChartTooltipContent />} />
                  <Bar dataKey="count" name="Complaints" fill={T.blue} radius={[6, 6, 0, 0]} maxBarSize={52} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm bg-white/80 backdrop-blur-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2" style={{ color: T.text }}><PieChartIcon className="h-4 w-4" style={{ color: T.blue }} />Status Breakdown</CardTitle>
              <CardDescription className="text-[11px]" style={{ color: T.textMuted }}>Current status distribution</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <ChartContainer config={CHART_PIE} className="h-[220px] w-full">
                <PieChart><Pie data={statusChartData} cx="50%" cy="50%" innerRadius={48} outerRadius={80} paddingAngle={3} dataKey="count" nameKey="status" label={PieLabel} labelLine={false}>{statusChartData.map((entry, i) => <Cell key={i} fill={entry.color} />)}</Pie><ChartTooltip content={<ChartTooltipContent />} /></PieChart>
              </ChartContainer>
              <div className="flex justify-center gap-4 mt-2">{statusChartData.map((item) => (<div key={item.status} className="flex items-center gap-1.5 text-[11px]"><div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} /><span style={{ color: T.textSec }}>{item.status}</span><span className="font-bold" style={{ color: T.text }}>{item.count}</span></div>))}</div>
            </CardContent>
          </Card>
        </div>

        {/* ═══ CHARTS ROW 2 + ACTIVITY ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
          <Card className="border-0 shadow-sm bg-white/80 backdrop-blur-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2" style={{ color: T.text }}><TrendingUp className="h-4 w-4" style={{ color: T.blue }} />Monthly Trend</CardTitle>
              <CardDescription className="text-[11px]" style={{ color: T.textMuted }}>Complaint volume over time</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <ChartContainer config={CHART_TREND} className="h-[260px] w-full">
                <AreaChart data={trendData} margin={{ top: 10, right: 5, left: -15, bottom: 5 }}>
                  <defs>
                    <linearGradient id="gO" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={T.red} stopOpacity={0.15} /><stop offset="95%" stopColor={T.red} stopOpacity={0} /></linearGradient>
                    <linearGradient id="gR" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={T.green} stopOpacity={0.15} /><stop offset="95%" stopColor={T.green} stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={T.border} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: T.textSec }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: T.textSec }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area type="monotone" dataKey="open" stroke={T.red} fill="url(#gO)" strokeWidth={2} name="Open" dot={false} />
                  <Area type="monotone" dataKey="resolved" stroke={T.green} fill="url(#gR)" strokeWidth={2} name="Resolved" dot={false} />
                  <Legend verticalAlign="top" align="right" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingBottom: 8 }} />
                </AreaChart>
              </ChartContainer>
            </CardContent>
          </Card>

          {/* Issue Categories */}
          <Card className="border-0 shadow-sm bg-white/80 backdrop-blur-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2" style={{ color: T.text }}><Target className="h-4 w-4" style={{ color: T.blue }} />Issue Categories</CardTitle>
              <CardDescription className="text-[11px]" style={{ color: T.textMuted }}>Click to filter by category</CardDescription>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              {issueTypeData.map((item) => {
                const pct = stats.total > 0 ? Math.round((item.count / stats.total) * 100) : 0;
                return (
                  <div key={item.name} className="space-y-1.5 group cursor-pointer" onClick={() => updateIssueType(filterIssueType === item.name ? '' : item.name)}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2"><span className="text-base group-hover:scale-110 transition-transform">{item.icon}</span><span className="text-xs font-semibold" style={{ color: T.text }}>{item.name}</span></div>
                      <span className="text-xs font-bold tabular-nums" style={{ color: T.text }}>{item.count} <span style={{ color: T.textMuted }}>({pct}%)</span></span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: T.border }}><div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: item.color }} /></div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Activity Feed */}
          <Card className="border-0 shadow-sm bg-white/80 backdrop-blur-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2" style={{ color: T.text }}><Activity className="h-4 w-4" style={{ color: T.blue }} />Recent Activity</CardTitle>
              <CardDescription className="text-[11px]" style={{ color: T.textMuted }}>Latest complaints filed</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-0 max-h-[310px] overflow-y-auto">
                {recentActivity.map((c, i) => (
                  <div key={c.id} className={`flex items-start gap-3 py-2.5 ${i < recentActivity.length - 1 ? 'border-b border-slate-100' : ''} cursor-pointer hover:bg-slate-50 -mx-2 px-2 rounded-lg transition-colors`} onClick={() => setSelectedComplaint(c)}>
                    <div className="h-8 w-8 rounded-full flex items-center justify-center text-sm shrink-0 mt-0.5" style={{ backgroundColor: ISSUE_META[c.issueType]?.color + '18' }}>{ISSUE_META[c.issueType]?.icon || '📋'}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate" style={{ color: T.text }}>{c.issueType} — <span style={{ color: T.textSec }}>{c.block}</span></p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px]" style={{ color: T.textMuted }}>{c.citizenName}</span>
                        <span className="text-[10px]" style={{ color: T.textMuted }}>•</span>
                        <span className="text-[10px]" style={{ color: T.textMuted }}>{fmtDate(c.createdAt)}</span>
                      </div>
                    </div>
                    <StatusBadge status={c.status} />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ═══ PERFORMANCE METRICS ═══ */}
        <Card className="border-0 shadow-sm bg-white/80 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2" style={{ color: T.text }}><Timer className="h-4 w-4" style={{ color: T.blue }} />Performance Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
              {[
                { label: 'Avg Resolution Time', value: '3.2 days', pct: 78, color: T.green },
                { label: 'SLA Compliance', value: '94%', pct: 94, color: T.blue },
                { label: 'First Response Rate', value: '89%', pct: 89, color: T.amber },
                { label: 'Citizen Satisfaction', value: '4.2/5', pct: 84, color: T.purple },
              ].map((m) => (
                <div key={m.label} className="space-y-2">
                  <div className="flex items-center justify-between"><p className="text-[11px] font-semibold" style={{ color: T.textSec }}>{m.label}</p><p className="text-sm font-bold" style={{ color: T.text }}>{m.value}</p></div>
                  <Progress value={m.pct} className="h-2" style={{ ['--progress-color' as string]: m.color }} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ═══ COMPLAINTS TABLE ═══ */}
        <Card className="border-0 shadow-sm bg-white/80 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-bold flex items-center gap-2" style={{ color: T.text }}><FileText className="h-4 w-4" style={{ color: T.blue }} />Recent Complaints</CardTitle>
                <CardDescription className="text-[11px] mt-0.5" style={{ color: T.textMuted }}>Showing {paginated.length} of {sorted.length} complaints</CardDescription>
              </div>
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="text-[10px] gap-1"><Filter className="h-3 w-3" />{sorted.length} results</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-slate-100 hover:bg-transparent">
                    {([
                      { field: 'id' as SortField, label: 'ID' },
                      { field: 'issueType' as SortField, label: 'Issue' },
                      { field: 'block' as SortField, label: 'Block' },
                      { field: 'createdAt' as SortField, label: 'Date' },
                      { field: 'status' as SortField, label: 'Status' },
                      { field: 'urgency' as SortField, label: 'Urgency' },
                    ]).map((col) => (
                      <TableHead key={col.field} className="text-[10px] font-bold uppercase tracking-wider cursor-pointer select-none hover:text-blue-600 transition-colors" style={{ color: T.textMuted }} onClick={() => handleSort(col.field)}>
                        <div className="flex items-center gap-1">{col.label}<ArrowUpDown className={`h-3 w-3 ${sortField === col.field ? 'text-blue-500' : 'opacity-40'}`} /></div>
                      </TableHead>
                    ))}
                    <TableHead className="text-[10px] font-bold uppercase tracking-wider text-right" style={{ color: T.textMuted }}>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginated.map((c, i) => (
                    <TableRow key={c.id} className={`border-b border-slate-50 hover:bg-blue-50/30 transition-colors cursor-pointer group ${i % 2 === 0 ? '' : 'bg-slate-50/30'}`} onClick={() => setSelectedComplaint(c)}>
                      <TableCell className="font-mono text-xs" style={{ color: T.textSec }}>{c.id}</TableCell>
                      <TableCell><div className="flex items-center gap-2"><span className="text-sm">{ISSUE_META[c.issueType]?.icon || '📋'}</span><span className="text-xs font-semibold" style={{ color: T.text }}>{c.issueType}</span></div></TableCell>
                      <TableCell className="text-xs font-medium" style={{ color: T.text }}>{c.block}</TableCell>
                      <TableCell className="text-xs tabular-nums" style={{ color: T.textMuted }}>{fmtDate(c.createdAt)}</TableCell>
                      <TableCell><StatusBadge status={c.status} /></TableCell>
                      <TableCell><UrgencyBadge urgency={c.urgency} /></TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setSelectedComplaint(c); }}><Eye className="h-4 w-4 mr-2" />View Details</DropdownMenuItem>
                            {c.status !== 'Resolved' && (<>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleStatusUpdate(c.id, 'In Progress'); }}><Clock className="h-4 w-4 mr-2" />Mark In Progress</DropdownMenuItem>
                              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleStatusUpdate(c.id, 'Resolved'); }}><CheckCircle2 className="h-4 w-4 mr-2 text-emerald-600" />Mark Resolved</DropdownMenuItem>
                            </>)}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden space-y-3">
              {paginated.map((c) => (
                <div key={c.id} onClick={() => setSelectedComplaint(c)} className="p-4 rounded-xl border border-slate-100 bg-white hover:shadow-md transition-all cursor-pointer active:scale-[0.99]">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2"><span className="text-lg">{ISSUE_META[c.issueType]?.icon || '📋'}</span><div><p className="text-sm font-semibold" style={{ color: T.text }}>{c.issueType}</p><p className="text-[11px] font-mono" style={{ color: T.textMuted }}>{c.id}</p></div></div>
                    <UrgencyBadge urgency={c.urgency} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[11px]" style={{ color: T.textSec }}><MapPin className="h-3 w-3" />{c.block}<span>•</span><Users className="h-3 w-3" />{c.citizenName}</div>
                    <StatusBadge status={c.status} />
                  </div>
                </div>
              ))}
            </div>

            {/* Empty state */}
            {paginated.length === 0 && (
              <div className="text-center py-12">
                <FileText className="h-12 w-12 mx-auto mb-3" style={{ color: T.border }} />
                <p className="text-sm font-semibold" style={{ color: T.text }}>No complaints found</p>
                <p className="text-xs mt-1" style={{ color: T.textMuted }}>Try adjusting your filters or search query</p>
                {activeFilterCount > 0 && <Button variant="outline" size="sm" onClick={clearFilters} className="mt-3 text-xs gap-1"><Undo2 className="h-3 w-3" />Clear Filters</Button>}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-100">
                <p className="text-xs" style={{ color: T.textMuted }}>Page {page} of {totalPages}</p>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} className="h-8 px-2.5 text-xs"><ChevronRight className="h-4 w-4 rotate-180" /></Button>
                  {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                    const p = i + 1;
                    return (<Button key={p} variant={p === page ? 'default' : 'outline'} size="sm" onClick={() => setPage(p)} className={`h-8 w-8 text-xs p-0 ${p === page ? 'text-white' : ''}`} style={p === page ? { backgroundColor: T.blue } : undefined}>{p}</Button>);
                  })}
                  {totalPages > 5 && <span className="text-xs px-1" style={{ color: T.textMuted }}>...</span>}
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="h-8 px-2.5 text-xs"><ChevronRight className="h-4 w-4" /></Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      {/* ═══ FOOTER ═══ */}
      <footer className="mt-auto border-t border-slate-200 bg-white/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center rounded-lg p-2" style={{ backgroundColor: T.bluePale }}><Shield className="h-4 w-4" style={{ color: T.blue }} /></div>
              <div><p className="text-xs font-semibold" style={{ color: T.text }}>Government of West Bengal</p><p className="text-[10px]" style={{ color: T.textMuted }}>District Administration — Nadia</p></div>
            </div>
            <div className="flex items-center gap-4 text-[10px]" style={{ color: T.textMuted }}>
              <span className="flex items-center gap-1"><Globe2 className="h-3 w-3" />wb.gov.in</span>
              <span className="flex items-center gap-1"><Mail className="h-3 w-3" />dm-nadia@wb.gov.in</span>
              <span className="flex items-center gap-1"><Phone className="h-3 w-3" />+91 03472 255XXX</span>
            </div>
            <p className="text-[10px]" style={{ color: T.textMuted }}>© {new Date().getFullYear()} All Rights Reserved</p>
          </div>
        </div>
      </footer>

      {/* ═══ DIALOGS ═══ */}
      <ComplaintDetailDialog complaint={selectedComplaint} open={!!selectedComplaint} onOpenChange={(v) => { if (!v) setSelectedComplaint(null); }} />
      <NewComplaintDialog open={newComplaintOpen} onOpenChange={setNewComplaintOpen} onAdd={handleAddComplaint} />
    </div>
  );
}
