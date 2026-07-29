'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FileText, Search, RefreshCw, Printer, Send, Pencil, FilePlus2,
  MapPin, Phone, Link2, CheckCircle2, FileClock,
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
import { authHeaders, fmtDate } from '@/lib/helpers';
import {
  LETTER_TEMPLATES, RECIPIENT_DESIGNATIONS, templateById, type LetterContext,
} from '@/lib/letter-templates';

/**
 * The issued-letters register.
 *
 * Every recommendation and forwarding letter this office writes, generated from
 * the citizen record already on file and kept as a searchable record of what was
 * issued and to whom. Before this, each letter was retyped from scratch in Word
 * and no copy survived past the printer.
 */

interface Letter {
  id: string;
  letter_no: string | null;
  letter_type: string;
  recipient_name: string | null;
  recipient_designation: string | null;
  recipient_office: string | null;
  subject: string;
  body: string;
  citizen_name: string | null;
  citizen_phone: string | null;
  citizen_village: string | null;
  complaint_id: string | null;
  status: 'DRAFT' | 'ISSUED' | 'CANCELLED';
  issued_at: string | null;
  issued_by: string | null;
  created_at: string;
}

interface ComplaintLite {
  id: string;
  ticketNo: string;
  citizenName: string | null;
  phone: string | null;
  village: string | null;
  block: string;
  issue: string;
  category: string;
}

interface LettersViewProps {
  officeName?: string;
  signatoryName?: string;
  constituency?: string;
}

