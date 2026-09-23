import { randomBase64Url } from "./crypto";
import { database } from "./database";
import { DraftSchema, type Draft } from "./draft";

export async function saveDraft(userId: string, draft: Draft): Promise<string> {
  const id = randomBase64Url(18);
  await database().prepare("INSERT INTO drafts (id, user_id, draft, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, userId, JSON.stringify(draft), Date.now())
    .run();
  return id;
}

export async function getDraft(userId: string, id: string): Promise<Draft | null> {
  const row = await database().prepare("SELECT draft FROM drafts WHERE user_id = ? AND id = ?")
    .bind(userId, id)
    .first<{ draft: string }>();
  return row ? DraftSchema.parse(JSON.parse(row.draft)) : null;
}
