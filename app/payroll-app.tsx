"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  CalendarCheck2,
  CalendarDays,
  Clock3,
  LayoutDashboard,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  Settings2,
  Trash2,
  Users,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { DatePicker, TimePicker } from "@/components/payroll-pickers";
import { AppToaster, ThemeToggle } from "@/components/theme-controls";
import { Blank, Choose, Field, Modal } from "@/components/payroll-ui";
import PayrollSettings from "@/components/payroll-settings";
import PayrollReconciliation from "@/components/payroll-reconciliation";
import SocialFriends from "@/components/social-friends";
import SocialNotifications, { NotificationPreferences } from "@/components/social-notifications";
import SocialProfile from "@/components/social-profile";
import { cloudClient, loadLedger, saveLedger, type Profile } from "@/lib/cloud";
import { errorMessage } from "@/lib/errors";
import { parseLedger } from "@/lib/ledger-schema";
import {
  initialLedger,
  defaultPayrollMonth,
  lockedDate,
  makeShift,
  money,
  periodForecast,
  shiftAmount,
  shiftStatus,
  shortDate,
  today,
  type Ledger,
  type Shift,
} from "@/lib/payroll";

const LOCAL_KEY = "ca-lam-local-v1";
const navigation = [
  ["overview", "Tổng quan", LayoutDashboard],
  ["calendar", "Lịch làm", CalendarDays],
  ["friends", "Bạn bè", Users],
  ["payroll", "Kỳ lương", Wallet],
  ["settings", "Cài đặt", Settings2],
] as const;
type Tab = (typeof navigation)[number][0];
function fromDevice(): Ledger {
  const raw = localStorage.getItem(LOCAL_KEY);
  return raw ? parseLedger(JSON.parse(raw)) : initialLedger();
}

