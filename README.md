# Workout

[![Install](https://img.shields.io/badge/install-one%20double--click-2b8a3e)](INSTALL.md)
[![Platform](https://img.shields.io/badge/platform-Android%208.0%2B-3ddc84)](INSTALL.md)
[![Stack](https://img.shields.io/badge/stack-Expo%2054%20%C2%B7%20RN%200.81%20%C2%B7%20TS-000020)](#what-it-does)
[![Tests](https://img.shields.io/badge/tests-2200%2B-1f9d55)](#tests)
[![Storage](https://img.shields.io/badge/storage-local--first-0b7285)](#what-it-does)

**Train · log · progress.** A local-first Android training log. It was Workout
Tracker until 2.0.0 and the workout section of Momentum until 3.0.0, when
Momentum's three logs became three apps (Tasks and Expenses are
[momentum-tasks](https://github.com/semyonsw/momentum-tasks) and
[momentum-expenses](https://github.com/semyonsw/momentum-expenses)). It is built
around one rule: **logging a set that
repeats last session costs one tap.**

> ### Install it
>
> | I want… | What to do |
> |---|---|
> | **the app on my phone** | grab the `.apk` from the [Releases page](../../releases), open it in Files, tap install — or plug the phone in and let the installer push it over USB |
> | **the project on my computer** | **Windows:** double-click `Install.bat` · **Linux/macOS/WSL:** `./install.sh` |
>
> The installer finds Node (and offers to fetch it), installs the locked
> dependency tree, **runs TypeScript and all ~2,200 tests to prove it works
> here**, and — if a phone is plugged in with USB debugging on — offers to
> install the APK on it, translating whatever Android says back into plain
> English. Details and troubleshooting: **[INSTALL.md](INSTALL.md)**.

- **Stack** — Expo (React Native) + TypeScript + NativeWind + Zustand. The
  finished-workout log lives in SQLite; the library, routines and settings are a
  few dozen rows and stay in AsyncStorage. No account, no server, no cloud build.
- **Design** — near-black glass, tabular numerals, and one fixed theme,
  Fintech Lime, that tints the buttons, lit cards and the light behind every
  section. Dark only; animations kept minimal so the app feels fast and calm.

```bash
npm ci                   # exactly the locked tree — see BUILD_ANDROID.md
npx expo start           # dev server
npm test                 # ~2200 tests: ladders, timers, cold starts, stores, backups, migration, AI edits
npm run typecheck
npm run lint             # also what CI runs, on every push
```

## What it does

| | |
| --- | --- |
| Four tabs | `Workout · Routines · History · Settings`. No tab bar during a session — a workout is not a tab |
| One big Start | the Home hero suggests the next routine (the sequence's turn, or the one after the last you trained) and carries one wide `▶ Start`; every other routine has a `▶ Start` of its own. Start opens the workout and begins the clock. Tapping the card or the name opens it WITHOUT starting — look first, leave, no trace. Only `Finish` writes to history |
| The clock, up top | one very big pill under the session header — an 84 pt countdown with its controls stacked underneath, readable from across the gym floor — shared by the rest countdown and the clock on a timed set. `−15`, `+15`, `⏸` and `Skip`; it names which rest it is running, and inverts to a green slab for the last ten seconds. The ± sets the rest for every set that follows, not just the one you are in |
| Count-in | the last N seconds of any countdown tick out loud and land on a long tone. Off screen it is a pair of scheduled notifications carrying the app's own WAVs, because a JS interval does not survive Doze |
| Timed sets | ▶ on the row: a get-ready count, then either a countdown that logs itself at the bell (a 2:00 plank, a boxing round) or an open hold you stop (a dead hang) |
| Boxing runs itself | a round exercise is the one thing here that advances without a thumb. ▶ buys a lead-in to get the gloves on — fifteen seconds, editable on the exercise — then the round runs, the bell logs it, the rest starts, and when the rest ends the next round starts on its own, all the way to the last one. Both clocks tick their final seconds out loud. ✕ stops the chain, and a hold is deliberately NOT one: a handstand ends when your shoulders say so, so it keeps its `DONE` |
| Focus mode | the session screen with everything but the work taken away, one swipe deep: the set you are about to do at 56 pt with a 176 dp `DONE` under your thumb, and — the moment you press it — a 120 pt rest countdown with the next exercise, weight and reps named underneath, so you already know what to walk to before the clock runs out. A new machine says so in words and names the one you are leaving. Timed sets keep all four of their phases in here, ± chips change the numbers without leaving, and the rest keeps running if you swipe back out |
| Rest is an editing screen | the minute before a set is when you decide the set is coming down 10 kg. Tap the `up next` block in focus mode while the clock runs and the same ± chips open under it, against the set the countdown is counting towards |
| Training sequence | optional, off by default. Build an order — push → pull → push — and the home screen names the next one up and advances when you finish it. Off means invisible |
| Copy a routine | `Duplicate this routine` in the editor, and the copy opens ready to change. The loop's own version of it: a sequence that trains `back` three times in twelve steps can give any one of those steps its own copy — `make it different` — so the second back day can hold different exercises from the first without the third moving |
| Routines | add, rename, reorder by long-press-and-slide, remove an exercise with the ✕ on its row, delete the routine |
| The plan is editable | tap a row in the routine editor and it opens in place: sets, the rep range, and how long to rest, all on ± chips. Rest names which of the two it is using — this exercise's own, or your Settings value — and can be put back to following Settings |
| One rest, and you can see whose it is | `Between sets` in Settings is the rest for every set of every exercise, and setting it puts every exercise back onto it. Give one movement a rest of its own in its editor — or on its routine row — and only that one leaves. Nothing ships with a rest of its own, and nothing creates one for you |
| Change the plan mid-set | `+ Add set` / `− Remove set` in every card, `Remove exercise` under them for the whole thing at once (it asks first if you have logged into it), `+ Add an exercise` at the bottom (library picker and create screen included). Long-press a card and slide to reorder: every card collapses while you drag, and the list scrolls itself at the edges |
| One warm-up, one tap | `+ Warm-up` on the first set inserts one set on top at about half the working weight, rounded to 2.5 kg, same reps. It reads `W`, counts towards nothing, and never moves the sets below it. Tap again to take it back |
| Edit the exercise from the card | `Edit exercise` in the open card opens the same editor the library does — its rest, its starting weight and count, how many sets it plans, its ladder, its clock. The change lands on the card you are looking at, so the very next rest is the one you just set, and on the library row, so it is still true next week |
| Today's weight is today's weight | four sets planned at 70 and a first set done at 60 does not mean three sets of 70 are still coming. A ✓ carries its weight down every set below it, and teaches the exercise where it now starts. Logged sets and the warm-up are never touched |
| …and it learns | on `Finish`, if you did five sets where the routine plans four, one extra tap writes that back. Declining changes nothing and it does not ask twice |
| Exercise library | a muscle tree — `push → chest → dips` — with search, create-from-query, edit in place (a rename keeps every set ever logged) and delete. An exercise carries its own set count, so a routine plans what the movement asks for, and one line of form — `elbows in, pause at the chest` — shown on the card while you do it |
| Calisthenics is its own group | a front lever is not back work, and filing it under `back` put it in a section that said nothing about it. `skill → calisthenics` is a real branch of the library tree, shipped with handstand, front lever, planche, L-sit and muscle-up — holds counted in seconds by a clock that runs UP, so the set is logged when you say it is |
| Rep ladder | `Find my max in the next workout`, and the whole session follows: set 1 is a max test and the rest rebuild from it. **Max 16 → `16 + 10 + 8 + 8 + 6`** — an all-out top set, backoff sets around half of it, and a total that is always three times your max. Meet every set and one rep is added, bottom set up; three met sessions and the max itself moves. Miss it and the same numbers come back. Hit 18 when the plan said 16 and every set under it re-shapes mid-workout to the ladder for 18 |
| Bests | the heaviest set, the most reps, and the best set by load × reps, on the exercise's own screen. Compared on the load your BODY moved, so `+20 kg` at 82 kg outranks `+20 kg` at 78. No medals, no banners |
| History | every finished workout, newest first, by month: date, duration, sets, volume, each exercise in the app's shorthand **and its total** — `+40 kg · 4 4 4` with `12 reps total` under it. Tapping a workout anywhere in the app opens that workout |
| The log is the log | it lives in SQLite, it is read before the first frame, and it survives the process being killed — `close all` included. If it ever cannot be READ, the app says so and states how many workouts are on disk rather than showing you an empty list, and it refuses to write a backup that would be missing them |
| Workout numbers | every workout carries an ordinal — `Workout 92`. Pin the number on any one session (`Set the workout number` inside it) and every other workout counts from there, backwards and forwards, so a log that starts at 91 because ninety happened before this app says so |
| Graphs | `History → Graphs`: reps per workout and kilograms per workout over time, or pick one exercise for its reps per session and top weight per session. Each line states its own direction — `up 34 reps since 11 Jun` — because the shape is visible but the arithmetic isn't |
| Calendar | `History → Cal`: which days you trained, a month at a time, gaps and all. A filled square is a day with a workout. It runs the way a wall calendar runs — this month at the bottom, older months above it, opening on today — so you climb up to read backwards. No streak, no flame, nothing to break |
| Sets per cluster | pull 42 · push 31 · legs 8, over 4 weeks, 12 weeks or all of it. Counts and bars, and a zero is the point. Type a weekly target for a cluster and the row reads `14 / 16` and measures against it — your number, not a textbook's |
| Bodyweight over time | a third line on the graphs, and the reason it is there: a bodyweight set is only readable against what you weighed the day you did it, so the log keeps a reading per day and every past session is priced with its own |
| A weigh-in reminder | the one notification that speaks first: Wednesday and Sunday at 06:00 by default, days and time editable. A tap opens the weigh-in screen — `Log`, `Remind me tomorrow` or `Skip` |
| One Settings page | `Workout`, `Timers & sound`, `Bodyweight`, `Data & backup`, `AI coach`, `Language` — one scroll, one heading each, nothing behind a fold |
| How did that go | one tap on the Finish sheet — easy, right, brutal — and it appears on the history row. One number for the session, never one per set |
| Numbers it will not fake | volume needs a bodyweight to weigh a push-up or an assisted pull-up. Without one the clause is dropped rather than printed short, and no bodyweight is ever guessed |
| Edit any workout in history | open it and everything about it is editable: correct one logged set on the same ± chips, add a set back, add or remove a whole exercise, rename it, move it to the right day and time, say how long it actually took. Moving a workout drags every set's date with it, because that date is what the suggestions and the charts read. Every number around the edit is recomputed from the rows rather than patched, and removing the last exercise is refused — that is `Delete this workout`, which asks first |
| Export / Import | everything you own — exercises, routines, the sequence, every workout with its set rows and your settings — as one readable JSON file, and back again through the phone's file browser. The pinned workout number travels with it, because it is the one fact that cannot be recomputed. **One export, one import, one reset**, all under `Data & backup`. A 3.x backup still imports; sections for features that are gone are ignored |
| Backups happen on their own | pick a folder once and the whole log is written into it every week, four copies deep, without being asked. Settings states the age of the last one — `Today`, `12 days ago`, `Never` — because a backup you have to remember is a backup you do not have |
| Русский, and English | a fresh install starts in English. `РУ` / `EN` under `Language` in Settings, two letters in their own script so the switch is legible to somebody who cannot read the screen it is on. Nothing is stored translated — the tabs, the muscle groups and the section names are identifiers in English underneath — so switching language mid-session moves nothing but the words |
| A die on the routine editor | tap it and a whole routine appears: five exercises dealt across the library, sets and rests filled in, named after what it actually drew — `Pull + Core`. Hold it to say which muscle groups, how many exercises and how many sets each. The names slide and reshuffle while it draws, and the frame it stops on IS the routine |
| An AI coach, if you want one | off until you paste your own Google AI key into `Settings → AI coach`, where it is tested in three named steps before it is kept — in the phone's keystore, never in a backup. It answers summaries and trends, and can propose almost any edit you could make by hand: exercises, routines, the sequence, settings, bodyweight, past workouts and their sets, and the open workout (warm-up and find-my-max included), plus the weigh-in reminder. Every proposal is a card you review — deletes in red — nothing is written until `Apply`, and one `Undo` takes it back. It never starts or finishes a workout, runs a timer, or exports, imports or resets. Your data is summarised on the phone and goes straight to Google — there is no server |
| Felt, not only seen | a tick under every button, a rising three-step when something reaches 100% — the last set of a session, a backup that landed |

## The rep ladder

```
max 16, five sets   16 + 10 + 8 + 8 + 6      48 reps  = 3 × max
...met                16 + 10 + 8 + 8 + 7      49
...met                16 + 10 + 9 + 8 + 7      50
...met                17 + 10 + 9 + 8 + 7      51      ← a new max
```

Switched on per exercise, on the create/edit screen, with `Find my max in the
next workout`: set 1 of the next session is an all-out test, and whatever it
proves becomes the max — a typed max is a guess, and every backoff would inherit
it. Pressing it again later is a retest. Everything else is arithmetic — the top set is all out, the backoffs sit
around half of it, and the five of them come to three times the max at every max
there is.

**It is the progression, not a table.** Meet every prescribed set and one rep is
added on `Finish`, to the lowest set that still needs it; after enough of those
the plan has arrived exactly at the next max's ladder and the top set moves —
which in practice is every five to eight workouts, because a session that comes
up short earns nothing and repeats. Nothing deloads on a miss: a program that
cuts your numbers because you slept badly is a program you stop trusting.

**It watches the top set.** The max is a guess until the bar says otherwise, so
logging the first set re-shapes every unlogged set under it — up when you beat the
plan, down when you don't. A set you edited by hand is yours and is left alone.

The scheme is the pull-up family this app's owner trained on for two years: Pavel
Tsatsouline's [Fighter Pull-Up
Program](https://www.strongfirst.com/the-fighter-pullup-program-revisited/) — one
all-out set, "then add a rep to the last set, then a rep to the set before that" —
the [Recon Ron](https://thechamplair.com/training/recon-ron-pullup-program/)
table, and the 50–60%-of-max backoff volume that
[grease-the-groove](https://www.strongfirst.com/how-to-increase-your-pull-ups-50-percent/)
prescribes. `src/lib/repLadder.ts` reproduces the reference table exactly — all 26
rows of it, in the test file, from arithmetic rather than from a lookup — so the
app runs the program rather than something that resembles it.

## Android APK

Android-only, sideloaded, from the **[Releases page](../../releases)** — a `v*`
tag builds and signs it in CI and attaches it there.
**[BUILD_ANDROID.md](BUILD_ANDROID.md)** covers installing it on a phone,
rebuilding locally, and — importantly — which key signs it and why an APK signed
with any other key cannot update the install.

```bash
npx expo prebuild -p android      # only when app.json or native deps changed
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

## Layout

```
App.tsx                     providers, the error boundary, notifications, audio,
                            and the one-time history migration
src/navigation/AppShell     four tabs and a stack; no tab bar during a session
src/screens/                one file per screen, all plain props-and-callbacks
src/components/             SetRow, ExerciseCard, TimerPill, primitives,
                            ErrorBoundary, ConfirmSheet…
src/hooks/                  the two timers, the count-in, the auto-backup and the
                            weigh-in reminder
src/lib/                    the decisions: rep ladder, set timer, count-in cue,
                            muscles, draft, routine plan, rest, balance, warm-up,
                            records, reorder, completed workout, bodyweight log,
                            weigh-in reminder, calendar, auto-backup, history,
                            trends, units, backup, section nav, up next, focus
                            plan, summary clamp — all pure, all tested. lib/ai/
                            is the coach: prompts, context, the proposal schema
                            and the edits it can make. Plus beeper/notify/
                            feedback, the wrappers around native side effects
                            that must never throw mid-set
src/state/                  the live session, the finished workouts, the library
                            (+ the sequence), the settings — zustand, every one
                            validated on the way in. restSync.ts is the one
                            policy that spans three of them: setting the global
                            rest, everywhere it has to land. historyDb.ts is the SQLite
                            schema and the migration off AsyncStorage; the other
                            three stores are a few dozen rows and stay there
src/data/seed.ts            the starting library and three routines. No history,
                            no sequence: both are only ever yours
test/fixtures/history.ts    a real training log, as a test fixture only
test/*Stub.ts               the three native modules the suite aliases away.
                            expoSqliteStub is the odd one out: a thin adapter
                            over Node's own `node:sqlite`, so the schema and the
                            migration are tested against a real engine
src/theme/tokens.ts         the values className can't reach
plugins/                    Expo config plugins (release signing, no microphone)
.github/workflows/          ci.yml on every push (test, typecheck, lint) and
                            release.yml on a `v*` tag (the signed APK)
```

Each file opens with a header explaining what it owns and why it is built the way
it is; those headers are the design document. Everything the user does persists:
finished workouts, a started session across a force-quit, and the library,
routines, sequence and settings across a relaunch. A fresh install starts with no
history and no sequence at all.
