"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  CalendarCheck2,
  CalendarDays,
  Clock3,
  Eye,
  LayoutDashboard,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  Settings2,
  Share2,
  Trash2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { DatePicker, TimePicker } from "@/components/payroll-pickers";
import { AppToaster, ThemeToggle } from "@/components/theme-controls";
import { Blank, Choose, Field, Modal } from "@/components/payroll-ui";
import PayrollSettings from "@/components/payroll-settings";
import PayrollReconciliation from "@/components/payroll-reconciliation";
import SharingPanel from "@/components/sharing-panel";
import { cloudClient, loadLedger, saveLedger, type Profile } from "@/lib/cloud";
import { BACKUP_PREFIX, LOCAL_KEY, backupKey, hasUserData, mergeLedgers, readDeviceRaw } from "@/lib/data-lifecycle";
import { errorMessage } from "@/lib/errors";
import { monthAfterShiftSave, moveMonth } from "@/lib/month";
import {
  applicable,
  autoCloseEndedPeriods,
  defaultPayrollMonth,
  hours,
  initialLedger,
  lockedDate,
  makeShift,
  money,
  periodForecast,
  removeShift,
  shiftAmount,
  shiftStatus,
  shortDate,
  today,
  type Ledger,
  type Shift,
} from "@/lib/payroll";

type DataMode =
  | { type: "local" }
  | { type: "cloud"; userId: string; revision: number }
  | { type: "shared"; ownerId: string; displayName: string }
  | { type: "transition" };

type MigrationChoice = {
  kind: "cloud-empty" | "both";
  local: Ledger;
  remote: { payload: Ledger; revision: number } | null;
};

type RecoveryState = { raw: string; error: string };

const navigation = [
  ["overview", "Tổng quan", LayoutDashboard],
  ["calendar", "Lịch làm", CalendarDays],
  ["payroll", "Kỳ lương", Wallet],
  ["sharing", "Chia sẻ", Share2],
  ["settings", "Cài đặt", Settings2],
] as const;
type Tab = (typeof navigation)[number][0];

function MonthNavigator({ month, onChange }: { month: string; onChange: (value: string) => void }) {
  return (
    <div className="month-navigator" aria-label="Điều hướng tháng">
      <button className="btn ghost icon" aria-label="Tháng trước" onClick={() => onChange(moveMonth(month, -1))}>‹</button>
      <label className="month-field"><span>Tháng {month.slice(5)}/{month.slice(0, 4)}</span><input aria-label="Chọn tháng và năm" type="month" value={month} onChange={(event) => onChange(event.target.value)} /></label>
      <button className="btn ghost icon" aria-label="Tháng sau" onClick={() => onChange(moveMonth(month, 1))}>›</button>
      <button className="btn ghost" onClick={() => onChange(today().slice(0, 7))}>Tháng hiện tại</button>
    </div>
  );
}

