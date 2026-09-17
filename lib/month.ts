export function moveMonth(month: string, delta: number) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Tháng không hợp lệ.");
  const [year, numberMonth] = month.split("-").map(Number);
  if (numberMonth < 1 || numberMonth > 12) throw new Error("Tháng không hợp lệ.");
  return new Date(Date.UTC(year, numberMonth - 1 + delta, 1)).toISOString().slice(0, 7);
}

export function monthAfterShiftSave(viewedMonth: string, shiftDate: string, editing: boolean) {
  return editing ? viewedMonth : shiftDate.slice(0, 7);
}
