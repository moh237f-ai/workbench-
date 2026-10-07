/* ==================== Shamsi (Jalali) Calendar ==================== */
/* Faithful port of jalaali-js (MIT) — matches the astronomical Persian
   calendar, including the 1403 leap year that naive 2820-cycle
   algorithms get wrong. Validated against Intl 'persian' calendar. */

export const SHAMSI_MONTHS = [
  'Farvardin', 'Ordibehesht', 'Khordad', 'Tir', 'Mordad', 'Shahrivar',
  'Mehr', 'Aban', 'Azar', 'Dey', 'Bahman', 'Esfand',
];
export const SHAMSI_MONTHS_SHORT = [
  'Far', 'Ord', 'Kho', 'Tir', 'Mor', 'Sha', 'Meh', 'Aba', 'Aza', 'Dey', 'Bah', 'Esf',
];
export const SHAMSI_WEEKDAYS_SHORT = ['Sha', 'Yek', 'Dos', 'Ses', 'Cha', 'Pan', 'Jom'];

export interface ShamsiDate {
  jy: number;
  jm: number;
  jd: number;
}

function div(a: number, b: number): number {
  return Math.trunc(a / b);
}

function mod(a: number, b: number): number {
  return a - Math.trunc(a / b) * b;
}

/* Breaks table + 33-year cycle arithmetic (jalaali-js jalCal) */
function jalCal(jy: number): { leap: number; gy: number; march: number } {
  const breaks = [
    -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060,
    2097, 2192, 2262, 2324, 2394, 2456, 3178,
  ];
  const bl = breaks.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = breaks[0];
  let jm = 0;
  let jump = 0;
  for (let i = 1; i < bl; i += 1) {
    jm = breaks[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

/* Gregorian → JDN (jalaali-js g2d) */
function g2d(gy: number, gm: number, gd: number): number {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) +
    gd -
    34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

/* JDN → Gregorian (jalaali-js d2g) */
function d2g(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

/* Jalali → JDN (jalaali-js j2d) */
function j2d(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

/* JDN → Jalali (jalaali-js d2j) */
function d2j(jdn: number): ShamsiDate {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let jd: number;
  let jm: number;
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) {
      jm = 1 + div(k, 31);
      jd = mod(k, 31) + 1;
      return { jy, jm, jd };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  jm = 7 + div(k, 30);
  jd = mod(k, 30) + 1;
  return { jy, jm, jd };
}

/* ---------- Public API ---------- */

export function gregToShamsi(gy: number, gm: number, gd: number): ShamsiDate {
  return d2j(g2d(gy, gm, gd));
}

export function shamsiToGreg(jy: number, jm: number, jd: number): { gy: number; gm: number; gd: number } {
  return d2g(j2d(jy, jm, jd));
}

export function dateToShamsi(d: Date): ShamsiDate {
  return gregToShamsi(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function formatShamsi(s: ShamsiDate, short = false): string {
  const m = short ? SHAMSI_MONTHS_SHORT[s.jm - 1] : SHAMSI_MONTHS[s.jm - 1];
  return `${s.jd} ${m} ${s.jy}`;
}

/** Persian weeks start Saturday: Sat=0 … Fri=6 */
export function shamsiWeekday(d: Date): number {
  return (d.getDay() + 1) % 7;
}

export function shamsiMonthDays(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isLeapShamsiYear(jy) ? 30 : 29;
}

function isLeapShamsiYear(jy: number): boolean {
  return jalCal(jy).leap === 0;
}

export interface CalendarCell {
  date: Date;
  iso: string;
  shamsi: ShamsiDate;
  inMonth: boolean;
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 6×7 grid for a Jalali month (weeks start Saturday) */
export function buildShamsiMonthGrid(jy: number, jm: number): CalendarCell[] {
  const daysInMonth = shamsiMonthDays(jy, jm);
  const firstG = shamsiToGreg(jy, jm, 1);
  const firstDate = new Date(firstG.gy, firstG.gm - 1, firstG.gd);
  const firstWeekday = shamsiWeekday(firstDate);
  const cells: CalendarCell[] = [];
  const prevMonth = jm === 1 ? { jy: jy - 1, jm: 12 } : { jy, jm: jm - 1 };
  const prevDays = shamsiMonthDays(prevMonth.jy, prevMonth.jm);
  const push = (sd: ShamsiDate) => {
    const g = shamsiToGreg(sd.jy, sd.jm, sd.jd);
    const date = new Date(g.gy, g.gm - 1, g.gd);
    cells.push({ date, iso: isoOf(date), shamsi: sd, inMonth: sd.jy === jy && sd.jm === jm });
  };
  for (let i = firstWeekday - 1; i >= 0; i--) push({ ...prevMonth, jd: prevDays - i });
  for (let d = 1; d <= daysInMonth; d++) push({ jy, jm, jd: d });
  const nextMonth = jm === 12 ? { jy: jy + 1, jm: 1 } : { jy, jm: jm + 1 };
  let dayNum = 1;
  while (cells.length < 42) push({ ...nextMonth, jd: dayNum++ });
  return cells;
}

/** 6×7 grid for a Gregorian month (weeks start Sunday).
 *  Leading/trailing cells carry the adjacent month's real dates so the grid
 *  matches the Shamsi grid's behavior (clickable, dimmed via inMonth). */
export function buildGregorianMonthGrid(year: number, month: number): CalendarCell[] {
  const startOffset = new Date(year, month, 1).getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: CalendarCell[] = [];
  const push = (date: Date) => {
    cells.push({ date, iso: isoOf(date), shamsi: dateToShamsi(date), inMonth: date.getMonth() === month });
  };
  const prevDays = new Date(year, month, 0).getDate();
  for (let i = startOffset - 1; i >= 0; i--) push(new Date(year, month - 1, prevDays - i));
  for (let d = 1; d <= daysInMonth; d++) push(new Date(year, month, d));
  let dayNum = 1;
  while (cells.length < 42) push(new Date(year, month + 1, dayNum++));
  return cells;
}
