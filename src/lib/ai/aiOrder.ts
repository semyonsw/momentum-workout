/**
 * "Put squats first", "do Pull before Push this week", "reorder my workout so
 * the big lifts come first" — a WHOLE ORDER, said once, for one of the three
 * lists the user reorders by hand: a routine's exercises (the routine editor's
 * drag), the training sequence's steps (the Sequence screen's drag) and the
 * workout in flight's cards (the session's drag).
 *
 *   model's `order` ──resolveOrder──► keys in the new order ──► the card, where
 *   the user can DRAG them ──► Apply: through the same store moves the screens
 *   make (`updateRoutine`, `moveSequenceStep`, `moveEntry`) ──► one Undo
 *
 * ── WHY A WHOLE ORDER AND NOT A RUN OF `move`s ─────────────────────────────
 *
 * `routine_item move` already exists, and a reorder written as five of them is
 * five places each counted against a list the previous move already changed —
 * the model gets the third one wrong, and the card shows `#4 → #2` rows nobody
 * can picture. One list in the order it should end up is what the user said and
 * what the card can draw: the new order itself, as rows the user can still drag
 * before anything is written. That is the point of the card — the model's
 * mistakes are fixed with the gesture the user already knows, not by asking again.
 *
 * ── WHAT A ROW IS ─────────────────────────────────────────────────────────
 *
 * A `key` that stays put while the list moves: a routine row's item id, a live
 * card's `localId` — and for the sequence, the step's POSITION when the card was
 * filed (`"0"`, `"1"`…), because the loop holds the same routine at several
 * steps and a routine id cannot tell `Push` at step 1 from `Push` at step 4
 * (`lib/sequenceSteps.ts` keys its drag by position for the same reason). `ref`
 * is what the model names a row by — the exercise or routine id — and `name` is
 * what the card prints.
 *
 * ── WHAT THE MODEL MAY GET WRONG, AND WHAT THAT MEANS ─────────────────────
 *
 * Each entry of `order` is an id, a name (exact, ignoring case), or a 1-based
 * place in the current list. Repeats are matched to the NEXT unused row with
 * that id — `[push, legs, push]` takes the two Push steps in their current
 * order — so duplicates are a feature of the input, not an error.
 *
 *  • An entry that names nothing, or a row already used, is SKIPPED. One bad id
 *    in an otherwise good order is not a reason to throw the order away; the
 *    user is looking at the result and can drag.
 *  • Rows the model LEFT OUT keep their current relative order and go AFTER the
 *    listed ones. Rejected: keeping them "in place" and permuting only the listed
 *    rows among their own slots. That reads "swap Row and Dips" correctly but
 *    turns the far more common "put Squat first" (`order:["squat"]`) into a
 *    no-op, and the prompt asks for the whole list anyway — the subset is the
 *    model's slip, and "what you named first, the rest as they were" is the
 *    reading a person would give it.
 *  • Nothing resolved, or the order that comes out is the order already saved:
 *    no change, dropped like a rename to the same name.
 *
 * Pure, like everything in `lib/`: the stores are read and written by
 * `state/aiActions.ts`.
 */

import type { ID, RoutineItem } from '../../types/models';
import { swapsToMove } from '../sequenceSteps';

/** Which hand-reorderable list. */
export type OrderList = 'routine' | 'sequence' | 'live';

export interface OrderRow {
  /** Stable while the list moves — see the file header. */
  key: string;
  /** What the model names it by: an exercise id, or a routine id. */
  ref: ID;
  /** What the card prints. */
  name: string;
}

/**
 * A whole new order for one list, already checked. `order` is the PENDING order
 * — the model's, until the user drags the card, then theirs. `rows` is the list
 * as it was when the card was filed, in that order: the card's `from`, and the
 * names it draws.
 */
export interface OrderChange {
  target: 'order';
  field: 'reorder';
  list: OrderList;
  /** The routine, for `routine`; '' for the loop and the workout in flight. */
  id: ID;
  /** The routine's name, for the card's subject; '' otherwise. */
  name: string;
  rows: OrderRow[];
  order: string[];
  value?: undefined;
}

/** The words a model uses for "reorder". */
export const REORDER_FIELDS = new Set(['reorder', 'order', 'sort', 'arrange', 'rearrange']);

