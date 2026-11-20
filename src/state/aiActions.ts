/**
 * The assistant's side effects: testing a key, asking a question, applying a
 * suggestion — the only place the AI reads other stores and the network.
 *
 *   testKey        shape check → GET /models → POST hello → key into the keystore
 *   sendMessage    context from the stores → Gemini → validated blocks → the chat
 *   applyProposal  the next library, written through `libraryStore`, with an Undo
 *   applyChanges   a settings card — exercises, app settings, a weigh-in, a
 *                  set's kind — written through each store's own actions,
 *                  with one Undo
 *
 * It lives in `state/` for the reason `dataTransfer.ts` does: it touches several
 * stores and runs outside React, on a button. Every decision it makes is a call
 * into `lib/ai/` — which request, what the answer means, what the library
 * becomes — and this file is the plumbing between those and the stores.
 *
 * NOTHING HERE THROWS. Every path ends in a store write the chat can draw: an
 * answer, or a sentence with a "Try again" under it. A promise that rejected out
 * of here would reject into a button handler, and the button would do nothing.
 *
 * NOTHING IS WRITTEN WITHOUT A TAP. A proposal arrives in the chat as a card and
 * sits there; `applyProposal` is reached only from `Add to routines` or `Apply
 * changes`, on the card or on the review screen.
 */

import { buildWorkoutContext, nextStartWeights } from '../lib/ai/aiContext';
import {
  applyExerciseChange,
  describeChanges,
  droppedNote,
  validateChangesReport,
  type AiChange,
  type ChangeContext,
  type CurrentValues,
} from '../lib/ai/aiChanges';
import { moveItem, newExercise, patchRoutineItems } from '../lib/ai/aiEdits';
import { orderRoutineItems, sequenceSwaps, type OrderChange } from '../lib/ai/aiOrder';
import { suggestionNote, systemPrompt, type SuggestionFate } from '../lib/ai/aiPrompts';
import { normalizeProposal, planApply, type Library } from '../lib/ai/aiProposal';
import { validateBlocks, type AiSection } from '../lib/ai/aiSchema';
import { keepSteps } from '../lib/ai/sequenceCursor';
import {
  CHAT_TIMEOUT_MS,
  FALLBACK_MODEL,
  RETRY_DELAYS_MS,
  TEST_TIMEOUT_MS,
  buildChatRequest,
  buildHelloRequest,
  buildListRequest,
  checkKeyShape,
  isRetryable,
  mapError,
  mapParseFailure,
  mapTransportFailure,
  parseChatResponse,
  parseModelList,
  wantsFallback,
  type HistoryTurn,
} from '../lib/ai/gemini';
import { clearKey, getKey, setKey } from '../lib/ai/secureKey';
import { send } from '../lib/ai/transport';
import { historyByExerciseId, workoutNumbers } from '../lib/completedWorkout';
import { dayKey, monthNames, parseClockTime, parseDay, type Weekday } from '../lib/days';
import { buildDraftEntry, defaultTargetCount, defaultTargetSets } from '../lib/draft';
import { resolveRest } from '../lib/rest';
import { warmupToggleState } from '../lib/warmup';
import type { CompletedWorkout } from '../lib/completedWorkout';
import type { Exercise, ID } from '../types/models';
import { t } from '../lib/i18n';
import { seedUser } from '../data/seed';
import { useActiveWorkout } from './activeWorkoutStore';
import { useAi, type AiMessage, type ChatBlock } from './aiStore';
import { setRestBetweenExercises, setRestBetweenSets } from './restSync';
import { useLibrary } from './libraryStore';
import { useSettings } from './settingsStore';
import { useWorkoutHistory } from './workoutHistoryStore';

const lang = () => useSettings.getState().language;

/** Appended to the question on the one re-ask after an unreadable reply. */
const REPAIR_NOTE =
  '(Your previous reply could not be read. Answer the question above again, replying ONLY with JSON of the form {"blocks":[{"type":"text","text":"..."}]} using the block types from your instructions. No prose outside the JSON.)';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let idSeed = 0;
function nextId(prefix: string): string {
  idSeed += 1;
  return `${prefix}_${Date.now().toString(36)}_${idSeed}`;
}

/* ------------------------------------------------------------------ */
/* The key test                                                        */
/* ------------------------------------------------------------------ */

/**
 * `transient` marks a failure that says nothing about the KEY — offline, a
 * timeout. The settings screen reads it to leave a working connection working.
 */
export type TestResult =
  { ok: true; latencyMs: number } | { ok: false; error: string; transient?: boolean };

/**
 * Test a key the user typed, step by step, and store it only if it passed.
 *
 * `onStep(n)` fires as each of the three visible steps completes, so the overlay
 * ticks them off as they happen rather than on a timer. The minimum time the
 * overlay stays up is the SCREEN's business, not this function's: a test that
 * padded itself would report a latency it did not have.
 */
