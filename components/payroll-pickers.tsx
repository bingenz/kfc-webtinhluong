"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { vi } from "react-day-picker/locale";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type PickerProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};
const pad = (value: number) => String(value).padStart(2, "0");
export function TimePicker({ label, value, onChange, disabled }: PickerProps) {
  const id = useId();
  const [hour, minute] = /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
    ? value.split(":")
    : ["00", "00"];
  const [draftHour, setDraftHour] = useState(hour),
    [draftMinute, setDraftMinute] = useState(minute);
  const minuteInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setDraftHour(hour);
    setDraftMinute(minute);
  }, [hour, minute]);
  const commit = (nextHour: string, nextMinute: string) => {
    if (
      /^\d{2}$/.test(nextHour) &&
      /^\d{2}$/.test(nextMinute) &&
      Number(nextHour) <= 23 &&
      Number(nextMinute) <= 59
    )
      onChange(nextHour + ":" + nextMinute);
  };
  return (
    <div className="compact-time" role="group" aria-labelledby={id + "-label"}>
      <span className="sr-only" id={id + "-label"}>
        {label}
      </span>
      <input
        aria-label={label + " giờ"}
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        value={draftHour}
        disabled={disabled}
        onChange={(e) => {
          const next = e.currentTarget.value.replace(/\D/g, "").slice(0, 2);
          setDraftHour(next);
          if (next.length === 2 && Number(next) <= 23) {
            commit(next, draftMinute.padStart(2, "0"));
            minuteInput.current?.focus();
          }
        }}
        onBlur={(e) => {
          const next = e.currentTarget.value
            .replace(/\D/g, "")
            .padStart(2, "0");
          setDraftHour(next);
          if (Number(next) <= 23) commit(next, draftMinute.padStart(2, "0"));
        }}
      />
      <span aria-hidden="true">:</span>
      <input
        ref={minuteInput}
        aria-label={label + " phút"}
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        value={draftMinute}
        disabled={disabled}
        onChange={(e) => {
          const next = e.currentTarget.value.replace(/\D/g, "").slice(0, 2);
          setDraftMinute(next);
          if (next.length === 2 && Number(next) <= 59)
            commit(draftHour.padStart(2, "0"), next);
        }}
        onBlur={(e) => {
          const next = e.currentTarget.value
            .replace(/\D/g, "")
            .padStart(2, "0");
          setDraftMinute(next);
          if (Number(next) <= 59) commit(draftHour.padStart(2, "0"), next);
        }}
      />
    </div>
  );
}

export function DatePicker({ label, value, onChange, disabled }: PickerProps) {
  const [open, setOpen] = useState(false);
  const [year, month, day] = value.split("-").map(Number);
  const selected = new Date(year, month - 1, day, 12);
  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="temporal-trigger"
          aria-label={label}
          disabled={disabled}
        >
          <span>
            {pad(day)}/{pad(month)}/{year}
          </span>
          <CalendarDays size={18} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        aria-label={label}
        className="temporal-popover date-picker"
        align="center"
        collisionPadding={12}
      >
        <Calendar
          mode="single"
          locale={vi}
          weekStartsOn={1}
          selected={selected}
          defaultMonth={selected}
          autoFocus
          formatters={{
            formatCaption: (date) =>
              `Tháng ${date.getMonth() + 1}/${date.getFullYear()}`,
            formatWeekdayName: (date) =>
              ["CN", "T2", "T3", "T4", "T5", "T6", "T7"][date.getDay()],
          }}
          onSelect={(date) => {
            if (date) {
              onChange(
                `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
              );
              setOpen(false);
            }
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
