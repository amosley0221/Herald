### Fixed
- **Every screen failed with `NativeDatabase.prepareAsync has been rejected —
  java.lang.NullPointerException` on Android.** Opening the database cached the
  finished handle rather than the work in progress, so the three requests the
  first screen makes at once — matches, stats, preferences — each found no
  handle and each opened the file. Two connections to one SQLite file leave one
  holding a released native pointer, and it fails later and somewhere else,
  which is why the message named a statement rather than the open. Desktop
  already cached the promise and was never affected.
- The last character of a heading was clipped on Android — the Today screen
  read `TODA`. Android measures text with any letter spacing down a path that
  under-reports the final glyph, so the view clips its own last letter; every
  tracked style now reserves the room.
