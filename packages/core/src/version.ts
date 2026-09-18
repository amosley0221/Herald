/** Semantic-version helpers shared by CI, the in-app updater and the engine. */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseVersion(version: string): SemVer | null {
  const m = SEMVER_RE.exec(version.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? null,
  };
}

/** Negative when `a < b`, zero when equal, positive when `a > b`. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return a.localeCompare(b);
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;
  // A release outranks any prerelease of the same version.
  if (pa.prerelease === pb.prerelease) return 0;
  if (pa.prerelease === null) return 1;
  if (pb.prerelease === null) return -1;
  return pa.prerelease.localeCompare(pb.prerelease);
}

export function isNewer(candidate: string, installed: string): boolean {
  return compareVersions(candidate, installed) > 0;
}

/**
 * Android `versionCode` derived from the tag, monotonically increasing.
 *
 * `major * 1_000_000 + minor * 1_000 + patch` leaves room for 999 minors and
 * 999 patches per major, and stays far below Android's 2_100_000_000 ceiling.
 */
export function androidVersionCode(version: string): number {
  const parsed = parseVersion(version);
  if (!parsed) throw new Error(`Not a semantic version: ${version}`);
  const { major, minor, patch } = parsed;
  if (minor > 999 || patch > 999) {
    throw new Error(`minor/patch above 999 would break versionCode ordering: ${version}`);
  }
  return major * 1_000_000 + minor * 1_000 + patch;
}

/** True when an installed build is too old for the engine to keep serving. */
export function isSupported(installed: string, minSupported: string): boolean {
  return compareVersions(installed, minSupported) >= 0;
}

export function formatVersion(version: string): string {
  return version.startsWith('v') ? version.slice(1) : version;
}
