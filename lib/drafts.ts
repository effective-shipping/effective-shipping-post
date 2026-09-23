import { randomBase64Url, sha256Base64Url } from "./crypto";
import { database } from "./database";
import { DraftSchema, type Draft } from "./draft";

// How long an agent's draft link can sign the browser in. After that, the link still opens the draft
// for a signed-in browser, but otherwise asks for the password.
const TICKET_LIFETIME_MS = 10 * 60 * 1000;

export async function saveDraft(userId: string, draft: Draft): Promise<{ readonly id: string; readonly ticket: string }> {
  const id = randomBase64Url(18);
  const ticket = randomBase64Url(32);
  await database().prepare("INSERT INTO drafts (id, user_id, draft, created_at, ticket_hash, ticket_expires_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, userId, JSON.stringify(draft), Date.now(), await sha256Base64Url(ticket), Date.now() + TICKET_LIFETIME_MS)
    .run();
  return { id, ticket };
}

export async function getDraft(userId: string, id: string): Promise<Draft | null> {
  const row = await database().prepare("SELECT draft FROM drafts WHERE user_id = ? AND id = ?")
    .bind(userId, id)
    .first<{ draft: string }>();
  return row ? DraftSchema.parse(JSON.parse(row.draft)) : null;
}

// Consumes the ticket in one statement, so two concurrent opens cannot both sign in.
export async function redeemTicket(id: string, ticket: string): Promise<string | null> {
  const row = await database().prepare(`
    UPDATE drafts SET ticket_hash = NULL, ticket_expires_at = NULL
    WHERE id = ? AND ticket_hash = ? AND ticket_expires_at > ?
    RETURNING user_id
  `).bind(id, await sha256Base64Url(ticket), Date.now()).first<{ user_id: string }>();
  return row?.user_id ?? null;
}
