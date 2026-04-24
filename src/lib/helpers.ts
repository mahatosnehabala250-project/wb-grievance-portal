import { STATUS_MAP, URGENCY_MAP, ROLE_MAP, CATEGORY_LABELS } from './constants';

export function fmtDate(s: string) {
  if (!s) return 'N/A';
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(s: string) {
  if (!s) return 'N/A';
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtStatus(status: string) {
  return STATUS_MAP[status]?.label || status;
}

export function fmtCategory(category: string) {
  return CATEGORY_LABELS[category] || category;
}

export function fmtUrgency(urgency: string) {
  return URGENCY_MAP[urgency]?.label || urgency;
}

export function fmtRole(role: string) {
  return ROLE_MAP[role] || role;
}

export function safeGetLocalStorage(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try { return localStorage.getItem(key); } catch { return null; }
}

export function safeSetLocalStorage(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key, value); } catch { /* noop */ }
}

export function authHeaders(): Record<string, string> {
  const token = safeGetLocalStorage('wb_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function getDaysOld(createdAt: string): number {
  const now = new Date();
  const created = new Date(createdAt);
  const diffMs = now.getTime() - created.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export function getSLAInfo(createdAt: string, status: string): { days: number; level: 'ok' | 'warning' | 'breached'; color: string; bg: string; text: string } {
  const days = getDaysOld(createdAt);
  if (status === 'RESOLVED' || status === 'REJECTED') {
    return { days, level: 'ok', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/40', text: 'text-emerald-700 dark:text-emerald-400' };
  }
  if (days > 7) {
    return { days, level: 'breached', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-950/40', text: 'text-red-700 dark:text-red-400' };
  }
  if (days >= 3) {
    return { days, level: 'warning', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-400' };
  }
  return { days, level: 'ok', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/40', text: 'text-emerald-700 dark:text-emerald-400' };
}

export function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.value = 0.15;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
    setTimeout(() => {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.frequency.value = 1108;
      osc2.type = 'sine';
      gain2.gain.value = 0.15;
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc2.start(ctx.currentTime);
      osc2.stop(ctx.currentTime + 0.25);
    }, 120);
  } catch { /* audio not available */ }
}
