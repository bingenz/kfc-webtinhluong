"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { Bell, BellOff, CheckCheck, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { enablePush, disablePush } from "@/lib/push";
import { errorMessage } from "@/lib/errors";
import type { NotificationEvent, NotificationPreference } from "@/lib/cloud";

const defaults: NotificationPreference = {
  user_id: "",
  messages: true,
  journal: true,
  social: true,
  preview: true,
};

export function NotificationPreferences({
  client,
  user,
}: {
  client: SupabaseClient | null;
  user: User | null;
}) {
  const [preference, setPreference] = useState<NotificationPreference>(defaults);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!client || !user) return;
    const { data, error } = await client
      .from("notification_preferences")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    setPreference({ ...defaults, user_id: user.id, ...(data || {}) });
    const registration = await navigator.serviceWorker?.getRegistration("/");
    setPushEnabled(Boolean(await registration?.pushManager.getSubscription()));
  }, [client, user]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => void refresh().catch((reason) => toast.error(errorMessage(reason))),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function savePreference(next: NotificationPreference) {
    if (!client || !user) return;
    setPreference(next);
    const { error } = await client
      .from("notification_preferences")
      .upsert({ ...next, user_id: user.id, updated_at: new Date().toISOString() });
    if (error) toast.error(errorMessage(error));
  }

  async function togglePush() {
    if (!client || !user) return;
    setBusy(true);
    try {
      if (pushEnabled) await disablePush(client);
      else await enablePush(client, user);
      await refresh();
      toast.success(pushEnabled ? "Đã tắt thông báo đẩy." : "Đã bật thông báo đẩy.");
    } catch (reason) {
      toast.error(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card card-pad notification-preferences">
      <h2>Thông báo</h2>
      {user ? (
        <>
          <p className="helper mt-2">Chỉ gửi thông báo cho hoạt động xã hội bạn đã chọn.</p>
          <button className="btn mt-4" disabled={busy} onClick={() => void togglePush()}>
            {pushEnabled ? <BellOff size={16} /> : <Bell size={16} />}
            {pushEnabled ? "Tắt push trên thiết bị này" : "Bật push trên thiết bị này"}
          </button>
          <div className="notification-settings mt-3">
            {([
              ["messages", "Tin nhắn"],
              ["journal", "Nhật ký"],
              ["social", "Kết bạn & ghi chú"],
              ["preview", "Hiện xem trước trên màn hình khóa"],
            ] as const).map(([key, label]) => (
              <label className="checkrow" key={key}>
                <input
                  type="checkbox"
                  checked={preference[key]}
                  onChange={(event) =>
                    void savePreference({ ...preference, [key]: event.target.checked })
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </>
      ) : (
        <p className="helper mt-2">Đăng nhập để quản lý thông báo trên thiết bị này.</p>
      )}
    </section>
  );
}

export default function SocialNotifications({
  client,
  user,
  onOpenFriends,
}: {
  client: SupabaseClient | null;
  user: User | null;
  onOpenFriends: (friendshipId?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<NotificationEvent[]>([]);
  const [preference, setPreference] = useState<NotificationPreference>(defaults);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!client || !user) return;
    const [{ data: activity, error }, { data: preferences }] = await Promise.all([
      client
        .from("notification_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(12),
      client
        .from("notification_preferences")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);
    if (error) throw error;
    setEvents((activity || []) as NotificationEvent[]);
    setPreference({ ...defaults, user_id: user.id, ...(preferences || {}) });
    const registration = await navigator.serviceWorker?.getRegistration("/");
    setPushEnabled(Boolean(await registration?.pushManager.getSubscription()));
  }, [client, user]);

  useEffect(() => {
    void refresh().catch((error) => toast.error(errorMessage(error)));
  }, [refresh]);
  useEffect(() => {
    if (!client || !user) return;
    let channel: ReturnType<SupabaseClient["channel"]> | undefined;
    const connect = () => {
      if (document.visibilityState !== "visible" || channel) return;
      channel = client
        .channel("notifications:" + user.id)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notification_events", filter: "recipient_id=eq." + user.id },
          () => void refresh(),
        )
        .subscribe();
    };
    const disconnect = () => {
      if (channel) void client.removeChannel(channel);
      channel = undefined;
    };
    const visibility = () => {
      if (document.visibilityState === "visible") {
        void refresh();
        connect();
      } else disconnect();
    };
    const workerMessage = () => void refresh();
    connect();
    document.addEventListener("visibilitychange", visibility);
    navigator.serviceWorker?.addEventListener("message", workerMessage);
    return () => {
      disconnect();
      document.removeEventListener("visibilitychange", visibility);
      navigator.serviceWorker?.removeEventListener("message", workerMessage);
    };
  }, [client, refresh, user]);

  const unread = events.filter((event) => !event.read_at).length;
  async function markRead(ids?: string[]) {
    if (!client || !ids?.length) return;
    const { error } = await client
      .from("notification_events")
      .update({ read_at: new Date().toISOString() })
      .in("id", ids);
    if (!error) await refresh();
  }
  async function savePreference(next: NotificationPreference) {
    if (!client || !user) return;
    setPreference(next);
    const { error } = await client.from("notification_preferences").upsert({ ...next, user_id: user.id, updated_at: new Date().toISOString() });
    if (error) toast.error(errorMessage(error));
  }
  async function togglePush() {
    if (!client || !user) return;
    setBusy(true);
    try {
      if (pushEnabled) await disablePush(client);
      else await enablePush(client, user);
      await refresh();
      toast.success(pushEnabled ? "Đã tắt thông báo đẩy." : "Đã bật thông báo đẩy.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  if (!user) return null;
  return (
    <div className="notification-menu">
      <button className="btn icon notification-trigger" aria-label="Thông báo" title="Thông báo" onClick={() => setOpen((current) => !current)}>
        <Bell size={18} />
        {unread > 0 && <span className="notification-badge">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <section className="notification-popover card" aria-label="Thông báo">
          <div className="section-head">
            <h2>Thông báo</h2>
            <div className="row-actions">
              <button className="btn ghost icon" aria-label="Cài đặt thông báo" title="Cài đặt thông báo" onClick={() => setSettings((value) => !value)}><Settings2 size={16} /></button>
              <button className="btn ghost icon" aria-label="Đánh dấu đã đọc" title="Đánh dấu đã đọc" onClick={() => void markRead(events.filter((event) => !event.read_at).map((event) => event.id))}><CheckCheck size={16} /></button>
            </div>
          </div>
          {settings ? (
            <div className="notification-settings">
              <button className="btn" disabled={busy} onClick={() => void togglePush()}>{pushEnabled ? <BellOff size={16} /> : <Bell size={16} />}{pushEnabled ? "Tắt push trên thiết bị này" : "Bật push trên thiết bị này"}</button>
              {([ ["messages", "Tin nhắn"], ["journal", "Nhật ký"], ["social", "Kết bạn & ghi chú"], ["preview", "Hiện xem trước trên màn hình khóa"] ] as const).map(([key, label]) => (
                <label className="checkrow" key={key}><input type="checkbox" checked={preference[key]} onChange={(event) => void savePreference({ ...preference, [key]: event.target.checked })} />{label}</label>
              ))}
            </div>
          ) : events.length ? (
            <div className="notification-list">
              {events.map((event) => (
                <button className={"notification-item " + (!event.read_at ? "unread" : "")} key={event.id} onClick={() => { void markRead([event.id]); setOpen(false); onOpenFriends(event.friendship_id || undefined); }}>
                  <strong>{event.title}</strong>
                  {event.preview && <span>{event.preview}</span>}
                  <small>{new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(event.created_at))}</small>
                </button>
              ))}
            </div>
          ) : <p className="helper">Chưa có hoạt động mới.</p>}
        </section>
      )}
    </div>
  );
}
