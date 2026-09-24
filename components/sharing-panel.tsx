"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { Copy, Eye, KeyRound, RefreshCw, ShieldCheck, UserMinus } from "lucide-react";
import { toast } from "sonner";
import {
  ensureShareIdentity,
  listMyViewers,
  listSharedWithMe,
  redeemShareCode,
  revokeShare,
  rotateShareCode,
  type Profile,
  type ShareGrant,
  type ShareIdentity,
} from "@/lib/cloud";
import { errorMessage } from "@/lib/errors";
import { Field } from "./payroll-ui";

type Props = {
  client: SupabaseClient | null;
  user: User | null;
  profile: Profile | null;
  onProfileChange: (profile: Profile) => void;
  onOpenShared: (ownerId: string, displayName: string) => void;
};

export default function SharingPanel({ client, user, profile, onProfileChange, onOpenShared }: Props) {
  const [identity, setIdentity] = useState<ShareIdentity | null>(null);
  const [viewers, setViewers] = useState<ShareGrant[]>([]);
  const [shared, setShared] = useState<ShareGrant[]>([]);
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState(profile?.display_name || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setDisplayName(profile?.display_name || ""), [profile?.display_name]);

  const refresh = useCallback(async () => {
    if (!client || !user) return;
    setBusy(true);
    setError("");
    try {
      const [nextIdentity, nextViewers, nextShared] = await Promise.all([
        ensureShareIdentity(client),
        listMyViewers(client),
        listSharedWithMe(client),
      ]);
      setIdentity(nextIdentity);
      setViewers(nextViewers);
      setShared(nextShared);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }, [client, user]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (!user || !client) {
    return (
      <section className="card card-pad">
        <h2>Chia sẻ</h2>
        <p className="helper mt-2">Đăng nhập để tạo mã chia sẻ và xem dữ liệu được chia sẻ với bạn.</p>
      </section>
    );
  }

  async function redeem(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await redeemShareCode(client!, code);
      setCode("");
      await refresh();
      toast.success("Đã cấp quyền xem dữ liệu read-only.");
      onOpenShared(result.owner_id, result.display_name);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function saveName(event: React.FormEvent) {
    event.preventDefault();
    const name = displayName.trim();
    if (!name || name.length > 80) {
      setError("Tên hiển thị phải từ 1 đến 80 ký tự.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { data, error: updateError } = await client!
        .from("profiles")
        .update({ display_name: name, updated_at: new Date().toISOString() })
        .eq("id", user!.id)
        .select("id,username,display_name,created_at,updated_at")
        .single();
      if (updateError) throw updateError;
      onProfileChange(data as Profile);
      toast.success("Đã cập nhật tên hiển thị.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sharing-grid">
      <section className="card card-pad">
        <div className="section-head">
          <div><h2>Mã chia sẻ của bạn</h2><p className="helper">Chỉ đưa mã này cho người bạn muốn cho xem lịch làm và sổ lương.</p></div>
          <ShieldCheck size={20} aria-hidden="true" />
        </div>
        {identity ? (
          <div className="share-code-box">
            <code>{identity.share_code}</code>
            <div className="row-actions">
              <button className="btn" type="button" onClick={async () => {
                await navigator.clipboard.writeText(identity.share_code);
                toast.success("Đã sao chép mã chia sẻ.");
              }}><Copy size={15}/> Sao chép</button>
              <button className="btn ghost" type="button" disabled={busy} onClick={async () => {
                if (!window.confirm("Đổi mã chia sẻ? Mã cũ sẽ ngừng dùng ngay, nhưng các quyền đã cấp vẫn còn hiệu lực.")) return;
                setBusy(true); setError("");
                try { setIdentity(await rotateShareCode(client!)); toast.success("Đã đổi mã chia sẻ."); }
                catch (reason) { setError(errorMessage(reason)); }
                finally { setBusy(false); }
              }}><RefreshCw size={15}/> Đổi mã</button>
            </div>
          </div>
        ) : <p className="helper">Đang tạo mã chia sẻ…</p>}
      </section>

      <section className="card card-pad">
        <h2>Nhập mã chia sẻ</h2>
        <p className="helper mt-2">Mã hợp lệ cấp quyền xem read-only; không tạo bạn bè, chat hay hồ sơ xã hội.</p>
        <form className="share-redeem-form" onSubmit={redeem}>
          <Field label="Mã chia sẻ">
            <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="ST-____-____-____-____" autoComplete="off" maxLength={24} required />
          </Field>
          <button className="btn primary" disabled={busy}><KeyRound size={15}/> Xem dữ liệu</button>
        </form>
      </section>

      <section className="card card-pad">
        <h2>Người đang có quyền xem</h2>
        {viewers.length ? viewers.map((grant) => (
          <div className="list-item" key={grant.viewer_id}>
            <div><strong>{grant.display_name || "Người dùng"}</strong><small>Được cấp {new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(new Date(grant.created_at))}</small></div>
            <button className="btn ghost danger" disabled={busy} onClick={async () => {
              if (!window.confirm(`Thu hồi quyền xem của ${grant.display_name || "người dùng này"}?`)) return;
              setBusy(true); setError("");
              try { await revokeShare(client!, grant.viewer_id); await refresh(); toast.success("Đã thu hồi quyền xem."); }
              catch (reason) { setError(errorMessage(reason)); }
              finally { setBusy(false); }
            }}><UserMinus size={15}/> Thu hồi</button>
          </div>
        )) : <p className="helper mt-3">Chưa có ai được cấp quyền xem.</p>}
      </section>

      <section className="card card-pad">
        <h2>Được chia sẻ với tôi</h2>
        {shared.length ? shared.map((grant) => (
          <div className="list-item" key={grant.owner_id}>
            <div><strong>{grant.display_name || "Người dùng"}</strong><small>Quyền xem read-only</small></div>
            <button className="btn" onClick={() => onOpenShared(grant.owner_id, grant.display_name || "Người dùng")}><Eye size={15}/> Mở</button>
          </div>
        )) : <p className="helper mt-3">Chưa có dữ liệu nào được chia sẻ với bạn.</p>}
      </section>

      <section className="card card-pad">
        <h2>Tài khoản</h2>
        <form className="share-redeem-form" onSubmit={saveName}>
          <Field label="Tên hiển thị"><input value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} required /></Field>
          <button className="btn" disabled={busy}>Lưu tên</button>
        </form>
      </section>

      {error && <p className="error-message sharing-error" role="alert">{error}</p>}
    </div>
  );
}
