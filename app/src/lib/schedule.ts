// When tournament matches are played (migration 0018), as the app shows and
// picks them. Times are the club's (Bucharest), whatever the phone's own
// time zone. The rules mirror the database's (club_opens/club_closes,
// match_slot, check_match_time): keep them in step. The database has the
// last word.

export const CLUB_TIME_ZONE = 'Europe/Bucharest';
export const CLUB_OPENS = '11:00';
export const CLUB_CLOSES = '18:00';
// The times offered when picking: on the hour and half hour.
const PICK_STEP_MINUTES = 30;
// How far ahead an admin can move a match from the app.
const ADMIN_DAYS = 21;

// How long a match takes on the table, in minutes.
export const slotMinutes = (bestOf: number): number => (bestOf <= 3 ? 30 : bestOf === 5 ? 45 : 60);

const clubFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: CLUB_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const dayNameFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

// Built from the parts: browsers don't all lay out a formatted date the same.
function parts(format: Intl.DateTimeFormat, at: Date): (type: Intl.DateTimeFormatPartTypes) => string {
  const all = format.formatToParts(at);
  return (type) => all.find((p) => p.type === type)?.value ?? '';
}

// The club day of a moment: "2026-11-16".
export function clubDay(at: Date | string | number): string {
  const part = parts(clubFormat, new Date(at));
  return `${part('year')}-${part('month')}-${part('day')}`;
}
// The club time of a moment: "11:00".
export function clubClock(at: Date | string | number): string {
  const part = parts(clubFormat, new Date(at));
  return `${part('hour')}:${part('minute')}`;
}

const pad = (n: number) => String(n).padStart(2, '0');
const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

// The moment of a club day and time ("2026-11-16", "11:00").
export function clubMoment(day: string, hhmm: string): Date {
  for (const offset of ['+02:00', '+03:00']) {
    const at = new Date(`${day}T${hhmm}:00${offset}`);
    if (clubDay(at) === day && clubClock(at) === hhmm) return at;
  }
  return new Date(`${day}T${hhmm}:00+03:00`); // a time skipped when the clocks go forward
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const isWeekend = (day: string): boolean => [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay());

// The weekday after `day` (Friday, Saturday and Sunday all lead to Monday).
export function nextWeekday(day: string): string {
  let d = addDays(day, 1);
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}

// "Mon 16 Nov"
export function formatDay(day: string): string {
  const part = parts(dayNameFormat, new Date(`${day}T12:00:00Z`));
  return `${part('weekday')} ${part('day')} ${part('month')}`;
}

// "Today", "Tomorrow", else "Mon 16 Nov".
export function dayLabel(day: string, now: Date | number = Date.now()): string {
  const today = clubDay(now);
  if (day === today) return 'Today';
  if (day === addDays(today, 1)) return 'Tomorrow';
  if (day === addDays(today, -1)) return 'Yesterday';
  return formatDay(day);
}

// "Tomorrow · 11:00", "Mon 16 Nov · 11:00"
export const formatMatchTime = (iso: string, now: Date | number = Date.now()): string =>
  `${dayLabel(clubDay(iso), now)} · ${clubClock(iso)}`;

// "Mon 16 Nov", or "Mon 16 – Wed 18 Nov" for a round over several days.
export function formatDayRange(start: string, end: string): string {
  if (start === end) return formatDay(start);
  const [a, b] = [formatDay(start), formatDay(end)];
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return `${sameMonth ? a.split(' ').slice(0, 2).join(' ') : a} – ${b}`;
}

// The days a player can move their match to: from today up to one day after
// the day it was planned for (none once that's past: the organizer decides).
export function proposalDays(plannedOn: string | null, now: Date | number = Date.now()): string[] {
  const today = clubDay(now);
  const last = addDays(plannedOn ?? today, 1);
  const days: string[] = [];
  for (let d = today; d <= last; d = addDays(d, 1)) days.push(d);
  return days;
}

// The days an admin can move a match to from the app.
export function adminDays(now: Date | number = Date.now()): string[] {
  const today = clubDay(now);
  return Array.from({ length: ADMIN_DAYS }, (_, i) => addDays(today, i));
}

// The start times offered for a day: 11:00, 11:30, … up to the last one that
// ends by closing time.
export function startTimes(bestOf: number): string[] {
  const len = slotMinutes(bestOf);
  const out: string[] = [];
  for (let m = minutes(CLUB_OPENS); m + len <= minutes(CLUB_CLOSES); m += PICK_STEP_MINUTES) {
    out.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  }
  return out;
}

// A match on the table: from `start` until `end` (ms).
export type TableTime = { matchId: string; start: number; end: number };

export type TimeOption = { hhmm: string; iso: string; free: boolean; past: boolean };

// The start times of `day` for a match, each free or not: not past (5 minutes
// ahead at least), and the table not taken by another match then.
export function timeOptions(
  day: string,
  bestOf: number,
  table: TableTime[],
  matchId: string,
  now: number = Date.now(),
): TimeOption[] {
  const len = slotMinutes(bestOf) * 60_000;
  const others = table.filter((t) => t.matchId !== matchId);
  return startTimes(bestOf).map((hhmm) => {
    const at = clubMoment(day, hhmm).getTime();
    const past = at < now + 5 * 60_000;
    const free = !past && !others.some((t) => at < t.end && t.start < at + len);
    return { hhmm, iso: new Date(at).toISOString(), free, past };
  });
}

// The days with a start time still ahead (today may have none left).
export function pickableDays(days: string[], bestOf: number, now: number = Date.now()): string[] {
  return days.filter((day) => timeOptions(day, bestOf, [], '', now).some((o) => !o.past));
}

// Still to play after the day it was due: the organizer decides it.
export function isOverdue(n: { status: string; scheduledAt: string | null }, now: Date | number = Date.now()): boolean {
  return n.status === 'ready' && !!n.scheduledAt && clubDay(n.scheduledAt) < clubDay(now);
}
