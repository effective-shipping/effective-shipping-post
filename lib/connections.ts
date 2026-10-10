import { openText, sealText } from "./crypto";
import { database } from "./database";
import {
  ConnectionSummarySchema,
  ProviderConnectionSchema,
  type ConnectionSummary,
  type Provider,
  type ProviderConnection,
} from "./domain";

type ConnectionRow = {
  provider: string;
  account_id: string;
  account_name: string;
  account_handle: string | null;
  access_token: string;
  refresh_token: string | null;
  expires_at: number | null;
};

export async function saveConnection(userId: string, connection: ProviderConnection): Promise<void> {
  const accessToken = await sealText(connection.accessToken);
  const refreshToken = connection.refreshToken ? await sealText(connection.refreshToken) : null;
  await database().prepare(`
    INSERT INTO connections (
      user_id, provider, account_id, account_name, account_handle,
      access_token, refresh_token, expires_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, provider) DO UPDATE SET
      account_id = excluded.account_id,
      account_name = excluded.account_name,
      account_handle = excluded.account_handle,
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  `).bind(
    userId,
    connection.provider,
    connection.accountId,
    connection.accountName,
    connection.accountHandle,
    accessToken,
    refreshToken,
    connection.expiresAt,
    Date.now(),
  ).run();
}

export async function getConnection(userId: string, provider: Provider): Promise<ProviderConnection | null> {
  const row = await database().prepare(`
    SELECT provider, account_id, account_name, account_handle,
           access_token, refresh_token, expires_at
    FROM connections
    WHERE user_id = ? AND provider = ?
  `).bind(userId, provider).first<ConnectionRow>();
  if (!row) return null;

  return ProviderConnectionSchema.parse({
    provider: row.provider,
    accountId: row.account_id,
    accountName: row.account_name,
    accountHandle: row.account_handle,
    accessToken: await openText(row.access_token),
    refreshToken: row.refresh_token ? await openText(row.refresh_token) : null,
    expiresAt: row.expires_at,
  });
}

export async function listConnections(userId: string): Promise<ReadonlyArray<ConnectionSummary>> {
  const result = await database().prepare(`
    SELECT provider, account_name, account_handle
    FROM connections
    WHERE user_id = ?
    ORDER BY provider
  `).bind(userId).all<{ provider: string; account_name: string; account_handle: string | null }>();

  return result.results.map((row) => ConnectionSummarySchema.parse({
    provider: row.provider,
    accountName: row.account_name,
    accountHandle: row.account_handle,
  }));
}

export async function deleteConnection(userId: string, provider: Provider): Promise<void> {
  await database().prepare("DELETE FROM connections WHERE user_id = ? AND provider = ?").bind(userId, provider).run();
}

