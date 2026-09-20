# Changelog

All notable changes to Herald are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Every release's section is published verbatim as the GitHub Release body, as
`releases/<version>.json`, and on the in-app **What's new** screen. A pull
request that changes `apps/**` or `packages/core/**` without adding a line here
is rejected by CI.

## [Unreleased]

## [0.2.2] — 2026-09-20

### Fixed
- Every request to the model was rejected with `400 \`temperature\` is
  deprecated for this model`. Current models refuse sampling parameters
  outright, and the model is configurable, so `temperature` is no longer sent
  at all — it would have worked only on older ones. This affected the hosted
  engine exactly as much as the apps.
- Drafting a cover letter threw before it reached the model: the prompt asks
  for the profile, the top reason the posting matched and a word limit, and
  none of the three were being supplied. Approving a match would have failed
  for everyone running without an engine.

## [0.2.1] — 2026-09-20

### Fixed
- Uploading a `.docx` resume failed with `400 invalid_request_error: The
  request body is not valid JSON: invalid high surrogate in string`. A `.docx`
  is a ZIP archive, and Herald was decoding anything that was not a PDF as
  UTF-8 text — which turns those bytes into lone surrogates that cannot be put
  in a JSON body at all, so the request was rejected before the model ever saw
  the resume. Herald now reads the text out of the archive, including headers
  and footers, where a resume often keeps its contact details. A file that
  still cannot be read as text says so instead of failing as a puzzle, and an
  old-format `.doc` is named as such rather than being attempted.

## [0.2.0] — 2026-09-19

### Changed
- The ingest and matching pipeline — the source adapters, dedupe, prefilter and
  the posting hashes — moved from the engine into `@herald/core`, which is
  plain TypeScript that runs in React Native. The engine's own modules are now
  re-exports, so there is one implementation of what counts as a duplicate and
  what survives the prefilter rather than two that drift. Groundwork for
  running Herald on the phone alone, with no engine to host.

### Added
- The desktop app works on its own, and can share what it has with a phone.
  It runs the same engine, with SQLite through Tauri and outbound HTTP through
  the native stack — a webview cannot read a job board itself, since no ATS
  sends CORS headers. Sharing is a small server in Rust that forwards each
  request to the webview, which answers with the same backend the desktop
  window uses, so a paired phone sees a Herald engine and there is still one
  implementation of what a match is. Replicating between two databases would
  instead have meant deciding what happens when both devices approve the same
  match offline.
- The scan runs on the phone. Ingest, dedupe, prefilter, score and store, with
  no engine behind it: the same pipeline code, the same prompts and the same
  posting hashes, so a match found on the phone means what a match found on the
  engine means. Sources, models and the score floor are all editable in the app,
  so watching a new company needs no new build.
- Prompt templates are embedded in `@herald/core`. The engine still prefers a
  file under `config/prompts/`, so wording remains tunable without a rebuild,
  and falls back to the embedded copy — which is what the phone runs, verified
  byte-identical to the files.
- `base64ToUtf8` and `parseModelJson` in `@herald/core`. React Native has no
  `Buffer` and its `atob` is Latin-1 only, so a resume with an accent in it
  decoded to mojibake.
- A portable SHA-256 in `@herald/core`. `node:crypto` does not exist in React
  Native and `expo-crypto`'s digest is asynchronous, which would make
  `dedupeKey` async and infect every caller. Pinned by tests to `node:crypto`
  across the message-padding boundaries and multi-byte input, so a posting
  hashes the same on a phone as on a server.

### Fixed
- The APK failed to sign, after a full eleven-minute build, with
  `BadPaddingException` — which names neither the secret at fault nor the fact
  that signing was what failed. `keytool` has written PKCS12 keystores since
  JDK 9, and the key inside one is encrypted with the store password, so the
  separate `ANDROID_KEY_PASSWORD` the README asked for does not exist and
  cannot unlock it. The release workflow now verifies the signing credentials
  in a second, before compiling anything, says which secret is wrong when one
  is, and uses the store password when that is what opens the key. The README
  no longer asks for a password `keytool` does not create.
- The Android build failed `CheckAarMetadata`: a dependency in the Expo SDK
  requires compiling against API 36, and the app pinned `compileSdkVersion` to
  35. The pin is removed rather than raised — Expo's own default is consistent
  with the dependencies it ships, so pinning a number here can only ever drift
  out of step with them again.
- The Android release build ran out of Metaspace. Metaspace is allocated
  outside the heap, so Expo's default `-Xmx2048m -XX:MaxMetaspaceSize=512m`
  capped class metadata at 512m however much heap was free — and the New
  Architecture's codegen and Kotlin compilation need far more. The build now
  gets 2g of Metaspace and 4g of heap.
- An Android build that failed kept its job alive until the timeout. Gradle
  forks worker and Kotlin daemon JVMs that inherit its stdout and outlive it,
  and a CI step ends when its stdout pipe closes rather than when its main
  process exits — so a build that had already failed in nine minutes held the
  job open for another eighty. It read from outside as a hang, and cost this
  release three runs and several hours. Gradle now writes to a file that is
  streamed separately, so the step ends when the build does and reports its
  real exit status.
- The macOS build failed at code signing on a repository with no Apple
  certificate. An unset secret becomes the empty string, but the environment
  variable is still defined, and Tauri decides to codesign on the variable
  being present rather than on it holding a certificate — so it tried to
  import an empty one and failed after the app had already been built. macOS
  now builds unsigned unless a certificate is actually configured. An unsigned
  build installs after a right-click → Open; it cannot self-update, because
  Gatekeeper blocks an unnotarized update.
