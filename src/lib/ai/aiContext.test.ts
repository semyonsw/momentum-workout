import { describe, expect, it } from 'vitest';

import {
  CONTEXT_CAP,
  buildWorkoutContext,
  lastTopWeights,
  nextStartWeights,
  workoutFacts,
} from './aiContext';
import { recomputeWorkout, type CompletedWorkout } from '../completedWorkout';
import { seedExercises, seedExercisesById, seedRoutines } from '../../data/seed';
import { fixtureHistory } from '../../../test/fixtures/history';
import type { SetHistory } from '../../types/models';

/**
 * The context builder, held to four promises: it stays under the cap, it reads
 * the log the way every other screen reads it (warm-ups count for nothing), it
 * says how much it read, and it never ships the whole database.
 */

/** The fixture's set rows, as the finished workouts the history store holds. */
function fixtureWorkouts(extra: SetHistory[] = []): CompletedWorkout[] {
  const bySession = new Map<string, SetHistory[]>();
  for (const row of [...fixtureHistory, ...extra]) {
    const bucket = bySession.get(row.sessionId);
    if (bucket) bucket.push(row);
    else bySession.set(row.sessionId, [row]);
  }
  return [...bySession.entries()]
    .map(([id, sets]) => {
      const ids = [...new Set(sets.map((s) => s.exerciseId))];
      const draft: CompletedWorkout = {
        id,
        title: 'Pull',
        routineId: 'r_pull',
        startedAt: sets[0].performedAt,
        endedAt: sets[0].performedAt,
        durationMinutes: 60,
        setCount: 0,
        totalVolumeKg: 0,
        volumeIsPartial: false,
        exercises: ids.map((exerciseId) => ({
          exerciseId,
          name: seedExercisesById[exerciseId].name,
          countUnit: seedExercisesById[exerciseId].countUnit,
          loadMode: seedExercisesById[exerciseId].loadMode,
          setCount: 0,
          summary: '',
          totalCount: 0,
          topWeightKg: null,
        })),
        sets,
      };
      return recomputeWorkout(draft, null, 'en');
    })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

const NOW = new Date('2026-08-10T12:00:00Z');

describe('the workout context', () => {
  const workouts = fixtureWorkouts();
  const built = buildWorkoutContext({
    exercises: seedExercises,
    routines: seedRoutines,
    workouts,
    unitSystem: 'metric',
    lang: 'ru',
    now: NOW,
  });
  const json = JSON.parse(built.json);

  it('stays under the cap', () => {
    expect(built.json.length).toBeLessThanOrEqual(CONTEXT_CAP);
  });

  it('carries all-time records, the weekly line, the bodyweight log and a richer library', () => {
    const wide = JSON.parse(
      buildWorkoutContext({
        exercises: seedExercises,
        routines: seedRoutines,
        workouts,
        unitSystem: 'metric',
        lang: 'en',
        now: NOW,
        bodyweightLog: [
          { at: '2026-07-01T08:00:00Z', kg: 80 },
          { at: '2026-08-01T08:00:00Z', kg: 79.5 },
        ],
      }).json,
    );
    expect(wide.allTime.workouts).toBe(workouts.length);
    expect(wide.sessionsPerWeek12w).toHaveLength(12);
    expect(wide.bodyweightKgLog).toEqual(['2026-07-01:80', '2026-08-01:79.5']);
    expect(wide.recordsAllTime.length).toBeGreaterThan(0);
    expect(wide.recordsAllTime[0]).toHaveProperty('sessions');
    expect(wide.recordsAllTime[0]).toHaveProperty('last');
    expect(wide.library.some((row: string) => row.split(' | ').length >= 3)).toBe(true);
  });

  it('carries the training loop in order, with what is next', () => {
    const [a, b] = seedRoutines;
    const looped = JSON.parse(
      buildWorkoutContext({
        exercises: seedExercises,
        routines: seedRoutines,
        workouts,
        unitSystem: 'metric',
        lang: 'en',
        now: NOW,
        sequence: { isActive: true, routineIds: [a.id, b.id, 'r_deleted', a.id], cursor: 1 },
      }).json,
    );
    expect(looped.sequence).toMatchObject({
      on: true,
      order: [a.name, b.name, a.name],
      next: b.name,
    });
    expect(json.sequence).toMatchObject({ on: false });
  });

  it('says what day it is, which language to answer in, and the units', () => {
    expect(json.today).toBe('2026-08-10');
    expect(json.language).toBe('Russian');
    expect(json.units).toBe('kg');
  });

  it('names every routine with its real ids, so an edit can target one', () => {
    expect(json.routines.map((r: { id: string }) => r.id)).toEqual(seedRoutines.map((r) => r.id));
    const pull = json.routines.find((r: { id: string }) => r.id === 'r_pull');
    expect(pull.exercises[0]).toMatchObject({ exerciseId: 'ex_pullup_90', sets: 4, reps: '4-6' });
  });

  it('lists sessions newest first, in the shorthand, and counts them', () => {
    expect(json.sessions[0].date).toBe('2026-08-08');
    expect(json.sessions[0].ex.some((line: string) => line.includes('80 kg'))).toBe(true);
    expect(built.workoutCount).toBe(json.sessions.length);
    expect(built.workoutCount).toBe(workouts.length);
  });

  it('leaves warm-ups out of everything', () => {
    // A 200 kg warm-up single on the pulldown: nowhere in the context.
    const warmup: SetHistory = {
      ...fixtureHistory.find((s) => s.sessionId === 's87' && s.exerciseId === 'ex_pulldown_wide')!,
      id: 'warm',
      setIndex: 99,
      weightKg: 200,
      count: 1,
      isWarmup: true,
    };
    const withWarmup = buildWorkoutContext({
      exercises: seedExercises,
      routines: seedRoutines,
      workouts: fixtureWorkouts([warmup]),
      unitSystem: 'metric',
      lang: 'en',
      now: NOW,
    });
    expect(withWarmup.json).not.toContain('200');
  });

  it('carries the sets per cluster', () => {
    expect(json.setsPerCluster4w.pull).toBeGreaterThan(0);
  });

  it('sends every session, not only the recent window, when it fits', () => {
    const old = { ...workouts[0], id: 'ancient', startedAt: '2025-01-15T09:00:00.000Z' };
    const all = buildWorkoutContext({
      exercises: seedExercises,
      routines: seedRoutines,
      workouts: [...workouts, old],
      unitSystem: 'metric',
      lang: 'en',
      now: NOW,
    });
    const sessions: { date: string }[] = JSON.parse(all.json).sessions;
    expect(sessions.map((s) => s.date)).toContain('2025-01-15');
    expect(all.workoutCount).toBe(workouts.length + 1);
  });

  it('sheds old sessions rather than growing past the cap', () => {
    // A hundred and fifty copies of the log's heaviest session, a day apart.
    const heavy = workouts[0];
    const many = Array.from({ length: 150 }, (_, i) => ({
      ...heavy,
      id: `copy_${i}`,
      startedAt: new Date(NOW.getTime() - i * 86_400_000).toISOString(),
    }));
    const big = buildWorkoutContext({
      exercises: seedExercises,
      routines: seedRoutines,
      workouts: many,
      unitSystem: 'metric',
      lang: 'en',
      now: NOW,
      cap: 24_000,
    });
    expect(big.json.length).toBeLessThanOrEqual(24_000);
    expect(big.workoutCount).toBeLessThan(150);
    expect(big.workoutCount).toBeGreaterThan(0);
    // Newest kept, oldest shed.
    expect(JSON.parse(big.json).sessions[0].date).toBe('2026-08-10');
  });

  it('carries the app’s workout settings', () => {
    const withSettings = JSON.parse(
      buildWorkoutContext({
        exercises: seedExercises,
        routines: seedRoutines,
        workouts,
        unitSystem: 'metric',
        lang: 'en',
        now: NOW,
        settings: {
          restSecondsBetweenSets: 90,
          restSecondsBetweenExercises: 120,
          autoStartRest: true,
        },
      }).json,
    );
    expect(withSettings.settings).toEqual({
      restSecondsBetweenSets: 90,
      restSecondsBetweenExercises: 120,
      autoStartRest: true,
    });
    // No settings handed in: no key, rather than a guess.
    expect(json.settings).toBeUndefined();
  });

  it('puts each exercise’s own settings on its library line, where they mean something', () => {
    const weighted = seedExercises.find((e) => e.requiresWeight && e.countUnit === 'reps')!;
    const timed = seedExercises.find((e) => e.countUnit === 'seconds')!;
    const exercises = seedExercises.map((e) => {
      if (e.id === weighted.id) {
        const { ladder: _ladder, ...rest } = e;
        return {
          ...rest,
          defaultRestSeconds: 120,
          defaultSets: 4,
          defaultCount: 10,
          countToMax: true,
          incrementKg: 2.5,
          prepareSeconds: 7,
        };
      }
      if (e.id === timed.id) return { ...e, prepareSeconds: 5, incrementKg: 1 };
      return e;
    });
    const lines: string[] = JSON.parse(
      buildWorkoutContext({
        exercises,
        routines: seedRoutines,
        workouts,
        unitSystem: 'metric',
        lang: 'en',
        now: NOW,
      }).json,
    ).library;
    const line = lines.find((l) => l.startsWith(`${weighted.id} | `))!;
    expect(line).toContain('rest 120s, sets 4, target 10, MAX mode, step 2.5 kg');
    // A rep exercise has no get-ready countdown.
    expect(line).not.toContain('get-ready');
    const timedLine = lines.find((l) => l.startsWith(`${timed.id} | `))!;
    expect(timedLine).toContain('get-ready 5s');
    if (!timed.requiresWeight) expect(timedLine).not.toContain('step');
    // An exercise with no rest of its own says whose rest it runs.
    expect(lines.some((l) => l.includes('rest follows setting'))).toBe(true);
  });

  it('keeps the ids when the library is shed to names', () => {
    const heavy = workouts[0];
    const many = Array.from({ length: 150 }, (_, i) => ({
      ...heavy,
      id: `copy_${i}`,
      startedAt: new Date(NOW.getTime() - i * 86_400_000).toISOString(),
    }));
    const big = JSON.parse(
      buildWorkoutContext({
        exercises: seedExercises,
        routines: seedRoutines,
        workouts: many,
        unitSystem: 'metric',
        lang: 'en',
        now: NOW,
        settings: {
          restSecondsBetweenSets: 90,
          restSecondsBetweenExercises: 120,
          autoStartRest: false,
        },
        cap: 24_000,
      }).json,
    );
    // The settings are tiny and never shed; the library's lines keep `id | name`.
    expect(big.settings.restSecondsBetweenSets).toBe(90);
    for (const line of big.library as string[])
      expect(line.split(' | ').length).toBeGreaterThanOrEqual(2);
  });

  it('says nothing about a superset group an older routine still carries', () => {
    const [routine] = seedRoutines;
    const sorted = [...routine.items].sort((a, b) => a.order - b.order);
    const items = sorted.map((item, i) =>
      i === 0 || i === 1 ? ({ ...item, supersetGroup: 'g1' } as typeof item) : item,
    );
    const rows = JSON.parse(
      buildWorkoutContext({
        exercises: seedExercises,
        routines: [{ ...routine, items }],
        workouts,
        unitSystem: 'metric',
        lang: 'en',
        now: NOW,
      }).json,
    ).routines[0].exercises;
    expect(rows.some((row: Record<string, unknown>) => 'superset' in row)).toBe(false);
  });

  it('names the prompts from the user’s own log', () => {
    const facts = workoutFacts({
      exercises: seedExercises,
      routines: seedRoutines,
      workouts,
      now: NOW,
    });
    // Weighted sit-ups: five sessions in the last four weeks against the
    // pulldown's three, and nothing in the fixture is on a barbell.
    expect(facts.topLift).toBe(seedExercisesById.ex_situp_weighted.name);
    // A barbell lift wins over a busier machine one.
    const squat: CompletedWorkout = {
      ...workouts[0],
      id: 'squat',
      exercises: [
        {
          exerciseId: 'ex_squat',
          name: seedExercisesById.ex_squat.name,
          countUnit: 'reps',
          loadMode: 'external',
          setCount: 3,
          summary: '80 kg · 5 5 5',
          totalCount: 15,
          topWeightKg: 80,
        },
      ],
    };
    expect(
      workoutFacts({
        exercises: seedExercises,
        routines: seedRoutines,
        workouts: [squat, ...workouts],
        now: NOW,
      }).topLift,
    ).toBe(seedExercisesById.ex_squat.name);
    expect(facts.lastRoutine?.id).toBe('r_pull');
    expect(lastTopWeights(workouts).ex_pulldown_wide).toBe(80);
    // A starting weight planned after that session is what the next one opens at.
    const planned = seedExercises.map((e) =>
      e.id === 'ex_pulldown_wide'
        ? { ...e, defaultWeightKg: 70, startWeightSetAt: NOW.toISOString() }
        : e,
    );
    expect(nextStartWeights(planned, workouts).ex_pulldown_wide).toBe(70);
    expect(nextStartWeights(seedExercises, workouts).ex_pulldown_wide).toBe(80);
  });
});

/* ------------------------------------------------------------------ */

describe('per-set marks from an older build', () => {
  it('says nothing about reps in reserve or set types a stored set still carries', () => {
    const workouts = fixtureWorkouts();
    const latest = workouts[0];
    const marked = {
      ...latest,
      sets: latest.sets.map((set) => ({ ...set, rir: 1, setType: 'failure' }) as typeof set),
    };
    const json = JSON.parse(
      buildWorkoutContext({
        exercises: seedExercises,
        routines: seedRoutines,
        workouts: [marked, ...workouts.slice(1)],
        unitSystem: 'metric',
        lang: 'en',
        now: NOW,
      }).json,
    );
    expect(json.effortNote).toBeUndefined();
    expect(json.setTypeNote).toBeUndefined();
    expect(json.sessions.some((row: Record<string, unknown>) => 'rir' in row)).toBe(false);
  });
});
