#!/usr/bin/env bash
# ---------------------------------------------------------------------------
#  Build, verify and ship the release APK — CLAUDE.md's release steps 2–3 as
#  one command, for WSL.
#
#      tools/release-apk.sh "4.0.0: simpler app"   # check, commit code, build, verify, push
#      tools/release-apk.sh            # build, verify, commit the APK, push
#      tools/release-apk.sh --no-push  # build and verify only
#      PROBE='some new string' tools/release-apk.sh   # bundle check for THIS release
#
#  The version comes from app.json, so bump it first. Given a commit message,
#  the script runs the four checks, commits every change in the tree with that
#  message, then builds — so the one command takes a finished change to the
#  phone's APK and to main. Without one, the code must already be committed.
#  Every trap CLAUDE.md documents is handled here rather than rediscovered:
#  the Linux SDK path, the Windows merger.xml caches, the compressReleaseAssets
#  race (retried once), and the four checks on the BUILT file.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
PUSH=1
MSG=""
case "${1:-}" in
  --no-push) PUSH=0 ;;
  "") ;;
  *) MSG="$1" ;;
esac

VERSION="$(node -p "require('./app.json').expo.version")"
APK="momentum-workout-$VERSION.apk"
LOG="$ROOT/android-build.log"
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export ANDROID_HOME=/root/android-sdk ANDROID_SDK_ROOT=/root/android-sdk
export PATH="$ANDROID_HOME/build-tools/36.0.0:$PATH"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
die() { printf '\n\033[31mFAILED: %s\033[0m\n' "$*" >&2; exit 1; }

say "Workout $VERSION"

if [ -n "$MSG" ]; then
  # Run through node directly: the .bin shims in this shared tree fall through
  # to the Windows node.exe (CLAUDE.md, "Before committing").
  say "checks: tsc, vitest, eslint, prettier"
  node node_modules/typescript/bin/tsc --noEmit || die "tsc"
  node node_modules/vitest/vitest.mjs run >/dev/null || die "vitest (run it to see the failure)"
  node node_modules/eslint/bin/eslint.js src || die "eslint"
  node node_modules/prettier/bin/prettier.cjs --write src >/dev/null
  say "commit: $MSG"
  git add -A
  git diff --cached --quiet || git commit -q -m "$MSG"
fi

# A Windows-installed tree has no Linux lightningcss and fails six minutes in.
node -e "require('./metro.config.js'); process.exit(0)" \
  || die "metro.config.js does not load — see 'THE OTHER TRAP' in CLAUDE.md"

say "expo prebuild"
npx expo prebuild -p android --no-install >>"$LOG" 2>&1 || die "prebuild (see $LOG)"
grep -q 'android.minSdkVersion=26' android/gradle.properties \
  || die "minSdkVersion is not 26 after prebuild"
echo "sdk.dir=/root/android-sdk" > android/local.properties

# Merge records a Windows build left behind hold C:\ paths with no parent here.
for f in $(grep -l 'C:\\Users' node_modules/*/android/build/intermediates/incremental/release/*/merger.xml 2>/dev/null || true); do
  rm -rf "$(dirname "$f")"
done

say "gradle assembleRelease (about 10 minutes; log: $LOG)"
build() {
  (cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a \
    -PWT_STORE_FILE="$PWD/app/debug.keystore" -PWT_STORE_PASSWORD=android \
    -PWT_KEY_ALIAS=androiddebugkey -PWT_KEY_PASSWORD=android) >>"$LOG" 2>&1
}
if ! build; then
  # compressReleaseAssets races itself on this mount; the second pass is cached.
  echo "first pass failed — retrying once"
  build || die "gradle (see the end of $LOG)"
fi

cp android/app/build/outputs/apk/release/app-release.apk "$APK"

say "verifying $APK"
# Each tool's output is captured whole, then searched. Piped straight into
# `head` or `grep -q`, the tool is killed by SIGPIPE when the reader stops early,
# and under `pipefail` that fails the check on a perfectly good APK.
CERTS="$(apksigner verify --print-certs "$APK")"
BADGING="$(aapt2 dump badging "$APK")"
# PROBE: an ASCII string this release's JS introduced (see CLAUDE.md on Hermes).
BUNDLE_HITS="$(unzip -p "$APK" assets/index.android.bundle | grep -ac "${PROBE:-cancel-pending}" || true)"
grep -q "package: name='com.semyonsw.workouttracker'" <<<"$BADGING" \
  || die "wrong package — it would install beside the phone's app, not over it"
grep -q 'CN=Android Debug' <<<"$CERTS" \
  || die "signed with the wrong key — it would not install over the phone's app"
grep -q "versionName='$VERSION'" <<<"$BADGING" \
  || die "versionName in the APK is not $VERSION"
if grep -q 'RECORD_AUDIO' <<<"$BADGING"; then
  die "the APK asks for the microphone"
fi
[ "${BUNDLE_HITS:-0}" -gt 0 ] || die "the bundle does not contain this release's JS"
head -1 <<<"$BADGING"
echo "signature, version, permissions and bundle: OK"

# Old APKs stay: each is a rollback, and removing one is the owner's call.

if [ "$PUSH" = 1 ]; then
  say "commit and push"
  git add -f "$APK"
  git commit -q -m "$VERSION: release APK"
  git push -q origin main
fi

say "done: $ROOT/$APK"
