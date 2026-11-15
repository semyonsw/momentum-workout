/**
 * The app, described for the assistant — so "where do I mark a warm-up?" gets a
 * path of taps rather than "I can only see your data".
 *
 * ── WHY A HAND-CHECKED MAP AND NOT THE SCREENS THEMSELVES ──────────────────
 *
 * The model never sees the UI; everything it knows about the app is what this
 * file says. So it is written the way the user would describe it — the on-screen
 * English labels in quotes, icons named by what they look like, every hold and
 * hidden tap spelled out — and built from the JSX, not from the header comments,
 * because a header says what a screen was meant to do and the JSX what it does.
 *
 * ── AND WHY IT CANNOT QUIETLY GO STALE ─────────────────────────────────────
 *
 * A guide that names a button the app no longer has is worse than no guide.
 * `appGuide.test.ts` checks that every quoted label below still exists in the
 * source; rename a button and that test names the line to fix here.
 *
 * REJECTED: generating it from the i18n catalogue. The catalogue has the words
 * but not where they are, and "where" is the whole question.
 *
 * Sent with the chat (`aiPrompts.ts`): "where is X" is asked from the chat. The
 * map is about 14 KB — the price of the answer being right, paid once per
 * request against a context often larger.
 */

/** How to use the guide — the rules, kept apart from the map they apply to. */
export const APP_GUIDE_RULES = `APP GUIDE. Below is a map of this app's screens and controls. Use it whenever the user asks where something is, how to do something in the app, what a button does, what the app can do, or asks for a guide or documentation.
- Answer "where/how" with the exact path of taps as a short numbered list in one "text" block (e.g. "1. Settings tab (gear). 2. "AI coach" row. 3. ..."), naming icons by how they look. Mention a hold or hidden tap explicitly — those are what users miss.
- If the user writes in Russian, describe the controls in Russian; the quoted labels in the map are the English UI text, so translate them naturally rather than quoting English.
- For "what can this app do" or a full guide: one "summary" block per part of the map with notes (at most 4 notes each, short), then offer to explain any part.
- If the user could do it through you (the "AI coach" part of the map lists what you can change), say so and offer it — but still say where it is in the app.
- Never describe a screen, button or feature the map does not contain. If it is not there, say the app does not have it. This app is one log; it has no screens for anything else.`;

const CONVENTIONS = `APP MAP
Conventions: "tap" = short press, "hold" = long-press. Labels in quotes are the exact on-screen English text. Icon-only buttons are described by icon. Every hold has a visible twin (a ⋯ button, a labelled button or a ⋮⋮ grip). Most destructive actions show an "Undo" toast for a few seconds; the rest ask first.`;

const NAVIGATION = `## 1. Navigation

### Bottom nav bar (glass pill, icon + label)
- Four items: "Workout" (where the app opens; dumbbell), "Routines" (list), "History" (clock-arrow) and "Settings" (gear). The active one is in the accent colour.
- Hidden on pushed screens, during a workout and while a sheet is open. Android Back on a pushed screen goes back one screen; Back on "Routines", "History" or "Settings" goes to "Workout"; Back on "Workout" asks for a second press, then leaves the app.

### Top bar
- "Workout" screen: one labelled pill, "AI coach" (sparkle).
- "Settings" screen: "РУ" / "EN" language letters.

### First launch
- Language choice: tap Русский or English.`;

