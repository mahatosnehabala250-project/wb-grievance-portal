export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/jwt';
import { runAssistant } from '@/lib/assistant/agent';
import { EVAL_SET } from '@/lib/assistant/eval-set';

/**
 * GET /api/assistant/eval?from=0&count=6 — run a slice of the eval set through the
 * REAL assistant with the caller's JWT (so it tests scope + tools + navigation),
 * and score each: did it call an expected tool / include required text / navigate
 * to the right page. Heavy (LLM calls) → admin/senior only, paged to fit maxDuration.
 */
export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    if (payload.role !== 'ADMIN' && payload.role_level !== 'MP' && payload.role_level !== 'MLA') {
      return NextResponse.json({ error: 'Eval is restricted to admin / senior roles' }, { status: 403 });
    }

    const url = new URL(request.url);
    const from = Math.max(0, Number(url.searchParams.get('from')) || 0);
    const count = Math.min(8, Math.max(1, Number(url.searchParams.get('count')) || 6));
    const origin = url.origin;
    const slice = EVAL_SET.slice(from, from + count);

    const results: Array<{ id: string; q: string; pass: boolean; toolOk: boolean; incOk: boolean; navOk: boolean; usedTools: string[]; navigate: string | null; answer: string }> = [];
    for (const t of slice) {
      let r;
      try { r = await runAssistant([{ role: 'user', content: t.q }], { payload, token, origin }); }
      catch { r = { answer: '', usedTools: [], proposedActions: [], navigate: undefined } as Awaited<ReturnType<typeof runAssistant>>; }
      const tools = r.usedTools || [];
      const ans = (r.answer || '').toLowerCase();
      const toolOk = !t.expectTool?.length || t.expectTool.some((x) => tools.includes(x));
      const incOk = !t.mustInclude?.length || t.mustInclude.every((s) => ans.includes(s.toLowerCase()));
      const navOk = !t.expectNavigate || r.navigate?.destination === t.expectNavigate;
      const responded = !!(r.answer || r.navigate || (r.proposedActions && r.proposedActions.length));
      const pass = toolOk && incOk && navOk && responded;
      results.push({ id: t.id, q: t.q, pass, toolOk, incOk, navOk, usedTools: tools, navigate: r.navigate?.destination || null, answer: (r.answer || '').slice(0, 180) });
    }
    const passed = results.filter((r) => r.pass).length;
    return NextResponse.json({ data: { from, count: slice.length, total: EVAL_SET.length, passed, results } });
  } catch (err) {
    console.error('eval error:', err);
    return NextResponse.json({ error: 'eval failed' }, { status: 500 });
  }
}
