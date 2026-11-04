import { describe, expect, it } from 'vitest';

import {
  achievements,
  BADGES,
  describeBadgeProgress,
  describeEarned,
  describeGallery,
  logFacts,
  type FactPoint,
  type LogFacts,
  type LogsInput,
} from './achievements';
import type { CompletedWorkout } from './completedWorkout';
import { shiftDay } from './days';
import { t, translatedKeys } from './i18n';
import type { SetHistory } from '../types/models';

/**
 * Achievements (E1). Two things matter: every threshold sits exactly where it
 * says (99 is not 100), and the same log always gives the same badges with the
 * same earned dates (they are the LOG's dates, never the clock's).
 */

const TODAY = '2026-10-09';

const at = (day: string, hour = 18) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour).toISOString();
};

let seq = 0;
function workout(day: string, over: Partial<CompletedWorkout> = {}): CompletedWorkout {
  seq += 1;
  return {
    id: `w${seq}`,
    title: 'Push',
    startedAt: at(day),
    endedAt: at(day, 19),
    durationMinutes: 60,
    setCount: 10,
    totalVolumeKg: 500,
    volumeIsPartial: false,
    exercises: [],
    sets: [],
    ...over,
  };
}

const EMPTY: LogsInput = { today: TODAY, workouts: [] };

/** `n` consecutive days ending on `last`, oldest first. */
function daysTo(last: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => shiftDay(last, i - n + 1));
}

const badge = (input: LogsInput, id: string) => {
  const found = achievements(logFacts(input)).find((row) => row.id === id);
  if (!found) throw new Error(`no badge ${id}`);
  return found;
};

const emptyFacts = (): LogFacts => logFacts(EMPTY);

describe('the badge list', () => {
  it('has sixteen badges, with unique ids', () => {
    expect(BADGES.length).toBe(16);
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(BADGES.length);
  });

  it('every title and description is in Russian too', () => {
    const keys = new Set(translatedKeys());
    for (const def of BADGES) {
      expect(keys.has(def.title), def.title).toBe(true);
      expect(keys.has(def.what), def.what).toBe(true);
    }
  });

  it('nothing is earned on an empty phone, and nothing reads below zero', () => {
    const badges = achievements(emptyFacts());
    expect(badges.every((b) => b.earnedOn === null && b.have === 0 && b.fraction === 0)).toBe(true);
    expect(describeGallery(badges, 'en')).toBe(`0 of ${BADGES.length} earned.`);
  });
});

describe('each badge sits exactly on its threshold', () => {
  /** A series that reaches `total` one step short of, or exactly on, the need. */
  function seriesTo(total: number, measure: 'sum' | 'max'): FactPoint[] {
    if (measure === 'max') return [{ day: '2026-03-01', value: total }];
    // Whole units summing to `total`, the last landing on 2026-03-02.
    const points: FactPoint[] = [];
    let left = total;
    const step = Math.max(1, Math.ceil(total / 50));
    while (left > 0) {
      const v = Math.min(step, left);
      left -= v;
      points.push({ day: left === 0 ? '2026-03-02' : '2026-03-01', value: v });
    }
    return points;
  }

  for (const def of BADGES) {
    it(`${def.id}: ${def.need - 1} is locked, ${def.need} is earned`, () => {
      const below = { ...emptyFacts(), [def.series]: seriesTo(def.need - 1, def.measure) };
      const on = { ...emptyFacts(), [def.series]: seriesTo(def.need, def.measure) };
      const locked = achievements(below).find((b) => b.id === def.id)!;
      const earned = achievements(on).find((b) => b.id === def.id)!;
      expect(locked.earnedOn).toBeNull();
      expect(locked.fraction).toBeLessThan(1);
      expect(earned.earnedOn).toBe(def.measure === 'max' ? '2026-03-01' : '2026-03-02');
      expect(earned.fraction).toBe(1);
      expect(earned.have).toBe(def.need);
    });
  }
});

