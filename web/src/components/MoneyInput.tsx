import { NumberInput, type NumberInputProps } from '@mantine/core';
import { useTranslation } from 'react-i18next';

/**
 * SAR amount input. The value is a decimal string with 2 places, as the API sends and expects
 * (NUMERIC(12,2)); the browser never stores it as a float.
 */
export function MoneyInput({ value, onChange, ...props }: { value: string; onChange: (v: string) => void } & Omit<NumberInputProps, 'value' | 'onChange'>) {
  const { t } = useTranslation();
  return (
    <NumberInput
      value={value}
      onChange={(v) => onChange(v === '' ? '0' : String(v))}
      onBlur={() => onChange(toMoneyString(value))}
      decimalScale={2}
      min={0}
      max={9_999_999_999.99}
      thousandSeparator=","
      allowNegative={false}
      rightSection={<span style={{ fontSize: 'var(--mantine-font-size-xs)', color: 'var(--app-muted)' }}>{t('currency')}</span>}
      rightSectionWidth={44}
      hideControls
      dir="ltr"
      {...props}
    />
  );
}

/** Normalizes "12.5" → "12.50" using string arithmetic only. */
export function toMoneyString(v: string): string {
  const m = /^(\d*)(?:\.(\d{0,2}))?/.exec(String(v).replace(/,/g, '').trim());
  if (!m || (!m[1] && !m[2])) return '0.00';
  return `${String(Number(m[1] || '0'))}.${(m[2] ?? '').padEnd(2, '0')}`;
}

/** Compare two decimal strings without floats. */
export function cmpMoney(a: string, b: string): number {
  const [ai, af] = toMoneyString(a).split('.');
  const [bi, bf] = toMoneyString(b).split('.');
  if (ai.length !== bi.length) return ai.length - bi.length;
  if (ai !== bi) return ai < bi ? -1 : 1;
  return af === bf ? 0 : af < bf ? -1 : 1;
}
