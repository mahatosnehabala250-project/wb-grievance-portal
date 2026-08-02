/**
 * Make a user's search box safe to paste into a PostgREST `or=(...)` filter.
 *
 * The filter is assembled as a string — `name.ilike.%term%,phone.ilike.%term%` —
 * so a term containing a comma, a bracket or a dot is read as filter grammar
 * rather than as text. A search for "Roy, Bikash" silently becomes two
 * conditions; a stray `)` produces a malformed filter and a 500.
 *
 * The scope filter is applied separately and ANDed, so this was never a way out
 * of a jurisdiction. What it did allow was querying columns the endpoint never
 * meant to expose, and turning a search box into an error generator.
 *
 * Rather than escape the grammar — easy to get subtly wrong — this strips the
 * characters that carry meaning in it. Users lose nothing: none of them are
 * useful inside a name, a village or a ticket number.
 */

/** Characters that mean something to PostgREST inside an or() group. */
const FILTER_SYNTAX = /[(),.*:"'\\]/g;

/** Longer than any real name, village or ticket; keeps the URL bounded too. */
const MAX_LEN = 80;

export function safeSearchTerm(raw: string | null | undefined): string {
  return String(raw ?? '')
    .replace(FILTER_SYNTAX, ' ')
    .replace(/%/g, '')        // the caller supplies the wildcards, not the user
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LEN);
}
