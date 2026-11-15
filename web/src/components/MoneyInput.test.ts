import { cmpMoney, toMoneyString } from './MoneyInput';

describe('money strings (no floats)', () => {
  it('normalizes to 2 places', () => {
    expect(toMoneyString('12.5')).toBe('12.50');
    expect(toMoneyString('0012')).toBe('12.00');
    expect(toMoneyString('1,234.567')).toBe('1234.56');
    expect(toMoneyString('')).toBe('0.00');
    expect(toMoneyString('.5')).toBe('0.50');
  });
  it('compares without floating point', () => {
    expect(cmpMoney('100', '99.99')).toBeGreaterThan(0);
    expect(cmpMoney('0.10', '0.1')).toBe(0);
    expect(cmpMoney('1234567890.01', '1234567890.02')).toBeLessThan(0);
  });
});
