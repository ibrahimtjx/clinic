import dayjs, { type Dayjs } from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * The calendar works in clinic local time, whatever the PC's own time zone setting is.
 * Asia/Riyadh has no daylight saving time, so the offset is always +03:00.
 */
export const CLINIC_TZ = 'Asia/Riyadh';
const OFFSET = '+03:00';

export const local = (iso: string | Date): Dayjs => dayjs(iso).tz(CLINIC_TZ);

/** Today's date (YYYY-MM-DD) in the clinic. */
export const todayStr = () => dayjs().tz(CLINIC_TZ).format('YYYY-MM-DD');

/** Minutes since local midnight. */
export const minutesOf = (iso: string): number => {
  const d = local(iso);
  return d.hour() * 60 + d.minute();
};

/** ISO timestamp for a local date and minutes since midnight. */
export const isoAt = (date: string, minutes: number): string => {
  // Minutes past midnight roll over to the next day (24:00 is not a valid ISO time).
  const d = dayjs(date).add(Math.floor(minutes / 1440), 'day').format('YYYY-MM-DD');
  const rest = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(rest / 60);
  const m = rest % 60;
  return `${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00${OFFSET}`;
};

export const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
export const parseHHMM = (s: string): number => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + (m || 0);
};

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD date. */
export const weekdayOf = (date: string) => dayjs(date).day();

export const addDays = (date: string, n: number) => dayjs(date).add(n, 'day').format('YYYY-MM-DD');

/** Sunday that starts the week containing `date` (Saudi weeks start on Sunday). */
export const weekStart = (date: string) => addDays(date, -weekdayOf(date));

export const localDate = (iso: string) => local(iso).format('YYYY-MM-DD');