export async function testKey(key: string, onStep: (done: 1 | 2 | 3) => void): Promise<TestResult> {
  const language = lang();
  const shape = checkKeyShape(key, language);
  if (shape) return { ok: false, error: shape };
  const model = useAi.getState().model;
  const trimmed = key.trim();
  const started = Date.now();

  const listed = await send(buildListRequest(trimmed), TEST_TIMEOUT_MS);
  if (listed.kind !== 'response') {
    return { ok: false, error: mapTransportFailure(listed.kind, language), transient: true };
  }
  onStep(1);
  if (listed.status !== 200) {
    return { ok: false, error: mapError(listed.status, listed.body, model, language) };
  }
  onStep(2);

  const hello = await send(buildHelloRequest(trimmed, model), TEST_TIMEOUT_MS);
  if (hello.kind !== 'response') {
    return { ok: false, error: mapTransportFailure(hello.kind, language), transient: true };
  }
  if (hello.status !== 200) {
    return { ok: false, error: mapError(hello.status, hello.body, model, language) };
  }
  onStep(3);

  const latencyMs = Date.now() - started;
  if (!(await setKey(trimmed))) {
    return { ok: false, error: t('The key works, but this phone could not store it.', language) };
  }
  return { ok: true, latencyMs };
}

/** The models this key can chat with, for the picker. Empty on any failure. */
export async function listModels(): Promise<string[]> {
  const key = await getKey();
  if (!key) return [];
  const result = await send(buildListRequest(key, 100), TEST_TIMEOUT_MS);
  if (result.kind !== 'response' || result.status !== 200) return [];
  return parseModelList(result.body);
}

/** `Disconnect`: the key leaves the keystore and the status goes off. Chats stay. */
export async function disconnect(): Promise<void> {
  await clearKey();
  useAi.getState().markOff();
}

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

/** What the chat reads, and how much of it — for "Reading 91 workouts…". */
export function chatContext(): {
  json: string;
  count: number;
  routineIds: Set<string>;
  /** The same routines' names — an edit naming its routine still finds it. */
  routineNames: Map<string, string>;
} {
  const library = useLibrary.getState();
  const history = useWorkoutHistory.getState();
  const settings = useSettings.getState();
  const built = buildWorkoutContext({
    sequence: library.sequence,
    bodyweightLog: settings.bodyweightLog,
    exercises: library.exercises,
    routines: library.routines,
    workouts: history.workouts,
    numbers: workoutNumbers(history.workouts, history.numbering),
    bodyweightKg: settings.bodyweightKg,
    settings: settingsData(),
    live: liveForContext(),
    unitSystem: settings.unitSystem,
    lang: lang(),
  });
  return {
    json: built.json,
    count: built.workoutCount,
    routineIds: new Set(library.routines.map((r) => r.id)),
    routineNames: new Map(library.routines.map((r) => [r.id, r.name])),
  };
}

/** The workout in flight, for the context — or null. */
function liveForContext() {
  const session = useActiveWorkout.getState().session;
  if (!session) return null;
  return { title: session.title, started: session.startedAt != null, entries: session.entries };
}

/* ------------------------------------------------------------------ */
/* A chat turn                                                         */
/* ------------------------------------------------------------------ */

/** Each suggestion the chat made, oldest first, and whether it was applied. */
function fatesOf(messages: readonly AiMessage[]): SuggestionFate[] {
  const { proposals } = useAi.getState();
  const fates: SuggestionFate[] = [];
  for (const message of messages) {
    if (message.role !== 'model') continue;
    for (const block of message.blocks) {
      if (block.type === 'sequence') {
        fates.push({ what: 'loop', name: '', status: block.status });
      } else if (block.type === 'changes') {
        fates.push({ what: 'settings', name: '', status: block.status });
      } else if (block.type === 'proposal') {
        const stored = proposals[block.proposalId];
        if (stored) {
          fates.push({ what: 'routine', name: stored.proposal.name, status: stored.status });
        }
      }
    }
  }
  return fates;
}

/** The chat so far, as Gemini wants it: user text, and the model's own JSON back. */
function historyOf(messages: readonly AiMessage[]): HistoryTurn[] {
  const turns: HistoryTurn[] = [];
  for (const message of messages) {
    if (message.role === 'user') turns.push({ role: 'user', text: message.text });
    else if (message.role === 'model' && message.raw)
      turns.push({ role: 'model', text: message.raw });
  }
  return turns;
}

function fail(section: AiSection, text: string, retry: string, asked = () => true): void {
  if (!asked()) return;
  useAi.getState().appendMessage(section, {
    id: nextId('err'),
    role: 'error',
    text,
    retry,
    at: new Date().toISOString(),
  });
}

/**
 * Ask one question in the chat.
 *
 * `retryOf` is the id of an error message being retried: it is removed, and the
 * user's question — already in the chat above it — is not appended a second time.
 */