const WORKOUT_MAP = `## 2. Workout

### Workout section (nav: "Workout")
- While a workout runs: an "In progress" card at the top — tap it to go back to the workout.
- Otherwise a hero card "Up next · <routine>" (the training sequence's turn, or the routine after the one you trained last) with one big "Start" button that starts it. Tapping the card itself opens the routine without starting it.
- "Other routines": each row has a "Start" pill (starts it); tapping the row's name opens it without starting.
- "Sequence" strip (only with a training order on): tap a step → Training sequence.
- "Recent": tap a past workout → the History tab with it expanded.
- "Progress" card: its header ("Graphs ›") opens the History tab on Graphs; chips "Muscle map" and "Body" open those screens.
- Scrolled down, a capsule at the top carries the hero routine (or the running workout) with a ▶.
- Empty state (no routines): "Create a routine", "Set up a training order", "Start an empty workout".

### Starting a workout
- "Start" (the hero's button, a routine row's pill on Workout, or a row's "Start" on the Routines tab) opens the routine and starts the clock.
- Opening a routine without starting (tap the hero card or a row's name) shows it NOT started; its bottom dock has "Stop and exit" and ▶ Start workout. Logging the first set also starts the clock.

### Live session screen
Header:
- "<" Back: leaves the screen, the workout KEEPS RUNNING (resume it from the Workout section).
- Title, sets progress, elapsed clock, workout number.
- ⋮ captioned "Options" → Session options sheet: "+ Add an exercise", "Auto-start rest" switch ("Rest timer starts when you log a set"), "Stop and exit…".
Timer pill under the header (only while running): rest "−15 s" / "+15 s" / pause / "Skip"; timed sets: "Start now", "+15 s", "Stop" (logs), "x" (cancel).
Exercise cards (one open at a time):
- Tap a collapsed card to open it; tap the open card's name to close it.
- Hold a card header (it has a grip mark) to lift it, slide, then "Drop" to reorder exercises.
- Open card header: name; sub-line like "4 sets · target 80 kg × 8"; a "Focus" chip (viewfinder icon, on the card holding the next set); an "Edit" pill.
Set row (one per set), left to right:
- Set well: the set number (a warm-up shows W and has no number).
- Weight well and reps well: tap either → the inline editor under the row (on every row, including the highlighted next one).
- Round log button on the right: tick = log the set; tap again = undo. Pre-filled numbers come from last session, so an unchanged set is one tap.
Inline editor (after tapping a weight or reps well):
- Two steppers: weight (− / value / +, step = the exercise's increment) and reps (−1 / value / +1). Tap the value to type an exact number.
- "Close" and "Log set".
Card footer (normal mode): a rest chip like Rest 1:30 (tap = start a rest now; its pencil = edit the rest).
Edit mode (tap "Edit"; the pill becomes "Done"):
- Each row: ⋮⋮ grip, set well, weight, reps, and a red − that removes THAT set.
- Moving a set: tap ⋮⋮ on a set to lift it, then tap ⋮⋮ on the row where it should go (only sets not yet logged can move).
- Buttons: "+ Add set", "Rest, targets and cue" › (exercise editor), then the red "Remove exercise".
Below the cards: "+ Add an exercise" (adds to this workout only).
Bottom dock (after start): "Focus" (viewfinder icon) and "Finish"; when every set is logged it becomes "Finish workout".

### Focus mode (full-screen, one set at a time)
- Open: the dock's "Focus" or the card's "Focus" chip.
- Close: "⌄" top-left, swipe the top band down, or Back.
- Big weight and reps with "−"/"+"; "done" logs the set and starts rest; rest view with ring countdown, "−15", "+15", pause, "Skip".

### Finish sheet ("Finish" / "Finish workout")
- Stats: "Time", "Sets", "Volume".
- "How did that go": Easy / Right / Brutal.
- If the session changed the plan: a "Changed from the plan" card (e.g. Bench press 3 sets → 4 sets) and a two-line button such as Save and make 4 sets the plan for Bench press (or Save and update 2 exercises in the plan) that also updates the routine.
- "Save workout" saves without touching the routine. "Keep training" goes back to logging.

### Routines (nav: "Routines")
- Header switch "Routines | Exercises".
- Routines: "Training sequence" row → Sequence screen; tap a routine → routine editor; "Start" on a row starts it as a workout.
- "Add routine" → a sheet: "Empty" (start blank and add exercises yourself) or "Random…" (pick muscles and length, the app fills it in).

### Routine editor
- "Routine name"; exercise rows: tap to expand (Sets, Reps, Rest, "Open its history"); hold the grip to reorder, "Drop" to place; "x" removes.
- "Add exercise"; "Duplicate this routine"; "Delete routine" (asks); floating "Save".
- A brand-new random routine has a die in the header to roll again; existing routines have no die.

### Training sequence ("Training sequence" row, or a step on the Workout section strip)
- "Use this sequence" switch.
- Each step: grip, number, routine name, and either a "Next" tag (the routine trained next) or a "Make next" button. Tap a step row to open its routine. Hold the grip to reorder.
- "+ Add a step" → pick a routine. "Start the sequence over".

### Exercise library ("Routines" tab → "Exercises")
- Search "Search exercises, muscles, days"; muscle tree; "New exercise"; "Recently used".
- Tap an exercise → its history. Header "Manage" → delete mode (trash on each row, asks first).

### Exercise history (tap an exercise in the library, or "Open its history")
- "Best", "Estimated 1-rep max" chart, "Records", "Top working weight", "Sessions"; tap a row → that workout.
- Header "Edit exercise" → the exercise editor.

### New / Edit exercise
- "Name", the form cue (shown on the exercise card while you do it), "Muscles".
- "Weight": "Plates or machine" / "Bodyweight + extra" / "Assisted" (each with an example line).
- Counted in reps / time / metres / rounds; sets; rest between sets.
- "Advanced" (collapsed): rep ladder, reps to MAX, increment.
- "Danger zone" at the bottom: "Delete" (asks; sets already logged stay in history).
- Floating "Create" / "Save".

### Training history (nav: "History")
- Switch "Log | Graphs | Calendar".
- Log: "Sets per cluster" ("4w", "12w", "All"); "Muscle map · this week"; workouts by month — tap one to expand.
  - Expanded workout: a date button (calendar icon, day, length, ▾) → "Move to another day" sheet with a calendar, "Cancel", "Move here".
  - Hint "Tap a set to correct it"; each exercise header has a pencil; tap a weight or reps well to correct it; tap the set number → the set-type sheet.
  - "+ Add a set", "Remove exercise", "+ Add an exercise", "Edit name, start and length", workout number, "Delete this workout" (asks).
- Graphs: "All workouts" chip or one chip per exercise; charts; "Bodyweight" row.
- Calendar: trained days have a dot; tap one → a preview row with "Open ›" opens that workout.

### Bodyweight (Progress card → "Body", Graphs → "Bodyweight", or Settings → Bodyweight)
- Weight card: tap the big value (pencil) → keypad, logs the weight; "−"/"+" nudge it; "Log weight" records it.

### Muscle map ("Muscle map" chip or Log → "Muscle map · this week")
- Previous/next week, front/back; tap a muscle for its weekly sets.`;

