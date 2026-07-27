'use client';

/**
 * CommandCenter — the redesigned command center shell: a left "rooms" rail + a
 * personalized "Aaj" home, replacing the single long scroll. White-label branded
 * (editable in-app). Each capability is its own focused room; ⌘K opens the AI
 * Chief-of-Staff anywhere. Backend unchanged — pure frontend IA.
 */

import { useState, useEffect } from 'react';
import { useNav } from '@/lib/nav-context';
import { Sun, LayoutDashboard, Zap, TrendingUp, Network, Brain, Target, Footprints, MessageSquare, Settings, Map as MapIcon } from 'lucide-react';
import { AajHome } from '@/components/AajHome';
import { AdvisorBar } from '@/components/AdvisorBar';
import { BrandingSettings } from '@/components/BrandingSettings';
import { IntelligenceCommandView } from '@/components/IntelligenceCommandView';
import { MapView } from '@/components/MapView';
import { OverviewDashboard } from '@/components/OverviewDashboard';
import { toast } from 'sonner';
import { authHeaders } from '@/lib/helpers';
import {
  resolveBranding, loadBrandingOverride, saveBrandingOverride, clearBrandingOverride,
  type BrandingScope, type Branding,
} from '@/lib/branding';

type Room = 'aaj' | 'overview' | 'actions' | 'map' | 'forecast' | 'network' | 'brain' | 'entity360' | 'field';

const ROOMS: Array<{ key: Room; label: string; icon: typeof Sun }> = [
  { key: 'aaj', label: 'Today', icon: Sun },
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'actions', label: 'Actions', icon: Zap },
  { key: 'map', label: 'Map', icon: MapIcon },
  { key: 'forecast', label: 'Forecast', icon: TrendingUp },
  { key: 'network', label: 'Network', icon: Network },
  { key: 'brain', label: 'Brain', icon: Brain },
  { key: 'entity360', label: 'Entity 360', icon: Target },
  { key: 'field', label: 'Field', icon: Footprints },
];

export function CommandCenter({ user }: { user?: (BrandingScope & { name?: string }) | null }) {
  const [room, setRoom] = useState<Room>('aaj');
  const nav = useNav();
  // Assistant navigation: when page.tsx sets a pendingRoom, switch to it.
  useEffect(() => {
    const pr = nav?.pendingRoom;
    if (pr && ROOMS.some((r) => r.key === pr)) { setRoom(pr as Room); nav?.consumePendingRoom(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav?.pendingRoom]);
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [brandingOpen, setBrandingOpen] = useState(false);
  const [override, setOverride] = useState<Partial<Branding> | null>(null);
  const [serverBranding, setServerBranding] = useState<Partial<Branding> | null>(null);

  // After mount: local preview override + DB-resolved branding (SSR-safe — base first).
  useEffect(() => { setOverride(loadBrandingOverride()); }, []);
  useEffect(() => {
    fetch('/api/branding', { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.branding) setServerBranding(j.branding); })
      .catch(() => {});
  }, []);

  // ⌘K / Ctrl+K opens the Chief-of-Staff from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setAdvisorOpen((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Precedence: config default ← DB (multi-tenant) ← local preview override.
  const branding: Branding = { ...resolveBranding(user), ...(serverBranding || {}), ...(override || {}) };

  return (
    <div
      className="flex flex-col sm:flex-row gap-3 sm:gap-4 flex-1 min-h-0"
      style={{ ['--cc-accent']: branding.accent } as React.CSSProperties}
    >
      {/* Rooms rail */}
      <nav className="sm:w-44 shrink-0 sm:border-r sm:pr-3">
        <div className="flex items-center gap-2 px-2 pb-3">
          <span className="w-6 h-6 rounded-md flex items-center justify-center text-white text-[13px] shrink-0" style={{ background: branding.accent }} aria-hidden>
            <Sun className="w-3.5 h-3.5" />
          </span>
          <span className="text-[13px] font-semibold leading-tight truncate flex-1">{branding.orgName}</span>
          <button onClick={() => setBrandingOpen(true)} className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Branding settings" title="Branding">
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex sm:flex-col gap-1 overflow-x-auto pb-1">
          {ROOMS.map(({ key, label, icon: Icon }) => {
            const on = room === key;
            return (
              <button
                key={key}
                onClick={() => setRoom(key)}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-left whitespace-nowrap transition-colors ${on ? 'font-medium' : 'text-muted-foreground hover:bg-muted/60'}`}
                style={on ? { background: branding.accentSoft, color: branding.accent } : undefined}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </button>
            );
          })}
          <button
            onClick={() => setAdvisorOpen(true)}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-left whitespace-nowrap text-muted-foreground hover:bg-muted/60 sm:mt-2 sm:border-t sm:pt-3"
          >
            <MessageSquare className="w-4 h-4 shrink-0" />
            Advisor
            <span className="ml-auto text-[10px] text-muted-foreground/70 font-mono hidden sm:inline">⌘K</span>
          </button>
        </div>
      </nav>

      {/* Active room */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {room === 'aaj' ? (
          <AajHome
            user={user}
            branding={branding}
            onOpenActions={() => setRoom('actions')}
            onOpenIntelligence={() => setRoom('overview')}
          />
        ) : room === 'map' ? (
          <MapView />
        ) : room === 'overview' ? (
          <OverviewDashboard />
        ) : (
          <IntelligenceCommandView room={room} />
        )}
      </div>

      <AdvisorBar open={advisorOpen} onClose={() => setAdvisorOpen(false)} branding={branding} />
      <BrandingSettings
        open={brandingOpen}
        onClose={() => setBrandingOpen(false)}
        value={branding}
        onSave={async (o) => {
          try {
            const res = await fetch('/api/branding', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(o) });
            const j = await res.json().catch(() => ({}));
            if (res.ok && j?.branding) {
              setServerBranding(j.branding); clearBrandingOverride(); setOverride(null);
              toast.success('Branding saved for your whole scope');
            } else {
              saveBrandingOverride(o); setOverride(o);
              toast.message(j?.error ? `${j.error} — local preview save kiya` : 'Local preview save kiya');
            }
          } catch {
            saveBrandingOverride(o); setOverride(o);
            toast.message('Server save fail — local preview save kiya');
          }
        }}
        onReset={async () => {
          clearBrandingOverride(); setOverride(null);
          try {
            const res = await fetch('/api/branding', { method: 'DELETE', headers: authHeaders() });
            if (res.ok) { setServerBranding(null); toast.success('Branding reset'); }
          } catch { /* local already cleared */ }
        }}
      />
    </div>
  );
}
