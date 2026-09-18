import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import {
  HeraldClient, HeraldError, motion, strings,
  type Match, type MatchStatus, type PreparedApplication, type Preferences,
  type Profile, type ReleaseIndex, type ResumeUpload, type TodayStats,
} from '@herald/core';
import { appConfig } from '../lib/config';
import { syncPushToken } from '../lib/notifications';
import {
  clearCredentials, isOnboarded, loadCredentials, saveCredentials, setOnboarded,
  type EngineCredentials,
} from '../lib/storage';

/**
 * The app's single source of state.
 *
 * Herald is a thin client over one engine, so a context with explicit refresh
 * beats a query library here: there is one server, one user, and a handful of
 * collections. Mutations update local state optimistically and roll back with a
 * danger-tone toast if the engine disagrees, which is what the design asks for.
 */

type Phase = 'loading' | 'unpaired' | 'onboarding' | 'ready';

interface ToastState {
  message: string;
  tone: 'default' | 'danger';
}

interface HeraldState {
  phase: Phase;
  client: HeraldClient | null;
  credentials: EngineCredentials | null;

  profile: Profile | null;
  preferences: Preferences | null;
  matches: Match[];
  stats: TodayStats | null;
  releases: ReleaseIndex | null;

  refreshing: boolean;
  error: string | null;
  toast: ToastState | null;

  connect: (credentials: EngineCredentials) => Promise<void>;
  disconnect: () => Promise<void>;
  completeOnboarding: () => Promise<void>;

  refresh: () => Promise<void>;
  uploadResume: (file: ResumeUpload) => Promise<string[]>;
  updateProfile: (patch: Partial<Profile>) => Promise<void>;
  updatePreferences: (patch: Partial<Preferences>) => Promise<void>;

  approve: (matchId: string) => Promise<PreparedApplication>;
  submit: (matchId: string, fields?: Record<string, string>, coverLetter?: string) => Promise<void>;
  skip: (matchId: string) => Promise<void>;

  showToast: (message: string, tone?: 'default' | 'danger') => void;
  matchById: (id: string) => Match | undefined;
}

const HeraldContext = createContext<HeraldState | null>(null);

