import { z } from "zod";

import { postTextIsValid } from "./text";

export const ProviderSchema = z.enum(["x", "linkedin"]);
export type Provider = z.infer<typeof ProviderSchema>;

const XDestinationSchema = z.object({
  provider: z.literal("x"),
  text: z.string().trim().min(1).refine((text) => postTextIsValid("x", text), "X text is invalid or over its character limit."),
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

export const DestinationResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("published"), provider: ProviderSchema, postUrl: z.string().url() }),
  z.object({ kind: z.literal("failed"), provider: ProviderSchema, message: z.string(), reconnect: z.boolean() }),
  z.object({ kind: z.literal("uncertain"), provider: ProviderSchema, message: z.string() }),
]);
export type DestinationResult = z.infer<typeof DestinationResultSchema>;

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

// Each network is either connected, ready to connect, or missing its app credentials.
export const AccountSchema = z.discriminatedUnion("status", [
  ConnectionSummarySchema.extend({ status: z.literal("connected") }),
  z.object({ status: z.literal("disconnected"), provider: ProviderSchema }),
  z.object({ status: z.literal("unconfigured"), provider: ProviderSchema, callbackUrl: z.string().url() }),
]);
export type Account = z.infer<typeof AccountSchema>;
