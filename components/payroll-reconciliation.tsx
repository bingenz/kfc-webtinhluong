"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, Clock3, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DatePicker } from "@/components/payroll-pickers";
import { Field } from "@/components/payroll-ui";
import {
  hours,
  money,
  parseVnd,
  period,
  reconciliationStatus,
  shortDate,
  today,
  uid,
  validDate,
  type Ledger,
} from "@/lib/payroll";
import { errorMessage } from "@/lib/errors";

type Props = {
  data: Ledger;
  month: string;
  onMonthChange: (month: string) => void;
  commit: (next: Ledger) => Promise<void>;
  busy: boolean;
};

const statusCopy = {
  pending: { label: "Chờ nhận", detail: "Chưa có khoản lương thực nhận." },
  reviewing: {
    label: "Đang đối soát",
    detail: "Kiểm tra các khoản nhận rồi xác nhận kết quả.",
  },
  matched: { label: "Đã khớp", detail: "Kỳ lương đã được xác nhận khớp." },
  difference: {
    label: "Có chênh lệch",
    detail: "Kỳ lương đã xác nhận với số tiền chênh lệch.",
  },
  "needs-review": {
    label: "Cần đối soát lại",
    detail: "Dữ liệu kỳ này đã thay đổi sau lần xác nhận gần nhất.",
  },
} as const;

