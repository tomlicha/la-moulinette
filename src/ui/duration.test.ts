import { describe, expect, it } from 'vitest';
import { formatDuration, parseDuration } from './duration';

describe('durées saisies', () => {
  it('lit mm:ss, h:mm:ss et des minutes seules', () => {
    expect(parseDuration('5:30')).toBe(330);
    expect(parseDuration(' 0:45 ')).toBe(45);
    expect(parseDuration('1:02:00')).toBe(3720);
    expect(parseDuration('12')).toBe(720);
    expect(parseDuration('1,5')).toBe(90);
  });

  it('refuse ce qui est ambigu ou faux', () => {
    for (const bad of ['', 'abc', '5:75', '1:2:3:4', '5:-1', '5:3a']) expect(parseDuration(bad)).toBeUndefined();
  });

  it('formate et relit à l\'identique', () => {
    for (const s of [0, 45, 330, 3599, 3720, 7265]) expect(parseDuration(formatDuration(s))).toBe(s);
    expect(formatDuration(330)).toBe('5:30');
    expect(formatDuration(3720)).toBe('1:02:00');
  });
});
