'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  HardHat, Search, RefreshCw, Plus, IndianRupee, MapPin, Users,
  CheckCircle2, Clock, PauseCircle, XCircle, FileCheck2, Wallet, AlertTriangle,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { authHeaders } from '@/lib/helpers';
import {
  WORK_CATEGORIES, FUND_SOURCES, WORK_STATUSES, EXECUTING_AGENCIES,
  financialYear, recentFinancialYears, inr, type FundSummary,
} from '@/lib/works';

/**
 * Development works and the constituency fund.
 *
 * Built around the one question the office cannot answer today without a phone
 * call: how much of this year's money is still uncommitted. Everything else on
 * the screen is in service of that number.
 */

interface Work {
  id: string;
  work_no: string | null;
  title: string;
  description: string | null;
  category: string;
  fund_source: string;
  financial_year: string;
  village: string | null;
  gp_name: string | null;
  block: string | null;
  estimated_cost: string | number | null;
  sanctioned_amount: string | number | null;
  released_amount: string | number | null;
  spent_amount: string | number | null;
  status: string;
  executing_agency: string | null;
  beneficiaries_est: number | null;
  expected_completion: string | null;
  completed_date: string | null;
  created_at: string;
}

const STATUS_META: Record<string, { label: string; cls: string; icon: React.ElementType }> = {
  PROPOSED:    { label: 'Proposed',    cls: 'bg-slate-500/12 text-slate-700 dark:text-slate-300',    icon: FileCheck2 },
  SANCTIONED:  { label: 'Sanctioned',  cls: 'bg-blue-500/12 text-blue-700 dark:text-blue-400',       icon: CheckCircle2 },
  IN_PROGRESS: { label: 'In progress', cls: 'bg-amber-500/12 text-amber-700 dark:text-amber-400',    icon: Clock },
  COMPLETED:   { label: 'Completed',   cls: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400', icon: CheckCircle2 },
  STALLED:     { label: 'Stalled',     cls: 'bg-red-500/12 text-red-700 dark:text-red-400',          icon: PauseCircle },
  CANCELLED:   { label: 'Cancelled',   cls: 'bg-muted text-muted-foreground',                         icon: XCircle },
};

const EMPTY_FORM = {
  title: '', description: '', category: 'ROAD', fundSource: 'MLA_LAD',
  village: '', gpName: '', block: '', executingAgency: '',
  estimatedCost: '', sanctionedAmount: '', releasedAmount: '', spentAmount: '',
  status: 'PROPOSED', beneficiaries: '', expectedCompletion: '', notes: '',
};

const pretty = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export function WorksView() {
  const [works, setWorks] = useState<Work[]>([]);
  const [summary, setSummary] = useState<FundSummary | null>(null);
  const [fy, setFy] = useState(financialYear());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [addOpen, setAddOpen] = useState(false);
  const [allocOpen, setAllocOpen] = useState(false);
  const [allocAmount, setAllocAmount] = useState('');
  const [canSetAllocation, setCanSetAllocation] = useState(false);
  const [allocationSet, setAllocationSet] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const years = useMemo(() => recentFinancialYears(4), []);

  const load = useCallback(async (year: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/works?fy=${encodeURIComponent(year)}`, { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setWorks(json.works || []);
        setSummary(json.summary || null);
        setCanSetAllocation(Boolean(json.canSetAllocation));
        setAllocationSet(Boolean(json.allocationSet));
      } else {
        const json = await res.json().catch(() => null);
        toast.error(json?.error || 'Could not load works');
      }
    } catch {
      toast.error('Network error');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(fy); }, [fy, load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return works.filter((w) => {
      if (statusFilter !== 'ALL' && w.status !== statusFilter) return false;
      if (!q) return true;
      return `${w.work_no || ''} ${w.title} ${w.village || ''} ${w.gp_name || ''} ${w.executing_agency || ''}`
        .toLowerCase().includes(q);
    });
  }, [works, search, statusFilter]);

  const addWork = useCallback(async () => {
    if (!form.title.trim()) { toast.error('Give the work a title'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/works', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ ...form, financialYear: fy }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok) {
        toast.success(`${json?.work?.work_no || 'Work'} recorded`);
        setForm({ ...EMPTY_FORM });
        setAddOpen(false);
        await load(fy);
      } else {
        toast.error(json?.error || 'Could not record the work');
      }
    } catch { toast.error('Network error'); }
    setSaving(false);
  }, [form, fy, load]);

  const setStatus = useCallback(async (w: Work, status: string) => {
    const prev = w.status;
    setWorks((rows) => rows.map((r) => (r.id === w.id ? { ...r, status } : r)));
    try {
      const res = await fetch('/api/works', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id: w.id, status }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setWorks((rows) => rows.map((r) => (r.id === w.id ? { ...r, status: prev } : r)));
        toast.error(json?.error || 'Could not update');
      } else {
        await load(fy);   // totals move when a work is cancelled
      }
    } catch {
      setWorks((rows) => rows.map((r) => (r.id === w.id ? { ...r, status: prev } : r)));
      toast.error('Network error');
    }
  }, [fy, load]);

  const saveAllocation = useCallback(async () => {
    const amount = Number(allocAmount);
    if (!Number.isFinite(amount) || amount <= 0) { toast.error('Enter the amount in rupees'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/works', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ financialYear: fy, allocatedAmount: amount }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok) {
        toast.success(`Allocation for ${fy} set to ${inr(amount)}`);
        setAllocOpen(false);
        setAllocAmount('');
        await load(fy);
      } else {
        toast.error(json?.error || 'Could not set the allocation');
      }
    } catch { toast.error('Network error'); }
    setSaving(false);
  }, [allocAmount, fy, load]);

  const pctSpent = summary && summary.allocated > 0
    ? Math.min(100, Math.round((summary.spent / summary.allocated) * 100)) : 0;
  const pctSanctioned = summary && summary.allocated > 0
    ? Math.min(100, Math.round((summary.sanctioned / summary.allocated) * 100)) : 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight flex items-center gap-2">
            <HardHat className="h-5 w-5 text-primary" />
            Development Works
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            What was sanctioned this year, what is built, and what is left
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={fy} onValueChange={setFy}>
            <SelectTrigger className="h-9 w-[130px] text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map((y) => <SelectItem key={y} value={y}>FY {y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => setAddOpen(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Add work
          </Button>
        </div>
      </div>

      {/* The fund */}
      {summary && (
        <Card>
          <CardContent className="p-4 space-y-3">
            {!allocationSet ? (
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium">No allocation set for FY {fy}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Enter this year&apos;s fund so the remaining balance means something. Until then only
                    what has been sanctioned and spent is shown.
                  </p>
                </div>
                {canSetAllocation && (
                  <Button size="sm" variant="outline" onClick={() => setAllocOpen(true)}>Set allocation</Button>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Uncommitted</div>
                    <div className={`text-3xl font-black tabular-nums ${summary.uncommitted < 0 ? 'text-red-600' : ''}`}>
                      {inr(summary.uncommitted)}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      of {inr(summary.allocated)} allocated for FY {fy}
                    </div>
                  </div>
                  {canSetAllocation && (
                    <Button size="sm" variant="ghost" className="text-xs" onClick={() => setAllocOpen(true)}>
                      Edit allocation
                    </Button>
                  )}
                </div>

                {summary.uncommitted < 0 && (
                  <p className="text-[11px] text-red-600">
                    More has been sanctioned than allocated. Check the amounts, or the allocation figure.
                  </p>
                )}

                {/* Sanctioned and spent against the same bar — they are different things */}
                <div className="space-y-1.5">
                  <div className="relative h-2.5 rounded-full overflow-hidden bg-muted">
                    <div className="absolute inset-y-0 left-0 bg-blue-500/40" style={{ width: `${pctSanctioned}%` }} />
                    <div className="absolute inset-y-0 left-0 bg-emerald-500" style={{ width: `${pctSpent}%` }} />
                  </div>
                  <div className="flex gap-4 text-[11px] text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                      Spent {inr(summary.spent)} ({pctSpent}%)
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-blue-500/40 inline-block" />
                      Sanctioned {inr(summary.sanctioned)} ({pctSanctioned}%)
                    </span>
                    <span>In flight {inr(summary.inFlight)}</span>
                  </div>
                </div>
              </>
            )}

            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 pt-1">
              {WORK_STATUSES.map((s) => (
                <button key={s} type="button"
                        onClick={() => setStatusFilter(statusFilter === s ? 'ALL' : s)}
                        className={`rounded-md border px-2 py-1.5 text-left transition-colors ${statusFilter === s ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}>
                  <div className="text-base font-bold tabular-nums">{summary.counts[s] || 0}</div>
                  <div className="text-[10px] text-muted-foreground leading-tight">{STATUS_META[s].label}</div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by work number, title, village or agency…" value={search}
                 onChange={(e) => setSearch(e.target.value)} className="h-9 pl-9 text-sm" />
        </div>
        <Button variant="outline" size="sm" className="h-9" onClick={() => load(fy)} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Works */}
      {loading ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" /><span className="text-sm">Loading works…</span>
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <HardHat className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm font-medium">
              {works.length === 0 ? `No works recorded for FY ${fy}` : 'Nothing matches this filter'}
            </p>
            <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
              Record each sanction as it happens. At the end of the year this is the list you are asked for.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((w) => {
            const M = STATUS_META[w.status] || STATUS_META.PROPOSED;
            return (
              <Card key={w.id}>
                <CardContent className="p-3">
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 w-[84px]">
                      <div className="text-[10px] text-muted-foreground">Work no.</div>
                      <div className="text-[11px] font-mono font-semibold break-all">{w.work_no || '—'}</div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{w.title}</span>
                        <Badge className={`text-[10px] border-0 ${M.cls}`}>{M.label}</Badge>
                        <Badge variant="secondary" className="text-[9px]">{pretty(w.category)}</Badge>
                        <Badge variant="outline" className="text-[9px]">{pretty(w.fund_source)}</Badge>
                      </div>

                      <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground flex-wrap">
                        {(w.village || w.gp_name || w.block) && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {[w.village, w.gp_name, w.block].filter(Boolean).join(', ')}
                          </span>
                        )}
                        {w.executing_agency && <span>{w.executing_agency}</span>}
                        {w.beneficiaries_est ? (
                          <span className="flex items-center gap-1"><Users className="h-3 w-3" />{w.beneficiaries_est}</span>
                        ) : null}
                        {w.expected_completion && w.status !== 'COMPLETED' && (
                          <span>due {w.expected_completion}</span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 mt-1 text-[11px] flex-wrap">
                        <span className="flex items-center gap-1">
                          <IndianRupee className="h-3 w-3 text-muted-foreground" />
                          <span className="text-muted-foreground">Sanctioned</span>
                          <span className="font-semibold">{inr(Number(w.sanctioned_amount))}</span>
                        </span>
                        <span>
                          <span className="text-muted-foreground">Spent </span>
                          <span className="font-semibold">{inr(Number(w.spent_amount))}</span>
                        </span>
                      </div>
                    </div>

                    <Select value={w.status} onValueChange={(s) => setStatus(w, s)}>
                      <SelectTrigger className="h-8 w-[140px] text-xs shrink-0"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {WORK_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add work */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add a work</DialogTitle>
            <DialogDescription>A work number is assigned automatically for FY {fy}.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wide">What is the work?</Label>
              <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                     placeholder="Concrete road from Taltal bus stop to primary school" className="h-9 text-sm" />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide">Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WORK_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{pretty(c)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide">Fund</Label>
                <Select value={form.fundSource} onValueChange={(v) => setForm((f) => ({ ...f, fundSource: v }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FUND_SOURCES.map((c) => <SelectItem key={c} value={c}>{pretty(c)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide">Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WORK_STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide">Agency</Label>
                <Select value={form.executingAgency} onValueChange={(v) => setForm((f) => ({ ...f, executingAgency: v }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Optional" /></SelectTrigger>
                  <SelectContent>
                    {EXECUTING_AGENCIES.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide">Village</Label>
                <Input value={form.village} className="h-9 text-sm" placeholder="Village"
                       onChange={(e) => setForm((f) => ({ ...f, village: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide">GP</Label>
                <Input value={form.gpName} className="h-9 text-sm" placeholder="Gram Panchayat"
                       onChange={(e) => setForm((f) => ({ ...f, gpName: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide">Beneficiaries</Label>
                <Input value={form.beneficiaries} className="h-9 text-sm" placeholder="Approx."
                       onChange={(e) => setForm((f) => ({ ...f, beneficiaries: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide">Due by</Label>
                <Input type="date" value={form.expectedCompletion} className="h-9 text-sm"
                       onChange={(e) => setForm((f) => ({ ...f, expectedCompletion: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {([
                ['estimatedCost', 'Estimated'],
                ['sanctionedAmount', 'Sanctioned'],
                ['releasedAmount', 'Released'],
                ['spentAmount', 'Spent'],
              ] as const).map(([key, label]) => (
                <div key={key} className="space-y-1.5">
                  <Label className="text-[11px] font-semibold uppercase tracking-wide">{label} (₹)</Label>
                  <Input value={form[key]} className="h-9 text-sm" placeholder="0"
                         onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground -mt-1">
              Amounts in rupees. Sanctioned and spent are kept apart on purpose — they diverge for months,
              and the remaining balance depends on which one you mean.
            </p>

            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wide">Notes</Label>
              <Textarea value={form.description} className="text-sm min-h-[60px]" placeholder="Optional"
                        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={addWork} disabled={saving}>{saving ? 'Saving…' : 'Add work'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Allocation */}
      <Dialog open={allocOpen} onOpenChange={setAllocOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Allocation for FY {fy}</DialogTitle>
            <DialogDescription>
              The total fund available this year. Everything on this screen is measured against it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wide flex items-center gap-1">
              <Wallet className="h-3.5 w-3.5" /> Amount in rupees
            </Label>
            <Input value={allocAmount} onChange={(e) => setAllocAmount(e.target.value)}
                   placeholder="6000000" className="h-9 text-sm" />
            <p className="text-[11px] text-muted-foreground">
              Full rupees, not lakh — 60 lakh is 6000000.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAllocOpen(false)}>Cancel</Button>
            <Button onClick={saveAllocation} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default WorksView;