export default function PayrollReconciliation({
  data,
  month,
  onMonthChange,
  commit,
  busy,
}: Props) {
  const summary = useMemo(() => period(data, month), [data, month]);
  const saved = data.reconciliations.find((item) => item.month === month);
  const status = reconciliationStatus(data, month);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(today());
  const [paymentNote, setPaymentNote] = useState("");
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [adjustmentNote, setAdjustmentNote] = useState("");
  const [confirmationNote, setConfirmationNote] = useState(() => saved?.note || "");
  const [error, setError] = useState("");

  async function addPayment(event: React.FormEvent) {
    event.preventDefault();
    try {
      const amount = parseVnd(paymentAmount);
      if (amount <= 0 || !validDate(paymentDate))
        throw new Error("Số tiền và ngày nhận không hợp lệ.");
      await commit({
        ...data,
        payments: [
          ...data.payments,
          {
            id: uid(),
            month,
            date: paymentDate,
            amount,
            note: paymentNote.trim(),
          },
        ],
      });
      setPaymentAmount("");
      setPaymentNote("");
      toast.success("Đã thêm khoản lương thực nhận.");
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function addAdjustment(event: React.FormEvent) {
    event.preventDefault();
    try {
      const amount = parseVnd(adjustmentAmount);
      if (!adjustmentNote.trim()) throw new Error("Hãy nhập lý do điều chỉnh.");
      await commit({
        ...data,
        adjustments: [
          ...data.adjustments,
          { id: uid(), month, amount, note: adjustmentNote.trim() },
        ],
      });
      setAdjustmentAmount("");
      setAdjustmentNote("");
      toast.success("Đã lưu khoản điều chỉnh.");
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function remove(kind: "payment" | "adjustment", id: string) {
    try {
      await commit({
        ...data,
        payments:
          kind === "payment"
            ? data.payments.filter((item) => item.id !== id)
            : data.payments,
        adjustments:
          kind === "adjustment"
            ? data.adjustments.filter((item) => item.id !== id)
            : data.adjustments,
      });
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function confirm() {
    try {
      if (!summary.payments.length)
        throw new Error("Hãy ghi nhận ít nhất một khoản thực nhận trước khi xác nhận.");
      if (confirmationNote.trim().length > 300)
        throw new Error("Ghi chú xác nhận tối đa 300 ký tự.");
      await commit({
        ...data,
        reconciliations: [
          ...data.reconciliations.filter((item) => item.month !== month),
          {
            month,
            expected: summary.expected,
            received: summary.received,
            difference: summary.difference,
            note: confirmationNote.trim(),
            confirmedAt: new Date().toISOString(),
          },
        ],
      });
      toast.success("Đã xác nhận đối soát kỳ lương.");
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  const statusInfo = statusCopy[status];
  return (
    <section className="payroll-workspace">
      <div className="payroll-toolbar">
        <div>
          <h2>Kỳ lương</h2>
          <p>Kiểm tra lương sau khi nhận và lưu kết quả đối soát.</p>
        </div>
        <label className="month-field" aria-label="Chọn kỳ lương">
          <span>Kỳ {month.slice(5)}/{month.slice(0, 4)}</span>
          <input
            type="month"
            value={month}
            onChange={(event) => onMonthChange(event.target.value)}
          />
        </label>
      </div>

      <section className="payroll-hero">
        <div>
          <span className={'payroll-status ' + status}>{statusInfo.label}</span>
          <p>Kỳ công {shortDate(summary.start)} - {shortDate(summary.end)} · Dự kiến nhận {shortDate(summary.payDate)}</p>
        </div>
        <div className="payroll-hero-amount">
          <small>CHÊNH LỆCH</small>
          <strong>{money(summary.difference)}</strong>
          <span>{summary.difference === 0 && summary.payments.length ? "Đã đủ số tiền dự kiến" : summary.difference < 0 ? "Thiếu so với dự kiến" : "Nhiều hơn dự kiến"}</span>
        </div>
      </section>

      <div className="payroll-stat-grid" aria-label="Tóm tắt kỳ lương">
        <div><span>Dự kiến</span><strong>{money(summary.expected)}</strong></div>
        <div><span>Đã nhận</span><strong>{money(summary.received)}</strong></div>
        <div><span>Thời gian</span><strong>{hours(summary.minutes)}</strong><small>{summary.shifts.length} ca · {summary.days} ngày</small></div>
      </div>

      <div className="payroll-columns">
        <div className="payroll-main-stack">
          <section className="card card-pad">
            <div className="section-head"><h2>Chi tiết dự kiến</h2><span className="helper">Tự tính từ ca làm đã lưu</span></div>
            <div className="breakdown-row"><span>Tiền ca</span><strong>{money(summary.wages)}</strong></div>
            <div className="breakdown-row"><span>Điều chỉnh</span><strong>{money(summary.adjustment)}</strong></div>
            <div className="breakdown-row total"><span>Tổng dự kiến</span><strong>{money(summary.expected)}</strong></div>
          </section>

          <section className="card card-pad">
            <div className="section-head"><h2>Khoản đã nhận</h2><span className="helper">{summary.payments.length} lần nhận</span></div>
            {summary.payments.length ? summary.payments.map((item) => (
              <div className="list-item" key={item.id}>
                <div><strong>{money(item.amount)}</strong><small>{shortDate(item.date)}/{item.date.slice(0, 4)}{item.note ? " · " + item.note : ""}</small></div>
                <button className="btn ghost icon" aria-label="Xóa khoản nhận" title="Xóa khoản nhận" disabled={busy} onClick={() => void remove("payment", item.id)}><Trash2 size={15} /></button>
              </div>
            )) : <p className="helper">Chưa ghi nhận khoản lương nào cho kỳ này.</p>}
            <form className="form-stack payroll-form" onSubmit={addPayment}>
              <Field label="Số tiền thực nhận"><input inputMode="numeric" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} placeholder="Ví dụ: 2.550.000" required /></Field>
              <Field label="Ngày nhận thực tế"><DatePicker label="Ngày nhận thực tế" value={paymentDate} onChange={setPaymentDate} /></Field>
              <Field label="Ghi chú"><input maxLength={300} value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} placeholder="Ví dụ: Đợt 1" /></Field>
              <button className="btn primary" disabled={busy}>Thêm khoản nhận</button>
            </form>
          </section>
        </div>

        <div className="payroll-side-stack">
          <section className="card card-pad">
            <h2>Điều chỉnh</h2>
            <p className="helper mt-2">Thưởng, phụ cấp khác, tạm ứng hoặc khấu trừ.</p>
            <form className="form-stack payroll-form" onSubmit={addAdjustment}>
              <Field label="Số tiền"><input inputMode="numeric" value={adjustmentAmount} onChange={(event) => setAdjustmentAmount(event.target.value)} placeholder="Âm để khấu trừ" required /></Field>
              <Field label="Lý do"><input maxLength={300} value={adjustmentNote} onChange={(event) => setAdjustmentNote(event.target.value)} placeholder="Ví dụ: Thưởng chuyên cần" required /></Field>
              <button className="btn" disabled={busy}>Lưu điều chỉnh</button>
            </form>
            {data.adjustments.filter((item) => item.month === month).map((item) => (
              <div className="list-item" key={item.id}>
                <div>{item.note}<small>{money(item.amount)}</small></div>
                <button className="btn ghost icon" aria-label="Xóa khoản điều chỉnh" title="Xóa khoản điều chỉnh" disabled={busy} onClick={() => void remove("adjustment", item.id)}><Trash2 size={15} /></button>
              </div>
            ))}
          </section>

          <section className="card card-pad reconciliation-confirmation">
            <div className="section-head"><h2>Xác nhận đối soát</h2>{status === "matched" ? <CheckCircle2 className="status-success" size={19} /> : <CircleAlert className="status-warning" size={19} />}</div>
            <p className="helper mt-2">{statusInfo.detail}</p>
            <Field label="Ghi chú xác nhận" className="mt-4"><textarea maxLength={300} value={confirmationNote} onChange={(event) => setConfirmationNote(event.target.value)} placeholder="Tùy chọn" /></Field>
            <button className="btn primary mt-4" disabled={busy || !summary.payments.length} onClick={() => void confirm()}>{saved && status !== "needs-review" ? "Cập nhật xác nhận" : "Xác nhận kết quả"}</button>
            {saved && <small className="confirmation-time"><Clock3 size={13} /> Xác nhận lúc {new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(saved.confirmedAt))}</small>}
          </section>
        </div>
      </div>
      {error && <p className="error-message" role="alert">{error}</p>}
    </section>
  );
}
