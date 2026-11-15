import { matchRanges, normalize } from './normalize';

describe('normalize (mirrors clinic_normalize in the database)', () => {
  it('unifies Arabic spelling variants and digits', () => {
    expect(normalize('أَحْمَد فاطمة مصطفى آمنة إيمان ٠٥٥١')).toBe('احمد فاطمه مصطفي امنه ايمان 0551');
    expect(normalize('Sara')).toBe('sara');
  });
});

describe('matchRanges', () => {
  const cut = (t: string, q: string) => matchRanges(t, q).map(([a, b]) => t.slice(a, b));
  it('highlights the original text for a normalized match', () => {
    expect(cut('أحمد محمد', 'احمد')).toEqual(['أحمد']);
    expect(cut('فاطمة علي', 'فاطمه')).toEqual(['فاطمة']);
    expect(cut('أَحْمَد', 'احمد')).toEqual(['أَحْمَد']);
    expect(cut('Sara Alotaibi', 'otai sar')).toEqual(['Sar', 'otai']);
    expect(cut('0551234567', '١٢٣')).toEqual(['123']);
    expect(cut('abc', '')).toEqual([]);
  });
});
