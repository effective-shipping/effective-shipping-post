import twitterText from "twitter-text";

import type { Provider } from "./domain";

export const POST_LIMITS = { x: 280, linkedin: 3000 } satisfies Record<Provider, number>;

export function countPostCharacters(provider: Provider, value: string): number {
  const text = value.trim();
  return provider === "x" ? twitterText.parseTweet(text).weightedLength : text.length;
}

export function postTextIsValid(provider: Provider, value: string): boolean {
  const text = value.trim();
  return provider === "x"
    ? twitterText.parseTweet(text).valid
    : text.length > 0 && text.length <= POST_LIMITS.linkedin;
}

export function linkedInPlainText(value: string): string {
  return value.replace(/[|{}@\[\]()<>#\\*_~]/gu, "\\$&");
}

export type PreviewSegment = { readonly kind: "text" | "entity"; readonly value: string };

// Marks the text each network turns into links. LinkedIn receives mentions and hashtags as literal text.
export function previewSegments(provider: Provider, value: string): ReadonlyArray<PreviewSegment> {
  const text = value.trim();
  const entities = provider === "x" ? twitterText.extractEntitiesWithIndices(text) : twitterText.extractUrlsWithIndices(text);
  const segments: PreviewSegment[] = [];
  let cursor = 0;
  for (const { indices: [start, end] } of entities) {
    if (start > cursor) segments.push({ kind: "text", value: text.slice(cursor, start) });
    segments.push({ kind: "entity", value: text.slice(start, end) });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ kind: "text", value: text.slice(cursor) });
  return segments;
}
