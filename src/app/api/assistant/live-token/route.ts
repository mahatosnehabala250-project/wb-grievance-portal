export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Modality } from '@google/genai';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import { getGeminiToolDeclarations } from '@/lib/assistant/tools';
import { buildSystemPrompt } from '@/lib/assistant/agent';

/**
 * POST /api/assistant/live-token — mint a short-lived EPHEMERAL token for a
 * browser Gemini Live session (so the raw GEMINI_API_KEY never reaches the client).
 * Returns the token + model + system instruction + role-filtered tool declarations.
 * The Live session's tool CALLS are still proxied back to /api/assistant/tool, which
 * re-checks the JWT scope — so RBAC holds even though audio is browser↔Gemini direct.
 */
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-2.0-flash-live-001';

export async function POST(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    if (!GEMINI_KEY) {
      return NextResponse.json({ error: 'Gemini Live not configured — set GEMINI_API_KEY', enabled: false }, { status: 200 });
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_KEY, httpOptions: { apiVersion: 'v1alpha' } });
    const now = Date.now();
    const ephemeral = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(now + 25 * 60 * 1000).toISOString(),       // token valid 25 min
        newSessionExpireTime: new Date(now + 2 * 60 * 1000).toISOString(), // must connect within 2 min
        // Bind the model + version to the token (fixes "model not found for API version v1main").
        liveConnectConstraints: {
          model: LIVE_MODEL,
          config: { responseModalities: [Modality.AUDIO] },
        },
        httpOptions: { apiVersion: 'v1beta' }, // live session must target v1beta (where the live model lives)
      },
    });

    const systemInstruction = `${buildSystemPrompt(payload)}\n\nThis is a LIVE VOICE call. Speak naturally and briefly, like a quick phone reply. Always reply in the language the user spoke.`;
    const tools = getGeminiToolDeclarations(payload);

    return NextResponse.json({ data: { token: ephemeral.name, model: LIVE_MODEL, systemInstruction, tools } });
  } catch (err) {
    console.error('live-token error:', err);
    return NextResponse.json({ error: 'Could not start live session' }, { status: 500 });
  }
}
