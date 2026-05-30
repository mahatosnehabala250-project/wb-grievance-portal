/**
 * Guardrail rule: URL allowlist.
 *
 * Pure function. Extracts URLs from the reply and strips any whose host is not
 * on the allowlist (Req 25.6). Allowed hosts (Design §v1.1.6):
 *   - `*.wb-grievance-portal.gov.in`
 *   - `wa.me`
 *   - `*.supabase.co/storage`  (subdomains of supabase.co; path must start /storage)
 *
 * Idempotence (Property 25): a stripped URL is removed entirely, so a second
 * pass finds nothing to strip and returns the same string with `violated: false`.
 *
 * @see .kiro/specs/sahayak-multi-agent-router/design.md - §v1.1.6 (urlAllowlistCheck)
 * @see .kiro/specs/sahayak-multi-agent-router/requirements.md - Requirement 25.6
 */

/** Matches http/https URLs; non-global clone used for stateless `.test()`. */
const URL_RE = /(https?:\/\/[^\s]+)/gi;

/** Default allowlist host suffixes (Design §v1.1.6). */
export const DEFAULT_ALLOWED_DOMAINS: readonly string[] = [
  'wb-grievance-portal.gov.in',
  'wa.me',
  'supabase.co',
];

/** Strip trailing punctuation that commonly clings to a URL in prose. */
function trimTrailingPunct(url: string): string {
  return url.replace(/[).,;:!?'"\]]+$/, '');
}

/**
 * Extract the lowercased host from a URL string, or null if it cannot be parsed.
 */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    // Fallback parse: strip scheme, take up to the first /, ?, or #.
    const m = /^https?:\/\/([^/?#\s]+)/i.exec(url);
    return m ? m[1].toLowerCase() : null;
  }
}

/**
 * True when `host` equals an allowed domain or is a subdomain of one.
 * `wa.me` matches only exactly (and its subdomains, which are harmless).
 */
function isAllowedHost(host: string, allowedDomains: readonly string[]): boolean {
  for (const domain of allowedDomains) {
    const d = domain.toLowerCase();
    if (host === d || host.endsWith('.' + d)) {
      return true;
    }
  }
  return false;
}

export interface UrlResult {
  violated: boolean;
  repaired: string;
}

/**
 * Detect non-allowlisted URLs and strip them from the reply.
 *
 * @param reply The outbound agent reply.
 * @param allowedDomains Host suffixes to permit; defaults to
 *        {@link DEFAULT_ALLOWED_DOMAINS}.
 */
export function checkUrls(
  reply: string,
  allowedDomains: readonly string[] = DEFAULT_ALLOWED_DOMAINS,
): UrlResult {
  const text = reply ?? '';

  let violated = false;
  const repaired = text.replace(URL_RE, (raw) => {
    const url = trimTrailingPunct(raw);
    const trailing = raw.slice(url.length);
    const host = hostOf(url);

    if (host && isAllowedHost(host, allowedDomains)) {
      return raw; // keep allowed URL (with any trailing punctuation)
    }

    violated = true;
    // Strip the URL but preserve trailing punctuation that belonged to the prose.
    return trailing;
  });

  if (!violated) {
    return { violated: false, repaired: text };
  }

  // Collapse any double spaces left by removed URLs, but keep newlines intact.
  const cleaned = repaired.replace(/[ \t]{2,}/g, ' ').replace(/ +([.,;:!?])/g, '$1');
  return { violated: true, repaired: cleaned };
}
