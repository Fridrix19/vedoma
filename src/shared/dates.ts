const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

export function addWorkingDays(from: Date, days: number): Date {
  const d = new Date(from);
  let left = days;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d;
}

export function subWorkingDays(from: Date, days: number): Date {
  const d = new Date(from);
  let left = days;
  while (left > 0) {
    d.setDate(d.getDate() - 1);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 26.09 */
export const ddmm = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
};

/** 23.09.2026 */
export const ddmmyyyy = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
};

/** 16:18 */
export const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** 26 сентября */
export const dayMonth = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
};

export const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** «Обновлено сегодня» / «Обновлено 24.09» */
export const relDay = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  if (isSameDay(d, now)) return 'сегодня';
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (isSameDay(d, y)) return 'вчера';
  return ddmm(iso);
};

export const minutesAgo = (iso: string) => (Date.now() - new Date(iso).getTime()) / 60000;

export function pluralDays(n: number) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return 'рабочий день';
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return 'рабочих дня';
  return 'рабочих дней';
}

/** Конец дня дедлайна прошёл? */
export const isPastDeadline = (deadlineIso: string) => {
  const d = new Date(deadlineIso);
  d.setHours(23, 59, 59, 999);
  return d.getTime() < Date.now();
};
