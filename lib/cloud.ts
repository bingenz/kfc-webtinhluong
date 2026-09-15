import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Ledger } from "./payroll";
import { parseLedger } from "./ledger-schema";
let client: SupabaseClient | null = null;
export async function cloudClient() {
  if (client) return client;
  const response = await fetch("/api/config");
  if (!response.ok)
    throw new Error("Không tải được cấu hình kết nối. Hãy thử lại.");
  const config = (await response.json()) as { url?: string; key?: string };
  if (!config.url || !config.key) return null;
  client = createClient(config.url, config.key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return client;
}
export type Profile = {
  id: string;
  username: string;
  display_name: string;
  avatar_path?: string | null;
  cover_path?: string | null;
  bio?: string;
  job_title?: string;
  workplace?: string;
};
export type Friendship = {
  id: string;
  requester_id: string;
  recipient_id: string;
  status: "pending" | "accepted" | "declined";
  created_at: string;
  responded_at?: string | null;
};
export type FriendPermission = {
  owner_id: string;
  friend_id: string;
  view_schedule: boolean;
  view_forecast: boolean;
  view_payroll: boolean;
  updated_at: string;
};
export type DirectMessage = {
  id: string;
  friendship_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  deleted_at?: string | null;
  read_at?: string | null;
};
export type NotificationPreference = {
  user_id: string;
  messages: boolean;
  journal: boolean;
  social: boolean;
  preview: boolean;
  updated_at?: string;
};
export type NotificationEvent = {
  id: string;
  recipient_id: string;
  actor_id?: string | null;
  kind: "message" | "note" | "friend_request" | "friend_accepted" | "journal_post" | "journal_reaction" | "journal_comment";
  title: string;
  preview: string;
  friendship_id?: string | null;
  created_at: string;
  read_at?: string | null;
};
export type JournalPost = {
  id: string;
  friendship_id: string;
  author_id: string;
  caption: string;
  created_at: string;
  deleted_at?: string | null;
};
export function unicodeLength(value: string) {
  return Array.from(value).length;
}
export function assertUnicodeLength(
  value: string,
  maximum: number,
  label: string,
) {
  if (unicodeLength(value) > maximum) throw new Error(label + " quá dài.");
}
export async function signedMediaUrl(c: SupabaseClient, path: string) {
  const { data, error } = await c.storage
    .from("social-media")
    .createSignedUrl(path, 60 * 5);
  if (error) throw error;
  return data.signedUrl;
}
export async function uploadSocialImage(
  c: SupabaseClient,
  path: string,
  file: File,
) {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 5 * 1024 * 1024
  )
    throw new Error("Ảnh phải là JPEG, PNG hoặc WebP và không quá 5 MB.");
  const { error } = await c.storage
    .from("social-media")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return path;
}
export async function deleteSocialImage(c: SupabaseClient, path: string) {
  await c.storage.from("social-media").remove([path]);
}
export async function friendProjection(
  c: SupabaseClient,
  ownerId: string,
  level: "schedule" | "forecast" | "payroll",
) {
  const { data, error } = await c.rpc(
    level === "schedule"
      ? "get_friend_schedule"
      : level === "forecast"
        ? "get_friend_forecast"
        : "get_friend_payroll",
    { owner: ownerId },
  );
  if (error) throw error;
  return data as Record<string, unknown> | null;
}
export async function loadLedger(c: SupabaseClient, id: string) {
  const { data, error } = await c
    .from("ledgers")
    .select("payload,revision")
    .eq("owner_id", id)
    .maybeSingle();
  if (error) throw error;
  return data
    ? { payload: parseLedger(data.payload), revision: Number(data.revision) }
    : null;
}
export async function saveLedger(
  c: SupabaseClient,
  payload: Ledger,
  revision: number,
) {
  const { data, error } = await c.rpc("save_ledger", {
    document: payload,
    expected_revision: revision,
  });
  if (error) {
    if (error.message.includes("REVISION_CONFLICT"))
      throw new Error(
        "Dữ liệu đã thay đổi trên thiết bị khác. Tải lại trang trước khi lưu tiếp; thay đổi này chưa được lưu.",
      );
    throw error;
  }
  return Number(data);
}
