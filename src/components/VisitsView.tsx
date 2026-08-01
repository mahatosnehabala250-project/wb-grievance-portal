'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  UserPlus, Search, RefreshCw, Clock, CheckCircle2, ArrowRightCircle,
  UserX, DoorOpen, Phone, MapPin, CalendarDays, Printer, QrCode,
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
import { printFrame } from '@/lib/print';
import { TelegramQrDialog } from '@/components/TelegramQrDialog';
import { CATEGORIES } from '@/lib/constants';

/**
 * The office visit register.
 *
 * An MLA office's busiest hour is people at the door, and that queue lived in a
 * paper diary — so the product saw only the slice of the day that arrived over
 * WhatsApp. This is the register: who came, what they wanted, what was promised.
 */

interface Visit {
  id: string;
  token_no: string | null;
  visitor_name: string;
  phone: string | null;
  village: string | null;
  purpose: string;
  category: string | null;
  notes: string | null;
  promised: string | null;
  promised_by_date: string | null;
  status: 'WAITING' | 'IN_MEETING' | 'DONE' | 'REFERRED' | 'NO_SHOW';
  met_by: string | null;
  arrived_at: string;
  complaint_id: string | null;
}

const STATUS_META: Record<Visit['status'], { label: string; cls: string; icon: React.ElementType }> = {
  WAITING:    { label: 'Waiting',     cls: 'bg-amber-500/12 text-amber-700 dark:text-amber-400',   icon: Clock },
  IN_MEETING: { label: 'In meeting',  cls: 'bg-blue-500/12 text-blue-700 dark:text-blue-400',      icon: DoorOpen },
  DONE:       { label: 'Done',        cls: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400', icon: CheckCircle2 },
  REFERRED:   { label: 'Referred',    cls: 'bg-violet-500/12 text-violet-700 dark:text-violet-400', icon: ArrowRightCircle },
  NO_SHOW:    { label: 'Did not come',cls: 'bg-muted text-muted-foreground',                        icon: UserX },
};

const EMPTY_FORM = {
  visitorName: '', phone: '', village: '', purpose: '',
  category: '', promised: '', promisedByDate: '', notes: '', metBy: '',
};

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface VisitsViewProps {
  /** Used on the printed slip's letterhead. */
  officeName?: string;
  constituency?: string;
}

export function VisitsView({ officeName, constituency }: VisitsViewProps = {}) {
  const office = officeName || 'Constituency Office';
  const seat = constituency || '';
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(todayISO());
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/visits?date=${encodeURIComponent(d)}`, { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setVisits(json.visits || []);
      } else {
        const json = await res.json().catch(() => null);
        toast.error(json?.error || 'Could not load the register');
      }
    } catch {
      toast.error('Network error');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(date); }, [date, load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return visits;
    return visits.filter((v) =>
      `${v.visitor_name} ${v.phone || ''} ${v.village || ''} ${v.purpose}`.toLowerCase().includes(q));
  }, [visits, search]);

  const counts = useMemo(() => {
    const c = { WAITING: 0, IN_MEETING: 0, DONE: 0, REFERRED: 0, NO_SHOW: 0 } as Record<Visit['status'], number>;
    visits.forEach((v) => { c[v.status] = (c[v.status] || 0) + 1; });
    return c;
  }, [visits]);

  const addVisit = useCallback(async () => {
    if (!form.visitorName.trim() || !form.purpose.trim()) {
      toast.error('Name and purpose are required');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/visits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => null);
      if (res.ok) {
        toast.success(`Token ${json?.visit?.token_no || ''} — ${form.visitorName} logged`);
        setForm({ ...EMPTY_FORM });
        setAddOpen(false);
        setDate(todayISO());
        await load(todayISO());
      } else {
        toast.error(json?.error || 'Could not log the visit');
      }
    } catch {
      toast.error('Network error');
    }
    setSaving(false);
  }, [form, load]);

  const setStatus = useCallback(async (v: Visit, status: Visit['status']) => {
    setUpdatingId(v.id);
    // Optimistic — the row flips immediately and rolls back if the server refuses.
    const prev = v.status;
    setVisits((rows) => rows.map((r) => (r.id === v.id ? { ...r, status } : r)));
    try {
      const res = await fetch('/api/visits', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id: v.id, status }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setVisits((rows) => rows.map((r) => (r.id === v.id ? { ...r, status: prev } : r)));
        toast.error(json?.error || 'Could not update');
      }
    } catch {
      setVisits((rows) => rows.map((r) => (r.id === v.id ? { ...r, status: prev } : r)));
      toast.error('Network error');
    }
    setUpdatingId(null);
  }, []);

  /**
   * Print the visitor's slip.
   *
   * The slip is the office's only way to reach a household that has never
   * messaged on WhatsApp — outside a 24-hour window there is no channel at all.
   * A QR on the paper turns a single visit into a permanent one.
   *
   * Rendered into an off-screen iframe rather than a new window: a pop-up print
   * view is silently blocked on a default browser, which is the machine this
   * runs on. The QR is fetched with the session token and inlined, because an
   * <img src> inside the frame would carry no Authorization header.
   */
  const printSlip = useCallback(async (v: Visit) => {
    let qrSvg = '';
    let qrLink = '';
    try {
      const res = await fetch('/api/telegram/qr', { headers: authHeaders() });
      if (res.ok) { const j = await res.json(); qrSvg = j.svg || ''; qrLink = j.link || ''; }
    } catch { /* the slip is still worth printing without the code */ }

    const esc = (s: string) => (s || '').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] as string));
    const row = (label: string, value: string) =>
      value ? `<tr><td class="l">${esc(label)}</td><td class="v">${esc(value)}</td></tr>` : '';

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(v.token_no || 'Slip')}</title>
<style>
  @page { size: A5; margin: 12mm; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #111; font-size: 11pt; }
  .head { text-align: center; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 14px; }
  .head h1 { font-size: 15pt; margin: 0; }
  .head p { margin: 2px 0 0; font-size: 9pt; color: #444; }
  .token { text-align: center; margin: 10px 0 16px; }
  .token .n { font-size: 26pt; font-weight: bold; font-family: ui-monospace, monospace; letter-spacing: 1px; }
  .token .c { font-size: 8.5pt; color: #666; text-transform: uppercase; letter-spacing: 1px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 3px 0; vertical-align: top; }
  td.l { color: #666; width: 34%; font-size: 9.5pt; }
  td.v { font-weight: 600; }
  .qr { margin-top: 18px; border-top: 1px solid #ddd; padding-top: 12px; text-align: center; }
  .qr p { margin: 6px 0 0; font-size: 9pt; color: #444; }
  .qr .u { font-size: 7.5pt; color: #777; word-break: break-all; }
</style></head><body>
<div class="head"><h1>${esc(office)}</h1><p>${esc(seat ? `${seat} Assembly Constituency` : '')}</p></div>
<div class="token"><div class="c">Token</div><div class="n">${esc(v.token_no || '—')}</div></div>
<table>
  ${row('Name', v.visitor_name)}
  ${row('Village', v.village || '')}
  ${row('Came for', v.purpose)}
  ${row('Promised', v.promised || '')}
  ${row('By when', v.promised_by_date || '')}
  ${row('Date', new Date(v.arrived_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }))}
</table>
${qrSvg ? `<div class="qr">${qrSvg}<p><b>Scan to follow this on Telegram</b></p><p>Send your ticket number to the bot and it will keep you updated.</p><p class="u">${esc(qrLink)}</p></div>` : ''}
</body></html>`;

    printFrame(html, `Slip ${v.token_no || ''}`.trim());
  }, [office, seat]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight flex items-center gap-2">
            <DoorOpen className="h-5 w-5 text-primary" />
            Visitor Register
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Who came to the office, what they asked for, and what was promised
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setQrOpen(true)} className="gap-1.5"
                  title="Show the Telegram code — no printing needed">
            <QrCode className="h-3.5 w-3.5" /> Telegram code
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)} className="gap-1.5">
            <UserPlus className="h-3.5 w-3.5" /> Log a visitor
          </Button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative">
          <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 pl-9 w-full sm:w-[180px] text-sm" />
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by name, phone, village or purpose…" value={search}
                 onChange={(e) => setSearch(e.target.value)} className="h-9 pl-9 text-sm" />
        </div>
        <Button variant="outline" size="sm" className="h-9" onClick={() => load(date)} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Day summary */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {(Object.keys(STATUS_META) as Visit['status'][]).map((s) => {
          const M = STATUS_META[s];
          return (
            <Card key={s}>
              <CardContent className="p-3">
                <div className="flex items-center gap-1.5 text-muted-foreground mb-0.5">
                  <M.icon className="h-3.5 w-3.5" />
                  <span className="text-[11px] font-medium">{M.label}</span>
                </div>
                <div className="text-xl font-bold tabular-nums">{counts[s] || 0}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Register */}
      {loading ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" /><span className="text-sm">Loading the register…</span>
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <DoorOpen className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm font-medium">Nobody logged for this day</p>
            <p className="text-xs text-muted-foreground mt-1">
              Log each visitor as they arrive — the register is what the office is measured on later.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((v) => {
            const M = STATUS_META[v.status];
            return (
              <Card key={v.id}>
                <CardContent className="p-3">
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 text-center">
                      <div className="text-[10px] text-muted-foreground">Token</div>
                      <div className="text-xs font-mono font-semibold">{v.token_no?.split('-')[1] || '—'}</div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{v.visitor_name}</span>
                        <Badge className={`text-[10px] border-0 ${M.cls}`}>{M.label}</Badge>
                        {v.category && <Badge variant="secondary" className="text-[9px]">{v.category}</Badge>}
                      </div>
                      <p className="text-[13px] text-muted-foreground mt-0.5">{v.purpose}</p>
                      {v.promised && (
                        <p className="text-[12px] mt-1">
                          <span className="text-muted-foreground">Promised: </span>
                          <span className="font-medium">{v.promised}</span>
                          {v.promised_by_date && <span className="text-muted-foreground"> · by {v.promised_by_date}</span>}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground flex-wrap">
                        {v.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{v.phone}</span>}
                        {v.village && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{v.village}</span>}
                        <span>{new Date(v.arrived_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>

                    <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs shrink-0"
                            onClick={() => printSlip(v)} title="Print a slip with a Telegram QR">
                      <Printer className="h-3.5 w-3.5" /> Slip
                    </Button>

                    <Select value={v.status} onValueChange={(s) => setStatus(v, s as Visit['status'])} disabled={updatingId === v.id}>
                      <SelectTrigger className="h-8 w-[132px] text-xs shrink-0"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(STATUS_META) as Visit['status'][]).map((s) => (
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

      <TelegramQrDialog open={qrOpen} onOpenChange={setQrOpen} officeName={office} />

      {/* Log a visitor */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Log a visitor</DialogTitle>
            <DialogDescription>A token number is assigned automatically.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide">Name</Label>
                <Input value={form.visitorName} onChange={(e) => setForm((f) => ({ ...f, visitorName: e.target.value }))}
                       placeholder="Visitor's name" className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide">Phone</Label>
                <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                       placeholder="9876543210" className="h-9 text-sm" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide">Village</Label>
                <Input value={form.village} onChange={(e) => setForm((f) => ({ ...f, village: e.target.value }))}
                       placeholder="Village or area" className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide">Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Optional" /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c: string) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wide">What do they want?</Label>
              <Textarea value={form.purpose} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
                        placeholder="Water pipeline broken in the village for a month" className="text-sm min-h-[62px]" />
            </div>

            <div className="grid grid-cols-[1fr_150px] gap-3">
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide">What was promised?</Label>
                <Input value={form.promised} onChange={(e) => setForm((f) => ({ ...f, promised: e.target.value }))}
                       placeholder="Will speak to the BDO" className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide">By when</Label>
                <Input type="date" value={form.promisedByDate}
                       onChange={(e) => setForm((f) => ({ ...f, promisedByDate: e.target.value }))} className="h-9 text-sm" />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={addVisit} disabled={saving}>{saving ? 'Saving…' : 'Log visitor'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default VisitsView;
