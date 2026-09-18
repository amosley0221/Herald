import type { BadgeTone, MatchStatus } from './types.js';

/**
 * Allowed status transitions. Anything not listed here is rejected by the
 * engine, so a stale client cannot drive a match into an impossible state.
 */
const TRANSITIONS: Record<MatchStatus, readonly MatchStatus[]> = {
  pending: ['approved', 'skipped'],
  approved: ['applied', 'skipped', 'needs_you'],
  applied: ['interview', 'rejected'],
  needs_you: ['applied', 'skipped'],
  interview: ['rejected'],
  rejected: [],
  skipped: ['pending'],
};

export function canTransition(from: MatchStatus, to: MatchStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextStatuses(from: MatchStatus): readonly MatchStatus[] {
  return TRANSITIONS[from];
}

/** A match the user has not decided on yet. */
export function isPending(status: MatchStatus): boolean {
  return status === 'pending';
}

/** A match that has left the queue — Tracker shows exactly these. */
export function isDecided(status: MatchStatus): boolean {
  return status !== 'pending';
}

/** Counts toward the "Applied" stat and the daily submission cap. */
export function isSubmitted(status: MatchStatus): boolean {
  return status === 'applied' || status === 'interview' || status === 'rejected';
}

export const STATUS_LABELS: Record<MatchStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  applied: 'Applied',
  interview: 'Interview',
  rejected: 'Rejected',
  skipped: 'Skipped',
  needs_you: 'Needs you',
};

export const STATUS_TONES: Record<MatchStatus, BadgeTone> = {
  pending: 'muted',
  approved: 'gold',
  applied: 'solid',
  interview: 'success',
  rejected: 'danger',
  skipped: 'muted',
  needs_you: 'danger',
};

export function statusLabel(status: MatchStatus): string {
  return STATUS_LABELS[status];
}

export function statusTone(status: MatchStatus): BadgeTone {
  return STATUS_TONES[status];
}

/**
 * Routing rule from the spec: at or above the threshold a match pushes
 * immediately; everything else waits for the digest.
 */
export function routesInstantly(score: number, threshold: number): boolean {
  return score >= threshold;
}
