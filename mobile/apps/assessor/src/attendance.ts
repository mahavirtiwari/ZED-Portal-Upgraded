import { formatDate } from '@zed/shared';
import type { Attendance, AttendanceData, AttendanceType } from './models';

/** Gson's Date format of AssessorDataAccessObject: "yyyy-MM-dd'T'HH:mm:ssXXX" (local time with its offset). */
export function gsonDate(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${formatDate(d, 'yyyy-MM-dd')}T${formatDate(d, 'HH:mm:ss')}${sign}${two(Math.floor(abs / 60))}:${two(abs % 60)}`;
}

export const timeOf = (a: Attendance): number => {
  const t = Date.parse(a.time);
  return Number.isNaN(t) ? 0 : t;
};

const day = (t: number) => formatDate(new Date(t), 'yyyy-MM-dd');
const today = () => formatDate(new Date(), 'yyyy-MM-dd');

/** Utils.fmtTime "h:mm a" / fmtDate "dd/MM/yyyy". */
export const formatTime = (t: number) => formatDate(new Date(t), 'h:mm a');
export const formatDay = (t: number) => formatDate(new Date(t), 'dd/MM/yyyy');

export function newAttendance(selfie: Attendance['selfie'], type: AttendanceType, now = new Date()): Attendance {
  return { selfie, comments: null, time: gsonDate(now), attendanceType: type, isSubmitted: false };
}

export const latestEntry = (d: AttendanceData): Attendance | null =>
  d.attendanceList.reduce<Attendance | null>((best, a) => (best == null || timeOf(a) > timeOf(best) ? a : best), null);

export const isLatestEntryLogin = (d: AttendanceData) => latestEntry(d)?.attendanceType === 'LOGIN';
export const isLatestEntryLogout = (d: AttendanceData) => latestEntry(d)?.attendanceType === 'LOGOUT';

export function lastLoginEntry(d: AttendanceData): Attendance | null {
  const sorted = [...d.attendanceList].sort((a, b) => timeOf(a) - timeOf(b));
  return [...sorted].reverse().find(a => a.attendanceType === 'LOGIN') ?? null;
}

export function lastLogoutEntry(d: AttendanceData): Attendance | null {
  const sorted = [...d.attendanceList].sort((a, b) => timeOf(a) - timeOf(b));
  const last = [...sorted].reverse().find(a => a.attendanceType === 'LOGOUT') ?? null;
  const login = lastLoginEntry(d);
  return last == null || (login != null && timeOf(last) < timeOf(login)) ? null : last;
}

/** AttendanceData.addEntry: null when added, else the reason. */
export function addEntry(d: AttendanceData, a: Attendance): string | null {
  if (a.attendanceType === 'LOGIN' && isLatestEntryLogin(d)) return "You haven't punched out since last punch in";
  if (a.attendanceType === 'LOGOUT' && isLatestEntryLogout(d)) return "You haven't punched in since last punch out";
  d.attendanceList.push(a);
  return null;
}

export const isTodaysEntry = (a: Attendance) => day(timeOf(a)) === today();
export const anyPendingData = (d: AttendanceData) => d.attendanceList.some(a => !a.isSubmitted);

/** AssessmentOptionsActivity: punched in today and not punched out since. */
export function isAttendanceTakenToday(d: AttendanceData | null | undefined): boolean {
  const latest = d ? latestEntry(d) : null;
  return latest != null && latest.attendanceType === 'LOGIN' && isTodaysEntry(latest);
}

export function isLoggedOutToday(d: AttendanceData | null | undefined): boolean {
  const latest = d ? latestEntry(d) : null;
  return latest != null && latest.attendanceType === 'LOGOUT';
}

/** AttendanceLogFragment.AttendanceAdapter: one row per date. */
export type AttendanceLogRow = { date: number; loginDate: number | null; logoutDate: number | null; status: string };

export function attendanceLog(list: Attendance[]): AttendanceLogRow[] {
  const log: AttendanceLogRow[] = [];
  for (const item of list) {
    const t = timeOf(item);
    const row = log.find(r => formatDay(r.date) === formatDay(t));
    if (!row) {
      log.push({
        date: t,
        loginDate: item.attendanceType === 'LOGIN' ? t : null,
        logoutDate: item.attendanceType === 'LOGOUT' ? t : null,
        status: item.isSubmitted ? 'Synced' : 'Pending',
      });
    } else if (item.attendanceType === 'LOGIN') {
      row.loginDate = t;
    } else if (row.loginDate != null && row.loginDate < t) {
      row.logoutDate = t;
    }
  }
  return log;
}

export function totalHours(r: AttendanceLogRow): string {
  if (r.logoutDate == null || r.loginDate == null) return '';
  return `${Math.trunc((r.logoutDate - r.loginDate) / 1000 / 3600)} hrs`;
}
