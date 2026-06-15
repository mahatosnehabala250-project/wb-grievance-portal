'use client';

/**
 * BrandingSettings — in-app white-label editor. A client/admin can set the org
 * name, leader name and accent colour live (no code), persisted per-browser via
 * localStorage and merged over the config branding. Honest scope: this is a local
 * preview/override; production multi-tenant branding lives in src/lib/branding.ts
 * (or a future client_branding table).
 */

import { useState, useEffect } from 'react';
import { X, Check, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Branding } from '@/lib/branding';
import { softFromAccent } from '@/lib/branding';

export function BrandingSettings({ open, onClose, value, onSave, onReset }: {
  open: boolean;
  onClose: () => void;
  value: Branding;
  onSave: (override: Partial<Branding>) => void;
  onReset: () => void;
}) {
  const [orgName, setOrgName] = useState(value.orgName);
  const [leaderName, setLeaderName] = useState(value.leaderName);
  const [accent, setAccent] = useState(value.accent);

  useEffect(() => {
    if (open) { setOrgName(value.orgName); setLeaderName(value.leaderName); setAccent(value.accent); }
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const safeAccent = /^#([0-9a-fA-F]{6})$/.test(accent) ? accent : '#BA7517';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm p-4 pt-[14vh]" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border bg-background shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="text-sm font-semibold">Branding</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-4 py-3 space-y-3">
          <div>
            <label className="text-[11px] text-muted-foreground">Org / brand name</label>
            <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="JanSunwai WB" className="h-9 text-sm mt-1" />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">Leader name (optional)</label>
            <Input value={leaderName} onChange={(e) => setLeaderName(e.target.value)} placeholder="e.g. Subodh Mahato" className="h-9 text-sm mt-1" />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">Accent colour</label>
            <div className="flex items-center gap-2 mt-1">
              <input type="color" value={safeAccent} onChange={(e) => setAccent(e.target.value)} className="h-9 w-12 rounded border cursor-pointer bg-transparent" aria-label="Accent colour" />
              <Input value={accent} onChange={(e) => setAccent(e.target.value)} className="h-9 text-sm font-mono flex-1" />
              <span className="w-9 h-9 rounded-lg border shrink-0" style={{ background: safeAccent }} aria-hidden />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">Local preview (is browser ke liye). Production branding config se aata hai.</p>
        </div>

        <div className="px-4 py-3 border-t flex items-center gap-2">
          <Button
            size="sm" className="flex-1 h-9 text-white" style={{ background: safeAccent }}
            onClick={() => { onSave({ orgName: orgName.trim() || 'JanSunwai WB', leaderName: leaderName.trim(), accent: safeAccent, accentSoft: softFromAccent(safeAccent) }); onClose(); }}
          >
            <Check className="w-4 h-4 mr-1" /> Save
          </Button>
          <Button size="sm" variant="outline" className="h-9" onClick={() => { onReset(); onClose(); }}>
            <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reset
          </Button>
        </div>
      </div>
    </div>
  );
}