export async function sendMessage(
  section: AiSection,
  text: string,
  retryOf?: string,
): Promise<void> {
  const question = text.trim();
  const store = useAi.getState();
  if (question === '' || store.pending[section]) return;
  const language = lang();

  if (retryOf) store.removeMessage(section, retryOf);
  // Everything before THIS question is the history it travels with.
  const earlier = useAi.getState().chats[section];
  const history = historyOf(
    retryOf && earlier[earlier.length - 1]?.role === 'user' ? earlier.slice(0, -1) : earlier,
  );
  /** The question this answer belongs under — gone means the chat was cleared. */
  let anchorId: string | undefined;
  if (!retryOf) {
    anchorId = nextId('msg');
    store.appendMessage(section, {
      id: anchorId,
      role: 'user',
      text: question,
      at: new Date().toISOString(),
    });
  } else {
    const before = useAi.getState().chats[section];
    const last = before[before.length - 1];
    if (last?.role === 'user') anchorId = last.id;
  }
  const stillAsked = () =>
    anchorId === undefined || useAi.getState().chats[section].some((m) => m.id === anchorId);

  store.setPending(section, true);
  try {
    const key = await getKey();
    if (!key || useAi.getState().status !== 'ready') {
      fail(
        section,
        t('Connect a Google AI key in Settings first.', language),
        question,
        stillAsked,
      );
      return;
    }

    const context = chatContext();
    const chosen = useAi.getState().model;
    // Read now, not when the question was typed: Apply may have been pressed since.
    const note = suggestionNote(fatesOf(earlier));
    const asked = note ? `${note}\n\n${question}` : question;
    const request = (model: string, userText = asked) =>
      buildChatRequest({
        key,
        model,
        systemPrompt: systemPrompt(language),
        context: context.json,
        history,
        userText,
      });

    /*
     * Google's bad moments are retried before anything is said — see
     * `RETRY_DELAYS_MS`. The chosen model twice more with a growing pause, then
     * once on the fallback model; the answer that comes back is shown exactly as
     * if the first try had worked.
     */
    let model = chosen;
    let result = await send(request(model), CHAT_TIMEOUT_MS);
    for (const [attempt, delay] of RETRY_DELAYS_MS.entries()) {
      if (!isRetryable(result) || !stillAsked()) break;
      // A timeout is retried once: two more 30-second waits is a minute of
      // "typing" for an answer that is probably not coming.
      if (result.kind === 'timeout' && attempt > 0) break;
      useAi.getState().setRetrying(section, true);
      await wait(delay);
      result = await send(request(model), CHAT_TIMEOUT_MS);
    }
    if (wantsFallback(result, model) && stillAsked()) {
      model = FALLBACK_MODEL;
      const second = await send(request(model), CHAT_TIMEOUT_MS);
      // A fallback that does not exist for this key is not news: the user is
      // told about THEIR model's failure, not about one they never picked.
      if (second.kind === 'response' && second.status === 200) result = second;
      else model = chosen;
    }
    if (result.kind !== 'response') {
      fail(section, mapTransportFailure(result.kind, language), question, stillAsked);
      return;
    }
    if (result.status !== 200) {
      fail(section, mapError(result.status, result.body, model, language), question, stillAsked);
      return;
    }

    /*
     * Read it — and if nothing in it can be drawn, ask ONCE more with the
     * format spelled out. The validator already reads every near-miss it can
     * (`validateBlocks`), so what reaches this second ask is a reply that was
     * genuinely off the schema, and a model told exactly what went wrong almost
     * always gets it right the second time. Only then does the chat say it
     * could not read the answer.
     */
    const read = (body: unknown) => {
      const parsed = parseChatResponse(body);
      const blocks = parsed.ok
        ? validateBlocks(parsed.json, {
            routineIds: context.routineIds,
            routineNames: context.routineNames,
          })
        : [];
      return { parsed, blocks };
    };
    let { parsed, blocks } = read(result.body);
    const unreadable =
      (!parsed.ok && parsed.reason === 'shape') || (parsed.ok && blocks.length === 0);
    if (unreadable && stillAsked()) {
      const again = await send(request(model, `${asked}\n\n${REPAIR_NOTE}`), CHAT_TIMEOUT_MS);
      if (again.kind === 'response' && again.status === 200) {
        const second = read(again.body);
        if (second.parsed.ok && second.blocks.length > 0) ({ parsed, blocks } = second);
      }
    }
    if (!parsed.ok) {
      fail(section, mapParseFailure(parsed.reason, language), question, stillAsked);
      return;
    }

    /* A proposal becomes a stored, editable record, and the chat keeps its id. */
    const library = useLibrary.getState();
    const chatBlocks: ChatBlock[] = [];
    for (const block of blocks) {
      if (block.type === 'sequence_proposal') {
        chatBlocks.push({ type: 'sequence', ...block.sequence, status: 'pending' });
        continue;
      }
      if (block.type === 'changes_proposal') {
        // Checked against the stores NOW, and the card's `from` read now too.
        const { changes, dropped } = validateChangesReport(block.changes.items, changeContext());
        const rows = describeChanges(changes, currentValues(), language);
        if (rows.length > 0) {
          chatBlocks.push({
            type: 'changes',
            changes,
            rows,
            why: block.changes.why,
            status: 'pending',
            ...(dropped > 0 ? { dropped } : {}),
          });
        } else {
          // Nothing it named could be applied; its reason is still the answer,
          // and the user is told why there is no card to press.
          if (block.changes.why) chatBlocks.push({ type: 'text', text: block.changes.why });
          if (dropped > 0) {
            chatBlocks.push({ type: 'text', text: droppedNote(dropped, language) });
          }
        }
        continue;
      }
      if (block.type !== 'routine_proposal') {
        chatBlocks.push(block);
        continue;
      }
      const review = normalizeProposal(block.proposal, {
        exercises: library.exercises,
        routines: library.routines,
        lastWeights: nextStartWeights(library.exercises, useWorkoutHistory.getState().workouts),
      });
      if (!review) {
        // Nothing left to apply once matched against the library — its reason
        // is still worth saying.
        chatBlocks.push({ type: 'text', text: block.proposal.why });
        continue;
      }
      const proposalId = nextId('prop');
      useAi.getState().putProposal(proposalId, review);
      chatBlocks.push({ type: 'proposal', proposalId });
    }
    if (chatBlocks.length === 0) {
      fail(section, mapParseFailure('shape', language), question, stillAsked);
      return;
    }
    if (!stillAsked()) return;
    useAi.getState().appendMessage(section, {
      id: nextId('ans'),
      role: 'model',
      blocks: chatBlocks,
      raw: parsed.raw,
      at: new Date().toISOString(),
    });
  } catch {
    // Belt and braces: every call above resolves, but a chat that stays
    // "typing" forever is the one failure this file exists to rule out.
    fail(section, mapTransportFailure('network', language), question, stillAsked);
  } finally {
    useAi.getState().setPending(section, false);
  }
}

