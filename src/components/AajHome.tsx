'use client';

/**
 * AajHome — the personalized "Aaj" (Today) command-center home (Phase A redesign).
 *
 * The 10-second executive glance: greeting by name, one big risk gauge, the few
 * numbers that matter, AI-picked "aaj ke 3 kaam" (top of the Level-10 action
 * queue), and the Chief-of-Staff's one line. Themed by white-label branding.
 * Reuses the existing scope-locked APIs (brief + operations) — no new backend.
 */

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Flag, MessageSquare, ArrowRight, Zap, Share2, Image as ImageIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { authHeaders } from '@/lib/helpers';
import { downloadBriefImage } from '@/lib/briefImage';
import { motion } from 'framer-motion';
import type { Branding } from '@/lib/branding';
import { initialsOf } from '@/lib/branding';

interface SessionUser { name?: string; role?: string; role_level?: string }

interface Brief {
  scope: { label: string; generatedAt: string };
  riskIndex: { score: number; grade: string; drivers: string[] };
  kpis: { active: number; slaBreached: number; filed7: number; resolutionRate: number; critical: number };
  warnings: Array<{ severity: string; title: string; detail: string }>;
  hotspots: Array<{ name: string; active: number; risk: number }>;
}
interface OpItem { id: string; ticketNo: string; actionType: string; title: string; why: string[]; score: number; riskTier: string }
interface Operations { items: OpItem[]; stats: { proposed: number; actionedWindow: number; resolvedOfActioned: number; windowDays: number }; canWrite: boolean }

const GRADE: Record<string, { c: string; label: string }> = {
  LOW: { c: '#1D9E75', label: 'Low' },
  GUARDED: { c: '#639922', label: 'Guarded' },
  ELEVATED: { c: '#BA7517', label: 'Elevated' },
  HIGH: { c: '#D85A30', label: 'High' },
  SEVERE: { c: '#E24B4A', label: 'Severe' },
};
const ACTION_TINT: Record<string, string> = {
  ASSIGN_OFFICER: '#185FA5', ESCALATE: '#BA7517', CHASE_STATUS: '#854F0B', CLOSE_QUICKWIN: '#1D9E75', REOPEN: '#993556',
};

function Gauge({ score, color }: { score: number; color: string }) {
  const r = 70, cx = 90, cy = 90;
  const a = (deg: number) => ((deg - 90) * Math.PI) / 180;
  const pt = (deg: number) => [cx + r * Math.cos(a(deg)), cy + r * Math.sin(a(deg))];
  const [x2, y2] = pt(-90 + (Math.max(0, Math.min(100, score)) / 100) * 180);
  return (
    <svg width="184" height="108" viewBox="0 0 180 108" role="img" aria-label={`Risk index ${score}`}>
      <path d="M20 90 A70 70 0 1 1 160 90" fill="none" stroke="currentColor" strokeWidth="13" strokeLinecap="round" className="text-muted" opacity={0.35} />
      <path d={`M20 90 A70 70 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`} fill="none" stroke={color} strokeWidth="13" strokeLinecap="round" />
      <text x="90" y="82" textAnchor="middle" style={{ fontSize: 36, fontWeight: 600, fill: 'currentColor' }} className="text-foreground">{score}</text>
    </svg>
  );
}