const STATUS_META: Record<Letter['status'], { label: string; cls: string }> = {
  DRAFT:     { label: 'Draft',     cls: 'bg-amber-500/12 text-amber-700 dark:text-amber-400' },
  ISSUED:    { label: 'Issued',    cls: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400' },
  CANCELLED: { label: 'Cancelled', cls: 'bg-muted text-muted-foreground' },
};

const EMPTY_FORM = {
  letterType: 'FORWARDING',
  recipientName: '',
  recipientDesignation: 'Block Development Officer',
  recipientOffice: '',
  citizenName: '',
  citizenPhone: '',
  citizenVillage: '',
  subjectMatter: '',
  earlierRef: '',
  subject: '',
  body: '',
  complaintId: '',
};

export function LettersView({ officeName, signatoryName, constituency }: LettersViewProps) {
  const [letters, setLetters] = useState<Letter[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [composeOpen, setComposeOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Pulling a complaint in is the whole point — the citizen's details are
  // already on file, so nobody should be retyping them into a letter.
  const [linkQuery, setLinkQuery] = useState('');
  const [linkResults, setLinkResults] = useState<ComplaintLite[]>([]);
  const [linking, setLinking] = useState(false);

  const office = officeName || 'Constituency Office';
  const signatory = signatoryName || 'MLA';
  const seat = constituency || '';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/letters', { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setLetters(json.letters || []);
      } else {
        const json = await res.json().catch(() => null);
        toast.error(json?.error || 'Could not load the letter register');
      }
    } catch {
      toast.error('Network error');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return letters.filter((l) => {
      if (statusFilter !== 'ALL' && l.status !== statusFilter) return false;
      if (!q) return true;
      return `${l.letter_no || ''} ${l.subject} ${l.citizen_name || ''} ${l.recipient_designation || ''} ${l.citizen_village || ''}`
        .toLowerCase().includes(q);
    });
  }, [letters, search, statusFilter]);

  const counts = useMemo(() => {
    const c = { DRAFT: 0, ISSUED: 0, CANCELLED: 0 } as Record<Letter['status'], number>;
    letters.forEach((l) => { c[l.status] = (c[l.status] || 0) + 1; });
    return c;
  }, [letters]);

  /** Build the letter context the templates render from. */
  const contextOf = useCallback((f: typeof EMPTY_FORM): LetterContext => ({
    citizenName: f.citizenName,
    citizenVillage: f.citizenVillage,
    citizenPhone: f.citizenPhone,
    subjectMatter: f.subjectMatter,
    recipientDesignation: f.recipientDesignation,
    recipientOffice: f.recipientOffice,
    constituency: seat,
    officeName: office,
    signatoryName: signatory,
    ticketNo: '',
    earlierRef: f.earlierRef,
  }), [seat, office, signatory]);

  /** Regenerate subject and body from the current template + details. */
  const regenerate = useCallback((next: typeof EMPTY_FORM, ticketNo = '') => {
    const t = templateById(next.letterType);
    const ctx = { ...contextOf(next), ticketNo };
    return { ...next, subject: t.subject(ctx), body: t.body(ctx) };
  }, [contextOf]);

  const pickTemplate = useCallback((id: string) => {
    setForm((f) => {
      const t = templateById(id);
      const next = {
        ...f,
        letterType: id,
        recipientDesignation: t.defaultDesignation || f.recipientDesignation,
      };
      return regenerate(next);
    });
  }, [regenerate]);

  const searchComplaints = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setLinkResults([]); return; }
    setLinking(true);
    try {
      const res = await fetch(`/api/complaints?search=${encodeURIComponent(q)}&limit=6`, { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setLinkResults(json.complaints || []);
      }
    } catch { /* the picker is optional — a failure here must not block the letter */ }
    setLinking(false);
  }, []);

  const attachComplaint = useCallback((c: ComplaintLite) => {
    setForm((f) => regenerate({
      ...f,
      complaintId: c.id,
      citizenName: c.citizenName || '',
      citizenPhone: c.phone || '',
      citizenVillage: c.village || c.block || '',
      subjectMatter: c.issue || '',
    }, c.ticketNo));
    setLinkQuery('');
    setLinkResults([]);
    toast.success(`${c.ticketNo} pulled in`);
  }, [regenerate]);

  const openCompose = useCallback(() => {
    setEditingId(null);
    setForm(regenerate({ ...EMPTY_FORM }));
    setLinkQuery('');
    setLinkResults([]);
    setComposeOpen(true);
  }, [regenerate]);

  const openEdit = useCallback((l: Letter) => {
    setEditingId(l.id);
    setForm({
      letterType: l.letter_type,
      recipientName: l.recipient_name || '',
      recipientDesignation: l.recipient_designation || '',
      recipientOffice: l.recipient_office || '',
      citizenName: l.citizen_name || '',
      citizenPhone: l.citizen_phone || '',
      citizenVillage: l.citizen_village || '',
      subjectMatter: '',
      earlierRef: '',
      subject: l.subject,
      body: l.body,
      complaintId: l.complaint_id || '',
    });
    setComposeOpen(true);
  }, []);

  const save = useCallback(async (status: 'DRAFT' | 'ISSUED') => {
    if (!form.subject.trim() || !form.body.trim()) {
      toast.error('Subject and letter body are required');
      return;
    }
    setSaving(true);
    try {
      const editing = Boolean(editingId);
      const res = await fetch('/api/letters', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(editing ? { id: editingId, ...form, status } : { ...form, status }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok) {
        toast.success(
          status === 'ISSUED'
            ? `Letter ${json?.letter?.letter_no || ''} issued`
            : `Draft ${json?.letter?.letter_no || ''} saved`
        );
        setComposeOpen(false);
        setEditingId(null);
        setForm({ ...EMPTY_FORM });
        await load();
      } else {
        toast.error(json?.error || 'Could not save the letter');
      }
    } catch {
      toast.error('Network error');
    }
    setSaving(false);
  }, [form, editingId, load]);

  const markIssued = useCallback(async (l: Letter) => {
    try {
      const res = await fetch('/api/letters', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id: l.id, status: 'ISSUED' }),
      });
      if (res.ok) {
        setLetters((rows) => rows.map((r) => (r.id === l.id ? { ...r, status: 'ISSUED' } : r)));
        toast.success(`${l.letter_no} marked as issued`);
      } else {
        const json = await res.json().catch(() => null);
        toast.error(json?.error || 'Could not update');
      }
    } catch {
      toast.error('Network error');
    }
  }, []);

  /**
   * Print on office letterhead.
   *
   * This renders into an off-screen iframe rather than a new window: a
   * window.open() print view is silently swallowed by the pop-up blocker on a
   * default browser, which is exactly the machine this gets demonstrated on.
   */
  const print = useCallback((l: Letter) => {
    const esc = (s: string) => (s || '').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] as string));
    const addressee = [l.recipient_name, l.recipient_designation, l.recipient_office]
      .filter((s): s is string => Boolean(s)).map(esc);
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(l.letter_no || 'Letter')}</title>
<style>
  @page { size: A4; margin: 22mm 20mm; }
  body { font-family: Georgia, 'Times New Roman', serif; font-size: 12.5pt; line-height: 1.65; color: #111; }
  .head { text-align: center; border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 22px; }
  .head h1 { font-size: 18pt; margin: 0; letter-spacing: .5px; }
  .head p { margin: 3px 0 0; font-size: 10.5pt; color: #444; }
  .meta { display: flex; justify-content: space-between; font-size: 11pt; margin-bottom: 18px; }
  .addr { margin-bottom: 16px; white-space: pre-line; }
  .subj { font-weight: bold; margin-bottom: 16px; }
  .body { white-space: pre-wrap; }
  .foot { margin-top: 34px; font-size: 9.5pt; color: #666; border-top: 1px solid #ddd; padding-top: 6px; }
</style></head><body>
<div class="head"><h1>${esc(office)}</h1><p>${esc(seat ? `${seat} Assembly Constituency` : '')}</p></div>
<div class="meta"><span>No. ${esc(l.letter_no || '')}</span><span>Date: ${esc(fmtDate(l.issued_at || l.created_at))}</span></div>
<div class="addr">To,\n${addressee.join('\n')}</div>
<div class="subj">Subject: ${esc(l.subject)}</div>
<div class="body">${esc(l.body)}</div>
<div class="foot">Issued from ${esc(office)} · Reference ${esc(l.letter_no || '')}</div>
</body></html>`;

    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) { toast.error('Could not open the print view'); frame.remove(); return; }
      win.focus();
      win.print();
      // Leave the frame in place until the print dialog has been dismissed;
      // removing it immediately cancels the job in some browsers.
      setTimeout(() => frame.remove(), 2000);
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  }, [office, seat]);

  const activeTemplate = templateById(form.letterType);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Letters
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Every letter this office issued, and who it went to
          </p>
        </div>
        <Button size="sm" onClick={openCompose} className="gap-1.5">
          <FilePlus2 className="h-3.5 w-3.5" /> Write a letter
        </Button>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by letter number, subject, citizen or officer…" value={search}
                 onChange={(e) => setSearch(e.target.value)} className="h-9 pl-9 text-sm" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-full sm:w-[150px] text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All letters</SelectItem>
            <SelectItem value="DRAFT">Drafts</SelectItem>
            <SelectItem value="ISSUED">Issued</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="h-9" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-2">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 text-muted-foreground mb-0.5">
              <FileClock className="h-3.5 w-3.5" /><span className="text-[11px] font-medium">Drafts</span>
            </div>
            <div className="text-xl font-bold tabular-nums">{counts.DRAFT}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 text-muted-foreground mb-0.5">
              <CheckCircle2 className="h-3.5 w-3.5" /><span className="text-[11px] font-medium">Issued</span>
            </div>
            <div className="text-xl font-bold tabular-nums">{counts.ISSUED}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 text-muted-foreground mb-0.5">
              <FileText className="h-3.5 w-3.5" /><span className="text-[11px] font-medium">Total on record</span>
            </div>
            <div className="text-xl font-bold tabular-nums">{letters.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Register */}
      {loading ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" /><span className="text-sm">Loading letters…</span>
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <FileText className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm font-medium">No letters yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Write the first one — pull a complaint in and the citizen&apos;s details fill themselves.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((l) => {
            const M = STATUS_META[l.status];
            const tmpl = LETTER_TEMPLATES.find((t) => t.id === l.letter_type);
            return (
              <Card key={l.id}>
                <CardContent className="p-3">
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 w-[76px]">
                      <div className="text-[10px] text-muted-foreground">Letter no.</div>
                      <div className="text-[11px] font-mono font-semibold break-all">{l.letter_no || '—'}</div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{l.subject}</span>
                        <Badge className={`text-[10px] border-0 ${M.cls}`}>{M.label}</Badge>
                        {tmpl && <Badge variant="secondary" className="text-[9px]">{tmpl.label}</Badge>}
                      </div>
                      <p className="text-[12px] text-muted-foreground mt-0.5">
                        To: {[l.recipient_name, l.recipient_designation, l.recipient_office].filter(Boolean).join(', ') || '—'}
                      </p>
                      <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground flex-wrap">
                        {l.citizen_name && <span>For {l.citizen_name}</span>}
                        {l.citizen_phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{l.citizen_phone}</span>}
                        {l.citizen_village && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{l.citizen_village}</span>}
                        {l.complaint_id && <span className="flex items-center gap-1"><Link2 className="h-3 w-3" />linked complaint</span>}
                        <span>{fmtDate(l.issued_at || l.created_at)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {l.status === 'DRAFT' && (
                        <>
                          <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => openEdit(l)} title="Edit draft">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => markIssued(l)} title="Mark as issued">
                            <Send className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => print(l)}>
                        <Printer className="h-3.5 w-3.5" /> Print
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Compose */}
      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit letter' : 'Write a letter'}</DialogTitle>
            <DialogDescription>
              {editingId
                ? 'The letter number stays the same.'
                : 'Pick the kind of letter, pull in the citizen, then edit the text as you like.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {!editingId && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-semibold uppercase tracking-wide">Kind of letter</Label>
                  <Select value={form.letterType} onValueChange={pickTemplate}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LETTER_TEMPLATES.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">{activeTemplate.hint}</p>
                </div>

                {/* Pull a complaint in */}
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-semibold uppercase tracking-wide">Pull in a complaint (optional)</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input value={linkQuery} placeholder="Ticket number, citizen name or phone"
                           onChange={(e) => { setLinkQuery(e.target.value); searchComplaints(e.target.value); }}
                           className="h-9 pl-9 text-sm" />
                  </div>
                  {linking && <p className="text-[11px] text-muted-foreground">Searching…</p>}
                  {linkResults.length > 0 && (
                    <div className="border rounded-md divide-y max-h-40 overflow-y-auto">
                      {linkResults.map((c) => (
                        <button key={c.id} type="button" onClick={() => attachComplaint(c)}
                                className="w-full text-left px-3 py-2 hover:bg-muted/60 transition-colors">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-mono">{c.ticketNo}</span>
                            <span className="text-xs font-medium">{c.citizenName || 'Unnamed'}</span>
                            <Badge variant="secondary" className="text-[9px]">{c.category}</Badge>
                          </div>
                          <p className="text-[11px] text-muted-foreground truncate">{c.issue}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide">Officer&apos;s name</Label>
                <Input value={form.recipientName} onChange={(e) => setForm((f) => ({ ...f, recipientName: e.target.value }))}
                       placeholder="Optional" className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide">Designation</Label>
                <Select value={form.recipientDesignation}
                        onValueChange={(v) => setForm((f) => ({ ...f, recipientDesignation: v }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {RECIPIENT_DESIGNATIONS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide">Office</Label>
                <Input value={form.recipientOffice} onChange={(e) => setForm((f) => ({ ...f, recipientOffice: e.target.value }))}
                       placeholder="Balarampur Block Office" className="h-9 text-sm" />
              </div>
            </div>

            {!editingId && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-semibold uppercase tracking-wide">Citizen</Label>
                    <Input value={form.citizenName} className="h-9 text-sm" placeholder="Name"
                           onChange={(e) => setForm((f) => regenerate({ ...f, citizenName: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-semibold uppercase tracking-wide">Phone</Label>
                    <Input value={form.citizenPhone} className="h-9 text-sm" placeholder="9876543210"
                           onChange={(e) => setForm((f) => regenerate({ ...f, citizenPhone: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-semibold uppercase tracking-wide">Village</Label>
                    <Input value={form.citizenVillage} className="h-9 text-sm" placeholder="Village or area"
                           onChange={(e) => setForm((f) => regenerate({ ...f, citizenVillage: e.target.value }))} />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-[1fr_200px] gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-semibold uppercase tracking-wide">What is it about?</Label>
                    <Input value={form.subjectMatter} className="h-9 text-sm"
                           placeholder="Pipeline broken for a month at Ward 4"
                           onChange={(e) => setForm((f) => regenerate({ ...f, subjectMatter: e.target.value }))} />
                  </div>
                  {form.letterType === 'REMINDER' && (
                    <div className="space-y-1.5">
                      <Label className="text-[11px] font-semibold uppercase tracking-wide">Earlier letter no.</Label>
                      <Input value={form.earlierRef} className="h-9 text-sm" placeholder="PUR/2026/0012"
                             onChange={(e) => setForm((f) => regenerate({ ...f, earlierRef: e.target.value }))} />
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wide">Subject line</Label>
              <Input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                     className="h-9 text-sm" />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wide">Letter</Label>
              <Textarea value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                        className="text-sm min-h-[260px] font-serif leading-relaxed" />
              <p className="text-[11px] text-muted-foreground">
                Edit freely — the template is only a starting point. Printing adds the letterhead and letter number.
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setComposeOpen(false)}>Cancel</Button>
            <Button variant="secondary" onClick={() => save('DRAFT')} disabled={saving}>
              {saving ? 'Saving…' : 'Save draft'}
            </Button>
            <Button onClick={() => save('ISSUED')} disabled={saving} className="gap-1.5">
              <Send className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Issue letter'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default LettersView;
