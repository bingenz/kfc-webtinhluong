"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { Camera, ChevronLeft, Save } from "lucide-react";
import { toast } from "sonner";
import { Blank, Field } from "./payroll-ui";
import { errorMessage } from "@/lib/errors";
import {
  assertUnicodeLength,
  signedMediaUrl,
  uploadSocialImage,
  type FriendPermission,
  type Profile,
} from "@/lib/cloud";

export default function SocialProfile({
  client,
  user,
  profileId,
  onBack,
}: {
  client: SupabaseClient | null;
  user: User | null;
  profileId?: string;
  onBack?: () => void;
}) {
  const [profile, setProfile] = useState<Profile | null>(null),
    [note, setNote] = useState(""),
    [permission, setPermission] = useState<FriendPermission | null>(null),
    [avatar, setAvatar] = useState(""),
    [cover, setCover] = useState(""),
    [working, setWorking] = useState(false),
    [error, setError] = useState("");
  const own = !!user && (!profileId || profileId === user.id);
  const target = profileId || user?.id;
  const load = useCallback(async () => {
    if (!client || !target) return;
    setError("");
    const [{ data: p, error: profileError }, { data: n, error: noteError }] =
      await Promise.all([
        client.from("profiles").select("*").eq("id", target).single(),
        client
          .from("profile_notes")
          .select("body")
          .eq("owner_id", target)
          .maybeSingle(),
      ]);
    if (profileError) throw profileError;
    if (noteError) throw noteError;
    setProfile(p as Profile);
    setNote(n?.body || "");
    if (user && target !== user.id) {
      const { data, error } = await client
        .from("friend_permissions")
        .select("*")
        .eq("owner_id", user.id)
        .eq("friend_id", target)
        .maybeSingle();
      if (error) throw error;
      setPermission(data as FriendPermission | null);
    }
    if (p.avatar_path) setAvatar(await signedMediaUrl(client, p.avatar_path));
    if (p.cover_path) setCover(await signedMediaUrl(client, p.cover_path));
  }, [client, target, user]);
  useEffect(() => {
    void load().catch((e) => setError(errorMessage(e)));
  }, [load]);
  async function save() {
    if (!client || !user || !profile || !own) return;
    setWorking(true);
    try {
      assertUnicodeLength(profile.display_name, 80, "Tên hiển thị");
      assertUnicodeLength(profile.bio || "", 300, "Giới thiệu");
      const { error } = await client
        .from("profiles")
        .update({
          display_name: profile.display_name.trim(),
          username: profile.username.trim().toLowerCase(),
          bio: profile.bio || "",
          job_title: profile.job_title || "",
          workplace: profile.workplace || "",
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);
      if (error) throw error;
      const body = note.trim();
      const result = body
        ? await client
            .from("profile_notes")
            .upsert({
              owner_id: user.id,
              body,
              updated_at: new Date().toISOString(),
            })
        : await client.from("profile_notes").delete().eq("owner_id", user.id);
      if (result.error) throw result.error;
      toast.success("Đã lưu hồ sơ.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setWorking(false);
    }
  }
  async function upload(kind: "avatar" | "cover", file?: File) {
    if (!client || !user || !file) return;
    setWorking(true);
    try {
      const extension = file.type.split("/")[1];
      const path = `profiles/${user.id}/${kind}-${crypto.randomUUID()}.${extension}`;
      await uploadSocialImage(client, path, file);
      const { error } = await client
        .from("profiles")
        .update({
          [kind + "_path"]: path,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);
      if (error) throw error;
      if (kind === "avatar") setAvatar(await signedMediaUrl(client, path));
      else setCover(await signedMediaUrl(client, path));
      toast.success("Đã tải ảnh lên.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setWorking(false);
    }
  }
  async function setPermissions(next: FriendPermission) {
    if (!client || !permission) return;
    setWorking(true);
    try {
      const { error } = await client.rpc("update_friend_permissions", {
        friend: next.friend_id,
        schedule: next.view_schedule,
        forecast: next.view_forecast,
        payroll: next.view_payroll,
      });
      if (error) throw error;
      setPermission(next);
      toast.success("Đã cập nhật quyền riêng tư.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setWorking(false);
    }
  }
  if (!user)
    return (
      <Blank
        title="Cần đăng nhập"
        text="Đăng nhập để xem và chỉnh sửa hồ sơ."
      />
    );
  if (!profile && !error) return <p className="loading">Đang tải hồ sơ…</p>;
  if (!profile)
    return (
      <p className="error-message" role="alert">
        {error}
      </p>
    );
  return (
    <div className="social-stack">
      <section
        className="profile-cover"
        style={cover ? { backgroundImage: `url(${cover})` } : undefined}
      >
        {onBack && (
          <button
            className="btn icon profile-back"
            aria-label="Quay lại"
            onClick={onBack}
          >
            <ChevronLeft size={18} />
          </button>
        )}
        {own && (
          <label className="btn icon profile-upload" aria-label="Tải ảnh bìa">
            <Camera size={17} />
            <input
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => void upload("cover", e.currentTarget.files?.[0])}
            />
          </label>
        )}
      </section>
      <section className="profile-header">
        <div className="profile-avatar">
          {avatar ? (
            <img src={avatar} alt="" />
          ) : (
            profile.display_name[0]?.toUpperCase()
          )}
          {own && (
            <label className="avatar-upload" aria-label="Tải ảnh đại diện">
              <Camera size={15} />
              <input
                className="sr-only"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) =>
                  void upload("avatar", e.currentTarget.files?.[0])
                }
              />
            </label>
          )}
        </div>
        <div>
          <h2>{profile.display_name}</h2>
          <p>@{profile.username}</p>
        </div>
      </section>
      <section className="card card-pad">
        {own ? (
          <div className="form-stack">
            <Field label="Tên hiển thị">
              <input
                maxLength={80}
                value={profile.display_name}
                onChange={(e) =>
                  setProfile({ ...profile, display_name: e.target.value })
                }
              />
            </Field>
            <Field label="Username">
              <input
                maxLength={30}
                pattern="[a-z0-9_]{3,30}"
                value={profile.username}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    username: e.target.value.toLowerCase(),
                  })
                }
              />
            </Field>
            <Field label="Giới thiệu">
              <textarea
                maxLength={300}
                value={profile.bio || ""}
                onChange={(e) =>
                  setProfile({ ...profile, bio: e.target.value })
                }
              />
            </Field>
            <div className="form-grid">
              <Field label="Chức danh">
                <input
                  maxLength={100}
                  value={profile.job_title || ""}
                  onChange={(e) =>
                    setProfile({ ...profile, job_title: e.target.value })
                  }
                />
              </Field>
              <Field label="Nơi làm việc">
                <input
                  maxLength={100}
                  value={profile.workplace || ""}
                  onChange={(e) =>
                    setProfile({ ...profile, workplace: e.target.value })
                  }
                />
              </Field>
            </div>
            <Field label="Ghi chú trạng thái cho bạn bè">
              <input
                maxLength={280}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Hôm nay mình làm ca chiều"
              />
            </Field>
            <button
              className="btn primary"
              disabled={working}
              onClick={() => void save()}
            >
              <Save size={16} />
              Lưu hồ sơ
            </button>
          </div>
        ) : (
          <>
            <p>{profile.bio || "Chưa có giới thiệu."}</p>
            {(profile.job_title || profile.workplace) && (
              <p className="helper mt-3">
                {[profile.job_title, profile.workplace]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
            {note && <div className="hint-card mt-5">{note}</div>}
          </>
        )}
      </section>
      {permission && (
        <section className="card card-pad">
          <h2>Quyền dành cho bạn bè này</h2>
          <p className="helper mt-2">
            Thay đổi có hiệu lực ngay trên thiết bị của họ.
          </p>
          {(
            [
              { key: "view_schedule", label: "Lịch làm" },
              { key: "view_forecast", label: "Lương dự kiến và chi tiết ca" },
              {
                key: "view_payroll",
                label: "Lương thực nhận và cài đặt lương",
              },
            ] as const
          ).map((item) => (
            <label className="checkrow" key={item.key}>
              <input
                type="checkbox"
                checked={permission[item.key]}
                disabled={working}
                onChange={(e) =>
                  void setPermissions({
                    ...permission,
                    [item.key]: e.target.checked,
                  })
                }
              />
              {item.label}
            </label>
          ))}
        </section>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
