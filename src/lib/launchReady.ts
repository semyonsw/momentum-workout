/**
 * THE LAUNCH SCREEN'S CLOCK — what it shows as loaded, and when it may leave.
 *
 * The animated splash is not decoration over a wait: its chips are the stores
 * the app reads on a cold start, and each one ticks when THAT STORE has actually
 * finished. Today that is one store — the training log, which is SQLite and the
 * slowest thing a cold start reads — but the pacing is written for a list, so a
 * second store is a line here rather than a new clock. Two things have to be
 * decided, and both are decided here where they can be tested:
 *
 *  1. WHEN A CHIP TICKS. A store that finishes in 4 ms would tick before its chip
 *     has even faded in, and stores that finish together would tick as one. So
 *     the k-th store to finish ticks at the later of its own finish and the k-th
 *     SLOT (700, 1150, 1600 ms — the design's pacing). The ORDER is the stores'
 *     real order; only the earliest moment each may be shown is paced.
 *
 *  2. WHEN THE SPLASH LEAVES. Every store the app waits on ticked and at least
 *     2.3 s gone — the floor the choreography needs to read as one thing — or
 *     6 s gone whatever the stores say. The ceiling matters more than the floor:
 *     a store that never reports ready must not be a launch that never ends, and
 *     every screen behind this one already has its own state for data that could
 *     not be read.
 */

export type LaunchStore = 'history';

/**
 * The release's fingerprint in the bundle: `momentum-workout-<version>`, set by
 * `tools/release-apk.sh` for the prebuild and the gradle run, and empty anywhere
 * else. The script greps the finished `index.android.bundle` for it, because it
 * exists only in JS bundled at THIS version — stale cached JS fails the check.
 * Plain ASCII, so Hermes keeps it greppable (CLAUDE.md). The launch screen wears
 * it as its `testID`, so it is never an unused export a bundler could drop.
 */
export const BUILD_MARK: string = process.env.EXPO_PUBLIC_BUILD_MARK ?? '';

/** Every store the launch waits on, in chip order — the order ties are broken in. */
export const LAUNCH_STORES: readonly LaunchStore[] = ['history'];

/** The earliest moment the first, second and third store may be shown ticked. */
const LAUNCH_TICK_SLOTS_MS = [700, 1150, 1600] as const;

/** Below this the splash never leaves. */
export const LAUNCH_FLOOR_MS = 2300;

/** Past this the splash always leaves. */
export const LAUNCH_CEILING_MS = 6000;

export interface LaunchInput {
  /** The stores the launch waits on (`LAUNCH_STORES`). */
  stores: readonly LaunchStore[];
  /** Which of them are ready (ticked). A store not listed in `stores` is ignored. */
  ready: Partial<Record<LaunchStore, boolean>>;
  elapsedMs: number;
}

export interface LaunchState {
  /** How many of `stores` are ready. */
  stage: number;
  /** The ring around the mark: `stage` over the number of stores, 0–1. */
  fraction: number;
  /** Start the exit now. */
  exit: boolean;
}

export function launchReady({ stores, ready, elapsedMs }: LaunchInput): LaunchState {
  const stage = stores.filter((store) => ready[store]).length;
  const total = stores.length;
  const fraction = total === 0 ? 1 : stage / total;
  const exit = (stage === total && elapsedMs >= LAUNCH_FLOOR_MS) || elapsedMs >= LAUNCH_CEILING_MS;
  return { stage, fraction, exit };
}

/**
 * Which chips show as ticked at `elapsedMs`, given when each store became ready
 * (ms since launch, or null while it has not). Only `stores` take slots; the
 * rest stay unticked.
 *
 * Ties are broken by the chips' own left-to-right order, so two stores that
 * finish in the same millisecond still tick one slot apart and in reading order.
 */
export function launchTicks(
  readyAtMs: Record<LaunchStore, number | null>,
  elapsedMs: number,
  stores: readonly LaunchStore[] = LAUNCH_STORES,
): Record<LaunchStore, boolean> {
  const finished = LAUNCH_STORES.filter(
    (store) => stores.includes(store) && readyAtMs[store] != null,
  ).sort(
    (a, b) =>
      (readyAtMs[a] as number) - (readyAtMs[b] as number) ||
      LAUNCH_STORES.indexOf(a) - LAUNCH_STORES.indexOf(b),
  );
  const ticked: Record<LaunchStore, boolean> = { history: false };
  finished.forEach((store, order) => {
    const at = Math.max(readyAtMs[store] as number, LAUNCH_TICK_SLOTS_MS[order]);
    ticked[store] = elapsedMs >= at;
  });
  return ticked;
}

/**
 * What the launch mark says: the app's name, the one glyph its mark holds, and
 * the line under the name (an English key, translated where it is drawn).
 *
 * The name is the launcher label (`app.json`), untranslated: it is a name, not a
 * sentence, and the icon the user just tapped says it in English.
 */
export const LAUNCH_BRAND = {
  wordmark: 'Workout',
  glyph: 'fitness_center',
  tagline: 'Train · log · progress',
} as const;
