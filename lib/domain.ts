import { z } from "zod";

export const ProviderSchema = z.enum(["x", "linkedin"]);
export type Provider = z.infer<typeof ProviderSchema>;

const XDestinationSchema = z.object({
  provider: z.literal("x"),
  text: z.string().trim().min(1).max(280),
});

const LinkedInDestinationSchema = z.object({
  provider: z.literal("linkedin"),
  text: z.string().trim().min(1).max(3000),
});

export const DestinationSchema = z.discriminatedUnion("provider", [
  XDestinationSchema,
  LinkedInDestinationSchema,
]);
export type Destination = z.infer<typeof DestinationSchema>;

export const PublishRequestSchema = z.object({
  destinations: z.array(DestinationSchema).min(1).max(2).superRefine((items, context) => {
    if (new Set(items.map((item) => item.provider)).size !== items.length) {
      context.addIssue({ code: "custom", message: "Choose each network once." });
    }
  }),
});
export type PublishRequest = z.infer<typeof PublishRequestSchema>;

export type DestinationResult =
  | { readonly kind: "published"; readonly provider: Provider; readonly postUrl: string }
  | { readonly kind: "failed"; readonly provider: Provider; readonly message: string; readonly reconnect: boolean };

export const DestinationResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("published"), provider: ProviderSchema, postUrl: z.string().url() }),
  z.object({ kind: z.literal("failed"), provider: ProviderSchema, message: z.string(), reconnect: z.boolean() }),
]);

export const PublishResponseSchema = z.object({
  results: z.array(DestinationResultSchema).min(1).max(2),
});

export const OAuthStateSchema = z.object({
  provider: ProviderSchema,
  state: z.string().min(24),
  codeVerifier: z.string().min(43),
  userId: z.string().min(1),
  expiresAt: z.number().int().positive(),
});

const ConnectionBaseSchema = z.object({
  accountId: z.string().min(1),
  accountName: z.string().min(1),
  accountHandle: z.string().nullable(),
  accessToken: z.string().min(1),
  refreshToken: z.string().nullable(),
  expiresAt: z.number().int().positive().nullable(),
});

export const ProviderConnectionSchema = z.discriminatedUnion("provider", [
  ConnectionBaseSchema.extend({ provider: z.literal("x") }),
  ConnectionBaseSchema.extend({ provider: z.literal("linkedin") }),
]);
export type ProviderConnection = z.infer<typeof ProviderConnectionSchema>;

export const ConnectionSummarySchema = z.object({
  provider: ProviderSchema,
  accountName: z.string(),
  accountHandle: z.string().nullable(),
});
export type ConnectionSummary = z.infer<typeof ConnectionSummarySchema>;
