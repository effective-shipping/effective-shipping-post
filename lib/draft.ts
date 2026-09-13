import { z } from "zod";

import type { DestinationResult, Provider } from "./domain";

export const DRAFT_KEY = "twofold:draft";
export const DraftSchema = z.object({
  shared: z.string(),
  x: z.string(),
  linkedin: z.string(),
  tailored: z.boolean(),
  selection: z.object({ x: z.boolean(), linkedin: z.boolean() }),
});
export type Draft = z.infer<typeof DraftSchema>;

export function createDraft(message = "", providers: ReadonlyArray<Provider> = ["x", "linkedin"]): Draft {
  return {
    shared: message,
    x: message,
    linkedin: message,
    tailored: false,
    selection: { x: providers.includes("x"), linkedin: providers.includes("linkedin") },
  };
}

export function applyDeliveryResults(draft: Draft, results: ReadonlyArray<DestinationResult>): Draft {
  const selection = { ...draft.selection };
  for (const result of results) {
    if (result.kind !== "failed") selection[result.provider] = false;
  }
  return { ...draft, selection };
}
