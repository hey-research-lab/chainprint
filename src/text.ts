/**
 * What chainprint prints from a file: the matched line only, cleaned,
 * redacted and cut to a window around the match. Nothing else of a file's
 * contents ever reaches the output.
 */

export const EXCERPT_MAX_CHARS = 120;
const WINDOW_BEFORE = 40;

// C0/C1 controls (tab and newline are folded to a space first) and bidi/zero-width marks.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
const BIDI_AND_INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/** Strip control, bidi and zero-width characters; fold whitespace. Safe for a terminal. */
export function cleanText(value: string): string {
  return value
    .replace(/[\t\r\n]/g, ' ')
    .replace(CONTROL, '')
    .replace(BIDI_AND_INVISIBLE, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const REDACTED = '<redacted>';

/**
 * Remove what could be a credential from a line before any of it is printed:
 * URL user-info, URL query strings, long opaque tokens and long hex strings
 * (private keys, hashes). Short public markers (hostnames, chain ids, 40-hex
 * addresses) are left intact.
 */
export function redactLine(line: string): string {
  return (
    line
      // scheme://user:pass@host → scheme://<redacted>@host
      .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@'"`]+@/gi, `$1${REDACTED}@`)
      // query strings
      .replace(/(\bhttps?:\/\/[^\s'"`?#]*)\?[^\s'"`#]*/gi, `$1?${REDACTED}`)
      // 0x followed by 64 or more hex digits (private keys, hashes, bytecode)
      .replace(/(?<![0-9a-zA-Z])0x[0-9a-fA-F]{64,}(?![0-9a-zA-Z])/g, `0x${REDACTED}`)
      // long opaque tokens that mix letters and digits (API keys)
      .replace(
        /(?<![A-Za-z0-9_-])(?!0x[0-9a-fA-F]{40}(?![A-Za-z0-9_-]))(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/g,
        REDACTED,
      )
  );
}

/**
 * The printable excerpt for a match: the line redacted and cleaned, then cut
 * to at most `EXCERPT_MAX_CHARS` characters around the matched text.
 */
export function excerpt(line: string, matched: string): string {
  const cleaned = cleanText(redactLine(line));
  if (cleaned.length <= EXCERPT_MAX_CHARS) return cleaned;
  const at = Math.max(0, cleaned.toLowerCase().indexOf(matched.toLowerCase()));
  const start = Math.max(0, at - WINDOW_BEFORE);
  const end = Math.min(cleaned.length, start + EXCERPT_MAX_CHARS);
  return `${start > 0 ? '…' : ''}${cleaned.slice(start, end)}${end < cleaned.length ? '…' : ''}`;
}

/** A path or name from the tree, safe to print. */
export const cleanPath = (value: string): string =>
  value
    .replace(CONTROL, '?')
    .replace(/[\t\r\n]/g, '?')
    .replace(BIDI_AND_INVISIBLE, '?');