export default function PayrollApp() {
  const [ledger, setLedger] = useState<Ledger>(initialLedger);
  const [mode, setModeState] = useState<DataMode>({ type: "local" });
  const modeRef = useRef<DataMode>({ type: "local" });
  const setMode = (next: DataMode) => { modeRef.current = next; setModeState(next); };
  const [tab, setTab] = useState<Tab>("overview");
  const [month, setMonth] = useState(today().slice(0, 7));
  const [payrollMonth, setPayrollMonth] = useState(today().slice(0, 7));
  const [selected, setSelected] = useState(today());
  const [now, setNow] = useState(new Date());
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [migration, setMigration] = useState<MigrationChoice | null>(null);
  const [recovery, setRecovery] = useState<RecoveryState | null>(null);
  const [shiftModal, setShiftModal] = useState(false);
  const [editing, setEditing] = useState<Shift | null>(null);
  const [date, setDate] = useState(today());
  const [roleId, setRoleId] = useState("cook");
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("13:00");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signUp, setSignUp] = useState(false);

  const revision = useRef(0);
  const deviceSnapshot = useRef<string | null>(null);
  const localLedgerRef = useRef<Ledger>(initialLedger());
  const ownCloudRef = useRef<{ ledger: Ledger; revision: number } | null>(null);
  const sessionVersion = useRef(0);
  const cloudAbort = useRef<AbortController | null>(null);
  const payrollMonthInitialized = useRef(false);

  const totals = useMemo(() => periodForecast(ledger, month, now), [ledger, month, now]);
  const readOnly = mode.type === "shared";

  const readLocal = useCallback(() => {
    const raw = localStorage.getItem(LOCAL_KEY);
    deviceSnapshot.current = raw;
    const result = readDeviceRaw(raw);
    if (!result.ok) {
      setRecovery({ raw: result.raw, error: result.error });
      setReady(false);
      return null;
    }
    localLedgerRef.current = result.ledger;
    setRecovery(null);
    return result.ledger;
  }, []);

  const restoreLocalImmediately = useCallback(() => {
    cloudAbort.current?.abort();
    cloudAbort.current = null;
    revision.current = 0;
    ownCloudRef.current = null;
    setProfile(null);
    setMigration(null);
    setError("");
    const local = readLocal();
    if (local) {
      setLedger(local);
      setMode({ type: "local" });
      setReady(true);
    } else {
      setLedger(initialLedger());
      setMode({ type: "local" });
    }
  }, [readLocal]);

  useEffect(() => {
        const local = readLocal();
    if (local) { setLedger(local); setReady(true); }
  }, [readLocal]);

  useEffect(() => {
    let timer: number | undefined;
    const refresh = () => setNow(new Date());
    const schedule = () => {
      window.clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      timer = window.setTimeout(() => { refresh(); schedule(); }, 60_000 - (Date.now() % 60_000));
    };
    const visibility = () => { if (document.visibilityState === "visible") refresh(); schedule(); };
    schedule(); document.addEventListener("visibilitychange", visibility);
    return () => { window.clearTimeout(timer); document.removeEventListener("visibilitychange", visibility); };
  }, []);

  useEffect(() => {
    let alive = true;
    let unsubscribe: undefined | (() => void);
    void cloudClient().then(async (service) => {
      if (!alive) return;
      setClient(service);
      if (!service) { setAuthReady(true); return; }
      const { data: { session } } = await service.auth.getSession();
      if (!alive) return;
      setUser(session?.user || null); setAuthReady(true);
      const watch = service.auth.onAuthStateChange((_event, next) => {
        sessionVersion.current += 1;
        cloudAbort.current?.abort();
        setUser(next?.user || null);
        setAuthReady(true);
      });
      unsubscribe = () => watch.data.subscription.unsubscribe();
    }).catch((reason) => { setError(errorMessage(reason)); setAuthReady(true); });
    return () => { alive = false; unsubscribe?.(); };
  }, []);

  useEffect(() => {
    if (!authReady) return;
    const version = ++sessionVersion.current;
    cloudAbort.current?.abort();
    const controller = new AbortController();
    cloudAbort.current = controller;
    if (!client || !user) {
            restoreLocalImmediately();
      return () => controller.abort();
    }
        setReady(false); setError(""); setMigration(null);
    void (async () => {
      try {
        let item = await (client.from("profiles").select("id,username,display_name,created_at,updated_at").eq("id", user.id).maybeSingle() as unknown as { abortSignal: (s: AbortSignal) => any }).abortSignal(controller.signal);
        if (item.error) throw item.error;
        if (!item.data) {
          const created = await (client.from("profiles").insert({
            id: user.id,
            username: "user_" + user.id.replaceAll("-", "").slice(0, 16),
            display_name: String(user.user_metadata?.display_name || "Người dùng").slice(0, 80),
          }).select("id,username,display_name,created_at,updated_at").single() as unknown as { abortSignal: (s: AbortSignal) => any }).abortSignal(controller.signal);
          if (created.error) throw created.error;
          item = created;
        }
        const remote = await loadLedger(client, user.id, controller.signal);
        if (controller.signal.aborted || version !== sessionVersion.current) return;
        setProfile(item.data as Profile);
        const local = localLedgerRef.current;
        const localHasData = hasUserData(local);
        const cloudHasData = !!remote && hasUserData(remote.payload);
        if (localHasData && !cloudHasData) {
          setLedger(local); setMode({ type: "transition" }); setMigration({ kind: "cloud-empty", local, remote }); setReady(true); return;
        }
        if (localHasData && remote && cloudHasData && JSON.stringify(local) !== JSON.stringify(remote.payload)) {
          setLedger(local); setMode({ type: "transition" }); setMigration({ kind: "both", local, remote }); setReady(true); return;
        }
        if (remote) {
          revision.current = remote.revision; ownCloudRef.current = { ledger: remote.payload, revision: remote.revision };
          setLedger(remote.payload); setMode({ type: "cloud", userId: user.id, revision: remote.revision }); setReady(true); return;
        }
        const fresh = initialLedger();
        const nextRevision = await saveLedger(client, fresh, 0, controller.signal);
        if (controller.signal.aborted || version !== sessionVersion.current) return;
        revision.current = nextRevision; ownCloudRef.current = { ledger: fresh, revision: nextRevision };
        setLedger(fresh); setMode({ type: "cloud", userId: user.id, revision: nextRevision }); setReady(true);
      } catch (reason) {
        if (!controller.signal.aborted && version === sessionVersion.current) { setError(errorMessage(reason)); setReady(true); }
      }
    })();
    return () => controller.abort();
  }, [authReady, client, user, restoreLocalImmediately]);

  useEffect(() => {
    if (!ready || payrollMonthInitialized.current) return;
    setPayrollMonth(defaultPayrollMonth(ledger, now));
    payrollMonthInitialized.current = true;
  }, [ledger, now, ready]);

  useEffect(() => {
    if (!ready || readOnly || mode.type === "transition" || busy) return;
    const closed = autoCloseEndedPeriods(ledger, now);
    if (closed === ledger) return;
    void commit(closed).catch((reason) => setError(errorMessage(reason)));
    // Auto-close is idempotent; ledger changes after commit prevent a second write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, readOnly, mode.type, ledger, now]);

  async function commit(next: Ledger) {
    if (!ready) throw new Error("Sổ lương chưa sẵn sàng.");
    const currentMode = modeRef.current;
    if (currentMode.type === "shared") throw new Error("Dữ liệu được chia sẻ ở chế độ chỉ đọc.");
    if (currentMode.type === "transition") throw new Error("Hãy chọn nguồn dữ liệu trước khi tiếp tục.");
    setBusy(true); setError("");
    try {
      if (currentMode.type === "cloud") {
        if (!client || !user || user.id !== currentMode.userId) throw new Error("Phiên đăng nhập đã thay đổi.");
        const version = sessionVersion.current;
        const controller = new AbortController();
        cloudAbort.current?.abort(); cloudAbort.current = controller;
        const nextRevision = await saveLedger(client, next, revision.current, controller.signal);
        if (controller.signal.aborted || version !== sessionVersion.current || modeRef.current.type !== "cloud") throw new Error("Phiên dữ liệu đã thay đổi; thay đổi cũ không được áp dụng vào giao diện.");
        revision.current = nextRevision; ownCloudRef.current = { ledger: next, revision: nextRevision };
        setMode({ type: "cloud", userId: user.id, revision: nextRevision });
      } else {
        if (localStorage.getItem(LOCAL_KEY) !== deviceSnapshot.current) throw new Error("Dữ liệu trên thiết bị đã thay đổi ở tab khác.");
        const raw = JSON.stringify(next);
        localStorage.setItem(LOCAL_KEY, raw); deviceSnapshot.current = raw; localLedgerRef.current = next;
      }
      setLedger(next); setError("");
    } finally { setBusy(false); }
  }

  function saveBackup(label: string, value: Ledger) {
    localStorage.setItem(backupKey() + ":" + label, JSON.stringify(value));
  }

  async function resolveMigration(action: "cloud" | "device" | "fresh" | "merge") {
    if (!migration || !client || !user) return;
    setBusy(true); setError("");
    const version = sessionVersion.current;
    const controller = new AbortController();
    cloudAbort.current?.abort(); cloudAbort.current = controller;
    try {
      if (action === "cloud") {
        if (!migration.remote) throw new Error("Tài khoản chưa có sổ để sử dụng.");
        revision.current = migration.remote.revision;
        ownCloudRef.current = { ledger: migration.remote.payload, revision: migration.remote.revision };
        setLedger(migration.remote.payload); setMode({ type: "cloud", userId: user.id, revision: migration.remote.revision });
      } else if (action === "fresh") {
        const fresh = migration.remote?.payload || initialLedger();
        const nextRevision = migration.remote?.revision ?? await saveLedger(client, fresh, 0, controller.signal);
        if (version !== sessionVersion.current) return;
        revision.current = nextRevision; ownCloudRef.current = { ledger: fresh, revision: nextRevision };
        setLedger(fresh); setMode({ type: "cloud", userId: user.id, revision: nextRevision });
      } else {
        const remoteRevision = migration.remote?.revision || 0;
        saveBackup("device-before-cloud-migration", migration.local);
        if (migration.remote) saveBackup("cloud-before-overwrite", migration.remote.payload);
        const nextLedger = action === "merge" && migration.remote ? mergeLedgers(migration.local, migration.remote.payload) : migration.local;
        const nextRevision = await saveLedger(client, nextLedger, remoteRevision, controller.signal);
        if (controller.signal.aborted || version !== sessionVersion.current) return;
        revision.current = nextRevision; ownCloudRef.current = { ledger: nextLedger, revision: nextRevision };
        setLedger(nextLedger); setMode({ type: "cloud", userId: user.id, revision: nextRevision });
        toast.success(action === "merge" ? "Đã gộp dữ liệu an toàn." : "Đã chuyển dữ liệu thiết bị lên tài khoản.");
      }
      setMigration(null); setReady(true);
    } catch (reason) { if (!controller.signal.aborted) setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }

  async function logout() {
    sessionVersion.current += 1;
    restoreLocalImmediately();
    const result = await client?.auth.signOut();
    if (result?.error) setError("Đã ẩn dữ liệu tài khoản khỏi thiết bị, nhưng máy chủ chưa xác nhận đăng xuất: " + errorMessage(result.error));
    else { setUser(null); toast.success("Đã đăng xuất. Dữ liệu trên thiết bị đã được khôi phục."); }
  }

  async function openShared(ownerId: string, displayName: string) {
    if (!client || !user) return;
    setBusy(true); setError("");
    try {
      if (modeRef.current.type === "cloud") ownCloudRef.current = { ledger, revision: revision.current };
      const remote = await loadLedger(client, ownerId);
      if (!remote) throw new Error("Quyền xem không còn hiệu lực hoặc dữ liệu không tồn tại.");
      setLedger(remote.payload); setMode({ type: "shared", ownerId, displayName }); setTab("overview");
      setMonth(today().slice(0, 7)); setPayrollMonth(defaultPayrollMonth(remote.payload));
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }

  const returnToOwnData = useCallback(() => {
    if (user && ownCloudRef.current) {
      revision.current = ownCloudRef.current.revision;
      setLedger(ownCloudRef.current.ledger);
      setMode({ type: "cloud", userId: user.id, revision: ownCloudRef.current.revision });
    } else restoreLocalImmediately();
  }, [user, restoreLocalImmediately]);

  useEffect(() => {
    if (mode.type !== "shared" || !client) return;
    let stopped = false;
    const verify = async () => {
      try {
        const remote = await loadLedger(client, mode.ownerId);
        if (stopped) return;
        if (!remote) { toast.error("Quyền xem đã bị thu hồi."); returnToOwnData(); }
        else setLedger(remote.payload);
      } catch { if (!stopped) { toast.error("Không thể xác minh quyền xem. Đã quay lại dữ liệu của bạn."); returnToOwnData(); } }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void verify(); };
    const timer = window.setInterval(() => void verify(), 30_000);
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [mode, client, returnToOwnData]);

  function openShift(shift?: Shift, day?: string) {
    if (readOnly && !shift) return;
    setEditing(shift || null);
    setDate(shift?.date || day || today());
    setRoleId(shift?.roleId || ledger.roles.find((x) => x.active)?.id || "");
    setStart(shift?.start || "08:00"); setEnd(shift?.end || "13:00"); setNote(shift?.note || ""); setFormError(""); setShiftModal(true);
  }

  async function saveShift(event: React.FormEvent) {
    event.preventDefault(); setFormError("");
    try {
      if (readOnly) throw new Error("Dữ liệu được chia sẻ ở chế độ chỉ đọc.");
      const next = makeShift(ledger, { id: editing?.id, date, roleId, start, end, note: note.trim() }, editing || undefined);
      await commit({ ...ledger, shifts: [...ledger.shifts.filter((x) => x.id !== next.id), next] });
      setMonth(monthAfterShiftSave(month, date, !!editing));
      setSelected(date); setShiftModal(false); toast.success("Đã lưu ca làm.");
    } catch (reason) { setFormError(errorMessage(reason)); }
  }

  async function signIn(event: React.FormEvent) {
    event.preventDefault(); if (!client) return; setError("");
    try {
      const result = signUp ? await client.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } }) : await client.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      toast.success(signUp ? "Hãy kiểm tra email để xác nhận tài khoản." : "Đã đăng nhập."); setPassword("");
    } catch (reason) { setError(errorMessage(reason)); }
  }

  const shiftsByDate = useMemo(() => {
    const map = new Map<string, Shift[]>();
    for (const shift of ledger.shifts) {
      if (!shift.date.startsWith(month)) continue;
      const list = map.get(shift.date) || [];
      list.push(shift); map.set(shift.date, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.start.localeCompare(b.start));
    return map;
  }, [ledger.shifts, month]);

  const monthShifts = useMemo(() => [...shiftsByDate.values()].flat().sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)), [shiftsByDate]);
  const selectedShifts = shiftsByDate.get(selected) || [];
  const [year, numberMonth] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, numberMonth, 0)).getUTCDate();
  const offset = (new Date(Date.UTC(year, numberMonth - 1, 1)).getUTCDay() + 6) % 7;

  const row = (shift: Shift, showDate = true) => {
    const status = shiftStatus(shift, now);
    const label = status === "completed" ? "Đã xong" : status === "in_progress" ? "Đang làm" : "Sắp tới";
    return (
      <div className="shift-row" key={shift.id}>
        {showDate && <div className="shift-date"><strong>{shift.date.slice(8)}</strong><small>{label}</small></div>}
        <div className="shift-info"><p><span className="role-badge" style={{ "--role-color": shift.color } as React.CSSProperties}>{shift.roleName}</span></p><small>{shift.start} - {shift.end}{shift.note ? " · " + shift.note : ""}</small></div>
        <div className="shift-money">{money(shiftAmount(shift, ledger.shifts))}{!readOnly && <button className="edit-link" onClick={() => openShift(shift)}><Pencil size={12}/> {lockedDate(ledger, shift.date) ? "Xem" : "Sửa"}</button>}</div>
      </div>
    );
  };

  const calendar = (
    <div className="calendar">
      {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((day) => <div className="day-head" key={day}>{day}</div>)}
      {Array.from({ length: offset }, (_, index) => <div className="calendar-day blank" key={"b" + index} />)}
      {Array.from({ length: days }, (_, index) => {
        const day = `${month}-${String(index + 1).padStart(2, "0")}`;
        const shifts = shiftsByDate.get(day) || [];
        const statuses = shifts.map((shift) => shiftStatus(shift, now));
        const status = statuses.includes("in_progress") ? "in-progress" : day === today() ? "today" : statuses.length && statuses.every((item) => item === "completed") ? "completed" : "future";
        const formatted = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "long" }).format(new Date(day + "T12:00:00+07:00"));
        return (
          <button key={day} aria-label={`${day === today() ? "Hôm nay, " : ""}${formatted}, ${shifts.length} ca`} onClick={() => setSelected(day)} className={`calendar-day ${status}${selected === day ? " selected" : ""}`}>
            <span className="day-number">{index + 1}</span>
            <span className="calendar-mini-list">{shifts.slice(0, 2).map((shift) => <span className="calendar-mini-shift" key={shift.id}><b>{shift.roleName}</b><small>{shift.start}–{shift.end}</small></span>)}{shifts.length > 2 && <small>+{shifts.length - 2} ca</small>}</span>
            {shifts.length > 0 && <span className="calendar-count">{shifts.length} ca</span>}
          </button>
        );
      })}
    </div>
  );

  const ownNavigation = readOnly ? navigation.filter(([id]) => id !== "settings") : navigation;
  const title = ownNavigation.find((item) => item[0] === tab)?.[1] || "Tổng quan";
  const selectedRate = applicable(ledger.rates.filter((item) => item.roleId === roleId), date);
  const editingLocked = !!editing && lockedDate(ledger, editing.date);

  const authPanel = user ? null : (
    <section className="card card-pad auth-panel">
      <h2>{signUp ? "Tạo tài khoản" : "Đăng nhập"}</h2>
      {!client && <p className="helper mt-3">Chưa kết nối Supabase. Dữ liệu chỉ lưu trên thiết bị.</p>}
      <form className="form-stack mt-5" onSubmit={signIn}>
        <Field label="Email"><input aria-label="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></Field>
        <Field label="Mật khẩu"><input aria-label="Mật khẩu" type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></Field>
        <button className="btn primary" disabled={!client}>{signUp ? "Đăng ký" : "Đăng nhập"}</button>
        <button className="btn ghost" type="button" onClick={() => setSignUp((value) => !value)}>{signUp ? "Quay lại đăng nhập" : "Tạo tài khoản"}</button>
      </form>
    </section>
  );

  return (
    <>
      <AppToaster />
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><CalendarCheck2 size={21}/></span>ShiftTrack<b>.</b></div>
        <div className="top-status"><ThemeToggle/><button className="btn ghost account-button" onClick={() => setTab("settings")} disabled={readOnly}>{user ? <span className="avatar">{profile?.display_name?.[0]?.toUpperCase() || "N"}</span> : <><LogIn size={16}/><span className="account-label">Đăng nhập</span></>}</button></div>
      </header>
      <main className="app-shell">
        <aside className="desktop-nav">{ownNavigation.map(([id, label, Icon]) => <button className={tab === id ? "active" : ""} onClick={() => setTab(id)} key={id}><Icon size={18}/>{label}</button>)}</aside>
        <div className={`wrap ${(tab === "overview" || tab === "calendar") && !readOnly ? "page--with-fab" : "page--without-fab"}`}>
          {readOnly && <div className="shared-view-banner"><div><Eye size={17}/><span>Đang xem dữ liệu của <strong>{mode.displayName}</strong></span><span className="readonly-badge">READ ONLY</span></div><button className="btn" onClick={returnToOwnData}>Quay lại dữ liệu của tôi</button></div>}
          <div className="page-head"><div><h1>{title}</h1><p>{tab === "overview" ? `Kỳ công ${shortDate(totals.start)} - ${shortDate(totals.end)}` : tab === "calendar" ? "Lịch làm theo tháng" : tab === "payroll" ? "Xem nhanh lương và lịch sử theo tháng" : tab === "sharing" ? "Quản lý quyền xem read-only bằng mã" : "Cài đặt lương, dữ liệu và tài khoản"}</p></div></div>
          {error && <p className="error-message" role="alert">{error}</p>}
          <nav className="navtabs">{ownNavigation.map(([id, label, Icon]) => <button key={id} className={`navtab ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}><Icon size={17}/>{label}</button>)}</nav>

          {tab === "overview" && <>
            <div className="page-toolbar"><MonthNavigator month={month} onChange={setMonth}/></div>
            <div className="grid-main">
              <div>
                <section className="summary">
                  <div className="summary-top"><span>KỲ CÔNG THÁNG {month.slice(5)}</span><span className="summary-tag">{totals.closed ? "Đã chốt" : "Đang ghi nhận"}</span></div>
                  <div className="forecast-values"><div><small>ĐÃ TÍCH LŨY</small><strong>{money(totals.earnedExpected)}</strong></div><div><small>GIỜ ĐÃ LÀM</small><strong>{hours(totals.earnedMinutes)} <span style={{fontSize: '16px', fontWeight: 'normal'}}>giờ</span></strong></div></div>
                  
                  <div className="summary-stats" aria-label="Tóm tắt kỳ công"><div><Wallet size={16}/><small>DỰ KIẾN CUỐI KỲ</small><strong>{money(totals.forecastExpected)}</strong></div><div><Clock3 size={16}/><small>TỔNG GIỜ KỲ</small><strong>{hours(totals.minutes)} giờ</strong></div><div><CalendarDays size={16}/><small>CA TRONG KỲ</small><strong>{totals.shifts.length} ca</strong></div><div><Wallet size={16}/><small>CA CHƯA KẾT THÚC</small><strong>{money(totals.forecastWages)}</strong></div></div>
                  <div className="summary-progress"><div><span>Tiến độ kỳ công</span><strong>{totals.earnedShifts.length}/{totals.shifts.length} ca đã kết thúc</strong></div><div className="bar"><span style={{ width: (totals.shifts.length ? (totals.earnedShifts.length / totals.shifts.length) * 100 : 0) + "%" }}/></div></div>
                </section>
                <section className="card card-pad"><div className="section-head"><h2>Ca đang làm và sắp tới</h2><button className="btn ghost" onClick={() => setTab("calendar")}>Mở lịch</button></div>{totals.futureShifts.slice(0, 5).map((shift) => row(shift))}{!totals.futureShifts.length && <Blank title="Chưa có ca sắp tới" text="Thêm ca làm để xem dự kiến cuối kỳ." action={!readOnly ? <button className="btn primary" onClick={() => openShift()}>Thêm ca</button> : undefined}/>}</section>
              </div>
              <aside className="right-stack"><section className="card card-pad"><h2>Thu nhập theo vị trí</h2>{ledger.roles.some((role) => totals.shifts.some((shift) => shift.roleId === role.id)) ? ledger.roles.map((role) => { const shifts = totals.shifts.filter((shift) => shift.roleId === role.id); return shifts.length ? <div className="total-row" key={role.id}><span>{role.name}</span><strong>{money(shifts.reduce((sum, shift) => sum + shiftAmount(shift, totals.shifts), 0))}</strong></div> : null; }) : <Blank title="Chưa có dữ liệu thu nhập" text="Tháng này chưa có ca để phân tích theo vị trí."/>}</section></aside>
            </div>
          </>}

          {tab === "calendar" && <div className="calendar-workspace">
            <section className="card card-pad calendar-card"><div className="section-head"><h2>Lịch làm tháng {numberMonth}/{year}</h2></div><MonthNavigator month={month} onChange={(value) => { setMonth(value); if (!selected.startsWith(value)) setSelected(value + "-01"); }}/>{calendar}</section>
            <section className="card card-pad selected-day-panel"><div className="section-head"><div><h2>{selected.startsWith(month) ? `Ngày ${shortDate(selected)}` : "Chi tiết ngày"}</h2><p className="helper">Chọn một ngày trên lịch để xem ca.</p></div>{!readOnly && <button className="btn primary" onClick={() => openShift(undefined, selected)}><Plus size={15}/> Thêm ca</button>}</div>{selectedShifts.length ? selectedShifts.map((shift) => row(shift, false)) : <Blank title="Ngày này chưa có ca" text="Bạn có thể thêm ca mới cho ngày đã chọn."/>}</section>
            <section className="card card-pad"><div className="section-head"><div><h2>Ca làm trong tháng</h2><p className="helper">Toàn bộ lịch sử trong tháng đang xem.</p></div><span className="chip">{monthShifts.length} ca</span></div>{monthShifts.length ? <div className="monthly-shift-list">{Array.from(new Set(monthShifts.map((shift) => shift.date))).map((day) => <section className="shift-day-group" key={day}><h3>{shortDate(day)}/{day.slice(0, 4)}</h3>{(shiftsByDate.get(day) || []).map((shift) => row(shift, false))}</section>)}</div> : <Blank title="Chưa có ca trong tháng" text="Tháng này chưa có lịch làm."/>}</section>
          </div>}

          {tab === "payroll" && <PayrollReconciliation key={`${payrollMonth}-${readOnly ? "shared" : "own"}`} data={ledger} month={payrollMonth} onMonthChange={setPayrollMonth} commit={commit} busy={busy} readOnly={readOnly}/>} 

          {tab === "sharing" && <SharingPanel client={client} user={user} profile={profile} onProfileChange={setProfile} onOpenShared={(ownerId, displayName) => void openShared(ownerId, displayName)}/>} 

          {tab === "settings" && !readOnly && <div className="settings-hub">
            {!user && <section className="settings-section"><div className="section-head"><div><h2>Tài khoản</h2><p className="helper">Đăng nhập để đồng bộ dữ liệu.</p></div><span className="chip">Thiết bị</span></div>{authPanel}</section>}
            <section className="settings-section"><div className="section-head"><div><h2>Vị trí, mức lương & quy tắc</h2><p className="helper">Các thay đổi mới không tự ghi đè snapshot của ca lịch sử.</p></div></div><PayrollSettings data={ledger} commit={commit} busy={busy} readOnly={false}/></section>
            <section className="settings-section"><div className="section-head"><div><h2>Dữ liệu & đồng bộ</h2><p className="helper">Dữ liệu thiết bị luôn được giữ riêng khi bạn dùng tài khoản.</p></div></div><section className="card card-pad"><p className="helper">Nguồn hiện tại: <strong>{mode.type === "cloud" ? "Supabase account" : "localStorage thiết bị"}</strong>. Backup tự động được tạo trước thao tác nhập/gộp có thể ghi đè dữ liệu cloud.</p></section></section>
            {user && <button className="btn danger" style={{ width: '100%', padding: '12px', marginTop: '8px' }} onClick={() => { if (window.confirm("Bạn có chắc chắn muốn đăng xuất khỏi tài khoản?")) void logout(); }}><LogOut size={16}/> Đăng xuất</button>}
          </div>}
        </div>
      </main>

      {(tab === "overview" || tab === "calendar") && !readOnly && <button className="floating-add" aria-label="Thêm ca" title="Thêm ca" onClick={() => openShift(undefined, tab === "calendar" ? selected : undefined)}><Plus size={24}/></button>}

      <Modal open={shiftModal} onClose={() => setShiftModal(false)} title={editing ? (editingLocked ? "Chi tiết ca đã khóa" : "Sửa ca làm") : "Thêm ca làm"} description={editingLocked ? "Kỳ lương đã được chốt. Ca này không thể chỉnh sửa hoặc xóa." : "Nhập ngày, vị trí và giờ làm."}>
        <form className="form-stack" onSubmit={saveShift}>
          <fieldset className="form-grid" disabled={readOnly || editingLocked}>
            <Field label="Ngày làm"><DatePicker label="Ngày làm" value={date} onChange={setDate}/></Field>
            <Field label="Vị trí"><Choose label="Vị trí" value={roleId} onChange={setRoleId} items={ledger.roles.filter((item) => item.active || item.id === editing?.roleId).map((item) => ({ value: item.id, label: item.name + (applicable(ledger.rates.filter((rate) => rate.roleId === item.id), date) ? "" : " · Chưa thiết lập mức lương") }))}/></Field>
            <Field label="Giờ bắt đầu"><TimePicker label="Giờ bắt đầu" value={start} onChange={setStart}/></Field>
            <Field label="Giờ kết thúc"><TimePicker label="Giờ kết thúc" value={end} onChange={setEnd}/></Field>
            <Field label="Ghi chú" className="full"><input aria-label="Ghi chú" value={note} maxLength={300} onChange={(event) => setNote(event.target.value)}/></Field>
          </fieldset>
          {!selectedRate && !editingLocked && <div className="warning-box"><strong>Mức lương chưa được thiết lập</strong><p>Vị trí này chưa có mức lương áp dụng cho ngày đã chọn.</p><button type="button" className="btn" onClick={() => { setShiftModal(false); setTab("settings"); }}>Thiết lập mức lương</button></div>}
          {formError && <p role="alert" className="error-message">{formError}</p>}
          <div className="form-footer">
            {editing && !readOnly && <button type="button" className="btn icon danger" aria-label="Xóa ca" disabled={editingLocked} onClick={async () => {
              if (!window.confirm("Xóa ca này? Thao tác sẽ thay đổi dữ liệu lương của kỳ đang mở.")) return;
              try { await commit(removeShift(ledger, editing.id)); setShiftModal(false); toast.success("Đã xóa ca làm."); }
              catch (reason) { setFormError(errorMessage(reason)); }
            }}><Trash2 size={16}/></button>}
            <button type="button" className="btn" onClick={() => setShiftModal(false)}>Đóng</button>
            {!readOnly && !editingLocked && <button className="btn primary" disabled={busy || !selectedRate}>Lưu</button>}
          </div>
        </form>
      </Modal>

      <Modal open={!!migration} onClose={() => {}} title="Chọn nguồn dữ liệu" description={migration?.kind === "cloud-empty" ? "Bạn đang có dữ liệu trên thiết bị này. Bạn muốn làm gì?" : "Thiết bị và tài khoản đều có dữ liệu. ShiftTrack sẽ không tự ghi đè một bên."}>
        {migration && <div className="migration-actions">
          <p className="helper">Dữ liệu localStorage trên thiết bị sẽ không bị xóa bởi các lựa chọn bên dưới.</p>
          {migration.kind === "cloud-empty" ? <>
            <button className="btn primary" disabled={busy} onClick={() => void resolveMigration("device")}>Chuyển dữ liệu thiết bị lên tài khoản</button>
            <button className="btn" disabled={busy} onClick={() => void resolveMigration("fresh")}>Bắt đầu tài khoản mới</button>
          </> : <>
            <button className="btn primary" disabled={busy} onClick={() => void resolveMigration("cloud")}>Sử dụng dữ liệu tài khoản</button>
            <button className="btn" disabled={busy} onClick={() => { if (window.confirm("Dùng dữ liệu thiết bị làm dữ liệu tài khoản? Một backup của cả hai bên sẽ được lưu trên thiết bị trước khi ghi.")) void resolveMigration("device"); }}>Giữ dữ liệu thiết bị trên tài khoản</button>
            <button className="btn" disabled={busy} onClick={() => void resolveMigration("merge")}>Gộp dữ liệu (chặn conflict cùng ID)</button>
          </>}
          <button className="btn ghost" disabled={busy} onClick={() => void logout()}>Hủy và đăng xuất</button>
        </div>}
      </Modal>

      <Modal open={!!recovery} onClose={() => {}} title="Không thể đọc dữ liệu trên thiết bị" description="Dữ liệu gốc vẫn được giữ nguyên. Hãy chọn cách khôi phục trước khi tiếp tục.">
        {recovery && <div className="migration-actions">
          <p className="error-message" role="alert">{recovery.error}</p>
          <button className="btn primary" onClick={() => { const local = readLocal(); if (local) { setLedger(local); setReady(true); } }}>Thử lại</button>
          <button className="btn" onClick={() => {
            const blob = new Blob([recovery.raw], { type: "application/json" });
            const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `shifttrack-corrupted-${Date.now()}.json`; link.click(); URL.revokeObjectURL(link.href);
          }}>Tải dữ liệu lỗi xuống dạng JSON</button>
          <button className="btn" onClick={() => {
            const keys = Object.keys(localStorage).filter((key) => key.startsWith(BACKUP_PREFIX)).sort().reverse();
            for (const key of keys) {
              const result = readDeviceRaw(localStorage.getItem(key));
              if (result.ok) { const raw = JSON.stringify(result.ledger); localStorage.setItem(LOCAL_KEY, raw); deviceSnapshot.current = raw; localLedgerRef.current = result.ledger; setLedger(result.ledger); setRecovery(null); setReady(true); toast.success("Đã khôi phục từ backup gần nhất."); return; }
            }
            setError("Không tìm thấy backup hợp lệ trên thiết bị.");
          }}>Khôi phục từ backup gần nhất</button>
          <button className="btn danger" onClick={() => {
            if (!window.confirm("Reset dữ liệu thiết bị? Thao tác này chỉ xóa dữ liệu lưu trên thiết bị hiện tại và không xóa dữ liệu cloud.")) return;
            const fresh = initialLedger(); const raw = JSON.stringify(fresh); localStorage.setItem(backupKey() + ":corrupted-before-reset", recovery.raw); localStorage.setItem(LOCAL_KEY, raw); deviceSnapshot.current = raw; localLedgerRef.current = fresh; setLedger(fresh); setRecovery(null); setReady(true); toast.success("Đã reset dữ liệu trên thiết bị.");
          }}>Reset dữ liệu thiết bị</button>
        </div>}
      </Modal>
    </>
  );
}
