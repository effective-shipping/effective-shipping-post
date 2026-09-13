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