const SETTINGS = `## 3. Settings (nav: "Settings") — one scrolling page, in sections
- "Workout": rest between sets / exercises, "Start rest automatically", "Timer ± step"; "Get ready"; "Make every exercise a rep ladder"; weekly sets per muscle group; units "Kilograms" | "Pounds".
- "Timers & sound": "Beep the last", "Sound", "Vibration", "Keep the screen on", "Notify when a timer ends", "Test the beep".
- "Bodyweight": the bodyweight number (− / +, "Clear my bodyweight"), a row into the Bodyweight screen, "Remind me to weigh in" (days and time).
- "Data & backup": "Back up automatically", "Export everything", "Replace everything from a file" (asks); "Workouts on disk"; "Delete all workout history" (asks); "Reset every setting" (asks).
- "AI coach": row → AI settings.
- "Language": Русский | English (also the "РУ" / "EN" letters in the top bar).`;

const ASSISTANT = `## 4. AI coach
### Opening
- "AI coach" (sparkle) in the top bar or an AI card's prompt chip. Without a working key it opens AI settings first.
### AI settings (Settings → "AI coach")
- Provider (Google Gemini), API key with paste/clear, model, what it reads; "Test & connect"; disconnect (asks).
### AI chat
- Header: "<" Back, clock icon = past chats, "+" = new chat.
- Starter chips, including "App guide". Type a question or tell it what to do; to talk instead of type, tap the mic on your phone's keyboard.
- It can do almost anything you can do by hand, through a card you must Apply: create, rename, duplicate or delete routines and exercises; add, remove, move and re-plan a routine's exercises; edit the training loop; change any exercise or workout setting, including the weigh-in reminder's switch, days and time; set an exercise's rep ladder to find (or retest) its max in the next workout; log today's body weight; correct a past workout (its sets' weight and reps, warm-up marks, add or remove sets and exercises, name, day, start time, length, number, or delete it); and, during a workout, add or remove exercises and sets, add or take off an exercise's warm-up set, change weights and reps and log a set. Removals are shown in red. It cannot start, finish or discard a workout, run timers, or export, import, back up or reset.
- Answer cards: "Suggested routine" or "Suggested edit" → "Review & edit" or "Add to routines"/"Apply changes"; "Suggested changes" → "Apply changes"/"Discard"; "Suggested training loop" → "Apply loop"/"Discard". Nothing changes until Apply; applying shows an Undo toast.
### AI review (from "Review & edit")
- Routine name, "Why", exercise rows with steppers, "Add an exercise"; "Discard" and "Add to routines"/"Apply changes".`;

/** The whole map the assistant is given. */
export function appGuide(): string {
  return [CONVENTIONS, NAVIGATION, WORKOUT_MAP, SETTINGS, ASSISTANT].join('\n\n');
}
