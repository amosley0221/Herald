/**
 * Runs an async initialiser at most once, however many callers race for it.
 *
 * The naive version of this caches the *result*:
 *
 *   let handle = null;
 *   async function open() {
 *     if (handle) return handle;
 *     handle = await openDatabase();   // every concurrent caller gets here
 *     return handle;
 *   }
 *
 * which is correct only if no two callers ever overlap. The moment two do --
 * and a screen that loads matches, stats and preferences with Promise.all
 * guarantees it -- each one sees an unset handle and starts its own open. The
 * caching then hides the damage rather than preventing it: the last write wins,
 * the other connections leak, and on Android two opens of one SQLite file end
 * as `NativeDatabase.prepareAsync ... NullPointerException` from whichever
 * handle lost.
 *
 * Caching the promise instead closes the window, because the promise exists
 * before the work finishes. A failure clears the cache so the next caller can
 * try again -- a permanently poisoned singleton is worse than a retry.
 */
export function once<T>(create: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    pending ??= create().catch((cause) => {
      pending = null;
      throw cause;
    });
    return pending;
  };
}
