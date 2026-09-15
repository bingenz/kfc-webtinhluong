"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { Heart, ImagePlus, Send, Trash2 } from "lucide-react";
import { Blank } from "./payroll-ui";
import {
  assertUnicodeLength,
  uploadSocialImage,
  type JournalPost,
} from "@/lib/cloud";
import { errorMessage } from "@/lib/errors";

type Conversation = { id: string; display_name: string; status: "accepted" };
type Comment = {
  id: string;
  post_id: string;
  author_id: string;
  body: string;
  created_at: string;
};
export default function SocialJournal({
  client,
  user,
  friendshipId,
}: {
  client: SupabaseClient | null;
  user: User | null;
  friendshipId?: string;
}) {
  const [pairs, setPairs] = useState<Conversation[]>([]),
    [pair, setPair] = useState(""),
    [posts, setPosts] = useState<JournalPost[]>([]),
    [caption, setCaption] = useState(""),
    [files, setFiles] = useState<File[]>([]),
    [comments, setComments] = useState<Record<string, Comment[]>>({}),
    [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({}),
    [hasOlder, setHasOlder] = useState(false),
    [drafts, setDrafts] = useState<Record<string, string>>({}),
    [error, setError] = useState(""),
    [working, setWorking] = useState(false);
  const loadPairs = useCallback(async () => {
    if (!client) return;
    const { data, error } = await client.rpc("my_friendships");
    if (error) throw error;
    const next = (data || []).filter(
      (x: { status: string }) => x.status === "accepted",
    ) as Conversation[];
    setPairs(next);
    setPair((current) => friendshipId || current || next[0]?.id || "");
  }, [client, friendshipId]);
  const activePair = friendshipId || pair;
  const loadPosts = useCallback(async (before?: string) => {
    if (!client || !activePair) return;
    let request = client
      .from("journal_posts")
      .select("*")
      .eq("friendship_id", activePair)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(20);
    if (before) request = request.lt("created_at", before);
    const { data, error } = await request;
    if (error) throw error;
    const next = (data || []) as JournalPost[];
    setPosts((current) => (before ? [...current, ...next] : next));
    setHasOlder(next.length === 20);
  }, [activePair, client]);
  const loadComments = useCallback(async (postId: string) => {
    if (!client) return;
    const { data, error } = await client
      .from("journal_comments")
      .select("*")
      .eq("post_id", postId)
      .is("deleted_at", null)
      .order("created_at")
      .limit(100);
    if (error) throw error;
    setComments((current) => ({ ...current, [postId]: (data || []) as Comment[] }));
  }, [client]);
  useEffect(() => {
    void loadPairs().catch((e) => setError(errorMessage(e)));
  }, [loadPairs]);
  useEffect(() => {
    void loadPosts().catch((e) => setError(errorMessage(e)));
  }, [loadPosts]);
  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (!client || !user || !activePair) return;
    try {
      assertUnicodeLength(caption, 2000, "Nội dung nhật ký");
      if (!caption.trim() && !files.length)
        throw new Error("Hãy viết nội dung hoặc chọn ảnh.");
      if (files.length > 6) throw new Error("Một bài chỉ có tối đa 6 ảnh.");
      setWorking(true);
      const { data, error } = await client
        .from("journal_posts")
        .insert({
          friendship_id: activePair,
          author_id: user.id,
          caption: caption.trim(),
        })
        .select()
        .single();
      if (error) throw error;
      const paths: string[] = [];
      try {
        for (const [index, file] of files.entries()) {
          const path = `journals/${activePair}/${user.id}/${data.id}-${index + 1}.${file.type.split("/")[1]}`;
          await uploadSocialImage(client, path, file);
          paths.push(path);
          const image = await client
            .from("journal_images")
            .insert({
              post_id: data.id,
              storage_path: path,
              position: index + 1,
            });
          if (image.error) throw image.error;
        }
      } catch (uploadError) {
        if (paths.length)
          await client.storage.from("social-media").remove(paths);
        await client.from("journal_posts").delete().eq("id", data.id);
        throw uploadError;
      }
      setCaption("");
      setFiles([]);
      await loadPosts();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setWorking(false);
    }
  }
  async function react(postId: string) {
    if (!client || !user) return;
    try {
      const { error } = await client
        .from("journal_reactions")
        .upsert({ post_id: postId, author_id: user.id, reaction: "❤️" });
      if (error) throw error;
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function comment(postId: string) {
    if (!client || !user) return;
    const body = (drafts[postId] || "").trim();
    try {
      assertUnicodeLength(body, 1000, "Bình luận");
      if (!body) throw new Error("Hãy nhập bình luận.");
      const { error } = await client
        .from("journal_comments")
        .insert({ post_id: postId, author_id: user.id, body });
      if (error) throw error;
      setDrafts((current) => ({ ...current, [postId]: "" }));
      await loadComments(postId);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  if (!user)
    return (
      <Blank
        title="Cần đăng nhập"
        text="Đăng nhập để dùng nhật ký chung với bạn bè."
      />
    );
  return (
    <div className="social-stack">
      <section className="card card-pad">
        <div className="section-head">
          <h2>Nhật ký chung</h2>
          {!friendshipId && pairs.length > 1 && (
            <select
              aria-label="Chọn bạn bè"
              value={pair}
              onChange={(e) => setPair(e.target.value)}
            >
              {pairs.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.display_name}
                </option>
              ))}
            </select>
          )}
        </div>
        {activePair ? (
          <form className="form-stack" onSubmit={post}>
            <textarea
              aria-label="Nội dung bài viết"
              maxLength={2000}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Ghi lại một khoảnh khắc"
            />
            <label className="btn w-fit">
              <ImagePlus size={16} />
              Thêm ảnh
              <input
                className="sr-only"
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) =>
                  setFiles(Array.from(e.currentTarget.files || []).slice(0, 6))
                }
              />
            </label>
            {files.length > 0 && (
              <p className="helper">Đã chọn {files.length} ảnh.</p>
            )}
            <button className="btn primary w-fit" disabled={working}>
              <Send size={16} />
              Đăng bài
            </button>
          </form>
        ) : (
          <p className="helper">Kết bạn để tạo nhật ký chung.</p>
        )}
      </section>
      {hasOlder && posts.length > 0 && (
        <button className="btn" onClick={() => void loadPosts(posts[posts.length - 1]?.created_at)}>
          Xem bài viết cũ hơn
        </button>
      )}
      {posts.map((post) => (
        <article className="card card-pad journal-post" key={post.id}>
          <div className="section-head">
            <div>
              <strong>{post.author_id === user.id ? "Bạn" : "Bạn bè"}</strong>
              <p className="helper">
                {new Intl.DateTimeFormat("vi-VN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(post.created_at))}
              </p>
            </div>
            {post.author_id === user.id && (
              <button
                className="btn icon"
                aria-label="Xóa bài viết"
                onClick={async () => {
                  const { error } = await client!
                    .from("journal_posts")
                    .delete()
                    .eq("id", post.id);
                  if (error) setError(errorMessage(error));
                  else void loadPosts();
                }}
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
          {post.caption && <p>{post.caption}</p>}
          <button
            className="btn ghost mt-4"
            onClick={() => void react(post.id)}
          >
            <Heart size={16} />
            Thả cảm xúc
          </button>
          <button
            className="btn ghost mt-2"
            onClick={() => {
              const opening = !expandedComments[post.id];
              setExpandedComments((current) => ({ ...current, [post.id]: opening }));
              if (opening) void loadComments(post.id).catch((e) => setError(errorMessage(e)));
            }}
          >
            {expandedComments[post.id] ? "Ẩn bình luận" : "Bình luận"}
          </button>
          {expandedComments[post.id] && <>
            {(comments[post.id] || []).map((comment) => (
              <div className="journal-comment" key={comment.id}>
                {comment.body}
                {comment.author_id === user.id && (
                  <button aria-label="Xóa bình luận" onClick={async () => {
                    const { error } = await client!.from("journal_comments").delete().eq("id", comment.id);
                    if (error) setError(errorMessage(error)); else void loadComments(post.id);
                  }}><Trash2 size={13} /></button>
                )}
              </div>
            ))}
            <div className="message-compose">
              <input aria-label="Viết bình luận" maxLength={1000} value={drafts[post.id] || ""} onChange={(e) => setDrafts((current) => ({ ...current, [post.id]: e.target.value }))} placeholder="Viết bình luận" />
              <button className="btn icon" aria-label="Gửi bình luận" onClick={() => void comment(post.id)}><Send size={16} /></button>
            </div>
          </>}
        </article>
      ))}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </div>
  );
}
