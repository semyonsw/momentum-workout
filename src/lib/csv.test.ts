import { describe, expect, it } from 'vitest';

import type { CompletedWorkout } from './completedWorkout';
import {
  BOM,
  SET_COLUMNS,
  csvBaseName,
  csvDocument,
  csvField,
  workoutsToCsv,
} from './csv';
import type { SetHistory } from '../types/models';

/**
 * CSV export (M7). The interesting cases are the quoting (names contain commas
 * by nature, notes contain line breaks), Cyrillic surviving Excel through the
 * BOM, and kg/lb — because a number in a cell must be the number on the screen.
 */

/** Records without the BOM, split on CRLF — a naive split, so only for unquoted rows. */
const records = (csv: string) => csv.slice(BOM.length).split('\r\n').slice(0, -1);

/* ------------------------------------------------------------------ */
/* Quoting                                                             */
/* ------------------------------------------------------------------ */

describe('csvField', () => {
  it('leaves a plain field alone', () => {
    expect(csvField('Bench press')).toBe('Bench press');
    expect(csvField('')).toBe('');
  });

  it('quotes commas, quotes, CR and LF, doubling inner quotes', () => {
    expect(csvField('Row, stomach')).toBe('"Row, stomach"');
    expect(csvField('The "good" bar')).toBe('"The ""good"" bar"');
    expect(csvField('line one\nline two')).toBe('"line one\nline two"');
    expect(csvField('a\rb')).toBe('"a\rb"');
  });

  it('a document is BOM + CRLF records with a trailing CRLF', () => {
    const doc = csvDocument(['a', 'b'], [['1', 'x,y']]);
    expect(doc).toBe(`${BOM}a,b\r\n1,"x,y"\r\n`);
    expect(doc.charCodeAt(0)).toBe(0xfeff);
  });
});


/* ------------------------------------------------------------------ */
/* Workouts                                                            */
/* ------------------------------------------------------------------ */

/** A local wall-clock time as ISO, so the date column is the same in every TZ. */
const at = (y: number, m: number, d: number, h = 18) => new Date(y, m - 1, d, h).toISOString();

function set(over: Partial<SetHistory> = {}, index = 0): SetHistory {
  return {
    id: `s${index}`,
    sessionId: 'w1',
    exerciseId: 'ex_a',
    performedAt: at(2026, 10, 3),
    setIndex: index,
    weightKg: 60,
    count: 8,
    countUnit: 'reps',
    loadMode: 'external',
    isWarmup: false,
    isCompleted: true,
    ...over,
  };
}

function workout(
  id: string,
  startedAt: string,
  title: string,
  sets: SetHistory[],
  exercises: { exerciseId: string; name: string }[] = [{ exerciseId: 'ex_a', name: 'Bench press' }],
): CompletedWorkout {
  return {
    id,
    title,
    startedAt,
    endedAt: startedAt,
    durationMinutes: 60,
    setCount: sets.length,
    totalVolumeKg: 0,
    volumeIsPartial: false,
    exercises: exercises.map((e) => ({
      ...e,
      countUnit: 'reps' as const,
      loadMode: 'external' as const,
      setCount: 1,
      summary: '',
      totalCount: 0,
      topWeightKg: null,
    })),
    sets,
  };
}