describe('from the logs: workouts', () => {
  it('99 workouts is not "100 workouts"; the hundredth is, on its own day', () => {
    const days = daysTo('2026-10-01', 100);
    const ninetyNine = days.slice(0, 99).map((d) => workout(d));
    expect(badge({ ...EMPTY, workouts: ninetyNine }, 'workouts100').earnedOn).toBeNull();
    expect(
      describeBadgeProgress(badge({ ...EMPTY, workouts: ninetyNine }, 'workouts100'), 'en'),
    ).toBe('99 / 100 workouts');
    const hundred = days.map((d) => workout(d));
    expect(badge({ ...EMPTY, workouts: hundred }, 'workouts100').earnedOn).toBe('2026-10-01');
  });

  it('1 tonne in a session needs one session at 1,000 kg, not two of 500', () => {
    const two = [
      workout('2026-09-01', { totalVolumeKg: 999 }),
      workout('2026-09-02', { totalVolumeKg: 500 }),
    ];
    expect(badge({ ...EMPTY, workouts: two }, 'session1t').earnedOn).toBeNull();
    expect(describeBadgeProgress(badge({ ...EMPTY, workouts: two }, 'session1t'), 'en')).toBe(
      '0.9 / 1 t',
    );
    const one = [...two, workout('2026-09-03', { totalVolumeKg: 1000 })];
    expect(badge({ ...EMPTY, workouts: one }, 'session1t').earnedOn).toBe('2026-09-03');
  });

  it('tonnage adds up across sessions, earned the day it crossed', () => {
    const list = daysTo('2026-09-20', 20).map((d) => workout(d, { totalVolumeKg: 500 }));
    // 20 × 500 = 10 000 kg: the 20th session crosses 10 t.
    expect(badge({ ...EMPTY, workouts: list.slice(0, 19) }, 'tonnage10').earnedOn).toBeNull();
    expect(badge({ ...EMPTY, workouts: list }, 'tonnage10').earnedOn).toBe('2026-09-20');
  });

  it('1,000 working sets counts the stored working sets', () => {
    const list = daysTo('2026-09-30', 100).map((d) => workout(d, { setCount: 10 }));
    expect(badge({ ...EMPTY, workouts: list }, 'sets1000').earnedOn).toBe('2026-09-30');
    list[0] = { ...list[0], setCount: 9 };
    expect(badge({ ...EMPTY, workouts: list }, 'sets1000').earnedOn).toBeNull();
  });

  it('a workout dated after today counts for nothing yet', () => {
    expect(badge({ ...EMPTY, workouts: [workout('2026-10-10')] }, 'workouts1').earnedOn).toBeNull();
  });

  describe('records, by the Finish sheet’s rules', () => {
    const set = (sessionId: string, day: string, weightKg: number, count = 5): SetHistory => ({
      id: `${sessionId}-${weightKg}-${count}`,
      sessionId,
      exerciseId: 'bench',
      performedAt: at(day, 10),
      setIndex: 0,
      weightKg,
      count,
      countUnit: 'reps',
      loadMode: 'external',
      isWarmup: false,
      isCompleted: true,
    });
    const session = (id: string, day: string, rows: SetHistory[]) =>
      workout(day, { id, sets: rows });

    it('a first-ever session is not a record', () => {
      const first = session('s1', '2026-09-01', [set('s1', '2026-09-01', 80)]);
      expect(badge({ ...EMPTY, workouts: [first] }, 'records1').earnedOn).toBeNull();
    });

    it('beating the bar is; equalling it is not', () => {
      const first = session('s1', '2026-09-01', [set('s1', '2026-09-01', 80)]);
      const same = session('s2', '2026-09-03', [set('s2', '2026-09-03', 80)]);
      expect(badge({ ...EMPTY, workouts: [same, first] }, 'records1').earnedOn).toBeNull();
      const more = session('s3', '2026-09-05', [set('s3', '2026-09-05', 82.5)]);
      expect(badge({ ...EMPTY, workouts: [more, same, first] }, 'records1').earnedOn).toBe(
        '2026-09-05',
      );
    });
  });
});

describe('stable across recomputation', () => {
  const input: LogsInput = {
    ...EMPTY,
    workouts: daysTo('2026-09-30', 12).map((d) => workout(d, { totalVolumeKg: 1200 })),
  };

  it('the same logs give the same badges, field for field', () => {
    expect(achievements(logFacts(input))).toEqual(achievements(logFacts(input)));
  });

  it('earned dates are the log’s: a later "today" moves none of them', () => {
    const now = achievements(logFacts(input));
    const later = achievements(logFacts({ ...input, today: '2027-03-01' }));
    for (const b of now.filter((row) => row.earnedOn !== null)) {
      expect(later.find((row) => row.id === b.id)!.earnedOn, b.id).toBe(b.earnedOn);
    }
    expect(now.find((b) => b.id === 'workouts10')!.earnedOn).toBe('2026-09-28');
  });

  it('the order the store keeps workouts in does not matter', () => {
    const reversed = { ...input, workouts: [...input.workouts].reverse() };
    expect(achievements(logFacts(reversed))).toEqual(achievements(logFacts(input)));
  });
});

describe('words', () => {
  it('a locked one-step badge says "Not yet" rather than 0 / 1', () => {
    const b = badge(EMPTY, 'workouts1');
    expect(describeBadgeProgress(b, 'en')).toBe('Not yet');
    expect(describeEarned(b, 'en')).toBeNull();
  });

  it('progress agrees with the need in Russian', () => {
    const list = daysTo('2026-09-30', 73).map((d) => workout(d));
    expect(describeBadgeProgress(badge({ ...EMPTY, workouts: list }, 'workouts100'), 'ru')).toBe(
      '73 / 100 тренировок',
    );
    expect(
      describeBadgeProgress(badge({ ...EMPTY, workouts: list.slice(0, 3) }, 'workouts10'), 'ru'),
    ).toBe('3 / 10 тренировок');
  });

  it('an earned badge names its day', () => {
    const b = badge({ ...EMPTY, workouts: [workout('2026-09-14')] }, 'workouts1');
    expect(describeEarned(b, 'en')).toBe('Earned 14 September 2026');
    expect(describeEarned(b, 'ru')).toBe(t('Earned {date}', 'ru', { date: '14 сентября 2026' }));
  });
});
