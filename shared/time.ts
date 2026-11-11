// Datas 'YYYY-MM-DD' e horários 'HH:MM' tratados como texto, sem fuso.

export const toMin = (t: string): number => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

export const toHHMM = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const weekdayOf = (date: string): number => new Date(`${date}T12:00:00Z`).getUTCDay();

export const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

export const isDate = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
  && !Number.isNaN(Date.parse(`${s}T12:00:00Z`))
  && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;

export const isTime = (s: unknown): s is string =>
  typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** Data e minuto atuais num fuso IANA. */
export function nowIn(tz: string, at = new Date()): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** Converte data/hora local (no fuso tz) para milissegundos UTC. */
export function localToUtcMs(date: string, time: string, tz: string): number {
  const guess = Date.parse(`${date}T${time}:00Z`);
  const local = nowIn(tz, new Date(guess));
  const localMs = Date.parse(`${local.date}T${toHHMM(local.minutes)}:00Z`);
  return guess - (localMs - guess);
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}
export function endOfMonth(date: string): string {
  const [y, m] = date.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}
export function addMonths(date: string, n: number): string {
  const [y, m] = date.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}
