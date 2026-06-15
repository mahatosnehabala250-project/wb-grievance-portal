'use client';

/**
 * CommandCenter — the redesigned command center shell: a left "rooms" rail + a
 * personalized "Aaj" home, replacing the single long scroll. White-label branded.
 * Each capability is its own focused room; ⌘K opens the AI Chief-of-Staff anywhere.
 * Backend unchanged — pure frontend IA over the existing scope-locked engines.
 */

import { useState, useEffect, useCallback } from 'react';
import { Sun, LayoutDashboard, Zap, TrendingUp, Network, Brain, Target, Footprints, MessageSquare } from 'lucide-react';
import { AajHome } from '@/components/AajHome';
import { AdvisorBar } from '@/components/AdvisorBar';
import { IntelligenceCommandView } from '@/components/IntelligenceCommandView';
import { resolveBranding, type BrandingScope } from '@/lib/branding';

type Room = 'aaj' | 'overview' | 'actions' | 'forecast' | 'network' | 'brain' | 'entity360' | 'field';

const ROOMS: Array<{ key: Room; label: string; icon: typeof Sun }> = [
  { key: 'aaj', label: 'Aaj', icon: Sun },
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'actions', label: 'Actions', icon: Zap },
  { key: 'forecast', label: 'Forecast', icon: TrendingUp },
  { key: 'network', label: 'Network', icon: Network },
  { key: 'brain', label: 'Brain', icon: Brain },
  { key: 'entity360', label: 'Entity 360', icon: Target },
  { key: 'field', label: 'Field', icon: Footprints },
];

export function CommandCenter({ user }: { user?: (BrandingScope & { name?: string }) | null }) {
  const [room, setRoom] = useState<Room>('aaj');
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const branding = resolveBranding(user);

  // ⌘K / Ctrl+K opens the Chief-of-Staff from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setAdvisorOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
          <span className="text-[13px] font-semibold leading-tight truncate">{branding.orgName}</span>
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
        ) : (
          <IntelligenceCommandView room={room} />
        )}
      </div>

      <AdvisorBar open={advisorOpen} onClose={() => setAdvisorOpen(false)} branding={branding} />
    </div>
  );
}
