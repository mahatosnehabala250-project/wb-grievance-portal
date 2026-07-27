'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  HeartHandshake, ShieldCheck, RefreshCw, Search, Clock,
  UserCheck, CheckCircle2, Undo2, Phone, FileCheck2, FileX2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { fmtDateTime, authHeaders } from '@/lib/helpers';
import { EmptyState } from '@/components/common';

// ─── Types (mirror /api/handoffs and /api/admin/consent payloads) ───
interface HandoffRow {
  id: string;
  session_id: string;
  reason: string;
  snapshot: Record<string, unknown>;
  claimed_by: string | null;
  claimed_by_name: string | null;
  claimed_at: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  status: 'pending' | 'claimed' | 'resolved' | string;
  created_at: string;
}
interface HandoffCounts { pending: number; claimed: number; resolved: number }
interface ConsentRow {
  phone: string;
  consent_given: boolean;
  consent_text_version: string | null;
  given_at: string | null;
  withdrawn_at: string | null;
}
interface ConsentStats { total: number; active: number; withdrawn: number }

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300 border-amber-200 dark:border-amber-800',
  claimed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 border-blue-200 dark:border-blue-800',
  resolved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
};

const REASON_LABEL: Record<string, string> = {
  strike_3: '3 strikes (bot failed)',
  manual: 'Manual escalation',
  system: 'System',
};

function snapshotPreview(snapshot: Record<string, unknown>): string {
  try {
    const s = JSON.stringify(snapshot, null, 2);
    return s === '{}' ? 'No snapshot captured.' : s;
  } catch {
    return 'Unreadable snapshot.';
  }
}