/* ------------------------------------------------------------------ */
/* Deciding a proposal                                                 */
/* ------------------------------------------------------------------ */

export interface Applied {
  /** `Added Legs + Core to routines` / `Updated Push`. */
  message: string;
  undo: () => void;
}

/**
 * `Add to routines` / `Apply changes`. Null when there is nothing to apply it to
 * — the routine an edit targets was deleted since, or every row was removed.
 */
export function applyProposal(id: string): Applied | null {
  const stored = useAi.getState().proposals[id];
  if (!stored || stored.status !== 'pending') return null;
  const library = useLibrary.getState();
  const snapshot: Library = { exercises: library.exercises, routines: library.routines };
  const next = planApply(stored.proposal, snapshot, { ownerId: seedUser.id });
  if (!next) return null;

  library.replaceLibrary({ exercises: next.exercises, routines: next.routines });
  useAi.getState().setProposalStatus(id, 'accepted');
  const isNew = stored.proposal.kind === 'new';
  if (isNew) useAi.getState().markRoutineAi(next.routineId);

  const language = lang();
  return {
    message: isNew
      ? t('Added {name} to routines', language, { name: next.routineName })
      : t('Updated {name}', language, { name: next.routineName }),
    undo: () => {
      useLibrary.getState().replaceLibrary(snapshot);
      useAi.getState().setProposalStatus(id, 'pending');
      if (isNew) useAi.getState().markRoutineSeen(next.routineId);
    },
  };
}

export function discardProposal(id: string): void {
  const stored = useAi.getState().proposals[id];
  if (stored?.status === 'pending') useAi.getState().setProposalStatus(id, 'discarded');
}

/* ------------------------------------------------------------------ */
/* Deciding a suggested loop                                           */
/* ------------------------------------------------------------------ */

/**
 * `Apply loop`: the training sequence becomes the suggested one, switched on,
 * pointing at the step the suggestion named — with an Undo that puts the old
 * loop back exactly, cursor and on/off included. Null when there is nothing to
 * apply: the message is gone, it was already decided, or every routine it named
 * has been deleted since.
 */
export function applySequence(section: AiSection, messageId: string): Applied | null {
  const message = useAi.getState().chats[section].find((m) => m.id === messageId);
  const block =
    message?.role === 'model' ? message.blocks.find((b) => b.type === 'sequence') : undefined;
  if (!block || block.type !== 'sequence' || block.status !== 'pending') return null;

  const library = useLibrary.getState();
  const known = new Set(library.routines.map((r) => r.id));
  // "Next" is re-counted on the routine the card highlighted — `keepSteps`.
  const { routineIds, next } = keepSteps(block.routineIds, block.next, (id) => known.has(id));
  if (routineIds.length === 0) return null;

  const before = library.sequence;
  library.replaceSequence({ isActive: true, routineIds, cursor: next });
  useAi.getState().setSequenceStatus(section, messageId, 'accepted');
  return {
    message: t('Training loop updated', lang()),
    undo: () => {
      useLibrary.getState().replaceSequence(before);
      useAi.getState().setSequenceStatus(section, messageId, 'pending');
    },
  };
}

export function discardSequence(section: AiSection, messageId: string): void {
  useAi.getState().setSequenceStatus(section, messageId, 'discarded');
}

/* ------------------------------------------------------------------ */
/* Deciding a settings card                                            */
/* ------------------------------------------------------------------ */

/** What `validateChanges` checks ids against — every store an item can name. */
function changeContext(): ChangeContext {
  const library = useLibrary.getState();
  const settings = useSettings.getState();
  return {
    exercises: library.exercises,
    workouts: useWorkoutHistory.getState().workouts,
    routines: library.routines,
    sequence: library.sequence,
    session: useActiveWorkout.getState().session,
    today: dayKey(new Date()),
    ladderAll: settings.ladderAllExercises,
    restSeconds: settings.restSecondsBetweenSets,
  };
}

/** `2026-10-27` → `27 Oct`, the card's date. */
function formatDay(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  const month = monthNames(lang())[m - 1] ?? '';
  return `${d} ${month.slice(0, 3)}`;
}

/** The settings a card can move, as plain data — its `from`s, and its Undo. */
function settingsData() {
  const s = useSettings.getState();
  return {
    restSecondsBetweenSets: s.restSecondsBetweenSets,
    restSecondsBetweenExercises: s.restSecondsBetweenExercises,
    autoStartRest: s.autoStartRest,
    adjustStepSeconds: s.adjustStepSeconds,
    prepareSeconds: s.prepareSeconds,
    beepSeconds: s.beepSeconds,
    soundEnabled: s.soundEnabled,
    hapticsEnabled: s.hapticsEnabled,
    keepAwakeEnabled: s.keepAwakeEnabled,
    notifyOnTimerEnd: s.notifyOnTimerEnd,
    ladderAllExercises: s.ladderAllExercises,
    unitSystem: s.unitSystem,
    language: s.language,
    weeklySetTargets: s.weeklySetTargets,
    weighInReminderEnabled: s.weighInReminderEnabled,
    weighInReminderDays: s.weighInReminderDays,
    weighInReminderTime: s.weighInReminderTime,
  };
}