- The desktop installers for Windows and macOS could not be built. Neither
  platform can take a bare list of PNGs — Windows needs an `.ico` for its
  resource file, and macOS maps each PNG onto a named icon type, which the
  1024px source has none of. Both containers are now generated from the same
  emblem as every other icon, so all three platforms build from one mark.
- The Android SDK licence step failed after accepting every licence. `yes` is
  killed by SIGPIPE the moment `sdkmanager` exits, and `pipefail` counted that
  as the step failing.
- The Android release build was given 45 minutes, which was not enough to
  distinguish a wedged build from a slow one — this project compiles the New
  Architecture's generated C++ from cold on its first release. It now gets 90
  minutes, reports a timestamped heartbeat every five, and always ends its log
  with Gradle's own most recent output rather than a thread dump.
- The Android release build could hang indefinitely. Gradle inherited the
  runner's stdin, so anything prompting for input waited forever, and a job's
  logs cannot be read until it ends — making the hang invisible for the six
  hours until the default timeout. The build now gets no stdin, the job times
  out at 45 minutes, and the SDK licence step reports what is installed instead
  of discarding its own errors.

### Changed
- The Android release build targets `arm64-v8a` only, and Gradle's caches now
  persist between runs. The default builds all four ABIs, so three quarters of
  the native compilation was for architectures no real device uses.

### Fixed
- The desktop release job ran a bare `npm ci`, which installs every workspace —
  including the engine, whose `better-sqlite3` has to be compiled from source on
  Windows and fails there. Each job now installs only the workspaces it needs.

### Fixed
- The release workflow used `android-actions/setup-android`, which installs the
  `tools` SDK package that Google has removed — sdkmanager exits 1 on it and
  failed the Android job outright. The runner already ships the SDK, so the
  step now just accepts licences.
- Cutting a release is idempotent. A run whose later jobs failed left the
  CHANGELOG already cut, so re-running refused with "the Unreleased section is
  empty". An already-cut version now reuses its notes and original date instead.

## [0.1.0] — 2026-09-18

### Added
- Shared `@herald/core` package: domain contracts, the match status machine,
  Crowned Pixel design tokens, formatting helpers, all UI copy, and the typed
  API client both apps use.
- Engine service: hourly ingest → dedupe → prefilter → score → route pipeline
  over config-defined sources, with a SQLite store and a scoring cache.
- Source adapters for Greenhouse, Lever, Ashby and Workday, plus a `json`
  adapter that maps any JSON endpoint through config and a `command` adapter
  that reads an external aggregator CLI. New boards need no code.
- Approve prepares an application by reading the target form and filling it
  from the profile; submit drives it with Playwright and stores a screenshot of
  the confirmation. Demographic and salary-expectation questions are never
  answered automatically.
- Guardrails: nothing is submitted without an explicit Submit tap, a
  configurable daily submission cap, and a manual-only host list that routes
  LinkedIn applications to the user rather than automating them.
- Push notifications over FCM: instant pushes above the threshold, a morning
  digest at the user's local hour, and a "finish this one yourself" push when a
  submission hits a CAPTCHA or login wall.
- Resume parsing for PDF, DOCX and TXT, with contact details extracted
  deterministically so they are never hallucinated.
- Optional Gmail reply tracking that moves applications to interview/rejected.
- Docker image and compose file for deploying the engine.
- Android app (Expo): all eight screens from the handoff — onboarding, Today,
  Matches, match detail, Review before submitting, Tracker, Preferences and
  What's new — built on the Crowned Pixel tokens with Cinzel and Jost bundled.
- Android notifications with Approve / View / Skip actions, deep-linking
  straight into the Review screen, plus the morning digest and needs-you pushes.
- Android updates without reinstalling: `expo-updates` applies JavaScript
  changes silently on next launch, and a release-feed banner downloads and
  installs a new APK when a native change ships.
- Pairing by QR code from the desktop app, with the engine token held in the
  Android keystore.
- Desktop app (Tauri): the three-pane inbox from the handoff — sidebar, list and
  detail — with Today, Matches, Tracker, Preferences and What's new, plus the
  Review layout in the detail pane and a QR pairing code for the phone.
- Desktop updates without reinstalling: Tauri's signature-checked updater reads
  a manifest published by CI and swaps the build in on relaunch.
- Release pipeline: CI cuts `## [Unreleased]` into a dated section on a tag,
  publishes `releases/index.json`, the updater manifest and a public
  release-notes page, and refuses a pull request that changes user-facing code
  without release notes.
- README covering setup, the daily pipeline, the guardrails, both update
  mechanisms and every configuration surface.

### Changed
- The Android APK is now built with Gradle on the CI runner instead of EAS, so
  releasing one needs no Expo account. Over-the-air updates remain an optional
  layer that is skipped when `EXPO_TOKEN` is not set.
- Release builds are signed from a keystore held in repository secrets, so each
  build installs over the last instead of being rejected for a signature
  mismatch.
- `RECORD_AUDIO` and `SYSTEM_ALERT_WINDOW`, pulled in by libraries, are stripped
  from the manifest. Herald only reads a QR code and has no business asking to
  record audio.

### Fixed
- The release workflow assumed a branch named `main`, which would have failed
  the first release on a repository whose default branch is named anything else
  or does not exist yet. It now uses the repository's own default branch.
- `expo-build-properties` was declared as a plugin but never installed, which
  would have failed `expo prebuild` on the first release build.
- `expo-system-ui` was missing, so the dark `userInterfaceStyle` was ignored.
- The release workflow keyed off the repository's default branch, which is still
  a working branch here — a release would have landed there instead of on the
  trunk. It now targets `main`, overridable with a `RELEASE_BRANCH` variable.
- `services/engine/dist-test/` (compiled test output) was committed, because
  `.gitignore` listed only `dist/`.
