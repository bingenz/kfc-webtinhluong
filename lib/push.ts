import type { SupabaseClient, User } from "@supabase/supabase-js";

function base64UrlBytes(value: string) {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  const raw = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export async function enablePush(client: SupabaseClient, user: User) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window))
    throw new Error("Trình duyệt này chưa hỗ trợ thông báo đẩy.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Bạn chưa cho phép gửi thông báo.");
  const response = await fetch("/api/push/public-key", { cache: "no-store" });
  const { key } = (await response.json()) as { key?: string };
  if (!key) throw new Error("Thông báo đẩy chưa được cấu hình trên máy chủ.");
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlBytes(key),
    }));
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth)
    throw new Error("Không thể tạo đăng ký thông báo cho thiết bị này.");
  await client.from("push_subscriptions").delete().eq("endpoint", json.endpoint);
  const { error } = await client.from("push_subscriptions").insert({
    endpoint: json.endpoint,
    user_id: user.id,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    content_encoding: "aes128gcm",
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function disablePush(client: SupabaseClient) {
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    await client.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
    await subscription.unsubscribe();
  }
}