/** `order`, or what a model writes instead: a list under another key, or a comma string. */
export function orderTokens(item: Record<string, unknown>): unknown[] {
  const raw = item.order ?? item.ids ?? item.exerciseIds ?? item.routineIds ?? item.steps;
  if (Array.isArray(raw)) return raw;
  const text = typeof raw === 'string' ? raw : typeof item.text === 'string' ? item.text : '';
  return text
    .split(/\s*(?:,|;|→|->|>|\n)\s*/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

function fold(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The model's order, as the keys of `rows` — every key exactly once. Null when
 * no entry named a row, or when the result is the order `rows` already has.
 * See the file header for the three rules.
 */
export function resolveOrder(
  rows: readonly OrderRow[],
  tokens: readonly unknown[],
): string[] | null {
  const used = new Set<string>();
  const out: string[] = [];
  const take = (row: OrderRow | undefined) => {
    if (!row || used.has(row.key)) return;
    used.add(row.key);
    out.push(row.key);
  };
  for (const token of tokens) {
    const free = rows.filter((r) => !used.has(r.key));
    if (typeof token === 'number' || (typeof token === 'string' && /^\d+$/.test(token.trim()))) {
      // A place in the CURRENT list, 1 = first — whether or not it was used.
      const at = Number(token);
      if (Number.isInteger(at) && at >= 1) take(rows[at - 1]);
      continue;
    }
    if (typeof token !== 'string' || token.trim() === '') continue;
    const id = token.trim();
    take(free.find((r) => r.ref === id) ?? free.find((r) => fold(r.name) === fold(id)));
  }
  if (out.length === 0) return null;
  for (const row of rows) if (!used.has(row.key)) out.push(row.key);
  return sameOrder(
    out,
    rows.map((r) => r.key),
  )
    ? null
    : out;
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, i) => key === b[i]);
}

/** Every key of `rows` exactly once, and nothing else — what a stored order must be. */
export function isPermutationOf(keys: readonly string[], order: readonly unknown[]): boolean {
  if (order.length !== keys.length) return false;
  const want = new Set(keys);
  const seen = new Set<string>();
  for (const key of order) {
    if (typeof key !== 'string' || !want.has(key) || seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/**
 * `order` with `key` moved to `toIndex` — an index into the list WITHOUT it,
 * which is what `useDragReorder` reports. The card's drag, as a pure step.
 */
export function moveKey(order: readonly string[], key: string, toIndex: number): string[] {
  const from = order.indexOf(key);
  if (from < 0) return [...order];
  const rest = order.filter((k) => k !== key);
  rest.splice(Math.max(0, Math.min(rest.length, toIndex)), 0, key);
  return rest;
}

/* ------------------------------------------------------------------ */
/* Applying                                                            */
/* ------------------------------------------------------------------ */

/**
 * A routine's rows in `order` (item ids), every `order` field rewritten. Rows
 * the card does not name — added since, or by an earlier item of the same card
 * — keep their relative order after the named ones; ids that are gone are
 * skipped. What the routine editor's Save would write after the same drags.
 */
export function orderRoutineItems(
  items: readonly RoutineItem[],
  order: readonly string[],
): RoutineItem[] {
  const sorted = [...items].sort((a, b) => a.order - b.order);
  const byId = new Map(sorted.map((item) => [item.id, item]));
  const named = order.flatMap((id) => {
    const item = byId.get(id);
    if (!item) return [];
    byId.delete(id);
    return [item];
  });
  const rest = sorted.filter((item) => byId.has(item.id));
  return [...named, ...rest].map((item, index) => ({ ...item, order: index }));
}

/**
 * The adjacent swaps that turn the loop into `order`, for `moveSequenceStep` —
 * the store's ONE reorder, which carries the cursor with the step it is on (see
 * `lib/sequenceSteps.ts` for why there is no second one). `order` is the steps'
 * positions at filing, as strings; null when the loop no longer has that many
 * steps, because positions counted against another loop name other steps.
 */
export function sequenceSwaps(
  stepCount: number,
  order: readonly string[],
): { index: number; direction: -1 | 1 }[] | null {
  const keys = Array.from({ length: stepCount }, (_, i) => String(i));
  if (!isPermutationOf(keys, order)) return null;
  const now = [...keys];
  const swaps: { index: number; direction: -1 | 1 }[] = [];
  order.forEach((key, target) => {
    for (const swap of swapsToMove(now.indexOf(key), target, now.length)) {
      const other = swap.index + swap.direction;
      [now[swap.index], now[other]] = [now[other], now[swap.index]];
      swaps.push(swap);
    }
  });
  return swaps;
}

/**
 * The rows the card draws, in the pending order. A key the rows do not know
 * (a stored card from a future build) is left out rather than drawn blank.
 */
export function orderedRows(change: Pick<OrderChange, 'rows' | 'order'>): OrderRow[] {
  const byKey = new Map(change.rows.map((r) => [r.key, r]));
  return change.order.flatMap((key) => {
    const row = byKey.get(key);
    return row ? [row] : [];
  });
}

/* ------------------------------------------------------------------ */
/* Reading one back from storage                                       */
/* ------------------------------------------------------------------ */

const LISTS: readonly OrderList[] = ['routine', 'sequence', 'live'];

/**
 * A stored reorder change, or null when it is not one that can be drawn and
 * applied: the chat is persisted and restored from backups, and a card whose
 * order is not a permutation of its own rows would draw rows that Apply could
 * not place.
 */
export function sanitizeOrderChange(raw: Record<string, unknown>): OrderChange | null {
  if (raw.target !== 'order' || !LISTS.includes(raw.list as OrderList)) return null;
  if (!Array.isArray(raw.rows) || !Array.isArray(raw.order)) return null;
  const rows: OrderRow[] = [];
  for (const r of raw.rows) {
    if (typeof r !== 'object' || r === null) return null;
    const { key, ref, name } = r as Record<string, unknown>;
    if (typeof key !== 'string' || typeof ref !== 'string' || typeof name !== 'string') {
      return null;
    }
    rows.push({ key, ref, name });
  }
  const keys = rows.map((r) => r.key);
  if (new Set(keys).size !== keys.length || !isPermutationOf(keys, raw.order)) return null;
  return {
    target: 'order',
    field: 'reorder',
    list: raw.list as OrderList,
    id: typeof raw.id === 'string' ? raw.id : '',
    name: typeof raw.name === 'string' ? raw.name : '',
    rows,
    order: raw.order as string[],
  };
}
