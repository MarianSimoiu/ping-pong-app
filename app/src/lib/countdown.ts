import { useEffect, useState } from 'react';

// The current time, refreshed every `intervalMs` while the screen using it is
// mounted (pass null to stop ticking).
export function useNow(intervalMs: number | null = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (intervalMs === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export type TimeLeft = { days: number; hours: number; minutes: number; seconds: number; ms: number };

export function timeLeft(untilIso: string, now: number): TimeLeft {
  const ms = Math.max(0, new Date(untilIso).getTime() - now);
  const s = Math.floor(ms / 1000);
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
    ms,
  };
}

// Compact, for list rows: "2d 4h", "3h 12m", "12m", "45s".
export function shortTimeLeft(untilIso: string, now: number): string {
  const t = timeLeft(untilIso, now);
  if (t.days > 0) return `${t.days}d ${t.hours}h`;
  if (t.hours > 0) return `${t.hours}h ${t.minutes}m`;
  if (t.minutes > 0) return `${t.minutes}m`;
  return `${t.seconds}s`;
}

// <input type="datetime-local"> values ("2026-11-15T18:00") <-> Date, in the
// device's time zone.
export function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalInputValue(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  const date = new Date(y, mo - 1, d, h, mi);
  // Rejects dates that roll over, like 31 November.
  return date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
}

// A sensible default kickoff: tomorrow at 18:00.
export function defaultKickoff(now = new Date()): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(18, 0, 0, 0);
  return d;
}
