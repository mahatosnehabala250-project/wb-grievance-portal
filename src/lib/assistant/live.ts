/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * live.ts — browser Gemini Live session (Phase 2 realtime voice).
 *
 * Audio streams browser ↔ Gemini directly (low latency) using a short-lived
 * ephemeral token from /api/assistant/live-token. The model's TOOL CALLS are
 * routed through our callbacks: read tools → POST /api/assistant/tool (executed
 * server-side with the JWT, scope-locked), navigate → onNavigate, write → confirm.
 * So the RBAC boundary is preserved even though audio is direct.
 *
 * Loaded only when the user turns Live on (dynamic import), to keep the SDK out
 * of the default bundle.
 */
import { GoogleGenAI, Modality } from '@google/genai';
import { authHeaders } from '@/lib/helpers';
import { NAV_DESTINATIONS, WRITE_TOOL_NAMES } from '@/lib/assistant/shared';

export type LiveStatus = 'connecting' | 'live' | 'closed' | 'error';
export interface LiveCallbacks {
  onUserText?: (delta: string) => void;
  onModelText?: (delta: string) => void;
  onTurnComplete?: () => void;
  onStatus?: (s: LiveStatus, msg?: string) => void;
  onNavigate?: (view: string, room?: string) => boolean;   // returns false if not allowed for the role
  onProposeWrite?: (name: string, args: any) => void;
}

function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64decode(b: string): Uint8Array {
  const bin = atob(b);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

export class LiveSession {
  private session: any = null;
  private micCtx: AudioContext | null = null;
  private micNode: AudioWorkletNode | null = null;
  private micStream: MediaStream | null = null;
  private playCtx: AudioContext | null = null;
  private nextStart = 0;
  private sources: AudioBufferSourceNode[] = [];
  private cb: LiveCallbacks;
  private closed = false;

  constructor(cb: LiveCallbacks) { this.cb = cb; }

  async start(): Promise<void> {
    this.cb.onStatus?.('connecting');
    const r = await fetch('/api/assistant/live-token', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: '{}' });
    const j = await r.json();
    if (j?.enabled === false || !j?.data?.token) throw new Error(j?.error || 'Live not configured');
    const { token, model, systemInstruction, tools } = j.data;

    const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } });
    this.playCtx = new AudioContext({ sampleRate: 24000 });

    this.session = await ai.live.connect({
      model,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction,
        tools: tools?.length ? [{ functionDeclarations: tools }] : undefined,
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
      callbacks: {
        onopen: () => this.cb.onStatus?.('live'),
        onmessage: (m: any) => this.onMessage(m),
        onerror: (e: any) => this.cb.onStatus?.('error', e?.message || 'connection error'),
        onclose: () => { if (!this.closed) this.cb.onStatus?.('closed'); },
      },
    });

    await this.startMic();
  }

  private async startMic(): Promise<void> {
    this.micStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    this.micCtx = new AudioContext({ sampleRate: 16000 });
    await this.micCtx.audioWorklet.addModule('/pcm-capture-worklet.js');
    const src = this.micCtx.createMediaStreamSource(this.micStream);
    this.micNode = new AudioWorkletNode(this.micCtx, 'pcm-capture');
    this.micNode.port.onmessage = (e: MessageEvent) => {
      const f = e.data as Float32Array;
      const i16 = new Int16Array(f.length);
      for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
      const data = b64encode(new Uint8Array(i16.buffer));
      try { this.session?.sendRealtimeInput({ media: { data, mimeType: 'audio/pcm;rate=16000' } }); } catch { /* noop */ }
    };
    src.connect(this.micNode);
  }

  private onMessage(m: any): void {
    const sc = m.serverContent;
    if (sc?.inputTranscription?.text) this.cb.onUserText?.(sc.inputTranscription.text);
    if (sc?.outputTranscription?.text) this.cb.onModelText?.(sc.outputTranscription.text);
    if (sc?.interrupted) this.stopPlayback();

    const audioB64 = m.data || sc?.modelTurn?.parts?.find((p: any) => p?.inlineData?.data)?.inlineData?.data;
    if (audioB64) this.enqueue(audioB64);

    if (sc?.turnComplete) this.cb.onTurnComplete?.();
    if (m.toolCall?.functionCalls?.length) void this.handleTools(m.toolCall.functionCalls);
  }

  private async handleTools(calls: any[]): Promise<void> {
    const functionResponses: any[] = [];
    for (const fc of calls) {
      const name = fc.name as string;
      const args = fc.args || {};
      let response: any;
      if (name === 'navigate') {
        const dest = NAV_DESTINATIONS.find((d) => d.id === args.destination);
        const ok = dest ? (this.cb.onNavigate?.(dest.view, dest.room) ?? false) : false;
        response = { result: dest ? (ok ? `opening ${dest.label}` : 'that page is not available for this role') : 'unknown destination' };
      } else if (WRITE_TOOL_NAMES.has(name)) {
        this.cb.onProposeWrite?.(name, args);
        response = { result: 'prepared — telling the user to confirm on screen' };
      } else {
        try {
          const r = await fetch('/api/assistant/tool', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ name, args }) });
          const j = await r.json();
          response = { result: j?.result ?? { error: 'no result' } };
        } catch { response = { result: { error: 'tool failed' } }; }
      }
      functionResponses.push({ id: fc.id, name, response });
    }
    try { this.session?.sendToolResponse({ functionResponses }); } catch { /* noop */ }
  }

  private enqueue(b64: string): void {
    if (!this.playCtx) return;
    const bytes = b64decode(b64);
    const len = Math.floor(bytes.byteLength / 2);
    const i16 = new Int16Array(bytes.buffer, bytes.byteOffset, len);
    const f32 = new Float32Array(len);
    for (let i = 0; i < len; i++) f32[i] = i16[i] / 32768;
    const buf = this.playCtx.createBuffer(1, len, 24000);
    buf.copyToChannel(f32, 0);
    const node = this.playCtx.createBufferSource();
    node.buffer = buf;
    node.connect(this.playCtx.destination);
    const start = Math.max(this.playCtx.currentTime, this.nextStart);
    node.start(start);
    this.nextStart = start + buf.duration;
    this.sources.push(node);
    node.onended = () => { this.sources = this.sources.filter((s) => s !== node); };
  }

  private stopPlayback(): void {
    for (const s of this.sources) { try { s.stop(); } catch { /* noop */ } }
    this.sources = [];
    this.nextStart = 0;
  }

  async stop(): Promise<void> {
    this.closed = true;
    this.stopPlayback();
    try { this.micNode?.disconnect(); } catch { /* noop */ }
    try { this.micStream?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    try { await this.micCtx?.close(); } catch { /* noop */ }
    try { await this.playCtx?.close(); } catch { /* noop */ }
    try { this.session?.close(); } catch { /* noop */ }
    this.session = null;
    this.cb.onStatus?.('closed');
  }
}
