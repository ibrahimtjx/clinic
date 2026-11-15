import type { Lang } from '../i18n';

/**
 * Display formatting (SPEC 2 Rules, 4.2):
 * Gregorian dd/MM/yyyy, 12-hour times, SAR with 2 decimals, Western digits by default.
 * All values shown are server values; formatting always uses the clinic time zone.
 */
export const CLINIC_TZ = 'Asia/Riyadh';

export type DigitStyle = 'latn' | 'arab';

const locale = (lang: Lang, digits: DigitStyle) =>
  `${lang === 'ar' ? 'ar-SA' : 'en-GB'}-u-nu-${digits}-ca-gregory`;

function parts(d: Date, lang: Lang, digits: DigitStyle, opts: Intl.DateTimeFormatOptions) {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat(locale(lang, digits), { timeZone: CLINIC_TZ, ...opts }).formatToParts(d)) {
    out[p.type] = p.value;
  }
  return out;
}

/** dd/MM/yyyy, always in that order regardless of language. */
export function formatDate(value: Date | string, lang: Lang = 'ar', digits: DigitStyle = 'latn'): string {
  const p = parts(new Date(value), lang, digits, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${p.day}/${p.month}/${p.year}`;
}

/** 12-hour time, e.g. "04:30 م" or "04:30 PM". */
export function formatTime(value: Date | string, lang: Lang = 'ar', digits: DigitStyle = 'latn'): string {
  const p = parts(new Date(value), lang, digits, { hour: '2-digit', minute: '2-digit', hour12: true });
  const period = lang === 'ar' ? (p.dayPeriod === 'ص' || /AM/i.test(p.dayPeriod ?? '') ? 'ص' : 'م') : (p.dayPeriod ?? '').toUpperCase();
  return `${p.hour}:${p.minute} ${period}`;
}

export function formatDateTime(value: Date | string, lang: Lang = 'ar', digits: DigitStyle = 'latn'): string {
  return `${formatDate(value, lang, digits)} ${formatTime(value, lang, digits)}`;
}

/**
 * Money arrives from the API as a decimal string (NUMERIC(12,2)), never a float.
 * Formatting splits the string, so no binary floating point touches the amount.
 */
export function formatMoney(amount: string, lang: Lang = 'ar', digits: DigitStyle = 'latn'): string {
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!m) throw new Error(`Invalid money value: ${amount}`);
  const [, neg, int, frac = ''] = m;
  const grouped = int.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let text = `${grouped}.${frac.padEnd(2, '0')}`;
  if (digits === 'arab') text = toArabicDigits(text).replace(/,/g, '٬').replace('.', '٫');
  const sign = neg ? '-' : '';
  return lang === 'ar' ? `${sign}${text} ر.س` : `SAR ${sign}${text}`;
}

export function toArabicDigits(s: string): string {
  return s.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
}

/** Age in years, months and days (SPEC 5.2 header card). */
export function ageParts(dob: Date, today: Date): { years: number; months: number; days: number } {
  let years = today.getFullYear() - dob.getFullYear();
  let months = today.getMonth() - dob.getMonth();
  let days = today.getDate() - dob.getDate();
  if (days < 0) {
    months -= 1;
    days += new Date(today.getFullYear(), today.getMonth(), 0).getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years, months, days };
}

/** Saudi mobile 05XXXXXXXX (SPEC 5.3). */
export const SAUDI_MOBILE = /^05\d{8}$/;
/** National ID or iqama: 10 digits (SPEC 5.3). */
export const NATIONAL_ID = /^\d{10}$/;