/** The values in force, for the card's `from`. */
function currentValues(): CurrentValues {
  const settings = useSettings.getState();
  return {
    exercises: useLibrary.getState().exercises,
    settings: settingsData(),
    bodyweightKg: settings.bodyweightKg,
    formatDay,
  };
}

/**
 * Applied first to last: settings (a new between-sets rest clears every
 * exercise's own rest, and an exercise rest on the same card must survive it),
 * then what the card creates (later items name it), then the edits in the
 * model's order, and whole-thing deletions last — an edit to a routine the
 * same card deletes is harmless before the delete and lost after it.
 */
function rank(change: AiChange): number {
  if (change.target === 'setting') return 0;
  if (change.target === 'exercise_create') return 1;
  if (change.target === 'routine' && change.field === 'create') return 2;
  if (change.target === 'exercise_delete') return 4;
  if ((change.target === 'routine' || change.target === 'workout') && change.field === 'delete') {
    return 4;
  }
  return 3;
}

/**
 * `Apply changes` on a settings card: every change, through each store's own
 * action — the same ones the screens call — and ONE Undo that puts every touched
 * store back as it was.
 *
 * Null when there is nothing to apply — the card is gone, already decided, or
 * everything it named has been deleted since. Each change is re-checked against
 * the store as it is NOW: an exercise deleted between the answer and the tap is
 * skipped rather than resurrected.
 */
export function applyChanges(section: AiSection, messageId: string): Applied | null {
  const message = useAi.getState().chats[section].find((m) => m.id === messageId);
  const block =
    message?.role === 'model' ? message.blocks.find((b) => b.type === 'changes') : undefined;
  if (!block || block.type !== 'changes' || block.status !== 'pending') return null;

  const library = useLibrary.getState();
  const settings = useSettings.getState();
  const snapshot = {
    library: { exercises: library.exercises, routines: library.routines },
    sequence: library.sequence,
    settings: settingsData(),
    bodyweightKg: settings.bodyweightKg,
    bodyweightLog: settings.bodyweightLog,
    numbering: useWorkoutHistory.getState().numbering,
  };
  const ctx: ApplyContext = { workouts: new Map(), refs: new Map(), routinesCreated: [] };
  /* The workout in flight carries its own copy of each exercise, and Apply
     writes into it (`syncExercise`, `followGlobalRest`) — so the Undo has to put
     those copies back too, or the open card keeps the change it just undid. */
  const session = useActiveWorkout.getState().session;
  const liveBefore = session
    ? { localId: session.localId, exercises: session.entries.map((e) => e.exercise) }
    : null;

  const ordered = [...(block.changes as AiChange[])]
    .map((change, index) => ({ change, index }))
    .sort((a, b) => rank(a.change) - rank(b.change) || a.index - b.index)
    .map(({ change }) => change);
  let applied = 0;
  for (const change of ordered) {
    if (applyOne(change, ctx)) applied += 1;
  }
  if (applied === 0) return null;
  useAi.getState().setChangesStatus(section, messageId, 'accepted');
  const touched = (target: string) => ordered.some((c) => c.target === target);

  return {
    message: t('{n} changes applied', lang(), { n: applied }),
    undo: () => {
      useLibrary.getState().replaceLibrary(snapshot.library);
      useLibrary.getState().replaceSequence(snapshot.sequence);
      for (const id of ctx.routinesCreated) useAi.getState().markRoutineSeen(id);
      const live = useActiveWorkout.getState();
      // The same session only: a workout started since never held these copies.
      if (session && liveBefore && live.session?.localId === liveBefore.localId) {
        const reorderedLive = ordered.some((c) => c.target === 'order' && c.list === 'live');
        if (touched('live') || touched('live_set') || reorderedLive) {
          useActiveWorkout.setState({ session });
        } else {
          for (const e of liveBefore.exercises) useActiveWorkout.getState().syncExercise(e.id, e);
        }
      }
      if (touched('setting')) useSettings.setState(snapshot.settings);
      // Only a card that weighed in puts the weight back: a weigh-in made by hand
      // since another card was applied is not this Undo's to take.
      // And FIRST, because restoring a workout reprices it at the weight in force.
      if (touched('bodyweight')) {
        useSettings.setState({
          bodyweightKg: snapshot.bodyweightKg,
          bodyweightLog: snapshot.bodyweightLog,
        });
      }
      // `reinstate`, not `restore`: a workout this card deleted comes back too.
      for (const workout of ctx.workouts.values()) {
        useWorkoutHistory.getState().reinstateWorkout(workout);
      }
      if (touched('workout')) {
        const history = useWorkoutHistory.getState();
        if (snapshot.numbering) {
          history.setWorkoutNumber(snapshot.numbering.workoutId, snapshot.numbering.number);
        } else {
          history.clearWorkoutNumbering();
        }
      }
      useAi.getState().setChangesStatus(section, messageId, 'pending');
    },
  };
}

