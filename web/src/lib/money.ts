import { toMoneyString } from '../components/MoneyInput';

/**
 * Decimal-string money arithmetic in integer halalas (SPEC 2: never floats). Amounts stay far below
 * Number.MAX_SAFE_INTEGER halalas, so integer math is exact.
 */
export const toCents = (v: string): number => {
  const neg = v.trim().startsWith('-');
  const [i, f] = toMoneyString(v.replace('-', '')).split('.');
  const c = Number(i) * 100 + Number(f);
  return neg ? -c : c;
};

export const fromCents = (c: number): string => {
  const neg = c < 0;
  const a = Math.abs(c);
  return `${neg ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
};

export const sumMoney = (values: string[]): string => fromCents(values.reduce((s, v) => s + toCents(v || '0'), 0));
export const subMoney = (a: string, b: string): string => fromCents(toCents(a) - toCents(b));