export function HeraldProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [credentials, setCredentials] = useState<EngineCredentials | null>(null);
  const [client, setClient] = useState<HeraldClient | null>(null);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [stats, setStats] = useState<TodayStats | null>(null);
  const [releases, setReleases] = useState<ReleaseIndex | null>(null);

  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, tone: 'default' | 'danger' = 'default') => {
    setToast({ message, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), motion.toastDuration);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  // ── Bootstrap ────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await loadCredentials();
      if (cancelled) return;
      if (!stored) {
        setPhase('unpaired');
        return;
      }
      setCredentials(stored);
      setClient(new HeraldClient({ baseUrl: stored.baseUrl, token: stored.token }));
      setPhase((await isOnboarded()) ? 'ready' : 'onboarding');
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Loading ──────────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    if (!client) return;
    setRefreshing(true);
    try {
      // Fetched together so a slow release feed cannot delay the match list.
      const [matchList, todayStats, preferenceState] = await Promise.all([
        client.listMatches({ limit: 200 }),
        client.todayStats(),
        client.getPreferences(),
      ]);
      setMatches(matchList);
      setStats(todayStats);
      setPreferences(preferenceState);
      setError(null);

      // These two are allowed to fail quietly: a profile 404 is the expected
      // state before a resume is uploaded, and the release feed is optional.
      void client.getProfile().then(setProfile).catch(() => undefined);
      void client.releases().then(setReleases).catch(() => undefined);
    } catch (cause) {
      setError(cause instanceof HeraldError && cause.code === 'network'
        ? strings.errors.offline
        : cause instanceof Error ? cause.message : strings.errors.generic);
    } finally {
      setRefreshing(false);
    }
  }, [client]);

  useEffect(() => {
    if (!client) return;
    void refresh();
    // Registering the push token is best-effort; a device that declined
    // notifications still uses the app normally.
    void syncPushToken(client).catch(() => undefined);
  }, [client, refresh]);

  // Refresh when the app comes back to the foreground, so a match approved
  // from a notification is not shown as still pending.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  // ── Pairing ──────────────────────────────────────────────────────────────

  const connect = useCallback(async (next: EngineCredentials) => {
    const candidate = new HeraldClient({ baseUrl: next.baseUrl, token: next.token });
    // Prove the engine is reachable and the token works before storing either.
    await candidate.health();
    await candidate.getPreferences();
    await saveCredentials(next);
    setCredentials(next);
    setClient(candidate);
    setPhase((await isOnboarded()) ? 'ready' : 'onboarding');
  }, []);

  const disconnect = useCallback(async () => {
    await clearCredentials();
    setCredentials(null);
    setClient(null);
    setProfile(null);
    setPreferences(null);
    setMatches([]);
    setStats(null);
    setPhase('unpaired');
  }, []);

  const completeOnboarding = useCallback(async () => {
    await setOnboarded(true);
    setPhase('ready');
  }, []);

  // ── Mutations ────────────────────────────────────────────────────────────

  const uploadResume = useCallback(async (file: ResumeUpload): Promise<string[]> => {
    if (!client) throw new Error(strings.errors.offline);
    const result = await client.uploadResume(file);
    setProfile(result.profile);
    return result.warnings;
  }, [client]);

  const updateProfile = useCallback(async (patch: Partial<Profile>) => {
    if (!client) return;
    const updated = await client.updateProfile(patch);
    setProfile(updated);
  }, [client]);

  const updatePreferences = useCallback(async (patch: Partial<Preferences>) => {
    if (!client || !preferences) return;
    const previous = preferences;
    // Optimistic: the threshold slider re-splits the feed as it moves, and
    // waiting for a round trip per tick would make it feel broken.
    setPreferences({ ...previous, ...patch });
    try {
      setPreferences(await client.updatePreferences(patch));
    } catch (cause) {
      setPreferences(previous);
      showToast(cause instanceof Error ? cause.message : strings.errors.generic, 'danger');
    }
  }, [client, preferences, showToast]);

  const setStatusLocally = useCallback((matchId: string, status: MatchStatus) => {
    setMatches((current) => current.map((match) =>
      match.id === matchId ? { ...match, status } : match));
  }, []);

  const approve = useCallback(async (matchId: string): Promise<PreparedApplication> => {
    if (!client) throw new Error(strings.errors.offline);
    const previous = matches.find((m) => m.id === matchId)?.status ?? 'pending';
    setStatusLocally(matchId, 'approved');
    try {
      return await client.approve(matchId);
    } catch (cause) {
      setStatusLocally(matchId, previous);
      throw cause;
    }
  }, [client, matches, setStatusLocally]);

  const submit = useCallback(async (
    matchId: string, fields?: Record<string, string>, coverLetter?: string,
  ) => {
    if (!client) throw new Error(strings.errors.offline);
    const match = matches.find((m) => m.id === matchId);
    const company = match?.posting.company ?? '';
    const previous = match?.status ?? 'approved';

    setStatusLocally(matchId, 'applied');
    try {
      const updated = await client.submit(matchId, fields, coverLetter);
      setMatches((current) => current.map((m) => (m.id === matchId ? updated : m)));
      // The engine reports `needs_you` when it hit a CAPTCHA or login wall, so
      // a 200 does not always mean the application went in.
      if (updated.status === 'needs_you') {
        showToast(updated.blockedReason ?? strings.notification.needsYou, 'danger');
      } else {
        showToast(strings.toast.submitted(company));
      }
      void refresh();
    } catch (cause) {
      setStatusLocally(matchId, previous);
      showToast(
        cause instanceof HeraldError && cause.code === 'cap_reached'
          ? cause.message
          : strings.toast.failed(company),
        'danger',
      );
      throw cause;
    }
  }, [client, matches, refresh, setStatusLocally, showToast]);

  const skip = useCallback(async (matchId: string) => {
    if (!client) throw new Error(strings.errors.offline);
    const match = matches.find((m) => m.id === matchId);
    const previous = match?.status ?? 'pending';
    setStatusLocally(matchId, 'skipped');
    showToast(strings.toast.skipped(match?.posting.company ?? ''));
    try {
      const updated = await client.skip(matchId);
      setMatches((current) => current.map((m) => (m.id === matchId ? updated : m)));
    } catch (cause) {
      setStatusLocally(matchId, previous);
      showToast(strings.errors.generic, 'danger');
    }
  }, [client, matches, setStatusLocally, showToast]);

  const matchById = useCallback(
    (id: string) => matches.find((match) => match.id === id),
    [matches],
  );

  const value = useMemo<HeraldState>(() => ({
    phase, client, credentials,
    profile, preferences, matches, stats, releases,
    refreshing, error, toast,
    connect, disconnect, completeOnboarding,
    refresh, uploadResume, updateProfile, updatePreferences,
    approve, submit, skip,
    showToast, matchById,
  }), [
    phase, client, credentials, profile, preferences, matches, stats, releases,
    refreshing, error, toast, connect, disconnect, completeOnboarding, refresh,
    uploadResume, updateProfile, updatePreferences, approve, submit, skip,
    showToast, matchById,
  ]);

  return <HeraldContext.Provider value={value}>{children}</HeraldContext.Provider>;
}

export function useHerald(): HeraldState {
  const context = useContext(HeraldContext);
  if (!context) throw new Error('useHerald must be used inside a HeraldProvider');
  return context;
}

/**
 * The feed split the design is built around: everything at or above the
 * threshold is an Approve-now row, the rest waits for the digest.
 */
export function useFeed(): { instant: Match[]; digest: Match[]; pending: Match[]; threshold: number } {
  const { matches, preferences } = useHerald();
  const threshold = preferences?.threshold ?? 85;
  return useMemo(() => {
    const pending = matches.filter((match) => match.status === 'pending');
    return {
      pending,
      instant: pending.filter((match) => match.score >= threshold),
      digest: pending.filter((match) => match.score < threshold),
      threshold,
    };
  }, [matches, threshold]);
}

/** Everything the user has decided on — what the Tracker lists. */
export function useTracker(): Match[] {
  const { matches } = useHerald();
  return useMemo(
    () => matches
      .filter((match) => match.status !== 'pending')
      .sort((a, b) => (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt)),
    [matches],
  );
}

export { appConfig };
