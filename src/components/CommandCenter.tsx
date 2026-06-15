'use client';

/**
 * CommandCenter — the Phase-A redesign shell: a left "rooms" rail + a personalized
 * "Aaj" home, replacing the single long scroll. White-label branded per client.
 *
 * v1 rooms: Aaj (new premium home) + Intelligence (the existing full detailed view,
 * untouched). Next iterations peel Map / Forecast / Network / Brain / Entity360 /
 * Field into their own rooms. Backend unchanged — this is pure frontend IA.
 */

import { useState } from 'react';
import { Sun, LayoutDashboard } from 'lucide-react';
import { AajHome } from '@/components/AajHome';
import { IntelligenceCommandView } from '@/components/IntelligenceCommandView';
import { resolveBranding, type BrandingScope } from '@/lib/branding';

type Room = 'aaj' | 'intel';

const ROOMS: Array<{ key: Room; label: string; icon: typeof Sun }> = [
  { key: 'aaj', label: 'Aaj', icon: Sun },
  { key: 'intel', label: 'Intelligence', icon: LayoutDashboard },
];

export function CommandCenter({ user }: { user?: (BrandingScope & { name?: string }) | null }) {
  const [room, setRoom] = useState<Room>('aaj');
  const branding = resolveBranding(user);

  return (
    <div
      className="flex flex-col sm:flex-row gap-3 sm:gap-4"
      style={{ '--cc-accent': branding.accent } as React.CSSProperties}
    >
      {/* Rooms rail */}
      <nav className="sm:w-44 shrink-0 sm:border-r sm:pr-3">
        <div className="flex items-center gap-2 px-2 pb-3">
          <span
            className="w-6 h-6 rounded-md flex items-center justify-center text-white text-[13px] shrink-0"
            style={{ background: branding.accent }}
            aria-hidden
          >
            <Sun className="w-3.5 h-3.5" />
          </span>
          <span className="text-[13px] font-semibold leading-tight truncate">{branding.orgName}</span>
        </div>
        <div className="flex sm:flex-col gap-1 overflow-x-auto">
          {ROOMS.map(({ key, label, icon: Icon }) => {
            const on = room === key;
            return (
              <button
                key={key}
                onClick={() => setRoom(key)}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-left whitespace-nowrap transition-colors ${
                  on ? 'font-medium' : 'text-muted-foreground hover:bg-muted/60'
                }`}
                style={on ? { background: branding.accentSoft, color: branding.accent } : undefined}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Active room */}
      <div className="flex-1 min-w-0">
        {room === 'aaj' ? (
          <AajHome
            user={user}
            branding={branding}
            onOpenActions={() => setRoom('intel')}
            onOpenIntelligence={() => setRoom('intel')}
          />
        ) : (
          <IntelligenceCommandView />
        )}
      </div>
    </div>
  );
}
