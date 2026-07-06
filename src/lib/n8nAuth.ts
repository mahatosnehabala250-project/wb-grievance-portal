import { NextRequest } from 'next/server';
import { getTokenFromRequest, verifyToken } from '@/lib/jwt';

/**
 * Machine-to-machine auth for n8n / automation endpoints.
 *
 * The intended contract (already used by /api/n8n/complaints) is:
 *   header  X-N8N-SECRET  ===  process.env.N8N_WEBHOOK_SECRET
 * Fail-closed: if the env secret is unset, nothing is allowed.
 *
 * Several n8n/ai routes historically shipped with NO gate at all (anyone on the
 * internet could bulk-mutate complaints, burn LLM quota, spam SMS). These helpers
 * close that hole. NOTE: n8n HTTP-Request nodes calling the guarded routes must
 * now send the X-N8N-SECRET header (same value they already send to
 * /api/n8n/complaints) or the call will 401.
 */

export function n8nSecretOk(request: NextRequest): boolean {
  const secret = request.headers.get('x-n8n-secret');
  return !!process.env.N8N_WEBHOOK_SECRET && secret === process.env.N8N_WEBHOOK_SECRET;
}

/** Allow if a valid user JWT is present OR the n8n shared secret matches.
 *  Used for routes that are hit BOTH by the logged-in app and by n8n
 *  (e.g. the AI helper endpoints — expensive, must not be anonymous). */
export async function isAuthedOrN8n(request: NextRequest): Promise<boolean> {
  if (n8nSecretOk(request)) return true;
  const token = getTokenFromRequest(request);
  if (!token) return false;
  return !!(await verifyToken(token));
}