export default function PayrollApp() {
  const [ledger, setLedger] = useState<Ledger>(initialLedger);
  const [tab, setTab] = useState<Tab>("overview");
  const [month, setMonth] = useState(today().slice(0, 7)),
    [payrollMonth, setPayrollMonth] = useState(today().slice(0, 7)),
    [selected, setSelected] = useState(today()),
    [now, setNow] = useState(new Date());
  const [client, setClient] = useState<SupabaseClient | null>(null),
    [user, setUser] = useState<User | null>(null),
    [profile, setProfile] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const [shiftModal, setShiftModal] = useState(false),
    [editing, setEditing] = useState<Shift | null>(null),
    [date, setDate] = useState(today()),
    [roleId, setRoleId] = useState("cook"),
    [start, setStart] = useState("08:00"),
    [end, setEnd] = useState("13:00"),
    [note, setNote] = useState(""),
    [formError, setFormError] = useState("");
  const [conversation, setConversation] = useState("");
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [signUp, setSignUp] = useState(false);
  const revision = useRef(0),
    deviceSnapshot = useRef<string | null>(null),
    payrollMonthInitialized = useRef(false);
  const totals = useMemo(
    () => periodForecast(ledger, month, now),
    [ledger, month, now],
  );

  useEffect(() => {
    if (!ready || payrollMonthInitialized.current) return;
    setPayrollMonth(defaultPayrollMonth(ledger, now));
    payrollMonthInitialized.current = true;
  }, [ledger, now, ready]);

  useEffect(() => {
    try {
      deviceSnapshot.current = localStorage.getItem(LOCAL_KEY);
      setLedger(fromDevice());
      setReady(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    let timer: number | undefined;
    const refresh = () => setNow(new Date());
    const schedule = () => {
      window.clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      timer = window.setTimeout(() => {
        refresh();
        schedule();
      }, 60_000 - (Date.now() % 60_000));
    };
    const visibility = () => {
      if (document.visibilityState === "visible") refresh();
      schedule();
    };
    schedule();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    let alive = true;
    let unsubscribe: undefined | (() => void);
    void cloudClient()
      .then(async (service) => {
        if (!alive) return;
        setClient(service);
        if (!service) return;
        const {
          data: { session },
        } = await service.auth.getSession();
        setUser(session?.user || null);
        const watch = service.auth.onAuthStateChange((_event, next) =>
          setUser(next?.user || null),
        );
        unsubscribe = () => watch.data.subscription.unsubscribe();
      })
      .catch((e) => setError(errorMessage(e)));
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, []);
  useEffect(() => {
    let alive = true;
    if (!client || !user) {
      setProfile(null);
      return;
    }
    void (async () => {
      try {
        let item = await client
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .maybeSingle();
        if (item.error) throw item.error;
        if (!item.data) {
          const created = await client
            .from("profiles")
            .insert({
              id: user.id,
              username: "user_" + user.id.replaceAll("-", "").slice(0, 16),
              display_name: String(
                user.user_metadata?.display_name || "Người dùng",
              ).slice(0, 80),
            })
            .select()
            .single();
          if (created.error) throw created.error;
          item = created;
        }
        const remote = await loadLedger(client, user.id);
        if (!alive) return;
        setProfile(item.data as Profile);
        setLedger(remote?.payload || initialLedger());
        revision.current = remote?.revision || 0;
        setReady(true);
      } catch (e) {
        if (alive) setError(errorMessage(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [client, user]);
  async function commit(next: Ledger) {
    if (!ready) throw new Error("Sổ lương chưa sẵn sàng.");
    setBusy(true);
    try {
      if (client && user)
        revision.current = await saveLedger(client, next, revision.current);
      else {
        if (localStorage.getItem(LOCAL_KEY) !== deviceSnapshot.current)
          throw new Error("Dữ liệu đã thay đổi ở tab khác.");
        const raw = JSON.stringify(next);
        localStorage.setItem(LOCAL_KEY, raw);
        deviceSnapshot.current = raw;
      }
      setLedger(next);
    } finally {
      setBusy(false);
    }
  }
  function openShift(shift?: Shift, day?: string) {
    setEditing(shift || null);
    setDate(shift?.date || day || today());
    setRoleId(shift?.roleId || ledger.roles.find((x) => x.active)?.id || "");
    setStart(shift?.start || "08:00");
    setEnd(shift?.end || "13:00");
    setNote(shift?.note || "");
    setFormError("");
    setShiftModal(true);
  }
  async function saveShift(event: React.FormEvent) {
    event.preventDefault();
    try {
      const next = makeShift(
        ledger,
        { id: editing?.id, date, roleId, start, end, note: note.trim() },
        editing || undefined,
      );
      await commit({
        ...ledger,
        shifts: [...ledger.shifts.filter((x) => x.id !== next.id), next],
      });
      setMonth(date.slice(0, 7));
      setSelected(date);
      setShiftModal(false);
      toast.success("Đã lưu ca làm.");
    } catch (e) {
      setFormError(errorMessage(e));
    }
  }
  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    if (!client) return;
    try {
      const result = signUp
        ? await client.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: window.location.origin },
          })
        : await client.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      toast.success(
        signUp ? "Hãy kiểm tra email để xác nhận tài khoản." : "Đã đăng nhập.",
      );
      setPassword("");
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const row = (shift: Shift) => {
    const status = shiftStatus(shift, now);
    return (
      <div className="shift-row" key={shift.id}>
        <div className="shift-date">
          <strong>{shift.date.slice(8)}</strong>
          <small>
            {status === "completed"
              ? "Đã xong"
              : status === "today"
                ? "Hôm nay"
                : "Sắp tới"}
          </small>
        </div>
        <div className="shift-info">
          <p>
            <span
              className="role-badge"
              style={{ "--role-color": shift.color } as React.CSSProperties}
            >
              {shift.roleName}
            </span>
          </p>
          <small>
            {shift.start} - {shift.end}
            {shift.note ? " · " + shift.note : ""}
          </small>
        </div>
        <div className="shift-money">
          {money(shiftAmount(shift, ledger.shifts))}
          <button className="edit-link" onClick={() => openShift(shift)}>
            <Pencil size={12} />
            Sửa
          </button>
        </div>
      </div>
    );
  };
  const [year, numberMonth] = month.split("-").map(Number),
    days = new Date(Date.UTC(year, numberMonth, 0)).getUTCDate(),
    offset = (new Date(Date.UTC(year, numberMonth - 1, 1)).getUTCDay() + 6) % 7;
  const calendar = (
    <div className="calendar">
      {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((day) => (
        <div className="day-head" key={day}>
          {day}
        </div>
      ))}
      {Array.from({ length: offset }, (_, i) => (
        <div className="calendar-day blank" key={"b" + i} />
      ))}
      {Array.from({ length: days }, (_, i) => {
        const day = `${month}-${String(i + 1).padStart(2, "0")}`,
          shifts = ledger.shifts.filter((x) => x.date === day);
        const status = shifts.some((x) => shiftStatus(x, now) === "completed")
          ? "completed"
          : day === today()
            ? "today"
            : "future";
        return (
          <button
            key={day}
            onClick={() => setSelected(day)}
            className={
              "calendar-day " + status + (selected === day ? " selected" : "")
            }
          >
            <span className="day-number">{i + 1}</span>
            {shifts.slice(0, 2).map((x) => (
              <span
                className="calendar-role"
                style={{ "--role-color": x.color } as React.CSSProperties}
                key={x.id}
              >
                {x.start} {x.roleName}
              </span>
            ))}
            {shifts.length > 0 && (
              <small>
                {status === "completed"
                  ? "Đã xong"
                  : status === "today"
                    ? "Hôm nay"
                    : "Sắp tới"}
              </small>
            )}
          </button>
        );
      })}
    </div>
  );
  const profilePane = user ? (
    <SocialProfile client={client} user={user} />
  ) : (
    <section className="card card-pad auth-panel">
      <h2>{signUp ? "Tạo tài khoản" : "Đăng nhập"}</h2>
      {!client && (
        <p className="helper mt-3">
          Chưa kết nối Supabase. Dữ liệu chỉ lưu trên thiết bị.
        </p>
      )}
      <form className="form-stack mt-5" onSubmit={signIn}>
        <Field label="Email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <Field label="Mật khẩu">
          <input
            type="password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <button className="btn primary" disabled={!client}>
          {signUp ? "Đăng ký" : "Đăng nhập"}
        </button>
        <button
          className="btn ghost"
          type="button"
          onClick={() => setSignUp((x) => !x)}
        >
          {signUp ? "Quay lại đăng nhập" : "Tạo tài khoản"}
        </button>
      </form>
    </section>
  );
  return (
    <>
      <AppToaster />
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <CalendarCheck2 size={21} />
          </span>
          ShiftTrack<b>.</b>
        </div>
        <div className="top-status">
          <ThemeToggle />
          <SocialNotifications
            client={client}
            user={user}
            onOpenFriends={(friendshipId) => {
              if (friendshipId) setConversation(friendshipId);
              setTab("friends");
            }}
          />
          <button className="btn ghost" onClick={() => setTab("settings")}>
            {user ? (
              <span className="avatar">
                {profile?.display_name[0]?.toUpperCase() || "B"}
              </span>
            ) : (
              <>
                <LogIn size={16} />
                Đăng nhập
              </>
            )}
          </button>
        </div>
      </header>
      <main className="app-shell">
        <aside className="desktop-nav">
          {navigation.map(([id, label, Icon]) => (
            <button
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
              key={id}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </aside>
        <div className="wrap">
          <div className="page-head">
            <div>
              <h1>{navigation.find((x) => x[0] === tab)?.[1]}</h1>
              <p>
                {tab === "overview"
                  ? "Kỳ công " +
                    shortDate(totals.start) +
                    " - " +
                    shortDate(totals.end)
                  : tab === "calendar"
                    ? "Lịch làm của bạn"
                    : tab === "payroll"
                      ? "Kiểm tra lương sau khi nhận"
                      : tab === "settings"
                        ? "Tài khoản, lương và tùy chọn ứng dụng"
                        : "Không gian riêng tư của bạn"}
              </p>
            </div>
            {(tab === "overview" || tab === "calendar") && (
              <button className="btn primary" onClick={() => openShift()}>
                <Plus size={16} />
                Thêm ca
              </button>
            )}
          </div>
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <nav className="navtabs">
            {navigation.map(([id, label, Icon]) => (
              <button
                key={id}
                className={"navtab " + (tab === id ? "active" : "")}
                onClick={() => setTab(id)}
              >
                <Icon size={17} />
                {label}
              </button>
            ))}
          </nav>
          {tab === "overview" && (
            <div className="grid-main">
              <div>
                <section className="summary">
                  <div className="summary-top">
                    <span>KỲ CÔNG THÁNG {month.slice(5)}</span>
                    <span className="summary-tag">
                      {totals.closed ? "Đã chốt" : "Đang ghi nhận"}
                    </span>
                  </div>
                  <div className="forecast-values">
                    <div>
                      <small>ĐÃ TÍCH LŨY</small>
                      <strong>{money(totals.earnedExpected)}</strong>
                    </div>
                    <div>
                      <small>DỰ KIẾN CUỐI KỲ</small>
                      <strong>{money(totals.forecastExpected)}</strong>
                    </div>
                  </div>
                  <div className="summary-bottom">
                    <span>{totals.earnedShifts.length} ca đã hoàn thành</span>
                    <span>{totals.futureShifts.length} ca sắp tới</span>
                  </div>
                </section>
                <div className="metrics">
                  <div className="metric">
                    <Clock3 size={17} />
                    <div className="value">
                      {Math.round(totals.minutes / 6) / 10}
                      <span>giờ</span>
                    </div>
                    <p>Tổng giờ trong kỳ</p>
                  </div>
                  <div className="metric">
                    <CalendarDays size={17} />
                    <div className="value">
                      {totals.shifts.length}
                      <span>ca</span>
                    </div>
                    <p>Ca làm trong kỳ</p>
                  </div>
                  <div className="metric">
                    <Wallet size={17} />
                    <div className="value">{money(totals.forecastWages)}</div>
                    <p>Tiền ca sắp tới</p>
                  </div>
                </div>
                <section className="card card-pad">
                  <div className="section-head">
                    <h2>Ca hôm nay và sắp tới</h2>
                    <button
                      className="btn ghost"
                      onClick={() => setTab("calendar")}
                    >
                      Mở lịch
                    </button>
                  </div>
                  {totals.futureShifts.slice(0, 5).map(row)}
                  {!totals.futureShifts.length && (
                    <Blank
                      title="Chưa có ca sắp tới"
                      text="Thêm ca làm để xem dự kiến cuối kỳ."
                    />
                  )}
                </section>
              </div>
              <aside className="right-stack">
                <section className="card card-pad">
                  <h2>Tiến độ kỳ công</h2>
                  <p className="helper mt-3">
                    {totals.earnedShifts.length}/{totals.shifts.length} ca đã
                    kết thúc.
                  </p>
                  <div className="bar mt-3">
                    <span
                      style={{
                        width:
                          (totals.shifts.length
                            ? (totals.earnedShifts.length /
                                totals.shifts.length) *
                              100
                            : 0) + "%",
                      }}
                    />
                  </div>
                </section>
                <section className="card card-pad">
                  <h2>Thu nhập theo vị trí</h2>
                  {ledger.roles.map((role) => {
                    const shifts = totals.shifts.filter(
                      (x) => x.roleId === role.id,
                    );
                    return shifts.length ? (
                      <div className="total-row" key={role.id}>
                        <span>{role.name}</span>
                        <strong>
                          {money(
                            shifts.reduce(
                              (sum, x) => sum + shiftAmount(x, totals.shifts),
                              0,
                            ),
                          )}
                        </strong>
                      </div>
                    ) : null;
                  })}
                </section>
              </aside>
            </div>
          )}
          {tab === "calendar" && (
            <div className="grid-main">
              <section className="card card-pad">
                <div className="section-head">
                  <h2>
                    Lịch làm tháng {numberMonth}/{year}
                  </h2>
                  <button
                    className="btn icon"
                    aria-label="Thêm ca"
                    onClick={() => openShift(undefined, selected)}
                  >
                    <Plus size={16} />
                  </button>
                </div>
                {calendar}
              </section>
              <section className="card card-pad">
                <h2>Ngày {shortDate(selected)}</h2>
                {ledger.shifts
                  .filter((x) => x.date === selected)
                  .sort((a, b) => a.start.localeCompare(b.start))
                  .map(row)}
              </section>
            </div>
          )}
          {tab === "friends" && (
            <SocialFriends
              key={conversation}
              client={client}
              user={user}
              initialConversation={conversation}
            />
          )}
          {tab === "payroll" && (
            <PayrollReconciliation
              key={payrollMonth}
              data={ledger}
              month={payrollMonth}
              onMonthChange={setPayrollMonth}
              commit={commit}
              busy={busy}
            />
          )}{" "}
          {tab === "settings" && (
            <div className="settings-hub">
              <section className="settings-account">
                <div className="section-head">
                  <div>
                    <h2>Tài khoản & hồ sơ</h2>
                    <p className="helper">Thông tin hiển thị với bạn bè và tài khoản đăng nhập.</p>
                  </div>
                </div>
                {profilePane}
                {user && (
                  <button
                    className="btn ghost"
                    onClick={async () => {
                      const result = await client?.auth.signOut();
                      if (result?.error) setError(errorMessage(result.error));
                      else toast.success("Đã đăng xuất.");
                    }}
                  >
                    <LogOut size={16} />
                    Đăng xuất
                  </button>
                )}
              </section>
              <div className="settings-utilities">
                <section className="card card-pad">
                  <h2>Giao diện</h2>
                  <p className="helper mt-2">Chọn giao diện phù hợp với môi trường làm việc của bạn.</p>
                  <div className="settings-control-row"><span>Chế độ tối</span><ThemeToggle /></div>
                </section>
                <NotificationPreferences client={client} user={user} />
              </div>
              <PayrollSettings
                data={ledger}
                commit={commit}
                busy={busy}
                readOnly={false}
              />
            </div>
          )}{" "}
        </div>
      </main>
      <Modal
        open={shiftModal}
        onClose={() => setShiftModal(false)}
        title={editing ? "Sửa ca làm" : "Thêm ca làm"}
        description="Nhập ngày, vị trí và giờ làm."
      >
        <form className="form-stack" onSubmit={saveShift}>
          <fieldset
            className="form-grid"
            disabled={!!editing && lockedDate(ledger, editing.date)}
          >
            <Field label="Ngày làm">
              <DatePicker label="Ngày làm" value={date} onChange={setDate} />
            </Field>
            <Field label="Vị trí">
              <Choose
                label="Vị trí"
                value={roleId}
                onChange={setRoleId}
                items={ledger.roles
                  .filter((x) => x.active || x.id === editing?.roleId)
                  .map((x) => ({ value: x.id, label: x.name }))}
              />
            </Field>
            <Field label="Giờ bắt đầu">
              <TimePicker
                label="Giờ bắt đầu"
                value={start}
                onChange={setStart}
              />
            </Field>
            <Field label="Giờ kết thúc">
              <TimePicker label="Giờ kết thúc" value={end} onChange={setEnd} />
            </Field>
            <Field label="Ghi chú" className="full">
              <input
                value={note}
                maxLength={300}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </fieldset>
          {formError && (
            <p role="alert" className="error-message">
              {formError}
            </p>
          )}
          <div className="form-footer">
            {editing && (
              <button
                type="button"
                className="btn icon danger"
                aria-label="Xóa ca"
                onClick={async () => {
                  try {
                    await commit({
                      ...ledger,
                      shifts: ledger.shifts.filter((x) => x.id !== editing.id),
                    });
                    setShiftModal(false);
                  } catch (e) {
                    setFormError(errorMessage(e));
                  }
                }}
              >
                <Trash2 size={16} />
              </button>
            )}
            <button
              type="button"
              className="btn"
              onClick={() => setShiftModal(false)}
            >
              Đóng
            </button>
            <button className="btn primary" disabled={busy}>
              Lưu
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
