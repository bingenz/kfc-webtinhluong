import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

type WebhookBody = { record?: { id?: string } };
type Activity = {
  id: string;
  recipient_id: string;
  kind: "message" | "note" | "friend_request" | "friend_accepted" | "journal_post" | "journal_reaction" | "journal_comment";
  title: string;
  preview: string;
  friendship_id: string | null;
};
type Preference = { messages: boolean; journal: boolean; social: boolean; preview: boolean };
type Subscription = { endpoint: string; keys: { p256dh: string; auth: string }; content_encoding: "aes128gcm" | "aesgcm" };

function eventEnabled(activity: Activity, preference: Preference | null) {
  if (!preference) return true;
  if (activity.kind === "message") return preference.messages;
  if (activity.kind.startsWith("journal_")) return preference.journal;
  return preference.social;
}

function activityUrl(activity: Activity) {
  if (activity.kind === "message" && activity.friendship_id)
    return "/?tab=friends&conversation=" + encodeURIComponent(activity.friendship_id);
  return "/?tab=friends";
}

export async function POST(request: Request) {
  const secret = process.env.SUPABASE_WEBHOOK_SECRET || "";
  if (!secret || request.headers.get("x-ca-lam-webhook-secret") !== secret)
    return new Response("Unauthorized", { status: 401 });

  const url = process.env.SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const publicKey = process.env.VAPID_PUBLIC_KEY || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY || "";
  if (!url || !serviceKey || !publicKey || !privateKey)
    return new Response("Push delivery is not configured.", { status: 503 });

  const body = (await request.json()) as WebhookBody;
  const id = body.record?.id;
  if (!id) return new Response("Missing notification record.", { status: 400 });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: activity, error } = await admin
    .from("notification_events")
    .select("id,recipient_id,kind,title,preview,friendship_id")
    .eq("id", id)
    .maybeSingle();
  if (error) return new Response(error.message, { status: 500 });
  if (!activity) return new Response(null, { status: 204 });

  const { data: preference } = await admin
    .from("notification_preferences")
    .select("messages,journal,social,preview")
    .eq("user_id", activity.recipient_id)
    .maybeSingle();
  if (!eventEnabled(activity as Activity, preference as Preference | null))
    return new Response(null, { status: 204 });

  const { data: subscriptions, error: subscriptionsError } = await admin
    .from("push_subscriptions")
    .select("endpoint,keys,content_encoding")
    .eq("user_id", activity.recipient_id);
  if (subscriptionsError) return new Response(subscriptionsError.message, { status: 500 });

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@example.com",
    publicKey,
    privateKey,
  );
  const preview = preference?.preview === false ? "Bạn có hoạt động mới" : activity.preview;
  const payload = JSON.stringify({
    title: activity.title,
    body: preview,
    tag: "ca-lam:" + activity.id,
    data: { url: activityUrl(activity as Activity), activityId: activity.id },
  });
  let delivered = false;
  await Promise.all(
    ((subscriptions || []) as Subscription[]).map(async (subscription) => {
      try {
        const details = webpush.generateRequestDetails(subscription, payload, {
          TTL: 60 * 60,
          contentEncoding: subscription.content_encoding,
        });
        const response = await fetch(details.endpoint, {
          method: details.method,
          headers: details.headers as HeadersInit,
          body: details.body ? new Uint8Array(details.body) : undefined,
        });
        if (response.ok) delivered = true;
        if (response.status === 404 || response.status === 410)
          await admin.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
      } catch {
        // The event remains visible in-app. A later subscription refresh can recover delivery.
      }
    }),
  );
  if (delivered)
    await admin
      .from("notification_events")
      .update({ delivered_at: new Date().toISOString() })
      .eq("id", activity.id);
  return new Response(null, { status: 204 });
}
