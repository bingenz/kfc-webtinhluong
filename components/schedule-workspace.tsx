"use client";

import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { BookOpen, Pencil, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { DatePicker, TimePicker } from "./payroll-pickers";
import { Blank, Choose, Field, Modal } from "./payroll-ui";
import { listSharedWithMe, loadLedger, type Profile, type ShareGrant } from "@/lib/cloud";
import { errorMessage } from "@/lib/errors";
import { shortDate, today, uid, type Ledger, type StudySchedule } from "@/lib/payroll";
import {
  commonFreeByDate,
  expandStudySchedules,
  formatMinutes,
  studyConflictCount,
  validateStudySchedule,
  type StudyOccurrence,
} from "@/lib/schedule";

type Props = {
  view: "study" | "free";
  ledger: Ledger;
  month: string;
  selected: string;
  onSelectedChange: (date: string) => void;
  commit: (ledger: Ledger) => Promise<void>;
  busy: boolean;
  readOnly: boolean;
  client: SupabaseClient | null;
  user: User | null;
  profile: Profile | null;
};

const weekdayItems = [
  [1, "T2"], [2, "T3"], [3, "T4"], [4, "T5"], [5, "T6"], [6, "T7"], [0, "CN"],
] as const;

function monthShape(month: string) {
  const [year, numberMonth] = month.split("-").map(Number);
  return {
    year,
    numberMonth,
    days: new Date(Date.UTC(year, numberMonth, 0)).getUTCDate(),
    offset: (new Date(Date.UTC(year, numberMonth - 1, 1)).getUTCDay() + 6) % 7,
    lastDay: `${month}-${String(new Date(Date.UTC(year, numberMonth, 0)).getUTCDate()).padStart(2, "0")}`,
  };
}

function byDate<T extends { date: string }>(items: T[]) {
  const map = new Map<string, T[]>();
  for (const item of items) map.set(item.date, [...(map.get(item.date) || []), item]);
  return map;
}

export default function ScheduleWorkspace(props: Props) {
  return props.view === "study" ? <StudyWorkspace {...props}/> : <FreeWorkspace {...props}/>;
}

function StudyWorkspace({ ledger, month, selected, onSelectedChange, commit, busy, readOnly }: Props) {
  const shape = monthShape(month);
  const occurrences = useMemo(() => expandStudySchedules(ledger.studySchedules, month), [ledger.studySchedules, month]);
  const occurrencesByDate = useMemo(() => byDate(occurrences), [occurrences]);
  const selectedItems = occurrencesByDate.get(selected) || [];
  const [open, setOpen] = useState(false);
  const [editingOccurrence, setEditingOccurrence] = useState<StudyOccurrence | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<StudySchedule | null>(null);
  const [kind, setKind] = useState<"single" | "weekly">("single");
  const [scope, setScope] = useState<"occurrence" | "series">("occurrence");
  const [date, setDate] = useState(selected);
  const [rangeStart, setRangeStart] = useState(selected);
  const [rangeEnd, setRangeEnd] = useState(shape.lastDay);
  const [weekdays, setWeekdays] = useState<number[]>([new Date(`${selected}T12:00:00Z`).getUTCDay()]);
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("10:00");
  const [formError, setFormError] = useState("");

  function openCreate(day = selected) {
    setEditingOccurrence(null); setEditingSchedule(null); setKind("single"); setScope("occurrence");
    setDate(day); setRangeStart(day); setRangeEnd(shape.lastDay < day ? day : shape.lastDay);
    setWeekdays([new Date(`${day}T12:00:00Z`).getUTCDay()]); setStart("08:00"); setEnd("10:00");
    setFormError(""); setOpen(true);
  }

  function openEdit(item: StudyOccurrence, nextScope: "occurrence" | "series" = "occurrence") {
    const schedule = ledger.studySchedules.find((entry) => entry.id === item.scheduleId);
    if (!schedule) return;
    setEditingOccurrence(item); setEditingSchedule(schedule); setKind(schedule.kind); setScope(nextScope);
    setDate(item.date); setStart(nextScope === "series" ? schedule.start : item.start); setEnd(nextScope === "series" ? schedule.end : item.end);
    if (schedule.kind === "weekly") {
      setRangeStart(schedule.startDate); setRangeEnd(schedule.endDate); setWeekdays(schedule.weekdays);
    }
    setFormError(""); setOpen(true);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault(); setFormError("");
    try {
      let candidate: StudySchedule;
      if (editingSchedule?.kind === "weekly" && scope === "occurrence" && editingOccurrence) {
        candidate = {
          ...editingSchedule,
          exceptions: [
            ...editingSchedule.exceptions.filter((item) => item.date !== editingOccurrence.date),
            { date: editingOccurrence.date, action: "replace", start, end },
          ],
        };
      } else if ((editingSchedule?.kind === "weekly" && scope === "series") || (!editingSchedule && kind === "weekly")) {
        candidate = validateStudySchedule({
          id: editingSchedule?.id || uid(), kind: "weekly", startDate: rangeStart, endDate: rangeEnd,
          weekdays: [...weekdays].sort(), start, end,
          exceptions: editingSchedule?.kind === "weekly"
            ? editingSchedule.exceptions.filter((item) => item.date >= rangeStart && item.date <= rangeEnd)
            : [],
        });
      } else {
        candidate = validateStudySchedule({ id: editingSchedule?.id || uid(), kind: "single", date, start, end });
      }
      validateStudySchedule(candidate);
      const others = ledger.studySchedules.filter((item) => item.id !== candidate.id);
      const conflicts = studyConflictCount(candidate, others, ledger.shifts);
      if (conflicts && !window.confirm(`Lịch này có ${conflicts} xung đột với ca làm hoặc buổi học khác. Vẫn lưu?`)) return;
      await commit({ ...ledger, studySchedules: [...others, candidate] });
      setOpen(false); toast.success("Đã lưu lịch học.");
    } catch (reason) { setFormError(errorMessage(reason)); }
  }

  async function remove() {
    if (!editingSchedule || !editingOccurrence) return;
    try {
      let schedules: StudySchedule[];
      if (editingSchedule.kind === "weekly" && scope === "occurrence") {
        const next: StudySchedule = {
          ...editingSchedule,
          exceptions: [...editingSchedule.exceptions.filter((item) => item.date !== editingOccurrence.date), { date: editingOccurrence.date, action: "cancel" }],
        };
        schedules = ledger.studySchedules.map((item) => item.id === next.id ? next : item);
      } else schedules = ledger.studySchedules.filter((item) => item.id !== editingSchedule.id);
      if (!window.confirm(scope === "series" ? "Xóa toàn bộ chuỗi lịch học này?" : "Xóa buổi học này?")) return;
      await commit({ ...ledger, studySchedules: schedules }); setOpen(false); toast.success("Đã xóa lịch học.");
    } catch (reason) { setFormError(errorMessage(reason)); }
  }

  const calendar = (
    <div className="calendar study-calendar">
      {weekdayItems.map(([, label]) => <div className="day-head" key={label}>{label}</div>)}
      {Array.from({ length: shape.offset }, (_, index) => <div className="calendar-day blank" key={`b${index}`}/>) }
      {Array.from({ length: shape.days }, (_, index) => {
        const day = `${month}-${String(index + 1).padStart(2, "0")}`;
        const items = occurrencesByDate.get(day) || [];
        return <button key={day} className={`calendar-day ${day === today() ? "today" : ""}${selected === day ? " selected" : ""}`} onClick={() => onSelectedChange(day)} aria-label={`${day}, ${items.length} buổi học`}>
          <span className="day-number">{index + 1}</span>
          <span className="calendar-mini-list">{items.slice(0, 2).map((item) => <span className="calendar-mini-shift study-mini" key={`${item.scheduleId}-${item.date}`}><b>Đi học</b><small>{item.start}–{item.end}</small></span>)}</span>
          {!!items.length && <span className="calendar-count study-count">{items.length} buổi</span>}
        </button>;
      })}
    </div>
  );

  return <>
    <div className="calendar-workspace">
      <section className="card card-pad calendar-card"><div className="section-head"><div><h2>Lịch học tháng {shape.numberMonth}/{shape.year}</h2><p className="helper">Lịch học được hiển thị riêng, không ảnh hưởng lịch làm hoặc lương.</p></div></div>{calendar}</section>
      <section className="card card-pad selected-day-panel"><div className="section-head"><div><h2>Ngày {shortDate(selected)}</h2><p className="helper">Các buổi học trong ngày đã chọn.</p></div>{!readOnly && <button className="btn primary" onClick={() => openCreate()}><Plus size={15}/> Thêm buổi</button>}</div>
        {selectedItems.length ? selectedItems.map((item) => <div className="shift-row" key={`${item.scheduleId}-${item.date}`}><div className="shift-info"><p><span className="role-badge study-badge"><BookOpen size={13}/> Đi học</span></p><small>{item.start} - {item.end}{item.recurring ? " · Lặp hằng tuần" : ""}{item.exception ? " · Đã đổi riêng" : ""}</small></div>{!readOnly && <div className="study-actions"><button className="edit-link" onClick={() => openEdit(item)}><Pencil size={12}/> Sửa</button>{item.recurring && <button className="edit-link" onClick={() => openEdit(item, "series")}>Sửa chuỗi</button>}</div>}</div>) : <Blank title="Ngày này chưa có lịch học" text="Thêm một buổi đơn hoặc lịch lặp hằng tuần."/>}
      </section>
      <section className="card card-pad"><div className="section-head"><div><h2>Buổi học trong tháng</h2><p className="helper">Toàn bộ lịch học của tháng đang xem.</p></div><span className="chip">{occurrences.length} buổi</span></div>{occurrences.length ? <div className="monthly-shift-list">{[...occurrencesByDate].map(([day, items]) => <section className="shift-day-group" key={day}><h3>{shortDate(day)}/{day.slice(0, 4)}</h3>{items.map((item) => <div className="shift-row" key={`${item.scheduleId}-${day}`}><div className="shift-info"><strong>{item.start}–{item.end}</strong><small>{item.recurring ? "Lặp hằng tuần" : "Buổi đơn"}</small></div></div>)}</section>)}</div> : <Blank title="Chưa có lịch học" text="Tháng này chưa có buổi học nào."/>}</section>
    </div>

    <Modal open={open} onClose={() => setOpen(false)} title={editingSchedule ? "Sửa lịch học" : "Thêm lịch học"} description="Chỉ cần nhập ngày và khoảng giờ đi học.">
      <form className="form-stack" onSubmit={save}>
        <fieldset disabled={readOnly} className="form-stack">
          {!editingSchedule && <Field label="Kiểu lịch"><Choose label="Kiểu lịch" value={kind} onChange={(value) => setKind(value as "single" | "weekly")} items={[{ value: "single", label: "Một buổi" }, { value: "weekly", label: "Lặp hằng tuần" }]}/></Field>}
          {editingSchedule?.kind === "weekly" && <Field label="Phạm vi chỉnh sửa"><Choose label="Phạm vi chỉnh sửa" value={scope} onChange={(value) => {
            const next = value as "occurrence" | "series";
            setScope(next);
            if (next === "series") { setStart(editingSchedule.start); setEnd(editingSchedule.end); }
            else if (editingOccurrence) { setStart(editingOccurrence.start); setEnd(editingOccurrence.end); }
          }} items={[{ value: "occurrence", label: "Chỉ buổi này" }, { value: "series", label: "Cả chuỗi" }]}/></Field>}
          {(kind === "single" || (editingSchedule?.kind === "weekly" && scope === "occurrence")) ? <Field label="Ngày học"><DatePicker label="Ngày học" value={date} onChange={setDate} disabled={editingSchedule?.kind === "weekly"}/></Field> : <div className="form-grid"><Field label="Từ ngày"><DatePicker label="Từ ngày" value={rangeStart} onChange={setRangeStart}/></Field><Field label="Đến ngày"><DatePicker label="Đến ngày" value={rangeEnd} onChange={setRangeEnd}/></Field><div className="field full"><span>Các thứ trong tuần</span><div className="weekday-picker">{weekdayItems.map(([value, label]) => <button type="button" className={weekdays.includes(value) ? "active" : ""} aria-pressed={weekdays.includes(value)} key={value} onClick={() => setWeekdays((current) => current.includes(value) ? current.filter((day) => day !== value) : [...current, value])}>{label}</button>)}</div></div></div>}
          <div className="form-grid"><Field label="Giờ bắt đầu"><TimePicker label="Giờ bắt đầu" value={start} onChange={setStart}/></Field><Field label="Giờ kết thúc"><TimePicker label="Giờ kết thúc" value={end} onChange={setEnd}/></Field></div>
        </fieldset>
        {formError && <p className="error-message" role="alert">{formError}</p>}
        <div className="form-footer">{editingSchedule && !readOnly && <button type="button" className="btn icon danger" aria-label="Xóa lịch học" disabled={busy} onClick={() => void remove()}><Trash2 size={16}/></button>}<button type="button" className="btn" onClick={() => setOpen(false)}>Đóng</button>{!readOnly && <button className="btn primary" disabled={busy}>Lưu</button>}</div>
      </form>
    </Modal>
  </>;
}

function FreeWorkspace({ ledger, month, selected, onSelectedChange, client, user, profile, readOnly }: Props) {
  const shape = monthShape(month);
  const [shared, setShared] = useState<ShareGrant[]>([]);
  const [selectedOwners, setSelectedOwners] = useState<string[]>([]);
  const [remoteLedgers, setRemoteLedgers] = useState<Record<string, Ledger>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!client || !user || readOnly) return;
    let active = true;
    void listSharedWithMe(client).then((items) => { if (active) setShared(items); }).catch((reason) => { if (active) setLoadError(errorMessage(reason)); });
    return () => { active = false; };
  }, [client, user, readOnly]);

  useEffect(() => {
    if (!selectedOwners.length) return;
    const refresh = () => setRefreshKey((value) => value + 1);
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [selectedOwners.length]);

  useEffect(() => {
    if (!client || !selectedOwners.length) { setRemoteLedgers({}); return; }
    let active = true; setLoading(true); setLoadError("");
    void Promise.all(selectedOwners.map(async (ownerId) => [ownerId, await loadLedger(client, ownerId)] as const)).then((items) => {
      if (!active) return;
      const missing = items.filter(([, value]) => !value).map(([id]) => id);
      if (missing.length) {
        setSelectedOwners((current) => current.filter((id) => !missing.includes(id)));
        toast.error("Một quyền chia sẻ đã hết hiệu lực và được loại khỏi nhóm.");
      }
      setRemoteLedgers(Object.fromEntries(items.filter((item): item is readonly [string, NonNullable<typeof item[1]>] => !!item[1]).map(([id, value]) => [id, value.payload])));
    }).catch((reason) => {
      if (active) { setRemoteLedgers({}); setSelectedOwners([]); setLoadError("Không thể xác minh nhóm so sánh: " + errorMessage(reason)); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, selectedOwners, refreshKey]);

  const comparisonLedgers = useMemo(() => [ledger, ...selectedOwners.map((id) => remoteLedgers[id]).filter((item): item is Ledger => !!item)], [ledger, selectedOwners, remoteLedgers]);
  const ready = selectedOwners.length > 0 && comparisonLedgers.length === selectedOwners.length + 1;
  const freeByDate = useMemo(() => ready ? commonFreeByDate(comparisonLedgers, month) : {}, [comparisonLedgers, month, ready]);
  const selectedSlots = freeByDate[selected] || [];

  if (readOnly) return <section className="card card-pad"><Blank title="Quay lại dữ liệu của bạn" text="So sánh lịch rảnh chỉ khả dụng từ sổ của chính bạn."/></section>;
  if (!user || !client) return <section className="card card-pad"><Blank title="Cần đăng nhập" text="Đăng nhập và nhập mã chia sẻ của người khác để so sánh lịch rảnh."/></section>;

  return <div className="calendar-workspace free-workspace">
    <section className="card card-pad calendar-card">
      <div className="section-head"><div><h2>Cùng rảnh tháng {shape.numberMonth}/{shape.year}</h2><p className="helper">Khoảng xanh là lúc cả nhóm cùng rảnh ít nhất 60 phút, từ 07:00 đến 23:00.</p></div>{loading && <span className="chip">Đang tải…</span>}</div>
      <div className="participant-picker"><label className="participant selected"><input type="checkbox" checked disabled/><span><b>{profile?.display_name || "Tôi"}</b><small>Lịch của tôi</small></span></label>{shared.map((grant) => { const checked = selectedOwners.includes(grant.owner_id); return <label className={`participant ${checked ? "selected" : ""}`} key={grant.owner_id}><input type="checkbox" checked={checked} disabled={!checked && selectedOwners.length >= 5} onChange={() => setSelectedOwners((current) => checked ? current.filter((id) => id !== grant.owner_id) : [...current, grant.owner_id])}/><span><b>{grant.display_name || "Người dùng"}</b><small>{checked ? "Đang so sánh" : "Thêm vào nhóm"}</small></span></label>; })}</div>
      {!shared.length && <p className="helper comparison-hint"><Users size={16}/> Chưa có ai chia sẻ dữ liệu với bạn. Hãy nhập mã trong mục Chia sẻ.</p>}
      {loadError && <p className="error-message" role="alert">{loadError}</p>}
      <div className="calendar free-calendar">
        {weekdayItems.map(([, label]) => <div className="day-head" key={label}>{label}</div>)}
        {Array.from({ length: shape.offset }, (_, index) => <div className="calendar-day blank" key={`b${index}`}/>) }
        {Array.from({ length: shape.days }, (_, index) => {
          const day = `${month}-${String(index + 1).padStart(2, "0")}`;
          const slots = freeByDate[day] || [];
          return <button key={day} className={`calendar-day ${slots.length ? "has-free" : ""}${selected === day ? " selected" : ""}`} onClick={() => onSelectedChange(day)} aria-label={`${day}, ${slots.length} khoảng cùng rảnh`}><span className="day-number">{index + 1}</span>{ready && <span className="calendar-mini-list">{slots.slice(0, 2).map((slot) => <span className="free-slot" key={slot.start}>{formatMinutes(slot.start)}–{formatMinutes(slot.end)}</span>)}{slots.length > 2 && <small>+{slots.length - 2} khoảng</small>}</span>}{ready && !!slots.length && <span className="calendar-count free-count">{slots.length} khung</span>}</button>;
        })}
      </div>
    </section>
    <section className="card card-pad selected-day-panel"><div className="section-head"><div><h2>Ngày {shortDate(selected)}</h2><p className="helper">Khung giờ tất cả thành viên đã chọn cùng rảnh.</p></div></div>{!selectedOwners.length ? <Blank title="Chọn người để so sánh" text="Chọn từ 1 đến 5 người đã chia sẻ dữ liệu với bạn."/> : selectedSlots.length ? <div className="free-slot-list">{selectedSlots.map((slot) => <div key={slot.start}><span className="free-dot"/><strong>{formatMinutes(slot.start)} – {formatMinutes(slot.end)}</strong><small>{slot.end - slot.start} phút</small></div>)}</div> : <Blank title="Không có khung rảnh phù hợp" text="Ngày này không có khoảng cả nhóm cùng rảnh từ 60 phút."/>}</section>
  </div>;
}