/** What Apply carries from one change to the next. */
interface ApplyContext {
  /** Each workout as it was before this card's FIRST write to it, for the Undo. */
  workouts: Map<ID, CompletedWorkout>;
  /** A card's handle (`new_1`) → the id the store gave it. */
  refs: Map<string, ID>;
  /** Routines this card created, which get the AI mark until the Undo. */
  routinesCreated: ID[];
}

/** An exercise id no row has, for a library row this card creates. */
function freshExerciseId(): ID {
  const taken = new Set(useLibrary.getState().exercises.map((e) => e.id));
  const base = `ex_${Date.now().toString(36)}`;
  for (let n = 0; ; n += 1) {
    const id = n === 0 ? base : `${base}_${n}`;
    if (!taken.has(id)) return id;
  }
}

/**
 * The entry for an exercise added to the workout in flight — built exactly as
 * `+ Add an exercise` builds it (`AppShell.addExerciseToSession`): what the
 * exercise plans anywhere else, prefilled from its history, at its own rest.
 */
function sessionEntryFor(exercise: Exercise) {
  const settings = useSettings.getState();
  const planned = defaultTargetSets(exercise);
  return buildDraftEntry({
    exercise,
    history: historyByExerciseId(useWorkoutHistory.getState().workouts)[exercise.id] ?? [],
    unitSystem: settings.unitSystem,
    restSeconds: resolveRest(exercise, settings.restSecondsBetweenSets).seconds,
    transitionRestSeconds: settings.restSecondsBetweenExercises,
    targetSets: planned,
    targetRepsMax: defaultTargetCount(exercise),
    plannedSetCount: planned,
    lang: settings.language,
  });
}

/** One change, through its store. False when its target is gone. */
function applyOne(change: AiChange, ctx: ApplyContext): boolean {
  const resolve = (id: string) => ctx.refs.get(id) ?? id;
  const keep = (workoutId: ID) => {
    const workout = useWorkoutHistory.getState().workouts.find((w) => w.id === workoutId);
    if (workout && !ctx.workouts.has(workoutId)) ctx.workouts.set(workoutId, workout);
    return workout;
  };
  switch (change.target) {
    case 'bodyweight':
      useSettings.getState().setBodyweightKg(change.value);
      return true;
    case 'setting':
      return applySetting(change);
    case 'exercise': {
      const library = useLibrary.getState();
      const id = resolve(change.id);
      const exercise = library.exercises.find((e) => e.id === id && !e.isArchived);
      if (!exercise) return false;
      // Through `updateExercise`, which also re-plans the routines on a `sets` change.
      const next = applyExerciseChange(exercise, { ...change, id });
      library.updateExercise(exercise.id, next);
      // And on the card of a workout in flight, as an edit made by hand lands there.
      useActiveWorkout.getState().syncExercise(next.id, next);
      return true;
    }
    case 'exercise_create': {
      const settings = useSettings.getState();
      const exercise = newExercise({
        id: freshExerciseId(),
        ownerId: seedUser.id,
        name: change.name,
        muscle: change.muscle,
        kind: change.kind,
        restSeconds: settings.restSecondsBetweenSets,
        ladderAll: settings.ladderAllExercises,
      });
      useLibrary.getState().addExercise(exercise);
      ctx.refs.set(change.ref, exercise.id);
      return true;
    }
    case 'exercise_delete': {
      const library = useLibrary.getState();
      const id = resolve(change.id);
      if (!library.exercises.some((e) => e.id === id)) return false;
      library.deleteExercise(id);
      return true;
    }
    case 'routine':
      return applyRoutine(change, ctx);
    case 'routine_item':
      return applyRoutineItem(change, resolve);
    case 'sequence': {
      const library = useLibrary.getState();
      const steps = library.sequence.routineIds.length;
      if (change.field === 'on') {
        library.setSequenceActive(change.value === true);
        return true;
      }
      const index = change.value;
      if (typeof index !== 'number' || index < 0 || index >= steps) return false;
      if (change.field === 'next') {
        library.setSequenceCursor(index);
        return true;
      }
      return library.varySequenceStep(index) != null;
    }
    case 'workout':
      return applyWorkout(change, keep, resolve);
    case 'workout_set': {
      const history = useWorkoutHistory.getState();
      if (!keep(change.id)) return false;
      if (change.field === 'kind') {
        return history.updateWorkoutSet(change.id, change.setId, {
          isWarmup: change.value === 'warmup',
        });
      }
      if (change.field === 'add') return history.addWorkoutSet(change.id, change.exerciseId);
      if (!change.setId) return false;
      if (change.field === 'delete') return history.deleteWorkoutSet(change.id, change.setId);
      if (change.field === 'weight') {
        return history.updateWorkoutSet(change.id, change.setId, { weightKg: change.value });
      }
      return history.updateWorkoutSet(change.id, change.setId, { count: change.value });
    }
    case 'live':
      return applyLive(change, resolve);
    case 'order':
      return applyOrder(change);
    case 'live_set': {
      const live = useActiveWorkout.getState();
      const entry = live.session?.entries.find((e) => e.localId === change.entryId);
      const set = entry?.sets.find((s) => s.localId === change.setId);
      if (!entry || !set) return false;
      if (change.field === 'log') {
        if (set.isCompleted) return false;
        live.completeSet(entry.localId, set.localId);
      } else if (change.field === 'unlog') {
        if (!set.isCompleted) return false;
        live.uncompleteSet(entry.localId, set.localId);
      } else if (change.field === 'remove') {
        live.removeSet(entry.localId, set.localId);
      } else if (change.field === 'weight') {
        live.patchSet(entry.localId, set.localId, { weightKg: change.value });
      } else {
        live.patchSet(entry.localId, set.localId, { count: change.value });
      }
      return true;
    }
  }
}

