"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Save } from "lucide-react";
import { toast } from "sonner";
import {
  formatVndInput,
  hours,
  money,
  parseVnd,
  period,
  periodBreakdown,
  shiftAmount,
  shortDate,
  today,
  uid,
  type Ledger,
} from "@/lib/payroll";
import { errorMessage } from "@/lib/errors";

const MONTH_RE = /^\d{4}-\d{2}$/;

type Props = {
  data: Ledger;
  month: string;
  onMonthChange: (month: string) => void;
  commit: (next: Ledger) => Promise<void>;
  busy: boolean;
  readOnly?: boolean;
};

function monthLabel(month: string) {
  return `Tháng ${month.slice(5)}/${month.slice(0, 4)}`;
}

function nextMonth(month: string) {
  const [year, value] = month.split("-").map(Number);
  return new Date(Date.UTC(year, value, 1)).toISOString().slice(0, 7);
}

function visibleMonths(data: Ledger, selected: string) {
  const values = new Set<string>([selected, today().slice(0, 7)]);
  for (const shift of data.shifts) {
    values.add(shift.date.slice(0, 7));
    values.add(nextMonth(shift.date.slice(0, 7)));
  }
  for (const item of data.payments) values.add(item.month);
  for (const item of data.adjustments) values.add(item.month);
  for (const item of data.settlements) values.add(item.month);
  for (const item of data.reconciliations) values.add(item.month);
  return [...values].filter((value) => MONTH_RE.test(value)).sort((a, b) => b.localeCompare(a));
}

function differenceClass(value: number) {
  if (value < 0) return "is-negative";
  if (value > 0) return "is-positive";
  return "is-match";
}

