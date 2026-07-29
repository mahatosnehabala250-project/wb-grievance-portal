'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Send, RefreshCw, Users, ShieldCheck, Megaphone, Moon, Ban,
  AlertTriangle, CheckCircle2, Clock, XCircle,
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
import { authHeaders, fmtDateTime } from '@/lib/helpers';
import { CATEGORIES } from '@/lib/constants';

/**
 * Outbound messaging to people the office has already served.
 *
 * The screen is built around the audience count, not the message box: the
 * question that matters before sending anything is "who exactly is this going
 * to, and who did we leave out?".
 */

interface Campaign {
  id: string;
  name: string;
  audience_kind: 'SERVICE' | 'BROADCAST';
  channel: string;
  message: string;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  status: 'DRAFT' | 'SENDING' | 'SENT' | 'CANCELLED';
  created_by: string | null;
  created_at: string;
  sent_at: string | null;
}

interface Preview {
  count: number;
  excluded: { optedOut: number; noConsent: number; noPhone: number; duplicates: number };
  capped: boolean;
  cap: number;
  sample: Array<{ name: string | null; village: string | null; phone: string }>;
}

const STATUS_META: Record<Campaign['status'], { label: string; cls: string; icon: React.ElementType }> = {
  DRAFT:     { label: 'Draft',    cls: 'bg-amber-500/12 text-amber-700 dark:text-amber-400',       icon: Clock },
  SENDING:   { label: 'Sending',  cls: 'bg-blue-500/12 text-blue-700 dark:text-blue-400',          icon: Send },
  SENT:      { label: 'Sent',     cls: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400', icon: CheckCircle2 },
  CANCELLED: { label: 'Cancelled',cls: 'bg-muted text-muted-foreground',                            icon: XCircle },
};

const EMPTY_FORM = {
  name: '',
  audienceKind: 'SERVICE' as 'SERVICE' | 'BROADCAST',
  channel: 'WHATSAPP',
  message: '',
  village: '',
  block: '',
  category: '',
  status: '',
  sinceDays: '',
};

export function OutreachView() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [canSend, setCanSend] = useState(false);
  const [quietHours, setQuietHours] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/outreach', { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setCampaigns(json.campaigns || []);
        setCanSend(Boolean(json.canSend));
        setQuietHours(Boolean(json.quietHours));
      } else {
        const json = await res.json().catch(() => null);
        toast.error(json?.error || 'Could not load campaigns');
      }
    } catch {
      toast.error('Network error');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const post = useCallback(async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/outreach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => null);
    return { res, json };
  }, []);

  const runPreview = useCallback(async () => {
    setPreviewing(true);
    setPreview(null);
    const { res, json } = await post({ action: 'preview', ...form });
    if (res.ok) setPreview(json as Preview);
    else toast.error(json?.error || 'Could not build the audience');
    setPreviewing(false);
  }, [form, post]);

  const createDraft = useCallback(async () => {
    if (!form.name.trim() || !form.message.trim()) {
      toast.error('Give the campaign a name and a message');
      return;
    }
    setSaving(true);
    const { res, json } = await post({ action: 'create', ...form });
    if (res.ok) {
      toast.success(`Draft saved — ${json?.campaign?.recipient_count ?? 0} recipients`);
      setComposeOpen(false);
      setForm({ ...EMPTY_FORM });
      setPreview(null);
      await load();
    } else {
      toast.error(json?.error || 'Could not save the draft');
    }
    setSaving(false);
  }, [form, post, load]);

  const send = useCallback(async (c: Campaign, override = false) => {
    const { res, json } = await post({ action: 'send', id: c.id, overrideQuietHours: override });
    if (res.ok) {
      toast.success(`Released to the queue — ${json?.queued ?? 0} recipients`);
      await load();
    } else if (res.status === 409 && json?.quietHours) {
      toast.error(json.error, {
        action: { label: 'Send anyway', onClick: () => send(c, true) },
        duration: 8000,
      });
    } else {
      toast.error(json?.error || 'Could not send');
    }
  }, [post, load]);

  const cancel = useCallback(async (c: Campaign) => {
    const { res, json } = await post({ action: 'cancel', id: c.id });
    if (res.ok) { toast.success('Campaign cancelled'); await load(); }
    else toast.error(json?.error || 'Could not cancel');
  }, [post, load]);

  const isBroadcast = form.audienceKind === 'BROADCAST';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" />
            Messaging
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Reaching the people who already came to this office
          </p>
        </div>
        <Button size="sm" onClick={() => { setPreview(null); setComposeOpen(true); }} className="gap-1.5">
          <Send className="h-3.5 w-3.5" /> New message
        </Button>
      </div>

      {quietHours && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/8 px-3 py-2">
          <Moon className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-xs">
            <span className="font-semibold">It is quiet hours (9pm–8am).</span>{' '}
            Sending is held until morning so nobody is woken by an office message. You can override on a draft.
          </p>
        </div>
      )}

      {/* Campaigns */}
      {loading ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" /><span className="text-sm">Loading…</span>
        </div>
      ) : campaigns.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Megaphone className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm font-medium">No messages sent yet</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
              Tell a village their work is sanctioned, or invite a GP to a pension camp. Build the
              audience first — you will see exactly who is included before anything goes out.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {campaigns.map((c) => {
            const M = STATUS_META[c.status];
            return (
              <Card key={c.id}>
                <CardContent className="p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{c.name}</span>
                        <Badge className={`text-[10px] border-0 ${M.cls}`}>{M.label}</Badge>
                        <Badge variant="secondary" className="text-[9px]">
                          {c.audience_kind === 'BROADCAST' ? 'Broadcast' : 'Service update'}
                        </Badge>
                        <Badge variant="outline" className="text-[9px]">{c.channel}</Badge>
                      </div>
                      <p className="text-[12px] text-muted-foreground mt-1 line-clamp-2 whitespace-pre-wrap">{c.message}</p>
                      <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1"><Users className="h-3 w-3" />{c.recipient_count} recipients</span>
                        {c.status !== 'DRAFT' && <span>{c.sent_count} sent</span>}
                        {c.failed_count > 0 && <span className="text-red-600">{c.failed_count} failed</span>}
                        <span>{fmtDateTime(c.sent_at || c.created_at)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {c.status === 'DRAFT' && (
                        <>
                          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => cancel(c)}>
                            Cancel
                          </Button>
                          <Button size="sm" className="h-8 gap-1.5 text-xs" disabled={!canSend} onClick={() => send(c)}
                                  title={canSend ? 'Release to the sending queue' : 'Only the MLA, MP or district president can send'}>
                            <Send className="h-3.5 w-3.5" /> Send
                          </Button>
                        </>
                      )}
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
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New message</DialogTitle>
            <DialogDescription>Build the audience, check who is included, then save it as a draft.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide">Campaign name</Label>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                       placeholder="Pension camp — Joypur GP" className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide">Channel</Label>
                <Select value={form.channel} onValueChange={(v) => setForm((f) => ({ ...f, channel: v }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                    <SelectItem value="TELEGRAM">Telegram</SelectItem>
                    <SelectItem value="SMS">SMS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Kind — the consequential choice on this screen */}
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wide">Kind of message</Label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button"
                        onClick={() => { setForm((f) => ({ ...f, audienceKind: 'SERVICE' })); setPreview(null); }}
                        className={`text-left rounded-md border p-2.5 transition-colors ${!isBroadcast ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}>
                  <div className="flex items-center gap-1.5 font-medium text-xs">
                    <ShieldCheck className="h-3.5 w-3.5" /> Service update
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    About a complaint they filed. Goes to anyone who gave the office their number.
                  </p>
                </button>
                <button type="button"
                        onClick={() => { setForm((f) => ({ ...f, audienceKind: 'BROADCAST' })); setPreview(null); }}
                        className={`text-left rounded-md border p-2.5 transition-colors ${isBroadcast ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}>
                  <div className="flex items-center gap-1.5 font-medium text-xs">
                    <Megaphone className="h-3.5 w-3.5" /> Broadcast
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Camps, announcements, greetings. Only to people who consented to these.
                  </p>
                </button>
              </div>
              {isBroadcast && (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/8 px-3 py-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
                  <p className="text-[11px]">
                    A broadcast is a new purpose under the DPDP Act, so it reaches only numbers with
                    recorded consent — today that is a small list, and it grows as the WhatsApp agent
                    asks each new citizen. During an election period, check the Model Code of Conduct first.
                  </p>
                </div>
              )}
            </div>

            {/* Audience filters */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide">Village</Label>
                <Input value={form.village} className="h-9 text-sm" placeholder="Any"
                       onChange={(e) => { setForm((f) => ({ ...f, village: e.target.value })); setPreview(null); }} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide">Block</Label>
                <Input value={form.block} className="h-9 text-sm" placeholder="Any"
                       onChange={(e) => { setForm((f) => ({ ...f, block: e.target.value })); setPreview(null); }} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide">Category</Label>
                <Select value={form.category || 'ANY'}
                        onValueChange={(v) => { setForm((f) => ({ ...f, category: v === 'ANY' ? '' : v })); setPreview(null); }}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ANY">Any</SelectItem>
                    {CATEGORIES.map((c: string) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wide">Filed within</Label>
                <Select value={form.sinceDays || 'ANY'}
                        onValueChange={(v) => { setForm((f) => ({ ...f, sinceDays: v === 'ANY' ? '' : v })); setPreview(null); }}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ANY">Any time</SelectItem>
                    <SelectItem value="30">30 days</SelectItem>
                    <SelectItem value="90">3 months</SelectItem>
                    <SelectItem value="365">1 year</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={runPreview} disabled={previewing}>
              <Users className="h-3.5 w-3.5" /> {previewing ? 'Counting…' : 'Who will receive this?'}
            </Button>

            {preview && (
              <Card>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold tabular-nums">{preview.count}</span>
                    <span className="text-xs text-muted-foreground">people will receive this</span>
                  </div>

                  {(preview.excluded.optedOut > 0 || preview.excluded.noConsent > 0 ||
                    preview.excluded.noPhone > 0 || preview.excluded.duplicates > 0) && (
                    <div className="flex flex-wrap gap-1.5">
                      {preview.excluded.optedOut > 0 && (
                        <Badge variant="secondary" className="text-[10px] gap-1">
                          <Ban className="h-3 w-3" />{preview.excluded.optedOut} opted out
                        </Badge>
                      )}
                      {preview.excluded.noConsent > 0 && (
                        <Badge variant="secondary" className="text-[10px]">{preview.excluded.noConsent} no consent on file</Badge>
                      )}
                      {preview.excluded.noPhone > 0 && (
                        <Badge variant="secondary" className="text-[10px]">{preview.excluded.noPhone} without a usable number</Badge>
                      )}
                      {preview.excluded.duplicates > 0 && (
                        <Badge variant="secondary" className="text-[10px]">{preview.excluded.duplicates} repeat numbers merged</Badge>
                      )}
                    </div>
                  )}

                  {preview.capped && (
                    <p className="text-[11px] text-amber-600">
                      Capped at {preview.cap} — the most recent contacts are kept. Narrow the audience to reach the rest.
                    </p>
                  )}

                  {preview.sample.length > 0 && (
                    <div className="text-[11px] text-muted-foreground">
                      For example: {preview.sample.map((s) => `${s.name || 'Unnamed'}${s.village ? ` (${s.village})` : ''}`).join(', ')}…
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wide">Message</Label>
              <Textarea value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                        placeholder="Pension camp at Joypur GP office on Tuesday 10am. Bring Aadhaar and bank passbook."
                        className="text-sm min-h-[110px]" />
              <p className="text-[11px] text-muted-foreground">
                An opt-out line is added automatically. Nothing is sent when you save — it becomes a draft
                that the MLA releases.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setComposeOpen(false)}>Cancel</Button>
            <Button onClick={createDraft} disabled={saving}>{saving ? 'Saving…' : 'Save as draft'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default OutreachView;