/** A setting, through the same write its Settings row makes. */
function applySetting(change: Extract<AiChange, { target: 'setting' }>): boolean {
  const settings = useSettings.getState();
  const on = change.value === true;
  switch (change.field) {
    case 'auto_rest':
      settings.setFlag('autoStartRest', on);
      return true;
    case 'sound':
      settings.setFlag('soundEnabled', on);
      return true;
    case 'vibration':
      settings.setFlag('hapticsEnabled', on);
      return true;
    case 'keep_awake':
      settings.setFlag('keepAwakeEnabled', on);
      return true;
    case 'timer_notifications':
      settings.setFlag('notifyOnTimerEnd', on);
      // The row asks for the permission as it turns on; so does this.
      if (on) {
        void import('../lib/notify')
          .then((m) => m.ensureNotificationPermission())
          .catch(() => undefined);
      }
      return true;
    case 'ladder_all':
      // The flag and the library together, as the switch keeps them.
      settings.setFlag('ladderAllExercises', on);
      useLibrary.getState().setLadderOnAllExercises(on);
      return true;
    case 'weigh_in_reminder':
      settings.setWeighInReminderEnabled(on);
      /* As the switch does: the permission is asked as it turns on, and a fresh
         grant arms the alerts now rather than at the next foreground. A refusal
         leaves it on and silent, which the Settings row says in words. */
      if (on) {
        void import('../lib/notify')
          .then((m) => m.ensureNotificationPermission())
          .then(async (state) => {
            if (state !== 'granted') return;
            const sync = await import('../hooks/useWeighInReminder');
            await sync.syncWeighInFromSettings(true);
          })
          .catch(() => undefined);
      }
      return true;
    case 'weigh_in_days': {
      if (!Array.isArray(change.value) || change.value.length === 0) return false;
      const wanted = change.value as Weekday[];
      // The chips' own toggle, one day at a time: the new days first, so the set
      // never passes through empty (which the store reads as "switch it off").
      const now = () => useSettings.getState().weighInReminderDays;
      for (const day of wanted) if (!now().includes(day)) settings.toggleWeighInReminderDay(day);
      for (const day of [...now()]) {
        if (!wanted.includes(day)) settings.toggleWeighInReminderDay(day);
      }
      return true;
    }
    case 'weigh_in_time': {
      const at = parseClockTime(change.value);
      if (!at) return false;
      settings.setWeighInReminderTime(at.hour, at.minute);
      return true;
    }
    case 'timer_step':
      settings.setNumber('adjustStepSeconds', Number(change.value));
      return true;
    case 'get_ready':
      settings.setNumber('prepareSeconds', Number(change.value));
      return true;
    case 'beep_seconds':
      settings.setNumber('beepSeconds', Number(change.value));
      return true;
    case 'units':
      settings.setUnitSystem(change.value === 'imperial' ? 'imperial' : 'metric');
      return true;
    case 'language':
      settings.setLanguage(change.value === 'ru' ? 'ru' : 'en');
      return true;
    case 'weekly_target':
      if (!change.cluster) return false;
      settings.setWeeklyTarget(
        change.cluster,
        change.value == null ? undefined : Number(change.value),
      );
      return true;
    case 'rest_between_sets':
      // The same writes the Settings rows make — `state/restSync.ts`.
      setRestBetweenSets(Number(change.value));
      return true;
    case 'rest_between_exercises':
      setRestBetweenExercises(Number(change.value));
      return true;
  }
}

function applyRoutine(
  change: Extract<AiChange, { target: 'routine' }>,
  ctx: ApplyContext,
): boolean {
  const library = useLibrary.getState();
  if (change.field === 'create') {
    const routine = library.createRoutine(change.name);
    ctx.refs.set(change.id, routine.id);
    ctx.routinesCreated.push(routine.id);
    useAi.getState().markRoutineAi(routine.id);
    return true;
  }
  const id = ctx.refs.get(change.id) ?? change.id;
  const routine = library.routines.find((r) => r.id === id);
  if (!routine) return false;
  switch (change.field) {
    case 'rename':
      library.updateRoutine(id, { name: change.value ?? routine.name, items: routine.items });
      return true;
    case 'duplicate': {
      const copy = library.duplicateRoutine(id);
      if (!copy) return false;
      if (change.value) {
        useLibrary.getState().updateRoutine(copy.id, { name: change.value, items: copy.items });
      }
      return true;
    }
    case 'delete':
      library.deleteRoutine(id);
      return true;
  }
}

