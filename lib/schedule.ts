import { timeMinutes, uid, validDate, type Ledger, type Shift, type StudySchedule } from "./payroll.ts";

export type StudyOccurrence = {
  scheduleId: string;
  date: string;
  start: string;
  end: string;
  recurring: boolean;
  exception: boolean;
};

export type TimeRange = { start: number; end: number };

const iso = (date: Date) => date.toISOString().slice(0, 10);
const utcDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

function monthBounds(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Tháng không hợp lệ.");
  const [year, numberMonth] = month.split("-").map(Number);
  return {
    start: `${month}-01`,
    end: iso(new Date(Date.UTC(year, numberMonth, 0))),
  };
}

export function occurrenceOnDate(schedule: StudySchedule, date: string): StudyOccurrence | null {
  if (schedule.kind === "single") {
    return schedule.date === date
      ? { scheduleId: schedule.id, date, start: schedule.start, end: schedule.end, recurring: false, exception: false }
      : null;
  }
  if (date < schedule.startDate || date > schedule.endDate) return null;
  const exception = schedule.exceptions.find((item) => item.date === date);
  if (exception?.action === "cancel") return null;
  const weekday = utcDate(date).getUTCDay();
  if (!schedule.weekdays.includes(weekday)) return null;
  return {
    scheduleId: schedule.id,
    date,
    start: exception?.action === "replace" ? exception.start : schedule.start,
    end: exception?.action === "replace" ? exception.end : schedule.end,
    recurring: true,
    exception: exception?.action === "replace",
  };
}

export function expandStudySchedules(schedules: StudySchedule[], month: string) {
  const { start, end } = monthBounds(month);
  const result: StudyOccurrence[] = [];
  for (let cursor = utcDate(start); iso(cursor) <= end; cursor = new Date(cursor.getTime() + 86_400_000)) {
    const date = iso(cursor);
    for (const schedule of schedules) {
      const occurrence = occurrenceOnDate(schedule, date);
      if (occurrence) result.push(occurrence);
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}

export function validateStudySchedule(schedule: StudySchedule) {
  const start = timeMinutes(schedule.start), end = timeMinutes(schedule.end);
  if (end <= start) throw new Error("Giờ kết thúc phải sau giờ bắt đầu trong cùng ngày.");
  if (schedule.kind === "single") {
    if (!validDate(schedule.date)) throw new Error("Ngày học không hợp lệ.");
    return schedule;
  }
  if (!validDate(schedule.startDate) || !validDate(schedule.endDate) || schedule.endDate < schedule.startDate)
    throw new Error("Khoảng ngày áp dụng không hợp lệ.");
  if (!schedule.weekdays.length || new Set(schedule.weekdays).size !== schedule.weekdays.length)
    throw new Error("Hãy chọn ít nhất một thứ trong tuần.");
  for (const exception of schedule.exceptions) {
    if (!validDate(exception.date) || exception.date < schedule.startDate || exception.date > schedule.endDate)
      throw new Error("Ngoại lệ lịch học không hợp lệ.");
    if (exception.action === "replace" && timeMinutes(exception.end) <= timeMinutes(exception.start))
      throw new Error("Giờ kết thúc phải sau giờ bắt đầu trong cùng ngày.");
  }
  return schedule;
}

export function newSingleStudy(date: string, start: string, end: string): StudySchedule {
  return validateStudySchedule({ id: uid(), kind: "single", date, start, end });
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return timeMinutes(aStart) < timeMinutes(bEnd) && timeMinutes(aEnd) > timeMinutes(bStart);
}

export function studyConflictCount(candidate: StudySchedule, schedules: StudySchedule[], shifts: Shift[]) {
  validateStudySchedule(candidate);
  const first = candidate.kind === "single" ? candidate.date : candidate.startDate;
  const last = candidate.kind === "single" ? candidate.date : candidate.endDate;
  let count = 0;
  for (let cursor = utcDate(first); iso(cursor) <= last; cursor = new Date(cursor.getTime() + 86_400_000)) {
    const date = iso(cursor);
    const occurrence = occurrenceOnDate(candidate, date);
    if (!occurrence) continue;
    if (shifts.some((shift) => shift.date === date && overlaps(occurrence.start, occurrence.end, shift.start, shift.end))) count += 1;
    if (schedules.some((schedule) => {
      const other = occurrenceOnDate(schedule, date);
      return other && overlaps(occurrence.start, occurrence.end, other.start, other.end);
    })) count += 1;
  }
  return count;
}

export function mergeRanges(ranges: TimeRange[]) {
  const sorted = ranges.filter((range) => range.end > range.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const result: TimeRange[] = [];
  for (const range of sorted) {
    const previous = result.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else result.push({ ...range });
  }
  return result;
}

export function commonFreeByDate(
  ledgers: Ledger[],
  month: string,
  windowStart = 7 * 60,
  windowEnd = 23 * 60,
  minimumMinutes = 60,
) {
  const { start, end } = monthBounds(month);
  const studies = ledgers.map((ledger) => expandStudySchedules(ledger.studySchedules, month));
  const result: Record<string, TimeRange[]> = {};
  for (let cursor = utcDate(start); iso(cursor) <= end; cursor = new Date(cursor.getTime() + 86_400_000)) {
    const date = iso(cursor);
    const busy = mergeRanges(ledgers.flatMap((ledger, index) => [
      ...ledger.shifts.filter((shift) => shift.date === date).map((shift) => ({ start: timeMinutes(shift.start), end: timeMinutes(shift.end) })),
      ...studies[index].filter((item) => item.date === date).map((item) => ({ start: timeMinutes(item.start), end: timeMinutes(item.end) })),
    ]).map((range) => ({ start: Math.max(windowStart, range.start), end: Math.min(windowEnd, range.end) })));
    const free: TimeRange[] = [];
    let position = windowStart;
    for (const range of busy) {
      if (range.start - position >= minimumMinutes) free.push({ start: position, end: range.start });
      position = Math.max(position, range.end);
    }
    if (windowEnd - position >= minimumMinutes) free.push({ start: position, end: windowEnd });
    result[date] = free;
  }
  return result;
}

export function formatMinutes(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
