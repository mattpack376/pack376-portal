import type { ReactNode } from "react";

/**
 * Renders admin-entered plain text with any bare URL in it turned into a
 * link — e.g. a schedule note that ends in a pasted sign-up link.
 *
 * Only http/https (and a bare `www.` host, which gets https://) are matched,
 * so a pasted `javascript:` or `data:` URL stays inert text, and the text is
 * rendered as React children rather than HTML, so nothing in it can inject
 * markup.
 */
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>]+/gi;
/** Sentence punctuation the admin typed after the URL, not part of it. */
const TRAILING_PUNCTUATION = /[.,;:!?'"]+$/;

/** Brackets a URL can legitimately contain, paired with their openers. */
const CLOSING_BRACKETS: Record<string, string> = { ")": "(", "]": "[" };

function countOf(text: string, character: string) {
  let count = 0;
  for (const c of text) if (c === character) count += 1;
  return count;
}

/**
 * Strips what the surrounding sentence contributed to a matched URL: trailing
 * punctuation, and closing brackets the URL never opened. Both are trimmed
 * until the URL stops changing, since they interleave — "(recipe:
 * www.example.org/pancakes)." ends in a paren *and* a period. A URL carrying
 * its own balanced parens (Wikipedia-style) is left whole.
 */
function trimSentencePunctuation(url: string) {
  for (;;) {
    const trimmed = url.replace(TRAILING_PUNCTUATION, "");
    const opener = CLOSING_BRACKETS[trimmed.slice(-1)];
    const unbalanced = opener !== undefined && countOf(trimmed, trimmed.slice(-1)) > countOf(trimmed, opener);
    const next = unbalanced ? trimmed.slice(0, -1) : trimmed;
    if (next === url) return next;
    url = next;
  }
}

export default function Linkify({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    let url = match[0];

    url = trimSentencePunctuation(url);
    if (!url) continue;

    if (start > cursor) nodes.push(text.slice(cursor, start));
    nodes.push(
      <a
        key={start}
        href={url.toLowerCase().startsWith("www.") ? `https://${url}` : url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-link"
      >
        {url}
      </a>,
    );
    cursor = start + url.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));

  return <>{nodes}</>;
}
