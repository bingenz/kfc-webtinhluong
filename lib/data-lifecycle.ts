import type { Ledger } from "./payroll.ts";
import { initialLedger } from "./payroll.ts";
import { parseLedger } from "./ledger-schema.ts";

export const LOCAL_KEY = "ca-lam-local-v1";
export const BACKUP_PREFIX = "ca-lam-backup-v1:";

export type DeviceRead =
  | { ok: true; ledger: Ledger; raw: string | null }
  | { ok: false; raw: string; error: string };

export function readDeviceRaw(raw: string | null): DeviceRead {
  if (!raw) return { ok: true, ledger: initialLedger(), raw: null };
  try {
    return { ok: true, ledger: parseLedger(JSON.parse(raw)), raw };
  } catch (error) {
    return {
      ok: false,
      raw,
      error: error instanceof Error ? error.message : "Không thể đọc dữ liệu trên thiết bị.",
    };
  }
}

export function hasUserData(ledger: Ledger) {
  return (
    ledger.shifts.length > 0 ||
    ledger.adjustments.length > 0 ||
    ledger.payments.length > 0 ||
    ledger.settlements.length > 0 ||
    ledger.reconciliations.length > 0 ||
    ledger.holidays.length > 0 ||
    ledger.roles.some((role) => !["cook", "lobby", "cash"].includes(role.id)) ||
    ledger.rates.some((rate) => !["cook-initial", "lobby-initial"].includes(rate.id)) ||
    ledger.rules.some((rule) => rule.id !== "initial")
  );
}

function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function mergeByKey<T>(
  left: T[],
  right: T[],
  key: (item: T) => string,
  label: string,
): T[] {
  const result = new Map<string, T>();
  for (const item of left) result.set(key(item), item);
  for (const item of right) {
    const id = key(item);
    const existing = result.get(id);
    if (existing && !same(existing, item)) {
      throw new Error(`Không thể gộp tự động: ${label} có cùng mã nhưng nội dung khác (${id}).`);
    }
    result.set(id, item);
  }
  return [...result.values()];
}

export function mergeLedgers(device: Ledger, cloud: Ledger): Ledger {
  return {
    schemaVersion: 1,
    roles: mergeByKey(cloud.roles, device.roles, (x) => x.id, "vị trí"),
    rates: mergeByKey(cloud.rates, device.rates, (x) => x.id, "mức lương"),
    rules: mergeByKey(cloud.rules, device.rules, (x) => x.id, "quy tắc"),
    holidays: mergeByKey(cloud.holidays, device.holidays, (x) => x.id, "ngày lễ"),
    shifts: mergeByKey(cloud.shifts, device.shifts, (x) => x.id, "ca làm"),
    adjustments: mergeByKey(cloud.adjustments, device.adjustments, (x) => x.id, "điều chỉnh"),
    payments: mergeByKey(cloud.payments, device.payments, (x) => x.id, "khoản nhận"),
    settlements: mergeByKey(cloud.settlements, device.settlements, (x) => x.month, "kỳ đã chốt"),
    reconciliations: mergeByKey(cloud.reconciliations, device.reconciliations, (x) => x.month, "đối soát"),
  };
}

export function backupKey(timestamp = new Date().toISOString()) {
  return BACKUP_PREFIX + timestamp.replaceAll(":", "-");
}
