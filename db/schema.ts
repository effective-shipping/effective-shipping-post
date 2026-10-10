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

// Drafts an agent staged for review. The editor loads one by ID; publishing still happens only in the browser.
export const drafts = sqliteTable("drafts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  draft: text("draft").notNull(),
  createdAt: integer("created_at").notNull(),
  // Hash of the single-use ticket in the draft link; cleared when the link is first opened.
  ticketHash: text("ticket_hash"),
  ticketExpiresAt: integer("ticket_expires_at"),
});
