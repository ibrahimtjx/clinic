import { describe, expect, it } from 'vitest';

import { fillTemplate, waLink, waNumber } from './whatsapp';

describe('whatsapp', () => {
  it('turns Saudi mobiles into international numbers', () => {
    expect(waNumber('0551234567')).toBe('966551234567');
    expect(waNumber('+966 55 123 4567')).toBe('966551234567');
    expect(waNumber('00966551234567')).toBe('966551234567');
    expect(waNumber('551234567')).toBe('966551234567');
    expect(waNumber('123')).toBeNull();
    expect(waNumber(null)).toBeNull();
  });
  it('fills placeholders and leaves unknown ones', () => {
    expect(fillTemplate('{patient} at {time} {x}', { patient: 'سارة', time: '10:00' })).toBe('سارة at 10:00 {x}');
  });
  it('builds a plain wa.me link', () => {
    const url = waLink('966551234567', "موعدك (غدًا)! it's");
    expect(url.startsWith('https://wa.me/966551234567?text=')).toBe(true);
    expect(url).toMatch(/^[A-Za-z0-9%/:._?=+-]+$/);
  });
});
