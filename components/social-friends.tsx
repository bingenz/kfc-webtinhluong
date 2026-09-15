"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { Check, ChevronLeft, FileText, MessageCircle, Search, Send, Settings2, Trash2, UserPlus, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Blank } from "./payroll-ui";
import SocialJournal from "./social-journal";
import SocialProfile from "./social-profile";
import { assertUnicodeLength, type DirectMessage, type Profile } from "@/lib/cloud";
import { errorMessage } from "@/lib/errors";

type Conversation = { id: string; friend_id: string; username: string; display_name: string; avatar_path?: string | null; last_body?: string | null; last_at?: string | null; unread_count: number };
type Friendship = { id: string; requester_id: string; recipient_id: string; status: "pending" | "accepted" | "declined"; friend_id: string; username: string; display_name: string };
type DetailTab = "profile" | "journal";

const initials = (name: string) => name.trim().slice(0, 1).toUpperCase() || "?";
function conversationTime(value?: string | null) {
  if (!value) return "";
  const time = new Date(value);
  return new Intl.DateTimeFormat("vi-VN", new Date().toDateString() === time.toDateString() ? { hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit" }).format(time);
}

export default function SocialFriends({ client, user, initialConversation }: { client: SupabaseClient | null; user: User | null; initialConversation?: string }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [friends, setFriends] = useState<Friendship[]>([]);
  const [selected, setSelected] = useState(initialConversation || "");
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [body, setBody] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [mode, setMode] = useState<"inbox" | "contacts">("inbox");
  const [details, setDetails] = useState<DetailTab | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const composing = useRef(false);

  const refresh = useCallback(async () => {
    if (!client || !user) return;
    const [{ data: inbox, error: inboxError }, { data: social, error: socialError }] = await Promise.all([client.rpc("my_conversations"), client.rpc("my_friendships")]);
    if (inboxError) throw inboxError;
    if (socialError) throw socialError;
    const next = (inbox || []) as Conversation[];
    setConversations(next);
    setFriends((social || []) as Friendship[]);
    setSelected((current) => current || initialConversation || next[0]?.id || "");
  }, [client, initialConversation, user]);
  const loadMessages = useCallback(async (before?: string) => {
    if (!client || !selected) return;
    let request = client.from("direct_messages").select("*").eq("friendship_id", selected).is("deleted_at", null).order("created_at", { ascending: false }).limit(50);
    if (before) request = request.lt("created_at", before);
    const { data, error: loadError } = await request;
    if (loadError) throw loadError;
    const page = ((data || []) as DirectMessage[]).reverse();
    setHasOlder(page.length === 50);
    setMessages((current) => before ? [...page, ...current] : page);
    const unread = page.filter((message) => message.sender_id !== user?.id && !message.read_at);
    if (unread.length) await client.from("direct_messages").update({ read_at: new Date().toISOString() }).in("id", unread.map((message) => message.id));
  }, [client, selected, user]);

  useEffect(() => { void refresh().catch((reason) => setError(errorMessage(reason))); }, [refresh]);
  useEffect(() => { setDetails(null); setMessages([]); if (selected) void loadMessages().catch((reason) => setError(errorMessage(reason))); }, [loadMessages, selected]);
  useEffect(() => {
    if (!client || !selected) return;
    let channel: ReturnType<SupabaseClient["channel"]> | undefined;
    const connect = () => {
      if (channel || document.visibilityState !== "visible") return;
      channel = client.channel("messages:" + selected).on("postgres_changes", { event: "*", schema: "public", table: "direct_messages", filter: "friendship_id=eq." + selected }, () => { void loadMessages(); void refresh(); }).subscribe();
    };
    const disconnect = () => { if (channel) void client.removeChannel(channel); channel = undefined; };
    const visibility = () => document.visibilityState === "visible" ? connect() : disconnect();
    connect(); document.addEventListener("visibilitychange", visibility);
    return () => { disconnect(); document.removeEventListener("visibilitychange", visibility); };
  }, [client, loadMessages, refresh, selected]);

  const selectedConversation = conversations.find((conversation) => conversation.id === selected);
  const accepted = friends.filter((friend) => friend.status === "accepted");
  const incoming = friends.filter((friend) => friend.status === "pending" && friend.recipient_id === user?.id);
  const outgoing = friends.filter((friend) => friend.status === "pending" && friend.requester_id === user?.id);
  const shownConversations = useMemo(() => conversations.filter((conversation) => { const needle = query.trim().toLowerCase(); return !needle || conversation.display_name.toLowerCase().includes(needle) || conversation.username.toLowerCase().includes(needle); }), [conversations, query]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!client || !user || !selected || composing.current) return;
    const message = body.trim();
    try {
      assertUnicodeLength(message, 2000, "Tin nhắn"); if (!message) throw new Error("Hãy nhập tin nhắn.");
      setWorking(true);
      const { error: sendError } = await client.from("direct_messages").insert({ friendship_id: selected, sender_id: user.id, body: message });
      if (sendError) throw sendError;
      setBody(""); await loadMessages(); await refresh();
    } catch (reason) { setError(errorMessage(reason)); } finally { setWorking(false); }
  }
  async function removeMessage(id: string) {
    if (!client) return;
    const { error: removeError } = await client.from("direct_messages").delete().eq("id", id);
    if (removeError) setError(errorMessage(removeError)); else void loadMessages();
  }
  async function search(event: React.FormEvent) {
    event.preventDefault(); if (!client || query.trim().length < 2) return;
    setWorking(true);
    try { const { data, error: searchError } = await client.rpc("search_profiles", { term: query.trim() }); if (searchError) throw searchError; setResults(((data || []) as Profile[]).filter((profile) => profile.id !== user?.id)); }
    catch (reason) { setError(errorMessage(reason)); } finally { setWorking(false); }
  }
  async function friendshipAction(name: "send_friend_request" | "respond_friend_request" | "cancel_friend_request" | "remove_friendship", args: Record<string, unknown>, message: string) {
    if (!client) return; setWorking(true);
    try { const { error: actionError } = await client.rpc(name, args); if (actionError) throw actionError; await refresh(); toast.success(message); }
    catch (reason) { setError(errorMessage(reason)); } finally { setWorking(false); }
  }
  if (!user) return <Blank title="Cần đăng nhập" text="Đăng nhập để nhắn tin, kết bạn và dùng nhật ký chung." />;
  if (details && selectedConversation) return <div className="friend-detail"><div className="friend-detail-head"><button className="btn icon" aria-label="Quay lại cuộc trò chuyện" title="Quay lại cuộc trò chuyện" onClick={() => setDetails(null)}><ChevronLeft size={18} /></button><div><strong>{selectedConversation.display_name}</strong><small>@{selectedConversation.username}</small></div></div><nav className="friend-detail-tabs"><button className={details === "profile" ? "active" : ""} onClick={() => setDetails("profile")}>Hồ sơ</button><button className={details === "journal" ? "active" : ""} onClick={() => setDetails("journal")}>Nhật ký chung</button></nav>{details === "profile" ? <SocialProfile client={client} user={user} profileId={selectedConversation.friend_id} /> : <SocialJournal client={client} user={user} friendshipId={selected} />}</div>;
  return <div className="friend-workspace">
    <aside className={"friend-sidebar " + (mode === "contacts" ? "contacts-mode" : "")}>
      <div className="friend-sidebar-head"><div><h2>{mode === "inbox" ? "Tin nhắn" : "Bạn bè"}</h2><small>{mode === "inbox" ? "Cuộc trò chuyện gần đây" : `${accepted.length} bạn bè`}</small></div><button className="btn icon" aria-label={mode === "inbox" ? "Quản lý bạn bè" : "Mở hộp thư"} title={mode === "inbox" ? "Quản lý bạn bè" : "Mở hộp thư"} onClick={() => setMode((current) => current === "inbox" ? "contacts" : "inbox")}>{mode === "inbox" ? <Users size={17} /> : <MessageCircle size={17} />}</button></div>
      {mode === "inbox" ? <><label className="friend-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm cuộc trò chuyện" aria-label="Tìm cuộc trò chuyện" /></label><div className="conversation-list">{shownConversations.map((conversation) => <button className={"conversation-row " + (conversation.id === selected ? "active" : "")} key={conversation.id} onClick={() => setSelected(conversation.id)}><span className="avatar">{initials(conversation.display_name)}</span><span className="conversation-copy"><strong>{conversation.display_name}</strong><small>{conversation.last_body || "Bắt đầu trò chuyện"}</small></span><span className="conversation-meta"><small>{conversationTime(conversation.last_at)}</small>{conversation.unread_count > 0 && <b>{conversation.unread_count > 9 ? "9+" : conversation.unread_count}</b>}</span></button>)}{!shownConversations.length && <p className="helper sidebar-empty">Chưa có cuộc trò chuyện. Hãy tìm và kết bạn.</p>}</div></> : <div className="contact-panel"><form className="friend-search" onSubmit={search}><Search size={16} /><input minLength={2} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tên hoặc @username" aria-label="Tìm bạn bè" /></form>{results.map((profile) => { const relation = friends.find((friend) => friend.friend_id === profile.id); return <div className="contact-row" key={profile.id}><span className="avatar">{initials(profile.display_name)}</span><span><strong>{profile.display_name}</strong><small>@{profile.username}</small></span>{relation ? <small>{relation.status === "accepted" ? "Đã là bạn" : "Đã gửi lời mời"}</small> : <button className="btn icon" title="Kết bạn" aria-label="Kết bạn" disabled={working} onClick={() => void friendshipAction("send_friend_request", { target: profile.id }, "Đã gửi lời mời kết bạn.")}><UserPlus size={16} /></button>}</div>; })}{incoming.length > 0 && <><h3>Lời mời nhận được</h3>{incoming.map((friend) => <div className="contact-row" key={friend.id}><span><strong>{friend.display_name}</strong><small>@{friend.username}</small></span><span className="row-actions"><button className="btn icon" title="Chấp nhận" aria-label="Chấp nhận" onClick={() => void friendshipAction("respond_friend_request", { friendship: friend.id, accept: true }, "Đã trở thành bạn bè.")}><Check size={16} /></button><button className="btn icon" title="Từ chối" aria-label="Từ chối" onClick={() => void friendshipAction("respond_friend_request", { friendship: friend.id, accept: false }, "Đã từ chối lời mời.")}><X size={16} /></button></span></div>)}</>}{outgoing.length > 0 && <><h3>Đã gửi</h3>{outgoing.map((friend) => <div className="contact-row" key={friend.id}><span><strong>{friend.display_name}</strong><small>@{friend.username}</small></span><button className="btn icon" title="Hủy lời mời" aria-label="Hủy lời mời" onClick={() => void friendshipAction("cancel_friend_request", { friendship: friend.id }, "Đã hủy lời mời.")}><X size={16} /></button></div>)}</>}<h3>Bạn bè</h3>{accepted.map((friend) => <button className="contact-row contact-button" key={friend.id} onClick={() => { setSelected(friend.id); setMode("inbox"); }}><span className="avatar">{initials(friend.display_name)}</span><span><strong>{friend.display_name}</strong><small>@{friend.username}</small></span><MessageCircle size={16} /></button>)}</div>}
    </aside>
    <section className={"chat-panel " + (!selected ? "empty" : "")}>{selectedConversation ? <><header className="chat-head"><div className="chat-person"><span className="avatar">{initials(selectedConversation.display_name)}</span><div><strong>{selectedConversation.display_name}</strong><small>@{selectedConversation.username}</small></div></div><div className="row-actions"><button className="btn icon" title="Nhật ký chung" aria-label="Nhật ký chung" onClick={() => setDetails("journal")}><FileText size={17} /></button><button className="btn icon" title="Xem hồ sơ và quyền" aria-label="Xem hồ sơ và quyền" onClick={() => setDetails("profile")}><Settings2 size={17} /></button></div></header><div className="message-scroll">{hasOlder && <button className="load-older" onClick={() => void loadMessages(messages[0]?.created_at)}>Tải tin nhắn cũ</button>}{messages.map((message) => <div className={"message-bubble " + (message.sender_id === user.id ? "mine" : "")} key={message.id}><p>{message.body}</p><small>{new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" }).format(new Date(message.created_at))}</small>{message.sender_id === user.id && <button className="message-delete" aria-label="Xóa tin nhắn" title="Xóa tin nhắn" onClick={() => void removeMessage(message.id)}><Trash2 size={13} /></button>}</div>)}</div><form className="message-compose" onSubmit={send}><textarea aria-label="Soạn tin nhắn" value={body} maxLength={2000} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onChange={(event) => setBody(event.target.value)} placeholder="Nhập tin nhắn" /><button className="btn primary icon" aria-label="Gửi tin nhắn" disabled={working || !body.trim()}><Send size={17} /></button></form></> : <Blank title="Chọn một cuộc trò chuyện" text="Chọn một người bạn hoặc mở danh bạ để bắt đầu." />}</section>
    {error && <p className="error-message workspace-error" role="alert">{error}</p>}
  </div>;
}