function applyRoutineItem(
  change: Extract<AiChange, { target: 'routine_item' }>,
  resolve: (id: string) => string,
): boolean {
  const routineId = resolve(change.id);
  const exerciseId = resolve(change.exerciseId);
  const library = useLibrary.getState();
  const exercise = library.exercises.find((e) => e.id === exerciseId);
  const target = library.routines.find((r) => r.id === routineId);
  if (!exercise || !target) return false;
  if (change.field === 'add') {
    library.appendToRoutine(routineId, exerciseId);
    if (change.value == null) return true;
    // Placed where it was asked for: the row just appended is the last one.
    const routine = useLibrary.getState().routines.find((r) => r.id === routineId);
    const last = routine ? [...routine.items].sort((a, b) => b.order - a.order)[0] : undefined;
    if (!routine || !last) return true;
    useLibrary.getState().updateRoutine(routineId, {
      name: routine.name,
      items: moveItem(routine.items, last.id, change.value),
    });
    return true;
  }
  const items = patchRoutineItems(target.items, { ...change, exerciseId }, exercise.countUnit);
  if (!items) return false;
  // `updateRoutine`, which is what the routine editor's Save writes.
  library.updateRoutine(routineId, { name: target.name, items });
  return true;
}

function applyWorkout(
  change: Extract<AiChange, { target: 'workout' }>,
  keep: (id: ID) => CompletedWorkout | undefined,
  resolve: (id: string) => string,
): boolean {
  const workout = keep(change.id);
  if (!workout) return false;
  const history = useWorkoutHistory.getState();
  switch (change.field) {
    case 'rename':
      return history.editWorkout(workout.id, { title: String(change.value) });
    case 'date': {
      // Another day, the same time of day — what "Move to another day" does.
      const day = parseDay(String(change.value));
      if (!day) return false;
      const was = new Date(workout.startedAt);
      day.setHours(was.getHours(), was.getMinutes(), was.getSeconds(), was.getMilliseconds());
      return history.editWorkout(workout.id, { startedAt: day });
    }
    case 'start_time': {
      const [h, m] = String(change.value).split(':').map(Number);
      const at = new Date(workout.startedAt);
      at.setHours(h, m, 0, 0);
      return history.editWorkout(workout.id, { startedAt: at });
    }
    case 'duration':
      return history.editWorkout(workout.id, { durationMinutes: Number(change.value) });
    case 'number':
      history.setWorkoutNumber(workout.id, Number(change.value));
      return true;
    case 'delete':
      history.deleteWorkout(workout.id);
      return true;
    case 'add_exercise': {
      const id = resolve(change.exerciseId ?? '');
      const exercise = useLibrary.getState().exercises.find((e) => e.id === id);
      return exercise ? history.addWorkoutExercise(workout.id, exercise) : false;
    }
    case 'remove_exercise':
      return history.deleteWorkoutExercise(workout.id, change.exerciseId ?? '');
  }
}

function applyLive(
  change: Extract<AiChange, { target: 'live' }>,
  resolve: (id: string) => string,
): boolean {
  const live = useActiveWorkout.getState();
  if (!live.session) return false;
  if (change.field === 'add_exercise') {
    const id = resolve(change.exerciseId);
    const exercise = useLibrary.getState().exercises.find((e) => e.id === id);
    if (!exercise) return false;
    live.addEntry(sessionEntryFor(exercise));
    return true;
  }
  const entry = live.session.entries.find((e) => e.localId === change.entryId);
  if (!entry) return false;
  if (change.field === 'warmup') {
    // `toggleWarmup` flips; re-checked NOW, so a warm-up the user added or
    // logged by hand since the card was filed is not flipped the wrong way.
    const state = warmupToggleState(entry.sets);
    if (state == null || (state === 'add') !== (change.on === true)) return false;
    live.toggleWarmup(entry.localId);
    return true;
  }
  if (change.field === 'remove_exercise') live.removeEntry(entry.localId);
  else if (change.field === 'add_set') live.addSet(entry.localId);
  else live.moveEntry(entry.localId, change.value ?? 0);
  return true;
}

/**
 * A whole new order — the card's, as the user left it after any drags —
 * through the move each list's own screen makes: the routine editor's Save
 * (`updateRoutine`), the Sequence screen's step swaps (`moveSequenceStep`,
 * which carries the cursor with its step), the session's card drag (`moveEntry`).
 */
function applyOrder(change: OrderChange): boolean {
  if (change.list === 'routine') {
    const library = useLibrary.getState();
    const routine = library.routines.find((r) => r.id === change.id);
    if (!routine) return false;
    library.updateRoutine(routine.id, {
      name: routine.name,
      items: orderRoutineItems(routine.items, change.order),
    });
    return true;
  }
  if (change.list === 'sequence') {
    const steps = useLibrary.getState().sequence.routineIds.length;
    const swaps = sequenceSwaps(steps, change.order);
    if (!swaps) return false;
    for (const swap of swaps) useLibrary.getState().moveSequenceStep(swap.index, swap.direction);
    return true;
  }
  const live = useActiveWorkout.getState();
  if (!live.session) return false;
  const present = new Set(live.session.entries.map((e) => e.localId));
  const keys = change.order.filter((key) => present.has(key));
  if (keys.length === 0) return false;
  // Each card to its place in turn; cards added since the reply keep theirs after.
  keys.forEach((key, index) => useActiveWorkout.getState().moveEntry(key, index));
  return true;
}

/**
 * A drag on a reorder card: the pending order, before Apply. Nothing in the
 * library moves until Apply — the card is the preview the user fixes.
 */
export function reorderChange(
  section: AiSection,
  messageId: string,
  changeIndex: number,
  order: readonly string[],
): void {
  useAi.getState().setChangeOrder(section, messageId, changeIndex, order);
}

export function discardChanges(section: AiSection, messageId: string): void {
  useAi.getState().setChangesStatus(section, messageId, 'discarded');
}
