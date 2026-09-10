import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const connections = sqliteTable(
  "connections",
  {
    userId: text("user_id").notNull(),
    provider: text("provider", { enum: ["x", "linkedin"] }).notNull(),
    accountId: text("account_id").notNull(),
    accountName: text("account_name").notNull(),
    accountHandle: text("account_handle"),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    expiresAt: integer("expires_at"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.provider] })],
);