export function AajHome({ user, branding, onOpenActions, onOpenIntelligence }: {
  user?: SessionUser | null;
  branding: Branding;
  onOpenActions?: () => void;
  onOpenIntelligence?: () => void;
}) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [ops, setOps] = useState<Operations | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, o] = await Promise.all([
        fetch('/api/intelligence/brief', { headers: authHeaders() }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/intelligence/operations', { headers: authHeaders() }).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      setBrief((b && (b.data || b)) || null);
      setOps((o && o.data) || null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const firstName = (user?.name || '').split(/\s+/)[0] || 'ji';
  const grade = brief ? (GRADE[brief.riskIndex.grade] || GRADE.ELEVATED) : GRADE.ELEVATED;
  const top3 = ops?.items?.slice(0, 3) || [];

  const chiefLine = (() => {
    if (!brief) return '';
    if (brief.warnings?.length) return `${brief.warnings[0].title} — ${brief.warnings[0].detail}`;
    const hs = brief.hotspots?.[0];
    const parts = [`${brief.scope.label}: ${brief.kpis.active} active, ${brief.kpis.slaBreached} SLA-breach`];
    if (hs) parts.push(`sabse zyada dabav ${hs.name} pe`);
    if (brief.riskIndex.drivers?.length) parts.push(brief.riskIndex.drivers[0]);
    return parts.join(' · ');
  })();

  // Shareable Daily Brief — WhatsApp/Telegram-ready text the leader can forward.
  const copyBrief = () => {
    if (!brief) return;
    const lines = [
      `📋 ${branding.orgName} — Today ka Brief`,
      `📍 ${brief.scope.label}`,
      `🎯 Risk ${brief.riskIndex.score}/100 (${grade.label})`,
      `• Active ${brief.kpis.active} · SLA-breach ${brief.kpis.slaBreached} · Is hafte ${brief.kpis.filed7}`,
      ...(top3.length ? ['', 'Today ke kaam:', ...top3.map((it, i) => `${i + 1}. ${it.title}`)] : []),
      ...(chiefLine ? ['', `🧭 ${chiefLine}`] : []),
      '',
      'Generated by JanSunwai Intelligence',
    ];
    navigator.clipboard.writeText(lines.join('\n'))
      .then(() => toast.success('Brief copy ho gaya — WhatsApp/Telegram pe paste karo'))
      .catch(() => toast.error('Copy failed'));
  };

  // Shareable Daily Brief as an IMAGE (canvas PNG) — download or native-share.
  const downloadImage = () => {
    if (!brief) return;
    downloadBriefImage({
      orgName: branding.orgName,
      scopeLabel: brief.scope.label,
      score: brief.riskIndex.score,
      grade: grade.label,
      accent: branding.accent,
      active: brief.kpis.active,
      slaBreached: brief.kpis.slaBreached,
      filed7: brief.kpis.filed7,
      tasks: top3.map((t) => t.title),
      chiefLine,
      dateStr: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    }).catch(() => toast.error('Image banane mein dikkat'));
  };

  return (
    <div className="space-y-5" style={{ '--cc-accent': branding.accent } as React.CSSProperties}>
      {/* Greeting */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center text-sm font-semibold text-white shrink-0" style={{ background: branding.accent }}>
            {initialsOf(user?.name)}
          </div>
          <div>
            <div className="text-xl font-semibold leading-tight">Namaskar, {firstName}</div>
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: branding.accent }} aria-hidden />
              {brief?.scope.label || branding.orgName}{branding.leaderName ? ` · ${branding.leaderName}` : ''}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {brief && (
            <>
              <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={copyBrief}>
                <Share2 className="w-3.5 h-3.5 mr-1" /> Text
              </Button>
              <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={downloadImage}>
                <ImageIcon className="w-3.5 h-3.5 mr-1" /> Image
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={load} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {loading && !brief ? (
        <div className="text-sm text-muted-foreground py-10 text-center">Today ka briefing taiyaar ho raha hai…</div>
      ) : !brief ? (
        <div className="text-sm text-muted-foreground py-10 text-center">Briefing load nahi hua. <Button variant="outline" size="sm" className="ml-2 h-6 text-[11px]" onClick={load}>Retry</Button></div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: 'easeOut' }} className="space-y-5">
          {/* Hero: gauge + key numbers */}
          <Card className="border shadow-sm" style={{ borderColor: branding.accentSoft }}>
            <CardContent className="p-4 flex flex-col sm:flex-row items-center gap-5">
              <div className="text-center shrink-0">
                <Gauge score={brief.riskIndex.score} color={grade.c} />
                <div className="text-xs text-muted-foreground -mt-1">Risk index · <span style={{ color: grade.c }}>{grade.label}</span></div>
              </div>
              <div className="grid grid-cols-3 gap-2.5 flex-1 w-full">
                {[
                  { label: 'Active', value: brief.kpis.active, c: undefined },
                  { label: 'SLA breach', value: brief.kpis.slaBreached, c: '#E24B4A' },
                  { label: 'Is hafte', value: brief.kpis.filed7, c: undefined },
                ].map((k) => (
                  <div key={k.label} className="rounded-xl bg-muted/50 p-3">
                    <div className="text-[11px] text-muted-foreground">{k.label}</div>
                    <div className="text-2xl font-semibold" style={k.c ? { color: k.c } : undefined}>{k.value}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Aaj ke 3 kaam */}
          <div>
            <div className="text-[13px] font-semibold mb-2 flex items-center gap-1.5">
              <Flag className="w-3.5 h-3.5" style={{ color: branding.accent }} /> Today ke 3 kaam
              {onOpenActions && top3.length > 0 && (
                <Button variant="ghost" size="sm" className="ml-auto h-6 text-[11px] px-2" onClick={onOpenActions}>
                  Saari actions <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
              )}
            </div>
            {top3.length > 0 ? (
              <div className="space-y-2">
                {top3.map((it) => (
                  <div key={it.id} className="flex items-center gap-2.5 border rounded-xl p-2.5">
                    <Badge variant="outline" className="text-[9px] h-4 px-1.5 shrink-0" style={{ color: ACTION_TINT[it.actionType], borderColor: ACTION_TINT[it.actionType] + '55' }}>
                      {it.actionType.replace('_', ' ')}
                    </Badge>
                    <span className="text-[13px] flex-1 min-w-0 truncate">{it.title}</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{it.score}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[12px] text-muted-foreground italic border rounded-xl p-3">
                Abhi koi pending action nahi — sab clear hai. Yeh honest hai, padding nahi.
              </div>
            )}
          </div>

          {/* Chief-of-Staff line */}
          <Card className="border" style={{ borderColor: branding.accentSoft }}>
            <CardContent className="p-3 flex gap-2.5 items-start">
              <MessageSquare className="w-4 h-4 mt-0.5 shrink-0" style={{ color: branding.accent }} />
              <div className="text-[13px] leading-relaxed">
                <span className="block text-[10px] text-muted-foreground mb-0.5">Chief-of-Staff</span>
                {chiefLine}
              </div>
            </CardContent>
          </Card>

          {/* Outcome correlation (honest) */}
          {ops && (
            <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <Zap className="w-3 h-3" style={{ color: branding.accent }} aria-hidden />
              Pichhle {ops.stats.windowDays}d: aapne <b className="text-foreground mx-0.5">{ops.stats.actionedWindow}</b> action liye
              {ops.stats.actionedWindow > 0 && <> · <b className="mx-0.5" style={{ color: '#1D9E75' }}>{ops.stats.resolvedOfActioned}</b> ab resolved</>}
              {onOpenIntelligence && (
                <Button variant="ghost" size="sm" className="ml-auto h-6 text-[11px] px-2" onClick={onOpenIntelligence}>
                  Poora intelligence <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
              )}
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
