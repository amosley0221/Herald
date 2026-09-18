# Changelog

All notable changes to Herald are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Every release's section is published verbatim as the GitHub Release body, as
`releases/<version>.json`, and on the in-app **What's new** screen. A pull
request that changes `apps/**` or `packages/core/**` without adding a line here
is rejected by CI.

## [Unreleased]

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
