import { DEFAULT_MAX_CHARS } from '@/lib/guardrail/rules';

/**
 * Invite a citizen onto Telegram at the one moment the office can reach them.
 *
 * WhatsApp only permits free-form messages inside 24 hours of the citizen's own
 * message — every one of the 22 outbound messages this system has ever sent was
 * inside that window, and none outside it. So the acknowledgement is the single
 * guaranteed opportunity to reach a person, and after it closes the office has
 * no channel at all: today, of 41 households in the Purulia seat, zero are
 * reachable.
 *
 * Telegram has no such window. One tap on a deep link and that household stays
 * reachable permanently — JS-12 resolves the ticket to a phone and writes the
 * link itself, so nothing else is required of the citizen.
 *
 * This is appended AFTER the guardrail runs, deliberately:
 *   - the URL allowlist does not include t.me, so a link added before the check
 *     would be stripped;
 *   - the model cannot be trusted to reproduce a URL exactly every time, and a
 *     mangled link is worse than none.
 */

/**
 * Two shapes, and the difference matters.
 *
 * JS-12 resolves a ticket to a phone with `WB-\d{2}-[A-Z]{3}-\d{6}` and nothing
 * else. A link carrying anything outside that — a seeded WB-DEMO-E454084A, say,
 * which is 37 of the 42 complaints in this constituency — opens the bot and then
 * silently does nothing, which is the worst outcome available.
 *
 * So a link is only ticketed when JS-12 will actually accept it. Anything else
 * falls back to the plain bot link, where the contact-share button still links
 * the citizen.
 */
const STRICT_TICKET_RE = /\bWB-\d{2}-[A-Z]{3}-\d{6}\b/;
const LOOSE_TICKET_RE = /\bWB-[A-Z0-9]+-[A-Z0-9-]+\b/;

/** Telegram's /start payload accepts [A-Za-z0-9_-] only, up to 64 characters. */
const START_PAYLOAD_RE = /^[A-Za-z0-9_-]{1,64}$/;

type Lang = 'bn' | 'hi' | 'en';

const INVITE_LINE: Record<Lang, string> = {
  bn: 'অগ্রগতি জানতে Telegram-এ যুক্ত হন:',
  hi: 'प्रगति जानने के लिए Telegram से जुड़ें:',
  en: 'Follow this complaint on Telegram:',
};

export function botUsername(): string | null {
  return process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || null;
}

/** The deep link that links a citizen by their own ticket number. */
export function citizenDeepLink(ticket: string): string | null {
  const bot = botUsername();
  if (!bot || !START_PAYLOAD_RE.test(ticket)) return null;
  return `https://t.me/${bot}?start=${ticket}`;
}

/**
 * Append the invite when the reply carries a ticket number and the citizen is
 * not already on Telegram.
 *
 * Returns the text unchanged whenever anything is missing — a reply must never
 * fail to send because an optional invite could not be built.
 */
export function withTelegramInvite(
  reply: string,
  language: Lang = 'bn',
  opts: { alreadyLinked?: boolean; maxChars?: number } = {}
): string {
  const text = String(reply || '');
  if (opts.alreadyLinked) return text;
  if (/t\.me\//i.test(text)) return text;          // already invited in this reply

  // Ticketed only when JS-12 will accept the payload; a ticket it cannot parse
  // still earns the plain bot link, where the contact-share button links them.
  const strict = text.match(STRICT_TICKET_RE)?.[0];
  const loose = strict || text.match(LOOSE_TICKET_RE)?.[0];
  if (!loose) return text;                          // no complaint context at all

  const bot = botUsername();
  const link = strict ? citizenDeepLink(strict) : (bot ? `https://t.me/${bot}` : null);
  if (!link) return text;

  const suffix = `\n\n${INVITE_LINE[language] || INVITE_LINE.bn}\n${link}`;

  // The length cap has already been applied upstream, so adding to it could
  // push the reply past the limit. Skip rather than truncate: a half-written
  // URL is worse than no invitation.
  const cap = opts.maxChars ?? DEFAULT_MAX_CHARS;
  if (text.length + suffix.length > cap) return text;

  return text + suffix;
}
