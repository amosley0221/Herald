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
