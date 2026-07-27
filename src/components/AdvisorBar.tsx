'use client';

/**
 * AdvisorBar — the ⌘K command bar for the AI Chief-of-Staff (Level 9), reachable
 * from anywhere in the command center. Ask a scoped question (Bangla/Hindi/English),
 * get an evidence-cited answer grounded only in your jurisdiction. Self-contained:
 * reuses POST /api/intelligence/advisor ({ question } → { data: { answer } }).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, X, MessageSquare, RefreshCw } from 'lucide-react';
import { authHeaders } from '@/lib/helpers';
import type { Branding } from '@/lib/branding';

const SUGGESTED = [
  'Where should I focus today?',
  'Which block has rising anger?',
  'Which quick wins can we close this week?',
];

export function AdvisorBar({ open, onClose, branding }: { open: boolean; onClose: () => void; branding: Branding }) {
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const ask = useCallback(async (question: string) => {
    const text = question.trim();
    if (!text) return;
    setLoading(true); setError(null); setAnswer(null);
    try {
      const res = await fetch('/api/intelligence/advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ question: text }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.data?.answer) setAnswer(json.data.answer);
      else setError(json?.error || 'The advisor could not answer just now');
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(t); };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm p-4 pt-[12vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl border bg-background shadow-2xl overflow-hidden"
        style={{ borderColor: branding.accentSoft }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input row */}
        <form
          onSubmit={(e) => { e.preventDefault(); ask(q); }}
          className="flex items-center gap-2 px-4 py-3 border-b"
        >
          <MessageSquare className="w-4 h-4 shrink-0" style={{ color: branding.accent }} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Chief-of-Staff se poocho — Bangla / Hindi / English…"
            className="flex-1 bg-transparent outline-none text-sm"
          />
          <button type="submit" disabled={loading || !q.trim()} className="shrink-0 rounded-lg px-2.5 py-1.5 text-white text-xs disabled:opacity-50" style={{ background: branding.accent }}>
            {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </button>
          <button type="button" onClick={onClose} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </form>

        {/* Body */}
        <div className="px-4 py-3 max-h-[50vh] overflow-y-auto">
          {!answer && !error && !loading && (
            <div className="space-y-1.5">
              <div className="text-[11px] text-muted-foreground mb-1">Try poochho:</div>
              {SUGGESTED.map((s) => (
                <button
                  key={s}
                  onClick={() => { setQ(s); ask(s); }}
                  className="block w-full text-left text-[13px] rounded-lg px-3 py-2 hover:bg-muted/60 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          {loading && <div className="text-sm text-muted-foreground py-3">Thinking… reading the data in your scope.</div>}
          {error && <div className="text-sm text-destructive py-2">{error}</div>}
          {answer && (
            <div className="text-[13px] leading-relaxed whitespace-pre-wrap">{answer}</div>
          )}
        </div>

        <div className="px-4 py-2 border-t text-[10px] text-muted-foreground flex items-center justify-between">
          <span>Your jurisdiction only · aggregate data</span>
          <span className="font-mono">Esc band karne ke liye</span>
        </div>
      </div>
    </div>
  );
}
