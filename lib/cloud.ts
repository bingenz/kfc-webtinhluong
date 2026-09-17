import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Ledger } from "./payroll";
import { parseLedger } from "./ledger-schema";

let client: SupabaseClient | null = null;

export async function cloudClient() {
  if (client) return client;
  const response = await fetch("/api/config");
  if (!response.ok) throw new Error("Không tải được cấu hình kết nối. Hãy thử lại.");
  const config = (await response.json()) as { url?: string; key?: string };
  if (!config.url || !config.key) return null;
  client = createClient(config.url, config.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

export type Profile = {
  id: string;
  username: string;
  display_name: string;
  created_at?: string;
  updated_at?: string;
};

export type ShareIdentity = {
  share_code: string;
  created_at: string;
  rotated_at: string | null;
};

export type ShareGrant = {
  owner_id: string;
  viewer_id: string;
  display_name: string;
  created_at: string;
};

export async function loadLedger(c: SupabaseClient, id: string, signal?: AbortSignal) {
  let query = c.from("ledgers").select("payload,revision").eq("owner_id", id).maybeSingle();
  if (signal) query = (query as unknown as { abortSignal: (s: AbortSignal) => typeof query }).abortSignal(signal);
  const { data, error } = await query;
  if (error) throw error;
  return data ? { payload: parseLedger(data.payload), revision: Number(data.revision) } : null;
}

export async function saveLedger(
  c: SupabaseClient,
  payload: Ledger,
  revision: number,
  signal?: AbortSignal,
) {
  let query = c.rpc("save_ledger", { document: payload, expected_revision: revision });
  if (signal) query = (query as unknown as { abortSignal: (s: AbortSignal) => typeof query }).abortSignal(signal);
  const { data, error } = await query;
  if (error) {
    if (error.message.includes("REVISION_CONFLICT")) {
      throw new Error("Dữ liệu đã thay đổi trên thiết bị khác. Hãy tải lại dữ liệu tài khoản trước khi lưu tiếp.");
    }
    throw error;
  }
  return Number(data);
}

export async function ensureShareIdentity(c: SupabaseClient) {
  const { data, error } = await c.rpc("ensure_share_identity");
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as ShareIdentity;
}

export async function rotateShareCode(c: SupabaseClient) {
  const { data, error } = await c.rpc("rotate_share_code");
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as ShareIdentity;
}

export async function redeemShareCode(c: SupabaseClient, code: string) {
  const { data, error } = await c.rpc("redeem_share_code", { code });
  if (error) {
    if (error.message.includes("INVALID_SHARE_CODE")) throw new Error("Mã chia sẻ không hợp lệ hoặc đã được đổi.");
    if (error.message.includes("CANNOT_SHARE_WITH_SELF")) throw new Error("Bạn không thể nhập mã chia sẻ của chính mình.");
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row as { owner_id: string; display_name: string };
}

export async function listMyViewers(c: SupabaseClient) {
  const { data, error } = await c.rpc("my_share_viewers");
  if (error) throw error;
  return (data || []) as ShareGrant[];
}

export async function listSharedWithMe(c: SupabaseClient) {
  const { data, error } = await c.rpc("shared_with_me");
  if (error) throw error;
  return (data || []) as ShareGrant[];
}

export async function revokeShare(c: SupabaseClient, viewerId: string) {
  const { error } = await c.rpc("revoke_share_grant", { viewer: viewerId });
  if (error) throw error;
}
