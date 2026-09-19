/**
 * Moved to @herald/core: the phone and the engine must agree on what counts as
 * the same posting, so there is one implementation rather than two. The hash is
 * a portable SHA-256 there, verified byte-identical to node:crypto.
 */
export {
  normalizeTitle, normalizeCompany, normalizeLocation,
  dedupeKey, contentHash, fingerprint, collapse,
} from '@herald/core';