export default function PayrollReconciliation({ data, month, onMonthChange, commit, busy, readOnly = false }: Props) {
  const months = useMemo(() => visibleMonths(data, month), [data, month]);
  const summary = useMemo(() => period(data, month), [data, month]);
  const breakdown = useMemo(() => periodBreakdown(data, month), [data, month]);
  const saved = data.reconciliations.find((item) => item.month === month);
  const existingNote = saved?.note || summary.payments.find((item) => item.note)?.note || "";
  const [expanded, setExpanded] = useState(true);
  const [received, setReceived] = useState(summary.payments.length ? formatVndInput(summary.received) : "");
  const [note, setNote] = useState(existingNote);
  const [error, setError] = useState("");

  async function saveActual(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      if (readOnly) throw new Error("Dữ liệu được chia sẻ ở chế độ chỉ đọc.");
      const amount = parseVnd(received);
      if (amount < 0) throw new Error("Tiền thực nhận không thể là số âm.");
      if (note.trim().length > 300) throw new Error("Ghi chú tối đa 300 ký tự.");
      const paymentId = summary.payments[0]?.id || uid();
      const paymentDate = summary.payments[0]?.date || today();
      const nextPayments = [
        ...data.payments.filter((item) => item.month !== month),
        { id: paymentId, month, date: paymentDate, amount, note: note.trim() },
      ];
      const difference = amount - summary.expected;
      await commit({
        ...data,
        payments: nextPayments,
        reconciliations: [
          ...data.reconciliations.filter((item) => item.month !== month),
          {
            month,
            expected: summary.expected,
            received: amount,
            difference,
            note: note.trim(),
            confirmedAt: new Date().toISOString(),
          },
        ],
      });
      setReceived(formatVndInput(amount));
      toast.success("Đã cập nhật tiền thực nhận.");
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  return (
    <section className="payroll-workspace payroll-simple">
      <div className="payroll-toolbar payroll-simple-head">
        <div>
          <h2>Kỳ lương</h2>
          <p>{readOnly ? "Xem nhanh lịch sử lương theo tháng." : "Cuộn để xem nhanh. Bấm vào một tháng để xem chi tiết."}</p>
        </div>
        {readOnly && <span className="readonly-badge">READ ONLY</span>}
      </div>

      <div className="payroll-month-list">
        {months.map((itemMonth) => {
          const item = period(data, itemMonth);
          const isOpen = itemMonth === month && expanded;
          const hasReceived = item.payments.length > 0;
          return (
            <article className={`payroll-month-card ${isOpen ? "is-open" : ""}`} key={itemMonth}>
              <button
                type="button"
                className="payroll-month-summary"
                aria-expanded={isOpen}
                onClick={() => {
                  if (itemMonth !== month) {
                    onMonthChange(itemMonth);
                    return;
                  }
                  setExpanded((value) => !value);
                }}
              >
                <div className="payroll-month-title">
                  <div>
                    <strong>{monthLabel(itemMonth)}</strong>
                    <span>{item.shifts.length} ca · {hours(item.minutes)} giờ</span>
                  </div>
                  <div className="payroll-month-state">
                    {item.closed && <span className="auto-closed">Đã chốt</span>}
                    {isOpen ? <ChevronUp size={19}/> : <ChevronDown size={19}/>} 
                  </div>
                </div>
                <div className="payroll-quick-stats">
                  <div><span>Dự kiến</span><strong>{money(item.expected)}</strong></div>
                  <div className="received"><span>Thực nhận</span><strong>{hasReceived ? money(item.received) : "Chưa cập nhật"}</strong></div>
                  <div className={hasReceived ? differenceClass(item.difference) : "is-pending"}>
                    <span>Chênh lệch</span>
                    <strong>{hasReceived ? (item.difference === 0 ? "Khớp" : `${item.difference > 0 ? "+" : "−"}${money(Math.abs(item.difference))}`) : "—"}</strong>
                  </div>
                </div>
              </button>

              {isOpen && (
                <div className="payroll-month-detail">
                  {!readOnly && (
                    <form className="payroll-actual-form" onSubmit={saveActual}>
                      <label>
                        <span>Tiền thực nhận</span>
                        <div className="money-input"><input inputMode="numeric" value={received} onChange={(event) => setReceived(event.target.value)} placeholder="Ví dụ: 3.180.000"/><b>₫</b></div>
                      </label>
                      <label className="payroll-note-field">
                        <span>Ghi chú <small>(không bắt buộc)</small></span>
                        <textarea rows={2} maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ví dụ: Bị trừ đồng phục 70k"/>
                      </label>
                      {error && <p className="form-error">{error}</p>}
                      <button className="btn primary payroll-save" disabled={busy}><Save size={15}/> Lưu</button>
                    </form>
                  )}

                  <div className="payroll-detail-section">
                    <div className="section-head compact"><div><h3>Thống kê tháng</h3><p className="helper">{shortDate(item.start)} - {shortDate(item.end)}</p></div></div>
                    <div className="payroll-detail-grid">
                      <div><span>Ngày làm</span><strong>{item.days} ngày</strong></div>
                      <div><span>Tổng giờ</span><strong>{hours(item.minutes)} giờ</strong></div>
                      <div><span>Lương theo giờ</span><strong>{money(breakdown.hourly)}</strong></div>
                      {breakdown.closing !== 0 && <div><span>Phụ cấp đóng ca</span><strong>{money(breakdown.closing)}</strong></div>}
                      {breakdown.holiday !== 0 && <div><span>Ngày lễ</span><strong>{money(breakdown.holiday)}</strong></div>}
                      {breakdown.adjustment !== 0 && <div><span>Điều chỉnh</span><strong>{money(breakdown.adjustment)}</strong></div>}
                    </div>
                  </div>

                  <div className="payroll-detail-section">
                    <div className="section-head compact"><div><h3>Ca làm trong tháng</h3><p className="helper">{item.shifts.length} ca</p></div></div>
                    {item.shifts.length === 0 ? <p className="payroll-empty">Chưa có ca làm trong kỳ này.</p> : (
                      <div className="payroll-shift-list">
                        {item.shifts.map((shift) => (
                          <div className="payroll-shift-row" key={shift.id}>
                            <div className="payroll-shift-main">
                              <strong>{shortDate(shift.date)}/{shift.date.slice(0, 4)}</strong>
                              <span className="payroll-role" style={{ borderColor: shift.color }}>{shift.roleName}</span>
                              <small>{shift.start} - {shift.end}{shift.holiday ? ` · ${shift.holiday}` : ""}</small>
                            </div>
                            <strong className="payroll-shift-money">{money(shiftAmount(shift, item.shifts))}</strong>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
