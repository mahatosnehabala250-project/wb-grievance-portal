/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

/**
 * CommandAssistant ("Saathi") — the global, role-aware voice/command assistant.
 * Floating mic on every authenticated screen. Listens (Web Speech STT) →
 * /api/assistant (DeepSeek tool-calling brain, scope-locked) → speaks the answer
 * (Web Speech TTS) → navigates via NavContext → renders write actions as confirm
 * cards that run the EXISTING audited routes. Languages: Hindi / Bengali / English.
 *
 * Voice engine v1 = browser Web Speech API (free, supports hi-IN/bn-IN/en-IN).
 * Phase 2 upgrade = Gemini Live realtime (same /api/assistant tool backend).
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, Square, X, Send, Volume2, VolumeX, Loader2, Sparkles, Check, MapPin, Wrench, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { authHeaders } from '@/lib/helpers';
import { useAuthStore } from '@/lib/auth-store';
import { useNav } from '@/lib/nav-context';

interface Msg { role: 'user' | 'assistant'; content: string }
interface ProposedAction { id: string; kind: 'assign' | 'status' | 'escalate' | 'note' | 'reopen'; ticketNo: string; params: Record<string, any>; label: string }

const LANGS: Array<{ id: string; label: string }> = [
  { id: 'hi-IN', label: 'हिं' }, { id: 'bn-IN', label: 'বাং' }, { id: 'en-IN', label: 'EN' },
];

export function CommandAssistant() {
  const { user } = useAuthStore();
  const nav = useNav();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakOn, setSpeakOn] = useState(true);
  const [lang, setLang] = useState('hi-IN');
  const [actions, setActions] = useState<ProposedAction[]>([]);
  const recRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Gemini Live (realtime) — opt-in
  const liveRef = useRef<any>(null);
  const liveUserRef = useRef('');
  const liveModelRef = useRef('');
  const [liveStatus, setLiveStatus] = useState<'idle' | 'connecting' | 'live' | 'error'>('idle');
  const [liveCaption, setLiveCaption] = useState<{ u: string; m: string }>({ u: '', m: '' });

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [msgs, actions, loading]);

  const speak = useCallback((text: string) => {
    if (!speakOn || typeof window === 'undefined' || !window.speechSynthesis) return;
    // strip markdown so TTS doesn't read "*" as "star", "#" etc.
    const clean = String(text).replace(/[*_`#~>|]+/g, '').replace(/\s{2,}/g, ' ').trim();
    if (!clean) return;
    try { window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(clean); u.lang = lang; u.rate = 1.02; window.speechSynthesis.speak(u); } catch { /* noop */ }
  }, [speakOn, lang]);

  const send = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || loading) return;
    setActions([]);
    const history = [...msgs, { role: 'user' as const, content: q }];
    setMsgs(history);
    setInput('');
    setLoading(true);
    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.slice(-10) }),
      });
      const json = await res.json();
      if (json?.enabled === false) { setMsgs((m) => [...m, { role: 'assistant', content: 'Assistant abhi configured nahi hai (DEEPSEEK_API_KEY missing).' }]); return; }
      const data = json?.data;
      if (!data) { setMsgs((m) => [...m, { role: 'assistant', content: 'Maaf kijiye, jawab nahi mila.' }]); return; }
      let answer = String(data.answer || '');
      // navigation
      if (data.navigate) {
        const ok = nav?.goTo(data.navigate.view, data.navigate.room) ?? false;
        if (!ok) answer += ' (Yeh page aapke role mein available nahi hai.)';
      }
      setMsgs((m) => [...m, { role: 'assistant', content: answer }]);
      if (Array.isArray(data.proposedActions) && data.proposedActions.length) setActions(data.proposedActions);
      speak(answer);
    } catch {
      setMsgs((m) => [...m, { role: 'assistant', content: 'Network error — dobara try karein.' }]);
    } finally {
      setLoading(false);
    }
  }, [loading, msgs, nav, speak]);

  // ── Web Speech STT ──
  const toggleListen = useCallback(() => {
    if (typeof window === 'undefined' || liveRef.current) return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { toast.error('Is browser mein voice support nahi — Chrome/Edge use karein, ya type karein.'); return; }
    if (listening) { try { recRef.current?.stop(); } catch { /* noop */ } setListening(false); return; }
    try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
    const rec = new SR();
    rec.lang = lang; rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
    let finalText = '';
    rec.onresult = (e: any) => { let interim = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript; } setInput(finalText || interim); };
    rec.onerror = () => { setListening(false); };
    rec.onend = () => { setListening(false); const t = finalText.trim(); if (t) send(t); };
    recRef.current = rec;
    try { rec.start(); setListening(true); } catch { setListening(false); }
  }, [listening, lang, send]);

  // ── Confirm a proposed write → run the EXISTING audited route ──
  const resolveComplaintId = async (ticketNo: string): Promise<string | null> => {
    try {
      const r = await fetch(`/api/complaints?search=${encodeURIComponent(ticketNo)}&limit=5`, { headers: authHeaders() });
      const j = await r.json(); const list = j?.complaints || [];
      const hit = list.find((c: any) => String(c.ticketNo || '').toLowerCase() === ticketNo.toLowerCase()) || list[0];
      return hit?.id || null;
    } catch { return null; }
  };
  const resolveOfficerId = async (name: string): Promise<string | null> => {
    try {
      const r = await fetch('/api/users', { headers: authHeaders() });
      const j = await r.json(); const list = Array.isArray(j) ? j : j?.users || [];
      const hit = list.find((u: any) => String(u.name || '').toLowerCase().includes(name.toLowerCase()));
      return hit?.id || null;
    } catch { return null; }
  };

  const runAction = useCallback(async (a: ProposedAction) => {
    setActions((s) => s.filter((x) => x.id !== a.id));
    const id = await resolveComplaintId(a.ticketNo);
    if (!id) { toast.error(`Ticket ${a.ticketNo} nahi mila / scope ke bahar`); return; }
    const hdr = { ...authHeaders(), 'Content-Type': 'application/json' };
    try {
      let res: Response;
      if (a.kind === 'escalate') {
        res = await fetch(`/api/complaints/${id}/escalate`, { method: 'PATCH', headers: hdr });
      } else if (a.kind === 'reopen') {
        res = await fetch(`/api/complaints/${id}/reopen`, { method: 'PATCH', headers: hdr });
      } else if (a.kind === 'note') {
        res = await fetch(`/api/complaints/${id}/comments`, { method: 'POST', headers: hdr, body: JSON.stringify({ content: String(a.params.note || a.params.content || '') }) });
      } else if (a.kind === 'status') {
        res = await fetch(`/api/complaints/${id}`, { method: 'PATCH', headers: hdr, body: JSON.stringify({ status: a.params.status, resolution: a.params.resolutionNote || undefined }) });
      } else {
        const oid = await resolveOfficerId(String(a.params.officer || ''));
        if (!oid) { toast.error(`Officer "${a.params.officer}" nahi mila`); return; }
        res = await fetch(`/api/complaints/${id}`, { method: 'PATCH', headers: hdr, body: JSON.stringify({ assignedToId: oid }) });
      }
      if (res.ok) { toast.success('Ho gaya ✓'); setMsgs((m) => [...m, { role: 'assistant', content: `Done — ${a.label}.` }]); }
      else { const j = await res.json().catch(() => ({})); toast.error(j.error || 'Action fail'); }
    } catch { toast.error('Action fail'); }
  }, []);

  const addProposed = useCallback((name: string, args: any) => {
    const kind = name === 'assign_officer' ? 'assign' : name === 'escalate_complaint' ? 'escalate' : name === 'add_note' ? 'note' : name === 'reopen_complaint' ? 'reopen' : 'status';
    const ticketNo = String(args.ticketNo || '');
    const label = kind === 'assign' ? `Assign ${args.officer} to ${ticketNo}` : kind === 'escalate' ? `Escalate ${ticketNo} by one level` : kind === 'note' ? `Add note to ${ticketNo}` : kind === 'reopen' ? `Reopen ${ticketNo}` : `Set ${ticketNo} → ${args.status}`;
    setActions((s) => [...s, { id: `${name}:${ticketNo}:${s.length}`, kind: kind as ProposedAction['kind'], ticketNo, params: args, label }]);
  }, []);

  const toggleLive = useCallback(async () => {
    if (liveRef.current) { try { await liveRef.current.stop(); } catch { /* noop */ } liveRef.current = null; setLiveStatus('idle'); return; }
    try {
      try { recRef.current?.stop(); } catch { /* noop */ }
      try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
      setListening(false);
      setLiveStatus('connecting');
      const { LiveSession } = await import('@/lib/assistant/live');
      const sess = new LiveSession({
        onStatus: (s) => {
          if (s === 'live') setLiveStatus('live');
          else if (s === 'connecting') setLiveStatus('connecting');
          else { setLiveStatus(s === 'error' ? 'error' : 'idle'); liveRef.current = null; }
        },
        onUserText: (d) => { liveUserRef.current += d; setLiveCaption({ u: liveUserRef.current, m: liveModelRef.current }); },
        onModelText: (d) => { liveModelRef.current += d; setLiveCaption((c) => ({ ...c, m: liveModelRef.current })); },
        onTurnComplete: () => {
          const u = liveUserRef.current.trim(); const m = liveModelRef.current.trim();
          setMsgs((prev) => [...prev, ...(u ? [{ role: 'user' as const, content: u }] : []), ...(m ? [{ role: 'assistant' as const, content: m }] : [])]);
          liveUserRef.current = ''; liveModelRef.current = ''; setLiveCaption({ u: '', m: '' });
        },
        onNavigate: (view: string, room?: string) => nav?.goTo(view, room) ?? false,
        onProposeWrite: (name: string, args: any) => addProposed(name, args),
      });
      liveRef.current = sess;
      await sess.start();
    } catch (e: any) {
      toast.error(e?.message || 'Live shuru nahi hua — mic permission / browser check karein');
      setLiveStatus('idle'); liveRef.current = null;
    }
  }, [nav, addProposed]);

  useEffect(() => () => { try { liveRef.current?.stop(); } catch { /* noop */ } }, []);

  if (!user) return null;

  return (
    <>
      {/* Launcher */}
      <button onClick={() => setOpen((o) => !o)} aria-label="Saathi assistant"
        className="fixed bottom-6 right-6 z-[60] w-14 h-14 rounded-full flex items-center justify-center shadow-xl transition-transform hover:scale-105"
        style={{ background: 'linear-gradient(135deg,#7c3aed,#22d3ee)', boxShadow: '0 8px 30px rgba(124,58,237,0.5)' }}>
        {listening ? <span className="absolute inset-0 rounded-full animate-ping" style={{ background: 'rgba(34,211,238,0.5)' }} /> : null}
        {open ? <X className="w-6 h-6 text-white relative" /> : <Sparkles className="w-6 h-6 text-white relative" />}
      </button>

      {open && (
        <div className="fixed bottom-24 right-6 z-[60] w-[360px] max-w-[calc(100vw-2rem)] rounded-2xl overflow-hidden flex flex-col"
          style={{ maxHeight: '70vh', background: '#0c1322', border: '1px solid rgba(124,58,237,0.35)', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <span className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#7c3aed,#22d3ee)' }}><Sparkles className="w-4 h-4 text-white" /></span>
            <div className="flex-1">
              <div className="text-[13px] font-semibold text-slate-100">Saathi</div>
              <div className="text-[9px] text-slate-500">Aapke role ke hisaab se — pucho ya kaam bolo</div>
            </div>
            <div className="flex gap-0.5">
              {LANGS.map((l) => (
                <button key={l.id} onClick={() => setLang(l.id)} className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                  style={lang === l.id ? { background: 'rgba(34,211,238,0.18)', color: '#22d3ee' } : { color: '#64748b' }}>{l.label}</button>
              ))}
            </div>
            <button onClick={toggleLive} title="Gemini Live — realtime baat-cheet" className="p-1 rounded flex items-center"
              style={{ color: liveStatus === 'live' ? '#a78bfa' : liveStatus === 'connecting' ? '#a78bfa' : '#64748b' }}>
              {liveStatus === 'connecting' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" fill={liveStatus === 'live' ? '#a78bfa' : 'none'} />}
            </button>
            <button onClick={() => setSpeakOn((s) => !s)} title="Awaaz on/off" className="p-1 rounded" style={{ color: speakOn ? '#22d3ee' : '#64748b' }}>
              {speakOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2" style={{ minHeight: 120 }}>
            {(liveStatus === 'live' || liveStatus === 'connecting' || liveStatus === 'error') && (
              <div className="rounded-lg px-2 py-1.5 mb-1" style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.35)' }}>
                <div className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: '#c4b5fd' }}>
                  <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: liveStatus === 'live' ? '#ef4444' : liveStatus === 'error' ? '#f59e0b' : '#a78bfa' }} />
                  {liveStatus === 'live' ? 'Live — boliye (Gemini)' : liveStatus === 'error' ? 'Live error — phir try karein' : 'Connecting…'}
                </div>
                {liveCaption.u && <div className="text-[11px] text-slate-300 mt-1 italic">“{liveCaption.u}”</div>}
                {liveCaption.m && <div className="text-[11px] text-slate-100 mt-0.5">{liveCaption.m}</div>}
              </div>
            )}
            {msgs.length === 0 && (
              <div className="text-[11px] text-slate-500 space-y-1.5 py-2">
                <div className="text-slate-400 font-medium">Try karo:</div>
                {['Aaj ki situation batao', 'Map kholo', 'Sabse zyada gussa kahan hai?', 'Critical complaints dikhao', 'Forecast kya hai?'].map((s) => (
                  <button key={s} onClick={() => send(s)} className="block w-full text-left px-2 py-1 rounded text-[11px]" style={{ background: 'rgba(255,255,255,0.04)', color: '#cbd5e1' }}>“{s}”</button>
                ))}
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[85%] px-2.5 py-1.5 rounded-xl text-[12px] leading-snug"
                  style={m.role === 'user' ? { background: 'rgba(34,211,238,0.15)', color: '#e2e8f0' } : { background: 'rgba(255,255,255,0.05)', color: '#e2e8f0' }}>
                  {m.content}
                </div>
              </div>
            ))}
            {loading && <div className="flex items-center gap-1.5 text-[11px] text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> soch raha hoon…</div>}

            {/* Proposed write actions — need confirmation */}
            {actions.map((a) => (
              <div key={a.id} className="rounded-lg p-2" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-400 mb-1.5">
                  {a.kind === 'assign' ? <MapPin className="w-3 h-3" /> : <Wrench className="w-3 h-3" />} Confirm karein
                </div>
                <div className="text-[12px] text-slate-200 mb-2">{a.label}</div>
                <div className="flex gap-1.5">
                  <button onClick={() => runAction(a)} className="px-2.5 py-1 rounded text-[11px] font-semibold flex items-center gap-1" style={{ background: '#f59e0b', color: '#1a1206' }}><Check className="w-3 h-3" /> Haan, karo</button>
                  <button onClick={() => setActions((s) => s.filter((x) => x.id !== a.id))} className="px-2.5 py-1 rounded text-[11px]" style={{ background: 'rgba(255,255,255,0.06)', color: '#94a3b8' }}>Rehne do</button>
                </div>
              </div>
            ))}
          </div>

          {/* Input */}
          <div className="flex items-center gap-2 px-2.5 py-2" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
            <button onClick={toggleListen} className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
              style={listening ? { background: '#ef4444', color: '#fff' } : { background: 'rgba(124,58,237,0.2)', color: '#a78bfa' }}>
              {listening ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(input); }}
              placeholder={listening ? 'Sun raha hoon…' : 'Pucho ya kaam bolo…'}
              className="flex-1 bg-transparent text-[13px] text-slate-100 outline-none placeholder:text-slate-600" />
            <button onClick={() => send(input)} disabled={!input.trim() || loading} className="p-1.5 rounded-lg disabled:opacity-40" style={{ color: '#22d3ee' }}><Send className="w-4 h-4" /></button>
          </div>
        </div>
      )}
    </>
  );
}
