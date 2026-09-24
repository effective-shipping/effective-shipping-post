import { z } from "zod";

import { ProviderSchema, type DestinationResult, type Provider } from "./domain";

export const DRAFT_KEY = "es-post:draft";
export const DraftIdSchema = z.string().regex(/^[\w-]{24}$/u);
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

// What an agent sends to stage a post. `text` is the main post; `x` is an optional shorter X version.
// Limits are generous on purpose: the editor shows any overage so the person can trim before publishing.
export const StageDraftRequestSchema = z.object({
  text: z.string().trim().min(1).max(10_000),
  x: z.string().trim().min(1).max(10_000).optional(),
  providers: z.array(ProviderSchema).min(1).max(2).refine((items) => new Set(items).size === items.length, "Choose each network once.").default(["x", "linkedin"]),
});
export type StageDraftRequest = z.infer<typeof StageDraftRequestSchema>;

export function stagedDraft(request: StageDraftRequest): Draft {
  const draft = createDraft(request.text, request.providers);
  return request.x ? { ...draft, tailored: true, x: request.x } : draft;
}

export function draftHasText(draft: Draft): boolean {
  return [draft.shared, draft.x, draft.linkedin].some((text) => text.trim().length > 0);
}