export function HandoffsConsentView() {
  // ─── Handoff queue state ───
  const [handoffs, setHandoffs] = useState<HandoffRow[]>([]);
  const [counts, setCounts] = useState<HandoffCounts>({ pending: 0, claimed: 0, resolved: 0 });
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'claimed' | 'resolved'>('all');
  const [loadingHandoffs, setLoadingHandoffs] = useState(true);
  const [actionBusy, setActionBusy] = useState<string | null>(null); // handoff id being acted on
  const [resolveTarget, setResolveTarget] = useState<HandoffRow | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ─── Consent registry state ───
  const [consents, setConsents] = useState<ConsentRow[]>([]);
  const [consentStats, setConsentStats] = useState<ConsentStats>({ total: 0, active: 0, withdrawn: 0 });
  const [phoneSearch, setPhoneSearch] = useState('');
  const [loadingConsents, setLoadingConsents] = useState(true);

  const loadHandoffs = useCallback(async (status: string) => {
    setLoadingHandoffs(true);
    try {
      const res = await fetch(`/api/handoffs?status=${status}`, { headers: authHeaders() });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error?.message || json.error || 'Failed to load handoffs');
      setHandoffs(json.data.handoffs);
      setCounts(json.data.counts);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load handoff queue');
    } finally {
      setLoadingHandoffs(false);
    }
  }, []);

  const loadConsents = useCallback(async (phone: string) => {
    setLoadingConsents(true);
    try {
      const qs = phone ? `?phone=${encodeURIComponent(phone)}` : '';
      const res = await fetch(`/api/admin/consent${qs}`, { headers: authHeaders() });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error?.message || json.error || 'Failed to load consents');
      setConsents(json.data.consents);
      setConsentStats(json.data.stats);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load consent registry');
    } finally {
      setLoadingConsents(false);
    }
  }, []);

  useEffect(() => { loadHandoffs(statusFilter); }, [statusFilter, loadHandoffs]);
  useEffect(() => { loadConsents(''); }, [loadConsents]);

  // ─── Handoff actions (claim / release / resolve hit the existing audited routes) ───
  const doAction = async (endpoint: 'claim' | 'release', h: HandoffRow) => {
    setActionBusy(h.id);
    try {
      const res = await fetch(`/api/handoffs/${endpoint}`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ handoff_id: h.id }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error?.message || 'Action failed');
      toast.success(endpoint === 'claim' ? 'Handoff claimed — this conversation is yours now' : 'Handoff released back to queue');
      loadHandoffs(statusFilter);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed');
      loadHandoffs(statusFilter); // refresh — someone else may have claimed it
    } finally {
      setActionBusy(null);
    }
  };

  const doResolve = async () => {
    if (!resolveTarget) return;
    setActionBusy(resolveTarget.id);
    try {
      const res = await fetch('/api/handoffs/resolve', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ handoff_id: resolveTarget.id, resolution: resolutionNote.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error?.message || 'Resolve failed');
      toast.success('Handoff resolved — citizen ko closing message queue ho gaya, bot resume');
      setResolveTarget(null);
      setResolutionNote('');
      loadHandoffs(statusFilter);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Resolve failed');
    } finally {
      setActionBusy(null);
    }
  };

  const consentPct = consentStats.total > 0 ? Math.round((consentStats.active / consentStats.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <HeartHandshake className="h-6 w-6" /> Handoffs &amp; Consent
          </h1>
          <p className="text-sm text-muted-foreground">
            Human-handoff queue (WhatsApp bot escalations) + DPDP consent registry
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { loadHandoffs(statusFilter); loadConsents(phoneSearch); }}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      <Tabs defaultValue="handoffs">
        <TabsList>
          <TabsTrigger value="handoffs">
            Handoff Queue {counts.pending > 0 && <Badge className="ml-2 bg-amber-500 text-white">{counts.pending}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="consent">Consent Registry (DPDP)</TabsTrigger>
        </TabsList>

        {/* ─────────── HANDOFF QUEUE ─────────── */}
        <TabsContent value="handoffs" className="space-y-4 mt-4">
          <div className="grid grid-cols-3 gap-4">
            {([['pending', 'Pending', Clock], ['claimed', 'Claimed', UserCheck], ['resolved', 'Resolved', CheckCircle2]] as const).map(([key, label, Icon]) => (
              <Card
                key={key}
                className={`cursor-pointer transition-shadow hover:shadow-md ${statusFilter === key ? 'ring-2 ring-primary' : ''}`}
                onClick={() => setStatusFilter(statusFilter === key ? 'all' : key)}
              >
                <CardContent className="pt-4 pb-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">{label}</p>
                    <p className="text-2xl font-bold">{counts[key]}</p>
                  </div>
                  <Icon className="h-6 w-6 text-muted-foreground" />
                </CardContent>
              </Card>
            ))}
          </div>

          {loadingHandoffs ? (
            <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : handoffs.length === 0 ? (
            <EmptyState
              icon={HeartHandshake}
              message={statusFilter === 'all' ? 'Queue is empty — the bot is handling everything. 🎉' : `No ${statusFilter} handoffs.`}
            />
          ) : (
            <div className="space-y-3">
              {handoffs.map((h) => (
                <Card key={h.id}>
                  <CardContent className="pt-4 pb-3 space-y-2">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className={STATUS_BADGE[h.status] || ''}>{h.status.toUpperCase()}</Badge>
                          <Badge variant="outline">{REASON_LABEL[h.reason] || h.reason}</Badge>
                          <span className="text-sm font-mono flex items-center gap-1">
                            <Phone className="h-3 w-3" /> {h.session_id}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Opened {fmtDateTime(h.created_at)}
                          {h.claimed_by_name && <> · Claimed by <span className="font-medium">{h.claimed_by_name}</span>{h.claimed_at && <> at {fmtDateTime(h.claimed_at)}</>}</>}
                          {h.resolved_at && <> · Resolved {fmtDateTime(h.resolved_at)}</>}
                        </p>
                        {h.resolution_notes && (
                          <p className="text-xs"><span className="text-muted-foreground">Note:</span> {h.resolution_notes}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button variant="ghost" size="sm" onClick={() => setExpandedId(expandedId === h.id ? null : h.id)}>
                          {expandedId === h.id ? 'Hide context' : 'Context'}
                        </Button>
                        {h.status === 'pending' && (
                          <Button size="sm" disabled={actionBusy === h.id} onClick={() => doAction('claim', h)}>
                            <UserCheck className="h-4 w-4 mr-1" /> Claim
                          </Button>
                        )}
                        {h.status === 'claimed' && (
                          <Button variant="outline" size="sm" disabled={actionBusy === h.id} onClick={() => doAction('release', h)}>
                            <Undo2 className="h-4 w-4 mr-1" /> Release
                          </Button>
                        )}
                        {(h.status === 'pending' || h.status === 'claimed') && (
                          <Button variant="default" size="sm" disabled={actionBusy === h.id}
                            onClick={() => { setResolveTarget(h); setResolutionNote(''); }}>
                            <CheckCircle2 className="h-4 w-4 mr-1" /> Resolve
                          </Button>
                        )}
                      </div>
                    </div>
                    {expandedId === h.id && (
                      <pre className="text-xs bg-muted rounded-md p-3 overflow-x-auto max-h-64 whitespace-pre-wrap">
                        {snapshotPreview(h.snapshot)}
                      </pre>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ─────────── CONSENT REGISTRY ─────────── */}
        <TabsContent value="consent" className="space-y-4 mt-4">
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-4 pb-3 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Total records</p>
                  <p className="text-2xl font-bold">{consentStats.total}</p>
                </div>
                <ShieldCheck className="h-6 w-6 text-muted-foreground" />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Active consent</p>
                  <p className="text-2xl font-bold text-emerald-600">{consentStats.active} <span className="text-sm font-normal text-muted-foreground">({consentPct}%)</span></p>
                </div>
                <FileCheck2 className="h-6 w-6 text-emerald-500" />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Withdrawn</p>
                  <p className="text-2xl font-bold text-rose-600">{consentStats.withdrawn}</p>
                </div>
                <FileX2 className="h-6 w-6 text-rose-500" />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle className="text-base">Citizen consent records</CardTitle>
                <div className="relative w-64">
                  <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="Search phone…"
                    value={phoneSearch}
                    onChange={(e) => setPhoneSearch(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') loadConsents(phoneSearch); }}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loadingConsents ? (
                <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : consents.length === 0 ? (
                <EmptyState icon={ShieldCheck} message="No consent records yet — the WhatsApp bot (JS-01) captures consent on first contact." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Phone</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>Given at</TableHead>
                      <TableHead>Withdrawn at</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {consents.map((c) => (
                      <TableRow key={c.phone}>
                        <TableCell className="font-mono text-sm">{c.phone}</TableCell>
                        <TableCell>
                          {c.consent_given
                            ? <Badge variant="outline" className={STATUS_BADGE.resolved}>CONSENTED</Badge>
                            : <Badge variant="outline" className="bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300 border-rose-200 dark:border-rose-800">WITHDRAWN</Badge>}
                        </TableCell>
                        <TableCell className="text-sm">{c.consent_text_version || '—'}</TableCell>
                        <TableCell className="text-sm">{c.given_at ? fmtDateTime(c.given_at) : '—'}</TableCell>
                        <TableCell className="text-sm">{c.withdrawn_at ? fmtDateTime(c.withdrawn_at) : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <p className="text-xs text-muted-foreground mt-3">
                DPDP Act 2023 — consent WhatsApp bot se record hota hai; erasure requests (&quot;delete my data&quot;) bot ke EraseMyData tool se anonymize hoti hain aur pii_audit_log mein audit hoti hain.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ─── Resolve dialog ─── */}
      <Dialog open={!!resolveTarget} onOpenChange={(open) => { if (!open) setResolveTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve handoff</DialogTitle>
            <DialogDescription>
              Citizen ({resolveTarget?.session_id}) ko localized closing message queue hoga aur bot conversation resume kar lega.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Resolution note (optional) — what was done?"
            value={resolutionNote}
            onChange={(e) => setResolutionNote(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveTarget(null)}>Cancel</Button>
            <Button onClick={doResolve} disabled={actionBusy === resolveTarget?.id}>
              <CheckCircle2 className="h-4 w-4 mr-1" /> Resolve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
