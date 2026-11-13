// How tournament rounds and match times read in notifications (pure,
// testable). Times are in the club's time zone, like the database's
// club_time_zone() (migration 0016) and the app.

export const CLUB_TIME_ZONE = 'Europe/Bucharest';

// A round's name, by how far it is from the final: "Quarterfinals".
export function roundName(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semifinals';
  if (fromEnd === 2) return 'Quarterfinals';
  if (fromEnd === 3) return 'Round of 16';
  if (fromEnd === 4) return 'Round of 32';
  return `Round ${round}`;
}

// One match of that round, in a sentence: "your semifinal".
export function matchName(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return 'final';
  if (fromEnd === 1) return 'semifinal';
  if (fromEnd === 2) return 'quarterfinal';
  if (fromEnd === 3) return 'round of 16 match';
  if (fromEnd === 4) return 'round of 32 match';
  return `round ${round} match`;
}

// "Mon 16 Nov, 11:00", in club time.
export function clubTime(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CLUB_TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('weekday')} ${part('day')} ${part('month')}, ${part('hour')}:${part('minute')}`;
}

// The moment a club-time day starts ("2026-11-16" at 00:00 in Bucharest).
export function clubDayStart(day: string): Date {
  for (const offset of ['+02:00', '+03:00']) {
    const at = new Date(`${day}T00:00:00${offset}`);
    if (clubDate(at) === day && clubClock(at) === '00:00') return at;
  }
  throw new Error(`No midnight on ${day}`);
}

// The club-time day of a moment, as YYYY-MM-DD.
export function clubDate(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CLUB_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

function clubClock(at: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: CLUB_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
}
