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

function countOf(text: string, character: string) {
  let count = 0;
  for (const c of text) if (c === character) count += 1;
  return count;
}

export default function Linkify({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    let url = match[0];

    // A closing paren the URL never opened belongs to the sentence around it
    // ("apple picking (see https://example.com/pick)"), as does any trailing
    // punctuation. Wikipedia-style URLs with their own parens still work.
    while (url.endsWith(")") && countOf(url, ")") > countOf(url, "(")) url = url.slice(0, -1);
    url = url.replace(TRAILING_PUNCTUATION, "");
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
