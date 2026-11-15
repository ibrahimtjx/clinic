import { ageParts, formatDate, formatMoney, formatTime, NATIONAL_ID, SAUDI_MOBILE } from './format';

// 2026-11-15 13:05 UTC = 16:05 in Riyadh (UTC+3).
const t = '2026-11-15T13:05:00Z';

describe('formatDate', () => {
  it('shows dd/MM/yyyy in Riyadh time with Western digits by default', () => {
    expect(formatDate(t, 'ar')).toBe('15/11/2026');
    expect(formatDate(t, 'en')).toBe('15/11/2026');
  });
  it('uses the Riyadh date near midnight UTC', () => {
    expect(formatDate('2026-11-15T22:30:00Z', 'en')).toBe('16/11/2026');
  });
  it('can use Arabic-Indic digits', () => {
    expect(formatDate(t, 'ar', 'arab')).toBe('١٥/١١/٢٠٢٦');
  });
});

describe('formatTime', () => {
  it('is 12-hour', () => {
    expect(formatTime(t, 'en')).toBe('04:05 PM');
    expect(formatTime(t, 'ar')).toBe('04:05 م');
    expect(formatTime('2026-11-15T05:00:00Z', 'ar')).toBe('08:00 ص');
  });
});

describe('formatMoney', () => {
  it('formats decimal strings with 2 places and grouping', () => {
    expect(formatMoney('1234567.5', 'en')).toBe('SAR 1,234,567.50');
    expect(formatMoney('0.1', 'ar')).toBe('0.10 ر.س');
    expect(formatMoney('-15', 'en')).toBe('SAR -15.00');
  });
  it('rejects floats with more than 2 decimals or junk', () => {
    expect(() => formatMoney('1.005')).toThrow();
    expect(() => formatMoney('abc')).toThrow();
  });
});

describe('ageParts', () => {
  it('computes years, months, days', () => {
    expect(ageParts(new Date(2000, 0, 31), new Date(2026, 10, 15))).toEqual({ years: 26, months: 9, days: 15 });
  });
});

describe('validators', () => {
  it('validates Saudi mobile and national ID', () => {
    expect(SAUDI_MOBILE.test('0551234567')).toBe(true);
    expect(SAUDI_MOBILE.test('551234567')).toBe(false);
    expect(NATIONAL_ID.test('1012345678')).toBe(true);
    expect(NATIONAL_ID.test('10123')).toBe(false);
  });
});