describe('workoutsToCsv', () => {
  it('empty data gives the header only', () => {
    expect(workoutsToCsv([])).toBe(`${BOM}${SET_COLUMNS.join(',')}\r\n`);
  });

  it('one row per set, warm-ups flagged, set numbers counting warm-ups', () => {
    const csv = workoutsToCsv([
      workout('w1', at(2026, 10, 3), 'Push', [
        set({ isWarmup: true, weightKg: 40, restTakenSeconds: 61.6 }, 0),
        set({}, 1),
      ]),
    ]);
    const rows = records(csv);
    expect(rows[0]).toBe(SET_COLUMNS.join(','));
    expect(rows[1]).toBe('2026-10-03,1,Push,Bench press,1,40,kg,8,reps,external,true,62,,warmup');
    expect(rows[2]).toBe('2026-10-03,1,Push,Bench press,2,60,kg,8,reps,external,false,,,working');
  });

  it('quotes commas, quotes and newlines in exercise and routine names; Cyrillic kept', () => {
    const csv = workoutsToCsv([
      workout(
        'w1',
        at(2026, 10, 3),
        'Тяга, "короткая"',
        [set()],
        [{ exerciseId: 'ex_a', name: 'Row,\nstomach' }],
      ),
    ]);
    expect(csv).toContain('2026-10-03,1,"Тяга, ""короткая""","Row,\nstomach",1,60,kg');
  });

  it('oldest workout first, numbered with the user pin, seconds and blank weight for holds', () => {
    const older = workout('w1', at(2026, 1, 1, 9), 'Core', [
      set({ weightKg: null, count: 90, countUnit: 'seconds', loadMode: 'none' }),
    ]);
    const newer = workout('w2', at(2026, 10, 3), 'Push', [set()]);
    const rows = records(
      workoutsToCsv([newer, older], { numbering: { workoutId: 'w2', number: 212 } }),
    );
    expect(rows[1]).toBe('2026-01-01,211,Core,Bench press,1,,,90,seconds,none,false,,,working');
    expect(rows[2]).toMatch(/^2026-10-03,212,Push,/);
  });

  it('a number below 1 is left blank, as the list leaves it', () => {
    const rows = records(
      workoutsToCsv(
        [
          workout('w2', at(2026, 10, 3), 'B', [set()]),
          workout('w1', at(2026, 10, 1), 'A', [set()]),
        ],
        { numbering: { workoutId: 'w2', number: 1 } },
      ),
    );
    expect(rows[1]).toMatch(/^2026-10-01,,A,/);
  });

  it('weights in lb for an imperial lifter', () => {
    const rows = records(
      workoutsToCsv([workout('w1', at(2026, 10, 3), 'Push', [set({ weightKg: 100 })])], {
        unitSystem: 'imperial',
      }),
    );
    expect(rows[1]).toContain(',220.46,lb,');
  });

  it('reps in reserve go in the last column, blank where nobody graded the set', () => {
    const rows = records(
      workoutsToCsv([
        workout('w1', at(2026, 10, 3), 'Push', [
          set({ rir: 1.5 }, 0),
          set({ rir: 0 }, 1),
          set({}, 2),
        ]),
      ]),
    );
    expect(SET_COLUMNS.at(-2)).toBe('rir');
    expect(rows[1].endsWith(',false,,1.5,working')).toBe(true);
    expect(rows[2].endsWith(',false,,0,working')).toBe(true);
    expect(rows[3].endsWith(',false,,,working')).toBe(true);
  });

  it('the set type goes in the last column; the warm-up flag keeps its own', () => {
    const rows = records(
      workoutsToCsv([
        workout('w1', at(2026, 10, 3), 'Push', [
          set({ isWarmup: true }, 0),
          set({ setType: 'failure' }, 1),
          set({ setType: 'amrap', rir: 0 }, 2),
          set({ setType: 'drop', weightKg: 40 }, 3),
        ]),
      ]),
    );
    expect(SET_COLUMNS.at(-1)).toBe('set_type');
    expect(rows[1].endsWith(',true,,,warmup')).toBe(true);
    expect(rows[2].endsWith(',false,,,failure')).toBe(true);
    expect(rows[3].endsWith(',false,,0,amrap')).toBe(true);
    expect(rows[4].endsWith(',false,,,drop')).toBe(true);
  });

  it('keeps each exercise’s sets together, in the workout’s exercise order', () => {
    // As `draftToSetHistory` writes them: setIndex counts within one exercise.
    const bench = (i: number) => set({ id: `b${i}`, exerciseId: 'ex_a' }, i);
    const squat = (i: number) => set({ id: `q${i}`, exerciseId: 'ex_b', weightKg: 100 }, i);
    const gone = set({ id: 'g0', exerciseId: 'ex_gone' }, 0);
    const exercises = [
      { exerciseId: 'ex_a', name: 'Bench press' },
      { exerciseId: 'ex_b', name: 'Squat' },
    ];
    // The set column counts within each exercise, as the workout screen does.
    const expected = [
      'Bench press,1',
      'Bench press,2',
      'Bench press,3',
      'Squat,1',
      'Squat,2',
      'ex_gone,1',
    ];
    const lift = (row: string) => row.split(',').slice(3, 5).join(',');
    for (const sets of [
      [bench(0), bench(1), bench(2), squat(0), squat(1), gone],
      // Stored in any order, the export reads the same; an unknown exercise goes last.
      [gone, squat(1), bench(2), squat(0), bench(0), bench(1)],
    ]) {
      const rows = records(
        workoutsToCsv([workout('w1', at(2026, 10, 3), 'Legs', sets, exercises)]),
      );
      expect(rows.slice(1).map(lift)).toEqual(expected);
    }
  });

  it('a deleted exercise exports under its id rather than vanishing', () => {
    const rows = records(
      workoutsToCsv([workout('w1', at(2026, 10, 3), 'Push', [set({ exerciseId: 'ex_gone' })])]),
    );
    expect(rows[1]).toContain(',ex_gone,');
  });
});

describe('csvBaseName', () => {
  it('is dated, sortable and names what it holds', () => {
    const now = new Date(2026, 9, 9, 9, 5);
    expect(csvBaseName(now)).toBe('momentum-workouts-2026-10-09-0905');
  });
});
