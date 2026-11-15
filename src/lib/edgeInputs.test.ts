/**
 * THE INPUTS NOBODY MEANT TO TYPE.
 *
 * Every function here is fed by something that can be garbage on a real phone —
 * a corrupt row, a measured duration, a file re-saved by another editor, a clock
 * east of Greenwich. Each case below printed something a person would read as a
 * bug ("-0", "Infinity:NaN", "NaN undefined", "not valid JSON") until it was
 * pinned here, alongside the boundary cases of the same functions that already
 * held and must keep holding.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  formatClock,
  formatDuration,
  formatShortDate,
  formatValue,
  formatVolumeKg,
  formatWeight,
  kgToLb,
  lbToKg,
  parseCountInput,
  roundToStep,
} from './units';
import { daysBetween, parseDay, shiftDay, weekEnd, weekStart } from './days';
import { parseBackup, serializeBackup } from './backup';
import { validateChanges } from './ai/aiChanges';
import { bodyweightAt, clampBodyweightKg, sanitizeBodyweightLog } from './bodyweightLog';
import { daysSince, isBackupFileName, padToCover, utf8ByteLength } from './autoBackup';

let savedTz: string | undefined;
beforeAll(() => {
  savedTz = process.env.TZ;
  // UTC+4, no DST: a session at 01:30 local is 21:30 UTC the day before.
  process.env.TZ = 'Asia/Yerevan';
});
afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

describe('number formatting never prints a non-number', () => {
  it('formatValue drops the sign of a value that rounds to zero', () => {
    expect(formatValue(-0.4)).toBe('0');
    expect(formatValue(-0.6)).toBe('-1');
    expect(formatValue(-1234.4)).toBe('-1,234');
    expect(formatValue(0)).toBe('0');
  });

  it('formatValue reads NaN and Infinity as zero', () => {
    expect(formatValue(NaN)).toBe('0');
    expect(formatValue(Infinity)).toBe('0');
  });

  it('formatWeight treats NaN like a missing weight', () => {
    expect(formatWeight(NaN, 'metric')).toBe('—');
    expect(formatWeight(null, 'imperial')).toBe('—');
    expect(formatWeight(0, 'metric')).toBe('0');
    expect(formatWeight(22.5, 'metric')).toBe('22.5');
    expect(formatWeight(20, 'metric', 'assisted')).toBe('−20');
  });

  it('formatClock clamps Infinity as it clamps NaN', () => {
    expect(formatClock(Infinity)).toBe('0:00');
    expect(formatClock(NaN)).toBe('0:00');
    expect(formatClock(-5)).toBe('0:00');
    expect(formatClock(59.6)).toBe('1:00');
  });

  it('formatDuration rounds a measured duration before choosing its form', () => {
    expect(formatDuration(59.5)).toBe('1 min');
    expect(formatDuration(44.4)).toBe('44 sec');
    expect(formatDuration(90.4)).toBe('1:30');
    expect(formatDuration(0.3)).toBe('no rest');
    expect(formatDuration(NaN)).toBe('no rest');
    expect(formatDuration(3600)).toBe('60 min');
  });

  it('formatVolumeKg groups thousands and floors junk at zero', () => {
    expect(formatVolumeKg(1234567)).toBe('1 234 567 kg');
    expect(formatVolumeKg(999.6)).toBe('1 000 kg');
    expect(formatVolumeKg(NaN)).toBe('0 kg');
    expect(formatVolumeKg(-50)).toBe('0 kg');
  });

  it('formatShortDate names no day for an unreadable timestamp', () => {
    expect(formatShortDate('yesterday-ish')).toBe('');
    expect(formatShortDate('')).toBe('');
  });
});

describe('dates are the phone’s own', () => {
  it('formatShortDate dates a pre-dawn session to the local day', () => {
    expect(formatShortDate('2026-08-16T21:30:00.000Z')).toBe('17 Aug');
  });

  it('a set-kind correction is labelled with the local day, not the UTC one', () => {
    const [change] = validateChanges(
      [{ target: 'workout_set', id: 'w1', exerciseId: 'bench', number: 1, text: 'warmup' }],
      {
        exercises: [],
        workouts: [
          {
            id: 'w1',
            startedAt: '2026-10-26T21:30:00.000Z',
            sets: [{ id: 's1', exerciseId: 'bench', setIndex: 0, isWarmup: false }],
          },
        ],
      },
    );
    expect(change).toMatchObject({ target: 'workout_set', setId: 's1', day: '2026-10-27' });
  });

  it('day arithmetic crosses month, year and leap-day boundaries', () => {
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDay('2028-02-28', 1)).toBe('2028-02-29');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-12-25', '2027-01-08')).toBe(14);
    expect(parseDay('2026-02-29')).toBeNull();
    expect(parseDay('2028-02-29')).not.toBeNull();
    // A week that straddles New Year belongs to the Monday in December.
    expect(weekStart('2027-01-01')).toBe('2026-12-28');
    expect(weekEnd('2026-12-28')).toBe('2027-01-03');
  });
});

describe('weights and steps', () => {
  it('kg ⇄ lb round-trips without drift a display would show', () => {
    for (const kg of [0, 1.25, 20, 22.5, 100, 272.5]) {
      expect(lbToKg(kgToLb(kg))).toBeCloseTo(kg, 10);
    }
    expect(formatWeight(100, 'imperial')).toBe('220.5');
  });

  it('roundToStep leaves a value alone when the step is unusable', () => {
    expect(roundToStep(26.4, 0)).toBe(26.4);
    expect(roundToStep(26.4, -2.5)).toBe(26.4);
    expect(roundToStep(26.4, 2.5)).toBe(27.5);
    expect(roundToStep(0.1 + 0.2, 0.1)).toBe(0.3);
  });

  it('parseCountInput refuses what is not a count', () => {
    expect(parseCountInput('', 'reps')).toBeNull();
    expect(parseCountInput('-3', 'reps')).toBeNull();
    expect(parseCountInput('Infinity', 'reps')).toBeNull();
    expect(parseCountInput('1:30', 'reps')).toBeNull();
    expect(parseCountInput('1:30', 'seconds')).toBe(90);
    expect(parseCountInput('1,5', 'rounds')).toBe(90);
  });
});

describe('a backup file read back', () => {
  const payload = {
    settings: { unitSystem: 'metric' },
    exercises: [{ id: 'e1' }],
    routines: [],
    workouts: [{ id: 'w1', sets: [{}, {}] }],
    sequence: null,
    numbering: null,
  };

  it('round-trips what it wrote', () => {
    const text = serializeBackup(payload, new Date('2026-11-05T10:00:00.000Z'));
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.counts).toEqual({ exercises: 1, routines: 0, workouts: 1, sets: 2 });
    expect(parsed.envelope.exportedAt).toBe('2026-11-05T10:00:00.000Z');
    expect(parsed.envelope.workouts).toEqual(payload.workouts);
  });

  it('opens a file an editor re-saved with a byte-order mark', () => {
    const parsed = parseBackup(String.fromCharCode(0xfeff) + serializeBackup(payload));
    expect(parsed.ok).toBe(true);
  });

  it.each([
    ['empty text', ''],
    ['a bare null', 'null'],
    ['an array', '[]'],
    ['a truncated file', '{"format":"workout-tracker-backup","workouts":['],
    ['a newer format', '{"version":99,"workouts":[]}'],
    ['another app’s backup', '{"format":"workout-tracker-backup","tasks":[]}'],
  ])('refuses %s with a sentence', (_label, text) => {
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.length).toBeGreaterThan(10);
  });
});

describe('settings sanitizers', () => {
  it('bodyweight: unset stays unset, the range clamps, the log keeps one a day', () => {
    expect(clampBodyweightKg(0)).toBeUndefined();
    expect(clampBodyweightKg('  ')).toBeUndefined();
    expect(clampBodyweightKg(82.34)).toBe(82.3);
    expect(clampBodyweightKg(999)).toBe(300);

    const log = sanitizeBodyweightLog([
      { at: '2026-11-01T06:00:00.000Z', kg: 80 },
      { at: '2026-11-01T18:00:00.000Z', kg: 81 },
      { at: '2026-11-03T06:00:00.000Z', kg: 79.5 },
      { at: 'bad', kg: 80 },
      { at: '2026-11-04T06:00:00.000Z', kg: 5 },
    ]);
    expect(log).toEqual([
      { at: '2026-11-03T06:00:00.000Z', kg: 79.5 },
      { at: '2026-11-01T18:00:00.000Z', kg: 81 },
    ]);
    expect(bodyweightAt(log, '2026-11-02T12:00:00.000Z')).toBe(81);
    expect(bodyweightAt(log, '2020-01-01T00:00:00.000Z')).toBe(81);
    expect(bodyweightAt([], '2026-11-02T12:00:00.000Z')).toBeNull();
  });
});

describe('the backup file on disk', () => {
  it('ages a backup by local days, never negative', () => {
    // 23:00 UTC on the 4th is 03:00 on the 5th in Yerevan: the same day as now.
    expect(daysSince('2026-11-04T23:00:00.000Z', new Date('2026-11-05T08:00:00.000Z'))).toBe(0);
    expect(daysSince('2026-11-06T08:00:00.000Z', new Date('2026-11-05T08:00:00.000Z'))).toBe(0);
    expect(daysSince('garbage', new Date())).toBeNull();
  });

  it('names only its own files, including SAF’s numbered copies', () => {
    expect(isBackupFileName('momentum-workout-backup-2026-11-05.json')).toBe(true);
    expect(isBackupFileName('momentum-workout-backup-2026-11-05 (2).json')).toBe(true);
    expect(isBackupFileName('momentum-backup-2026-11-05.json')).toBe(false);
    expect(isBackupFileName('momentum-workouts-2026-11-05-0912.csv')).toBe(false);
  });

  it('counts UTF-8 bytes for the overwrite padding', () => {
    expect(utf8ByteLength('aé€😀')).toBe(1 + 2 + 3 + 4);
    expect(utf8ByteLength('\ud83d')).toBe(3);
    expect(padToCover('ab', 5)).toBe('ab   ');
    expect(padToCover('abcdef', 5)).toBe('abcdef');
  });
});
