"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, Clock3, LockKeyhole, RefreshCcw, Trash2, UnlockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { DatePicker } from "@/components/payroll-pickers";
import { Field } from "@/components/payroll-ui";
import {
  closePeriod,
  differenceLabel,
  hours,
  money,
  parseVnd,
  period,
  periodBreakdown,
  recalculatePeriod,
  reconciliationStatus,
  reopenPeriod,
  shortDate,
  today,
  uid,
  validDate,
  type Ledger,
} from "@/lib/payroll";
import { errorMessage } from "@/lib/errors";
import { moveMonth } from "@/lib/month";

type Props = {
  data: Ledger;
  month: string;
  onMonthChange: (month: string) => void;
  commit: (next: Ledger) => Promise<void>;
  busy: boolean;
  readOnly?: boolean;
};

const statusCopy = {
  pending: { label: "Chờ nhận", detail: "Chưa có khoản lương thực nhận." },
  reviewing: { label: "Đang đối soát", detail: "Kiểm tra các khoản nhận rồi xác nhận kết quả." },
  matched: { label: "Đã khớp", detail: "Kỳ lương đã được xác nhận khớp." },
  difference: { label: "Có chênh lệch", detail: "Kỳ lương đã xác nhận với số tiền chênh lệch." },
  "needs-review": { label: "Cần đối soát lại", detail: "Dữ liệu kỳ này đã thay đổi sau lần xác nhận gần nhất." },
} as const;

