#!/usr/bin/env node
/**
 * Assistant eval runner (CLI). Signs an ADMIN JWT and runs the eval set through
 * the deployed /api/assistant/eval endpoint, printing a scored table.
 *
 * Usage:
 *   JWT_SECRET=<prod-secret> node scripts/eval-assistant.mjs
 *   JWT_SECRET=<secret> EVAL_URL=https://your-app.vercel.app node scripts/eval-assistant.mjs
 *
 * JWT_SECRET must match the deployment's JWT_SECRET (it's not in .env — copy it
 * from Vercel env). The endpoint itself does the scoring with the same scope as a
 * logged-in ADMIN, so this just paginates and prints.
 */
import { SignJWT } from 'jose';

const BASE = process.env.EVAL_URL || 'https://wb-grievance-portal.vercel.app';
const SECRET = process.env.JWT_SECRET;
if (!SECRET) { console.error('❌ Set JWT_SECRET (from Vercel env). Example: JWT_SECRET=xxx node scripts/eval-assistant.mjs'); process.exit(1); }

const token = await new SignJWT({ userId: 'eval-admin', username: 'eval', role: 'ADMIN', name: 'Eval Admin', block: '', district: null })
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
  .sign(new TextEncoder().encode(SECRET));

const all = [];
let from = 0, total = Infinity;
const COUNT = 6;
console.log(`Running eval against ${BASE} …\n`);
while (from < total) {
  const res = await fetch(`${BASE}/api/assistant/eval?from=${from}&count=${COUNT}`, { headers: { Authorization: `Bearer ${token}` } });
  const j = await res.json();
  if (!res.ok || !j.data) { console.error('Request failed:', res.status, j.error || ''); process.exit(1); }
  total = j.data.total;
  for (const r of j.data.results) {
    all.push(r);
    const tag = r.pass ? '✅ PASS' : '❌ FAIL';
    const reasons = [!r.toolOk && 'tool', !r.incOk && 'text', !r.navOk && 'nav'].filter(Boolean).join('+');
    console.log(`${tag}  ${r.q}`);
    console.log(`        tools=[${r.usedTools.join(', ')}]${r.navigate ? ` nav=${r.navigate}` : ''}${reasons ? `  ✗${reasons}` : ''}`);
    console.log(`        → ${r.answer.replace(/\n/g, ' ')}\n`);
  }
  from += COUNT;
}
const passed = all.filter((r) => r.pass).length;
console.log(`\n━━━ ${passed}/${all.length} passed (${Math.round((passed / all.length) * 100)}%) ━━━`);
process.exit(passed === all.length ? 0 : 1);
