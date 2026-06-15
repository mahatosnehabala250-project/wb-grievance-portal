/**
 * White-label branding (Level-11 polish — per-client identity).
 *
 * One platform, many clients (MLAs / MPs / parties). Each client can get their
 * OWN name, leader, tagline and accent colour — so the command center feels like
 * "mera apna system", and the setup fee is justified. v1 is config-driven (no DB):
 * add an entry to CLIENTS keyed by the client's scope (constituency / lok sabha /
 * district, lowercased). Falls back to the neutral default when unmatched.
 *
 * Later this can move to a `client_branding` table resolved server-side; the
 * resolver signature stays the same so callers don't change.
 */

export interface Branding {
  orgName: string;     // brand shown in the rail / header
  leaderName: string;  // the politician this deployment represents ('' = none)
  tagline: string;
  accent: string;      // hex — chrome accent (rail active, avatar, hero)
  accentSoft: string;  // soft rgba bg of the same hue
}

export interface BrandingScope {
  role?: string;
  role_level?: string;
  constituency?: string | null;
  lok_sabha_constituency?: string | null;
  district?: string | null;
  block?: string | null;
}

const DEFAULT_BRANDING: Branding = {
  orgName: 'JanSunwai WB',
  leaderName: '',
  tagline: 'Citizen Grievance Intelligence',
  accent: '#BA7517',                 // amber-600 (premium / saffron-ish, party-neutral)
  accentSoft: 'rgba(186, 117, 23, 0.12)',
};

// Per-client overrides. Key = lowercased scope name. Add real clients here.
// Example (commented — fill with a real signed client):
//   'bankura': { orgName: 'Bankura Sansad Seva', leaderName: 'Dr. S. Roy', accent: '#185FA5', accentSoft: 'rgba(24,95,165,0.12)' },
const CLIENTS: Record<string, Partial<Branding>> = {};

const norm = (s?: string | null) => (s || '').trim().toLowerCase();

/** Resolve the active branding for the logged-in user's scope (most-specific first). */
export function resolveBranding(user?: BrandingScope | null): Branding {
  if (!user) return DEFAULT_BRANDING;
  const keys = [
    norm(user.constituency),
    norm(user.lok_sabha_constituency),
    norm(user.district),
    norm(user.block),
  ].filter(Boolean);
  for (const k of keys) {
    if (CLIENTS[k]) return { ...DEFAULT_BRANDING, ...CLIENTS[k] };
  }
  return DEFAULT_BRANDING;
}

/** Initials for an avatar chip. */
export function initialsOf(name?: string): string {
  const n = (name || '').trim();
  if (!n) return 'JS';
  const parts = n.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || n[0].toUpperCase();
}
