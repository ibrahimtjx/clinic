import ar from './ar.json';
import en from './en.json';

function keys(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

describe('i18n files', () => {
  it('ar.json and en.json have exactly the same keys', () => {
    expect(keys(ar).sort()).toEqual(keys(en).sort());
  });
  it('arrays have the same length in both languages', () => {
    expect(ar.sample.patients.length).toBe(en.sample.patients.length);
    expect(ar.sample.doctors.length).toBe(en.sample.doctors.length);
  });
});