export default function PayrollReconciliation({ data, month, onMonthChange, commit, busy, readOnly = false }: Props) {
  const summary = useMemo(() => period(data, month), [data, month]);
  const breakdown = useMemo(() => periodBreakdown(data, month), [data, month]);
  const saved = data.reconciliations.find((item) => item.month === month);
  const status = reconciliationStatus(data, month);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(today());
  const [paymentNote, setPaymentNote] = useState("");
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [adjustmentNote, setAdjustmentNote] = useState("");
  const [confirmationNote, setConfirmationNote] = useState(() => saved?.note || "");
  const [error, setError] = useState("");

  const guardWritable = () => {
    if (readOnly) throw new Error("Dữ liệu được chia sẻ ở chế độ chỉ đọc.");
  };

  async function addPayment(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      guardWritable();
      const amount = parseVnd(paymentAmount);
      if (amount <= 0 || !validDate(paymentDate)) throw new Error("Số tiền và ngày nhận không hợp lệ.");
      await commit({ ...data, payments: [...data.payments, { id: uid(), month, date: paymentDate, amount, note: paymentNote.trim() }] });
      setPaymentAmount(""); setPaymentNote(""); setError("");
      toast.success("Đã thêm khoản lương thực nhận.");
    } catch (reason) { setError(errorMessage(reason)); }
  }

  async function addAdjustment(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      guardWritable();
      if (summary.closed) throw new Error("Kỳ lương đã chốt. Hãy mở lại kỳ trước khi điều chỉnh.");
      const amount = parseVnd(adjustmentAmount);
      if (!adjustmentNote.trim()) throw new Error("Hãy nhập lý do điều chỉnh.");
      await commit({ ...data, adjustments: [...data.adjustments, { id: uid(), month, amount, note: adjustmentNote.trim() }] });
      setAdjustmentAmount(""); setAdjustmentNote(""); setError("");
      toast.success("Đã lưu khoản điều chỉnh.");
    } catch (reason) { setError(errorMessage(reason)); }
  }

  async function remove(kind: "payment" | "adjustment", id: string) {
    setError("");
    try {
      guardWritable();
      if (kind === "adjustment" && summary.closed) throw new Error("Kỳ lương đã chốt. Hãy mở lại kỳ trước khi xóa điều chỉnh.");
      if (!window.confirm(kind === "payment" ? "Xóa khoản thực nhận này?" : "Xóa khoản điều chỉnh này?")) return;
      await commit({
        ...data,
        payments: kind === "payment" ? data.payments.filter((item) => item.id !== id) : data.payments,
        adjustments: kind === "adjustment" ? data.adjustments.filter((item) => item.id !== id) : data.adjustments,
      });
      setError("");
      toast.success("Đã cập nhật kỳ lương.");
    } catch (reason) { setError(errorMessage(reason)); }
  }

  async function confirm() {
    setError("");
    try {
      guardWritable();
      if (!summary.payments.length) throw new Error("Hãy ghi nhận ít nhất một khoản thực nhận trước khi xác nhận.");
      if (confirmationNote.trim().length > 300) throw new Error("Ghi chú xác nhận tối đa 300 ký tự.");
      await commit({
        ...data,
        reconciliations: [
          ...data.reconciliations.filter((item) => item.month !== month),
          { month, expected: summary.expected, received: summary.received, difference: summary.difference, note: confirmationNote.trim(), confirmedAt: new Date().toISOString() },
        ],
      });
      setError("");
      toast.success("Đã xác nhận đối soát kỳ lương.");
    } catch (reason) { setError(errorMessage(reason)); }
  }

  async function toggleSettlement() {
    setError("");
    try {
      guardWritable();
      if (summary.closed) {
        if (!window.confirm("Mở lại kỳ lương? Sau khi mở, ca và điều chỉnh trong kỳ có thể được sửa lại.")) return;
        await commit(reopenPeriod(data, month));
        toast.success("Đã mở lại kỳ lương.");
      } else {
        if (!window.confirm(`Chốt kỳ ${month.slice(5)}/${month.slice(0, 4)}? Các ca trong phạm vi ${shortDate(summary.start)} - ${shortDate(summary.end)} sẽ bị khóa.`)) return;
        await commit(closePeriod(data, month));
        toast.success("Đã chốt kỳ lương.");
      }
      setError("");
    } catch (reason) { setError(errorMessage(reason)); }
  }

  async function recalculate() {
    setError("");
    try {
      guardWritable();
      if (!window.confirm("Tính lại tổng kỳ từ các snapshot đã lưu của từng ca? Mức lương/quy tắc lịch sử của ca sẽ không bị thay đổi.")) return;
      await commit(recalculatePeriod(data, month));
      setError("");
      toast.success("Đã tính lại kỳ lương.");
    } catch (reason) { setError(errorMessage(reason)); }
  }

  const statusInfo = statusCopy[status];
  return (
    <section className="payroll-workspace">
      <div className="payroll-toolbar">
        <div><h2>Kỳ lương</h2><p>{readOnly ? "Đang xem toàn bộ lịch sử payroll ở chế độ chỉ đọc." : "Kiểm tra lương, chốt kỳ và lưu kết quả đối soát."}</p></div>
        <div className="month-navigator" aria-label="Điều hướng kỳ lương">
          <button className="btn ghost icon" aria-label="Kỳ trước" onClick={() => onMonthChange(moveMonth(month, -1))}>‹</button>
          <label className="month-field"><span>Kỳ {month.slice(5)}/{month.slice(0, 4)}</span><input aria-label="Chọn kỳ lương" type="month" value={month} onChange={(event) => onMonthChange(event.target.value)} /></label>
          <button className="btn ghost icon" aria-label="Kỳ sau" onClick={() => onMonthChange(moveMonth(month, 1))}>›</button>
          <button className="btn ghost" onClick={() => onMonthChange(today().slice(0, 7))}>Hiện tại</button>
        </div>
      </div>

      <section className="payroll-hero">
        <div className="payroll-hero-heading">
          <div>
            <span className={'payroll-status ' + status}>{summary.closed ? "Đã chốt" : statusInfo.label}</span>
            <p>Kỳ công {shortDate(summary.start)} - {shortDate(summary.end)} · Dự kiến nhận {shortDate(summary.payDate)}{summary.closed ? ` · Chốt ${new Intl.DateTimeFormat("vi-VN", { dateStyle: "short" }).format(new Date(summary.closed.lockedAt))}` : ""}</p>
          </div>
          {readOnly && <span className="readonly-badge">READ ONLY</span>}
        </div>
        <div className="payroll-hero-stats" aria-label="Tóm tắt kỳ lương">
          <div><small>TỔNG DỰ KIẾN</small><strong>{money(summary.expected)}</strong></div>
          <div><small>ĐÃ NHẬN</small><strong>{money(summary.received)}</strong></div>
          <div><small>CHÊNH LỆCH</small><strong>{differenceLabel(summary.difference)}</strong></div>
          <div><small>THỜI GIAN</small><strong>{hours(summary.minutes)} giờ</strong></div>
          <div><small>CA LÀM</small><strong>{summary.shifts.length} ca · {summary.days} ngày</strong></div>
        </div>
      </section>

      <section className="card card-pad payroll-breakdown">
        <div className="section-head"><div><h2>Chi tiết dự kiến</h2><p className="helper">Các dòng cộng lại thành tổng dự kiến của kỳ.</p></div>{!readOnly && <div className="row-actions"><button className="btn" disabled={busy} onClick={() => void toggleSettlement()}>{summary.closed ? <UnlockKeyhole size={15}/> : <LockKeyhole size={15}/>} {summary.closed ? "Mở lại kỳ" : "Chốt kỳ lương"}</button><button className="btn ghost" disabled={busy || !!summary.closed} onClick={() => void recalculate()}><RefreshCcw size={15}/> Tính lại kỳ</button></div>}</div>
        <div className="breakdown-list">
          <div><span>Lương theo giờ</span><strong>{money(breakdown.hourly)}</strong></div>
          <div><span>Phụ cấp đóng ca</span><strong>{money(breakdown.closing)}</strong></div>
          <div><span>Hệ số ngày lễ</span><strong>{money(breakdown.holiday)}</strong></div>
          <div><span>Điều chỉnh</span><strong>{money(breakdown.adjustment)}</strong></div>
          <div className="breakdown-total"><span>Dự kiến</span><strong>{money(breakdown.expected)}</strong></div>
        </div>
      </section>

      <div className="payroll-columns">
        <div className="payroll-main-stack">
          <section className="card card-pad">
            <div className="section-head"><h2>Khoản đã nhận</h2><span className="helper">{summary.payments.length} lần nhận</span></div>
            {summary.payments.length ? summary.payments.map((item) => (
              <div className="list-item" key={item.id}><div><strong>{money(item.amount)}</strong><small>{shortDate(item.date)}/{item.date.slice(0, 4)}{item.note ? " · " + item.note : ""}</small></div>{!readOnly && <button className="btn ghost icon" aria-label="Xóa khoản nhận" disabled={busy} onClick={() => void remove("payment", item.id)}><Trash2 size={15}/></button>}</div>
            )) : <p className="helper">Chưa ghi nhận khoản lương nào cho kỳ này.</p>}
            {!readOnly && <form className="form-stack payroll-form" onSubmit={addPayment}>
              <Field label="Số tiền thực nhận"><input inputMode="numeric" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} placeholder="Ví dụ: 2.550.000" required /></Field>
              <Field label="Ngày nhận thực tế"><DatePicker label="Ngày nhận thực tế" value={paymentDate} onChange={setPaymentDate} /></Field>
              <Field label="Ghi chú"><input maxLength={300} value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} placeholder="Ví dụ: Đợt 1" /></Field>
              <button className="btn primary" disabled={busy}>Thêm khoản nhận</button>
            </form>}
          </section>
        </div>

        <div className="payroll-side-stack">
          <section className="card card-pad">
            <h2>Điều chỉnh</h2><p className="helper mt-2">Thưởng, phụ cấp khác, tạm ứng hoặc khấu trừ.</p>
            {!readOnly && <form className="form-stack payroll-form" onSubmit={addAdjustment}>
              <Field label="Số tiền"><input inputMode="numeric" value={adjustmentAmount} onChange={(event) => setAdjustmentAmount(event.target.value)} placeholder="Âm để khấu trừ" required /></Field>
              <Field label="Lý do"><input maxLength={300} value={adjustmentNote} onChange={(event) => setAdjustmentNote(event.target.value)} placeholder="Ví dụ: Thưởng chuyên cần" required /></Field>
              <button className="btn" disabled={busy || !!summary.closed}>Lưu điều chỉnh</button>
            </form>}
            {data.adjustments.filter((item) => item.month === month).map((item) => (
              <div className="list-item" key={item.id}><div>{item.note}<small>{money(item.amount)}</small></div>{!readOnly && <button className="btn ghost icon" aria-label="Xóa khoản điều chỉnh" disabled={busy || !!summary.closed} onClick={() => void remove("adjustment", item.id)}><Trash2 size={15}/></button>}</div>
            ))}
          </section>

          <section className="card card-pad reconciliation-confirmation">
            <div className="section-head"><h2>Xác nhận đối soát</h2>{status === "matched" ? <CheckCircle2 className="status-success" size={19}/> : <CircleAlert className="status-warning" size={19}/>}</div>
            <p className="helper mt-2">{statusInfo.detail}</p>
            <div className="difference-callout">{differenceLabel(summary.difference)}</div>
            {!readOnly && <><Field label="Ghi chú xác nhận" className="mt-4"><textarea maxLength={300} value={confirmationNote} onChange={(event) => setConfirmationNote(event.target.value)} placeholder="Tùy chọn" /></Field><button className="btn primary mt-4" disabled={busy || !summary.payments.length} onClick={() => void confirm()}>{saved && status !== "needs-review" ? "Cập nhật xác nhận" : "Xác nhận kết quả"}</button></>}
            {saved && <small className="confirmation-time"><Clock3 size={13}/> Xác nhận lúc {new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(saved.confirmedAt))}</small>}
          </section>
        </div>
      </div>
      {error && <p className="error-message" role="alert">{error}</p>}
    </section>
  );
}
