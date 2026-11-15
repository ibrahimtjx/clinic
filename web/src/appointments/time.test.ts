import { isoAt, localDate, minutesOf, weekStart, weekdayOf } from './time';

describe('clinic time', () => {
  it('works in Riyadh time regardless of the PC time zone', () => {
    expect(minutesOf('2027-01-03T06:30:00Z')).toBe(9 * 60 + 30);
    expect(localDate('2027-01-03T22:30:00Z')).toBe('2027-01-04');
    expect(isoAt('2027-01-03', 9 * 60 + 5)).toBe('2027-01-03T09:05:00+03:00');
    expect(isoAt('2027-01-03', 24 * 60)).toBe('2027-01-04T00:00:00+03:00');
  });
  it('weeks start on Sunday', () => {
    expect(weekdayOf('2027-01-03')).toBe(0);
    expect(weekStart('2027-01-06')).toBe('2027-01-03');
  });
});
