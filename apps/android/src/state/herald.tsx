import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import {
  HeraldClient, HeraldError, motion, strings,
  type HeraldBackend, type Match, type MatchStatus, type PreparedApplication,
  type Preferences, type Profile, type ReleaseIndex, type ResumeUpload, type TodayStats,
} from '@herald/core';
import { LocalBackend } from '../engine/local-backend';
import { getApiKey, setApiKey } from '../engine/settings';
import { appConfig } from '../lib/config';
import { syncPushToken } from '../lib/notifications';
import {
  clearCredentials, isOnboarded, loadCredentials, saveCredentials, setOnboarded,
  type EngineCredentials,
} from '../lib/storage';

/**
 * The app's single source of state.
 *
 * There is one user and a handful of collections, so a context with explicit
 * refresh beats a query library. Mutations update local state optimistically
 * and roll back with a danger-tone toast if the backend disagrees, which is
 * what the design asks for.
 *
 * The backend is either the device itself or a hosted engine, and nothing in
 * here or in any screen depends on which: both satisfy HeraldBackend. Standalone
 * is the default; pairing is for anyone who would rather their phone sat idle
 * while something always-on did the scanning.
 */

type Phase = 'loading' | 'setup' | 'onboarding' | 'ready';

/** Where the work happens. `local` is this device; `paired` is a hosted engine. */
export type BackendMode = 'local' | 'paired';

interface ToastState {
  message: string;
  tone: 'default' | 'danger';
}

interface HeraldState {
  phase: Phase;
  mode: BackendMode;
  backend: HeraldBackend | null;
  credentials: EngineCredentials | null;

  profile: Profile | null;
  preferences: Preferences | null;
  matches: Match[];
  stats: TodayStats | null;
  releases: ReleaseIndex | null;

  refreshing: boolean;
  error: string | null;
  toast: ToastState | null;

  /** Pair with a hosted engine, which takes over from the device. */
  connect: (credentials: EngineCredentials) => Promise<void>;
  /** Run on this device, with the given Anthropic key. */
  useThisDevice: (apiKey: string) => Promise<void>;
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
  const [mode, setMode] = useState<BackendMode>('local');
  const [backend, setBackend] = useState<HeraldBackend | null>(null);

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
      // A stored pairing wins: it was chosen deliberately, and the engine holds
      // the data. Otherwise the device does the work itself, which needs an API
      // key — and with neither, there is nothing to do but ask for one.
      const stored = await loadCredentials();
      if (cancelled) return;

      if (stored) {
        setCredentials(stored);
        setMode('paired');
        setBackend(new HeraldClient({ baseUrl: stored.baseUrl, token: stored.token }));
        setPhase((await isOnboarded()) ? 'ready' : 'onboarding');
        return;
      }

      const apiKey = await getApiKey();
      if (cancelled) return;
      if (!apiKey) {
        setPhase('setup');
        return;
      }
      setMode('local');
      setBackend(new LocalBackend());
      setPhase((await isOnboarded()) ? 'ready' : 'onboarding');
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Loading ──────────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    if (!backend) return;
    setRefreshing(true);
    try {
      // Fetched together so a slow release feed cannot delay the match list.
      const [matchList, todayStats, preferenceState] = await Promise.all([
        backend.listMatches({ limit: 200 }),
        backend.todayStats(),
        backend.getPreferences(),
      ]);
      setMatches(matchList);
      setStats(todayStats);
      setPreferences(preferenceState);
      setError(null);

      // These two are allowed to fail quietly: a profile 404 is the expected
      // state before a resume is uploaded, and the release feed is optional.
      void backend.getProfile().then(setProfile).catch(() => undefined);
      void backend.releases().then(setReleases).catch(() => undefined);
    } catch (cause) {
      setError(cause instanceof HeraldError && cause.code === 'network'
        ? strings.errors.offline
        : cause instanceof Error ? cause.message : strings.errors.generic);
    } finally {
      setRefreshing(false);
    }
  }, [backend]);

  useEffect(() => {
    if (!backend) return;
    void refresh();
    // Only a hosted engine can push to this device; running locally, the scan
    // raises its own notification and has no token to register. Best-effort
    // either way: a device that declined notifications still works normally.
    if (backend instanceof HeraldClient) {
      void syncPushToken(backend).catch(() => undefined);
    }
  }, [backend, refresh]);

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
    setMode('paired');
    setBackend(candidate);
    setPhase((await isOnboarded()) ? 'ready' : 'onboarding');
  }, []);

  const useThisDevice = useCallback(async (apiKey: string) => {
    await setApiKey(apiKey);
    setCredentials(null);
    setMode('local');
    setBackend(new LocalBackend());
    setPhase((await isOnboarded()) ? 'ready' : 'onboarding');
  }, []);

  const disconnect = useCallback(async () => {
    await clearCredentials();
    setCredentials(null);
    setProfile(null);
    setPreferences(null);
    setMatches([]);
    setStats(null);

    // Unpairing falls back to this device rather than stranding the user, as
    // long as there is a key to work with.
    const apiKey = await getApiKey();
    if (apiKey) {
      setMode('local');
      setBackend(new LocalBackend());
      setPhase('ready');
      return;
    }
    setMode('local');
    setBackend(null);
    setPhase('setup');
  }, []);

  const completeOnboarding = useCallback(async () => {
    await setOnboarded(true);
    setPhase('ready');
  }, []);

  // ── Mutations ────────────────────────────────────────────────────────────

  const uploadResume = useCallback(async (file: ResumeUpload): Promise<string[]> => {
    if (!backend) throw new Error(strings.errors.offline);
    const result = await backend.uploadResume(file);
    setProfile(result.profile);
    return result.warnings;
  }, [backend]);

  const updateProfile = useCallback(async (patch: Partial<Profile>) => {
    if (!backend) return;
    const updated = await backend.updateProfile(patch);
    setProfile(updated);
  }, [backend]);

  const updatePreferences = useCallback(async (patch: Partial<Preferences>) => {
    if (!backend || !preferences) return;
    const previous = preferences;
    // Optimistic: the threshold slider re-splits the feed as it moves, and
    // waiting for a round trip per tick would make it feel broken.
    setPreferences({ ...previous, ...patch });
    try {
      setPreferences(await backend.updatePreferences(patch));
    } catch (cause) {
      setPreferences(previous);
      showToast(cause instanceof Error ? cause.message : strings.errors.generic, 'danger');
    }
  }, [backend, preferences, showToast]);

  const setStatusLocally = useCallback((matchId: string, status: MatchStatus) => {
    setMatches((current) => current.map((match) =>
      match.id === matchId ? { ...match, status } : match));
  }, []);

  const approve = useCallback(async (matchId: string): Promise<PreparedApplication> => {
    if (!backend) throw new Error(strings.errors.offline);
    const previous = matches.find((m) => m.id === matchId)?.status ?? 'pending';
    setStatusLocally(matchId, 'approved');
    try {
      return await backend.approve(matchId);
    } catch (cause) {
      setStatusLocally(matchId, previous);
      throw cause;
    }
  }, [backend, matches, setStatusLocally]);

  const submit = useCallback(async (
    matchId: string, fields?: Record<string, string>, coverLetter?: string,
  ) => {
    if (!backend) throw new Error(strings.errors.offline);
    const match = matches.find((m) => m.id === matchId);
    const company = match?.posting.company ?? '';
    const previous = match?.status ?? 'approved';

    setStatusLocally(matchId, 'applied');
    try {
      const updated = await backend.submit(matchId, fields, coverLetter);
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
  }, [backend, matches, refresh, setStatusLocally, showToast]);

  const skip = useCallback(async (matchId: string) => {
    if (!backend) throw new Error(strings.errors.offline);
    const match = matches.find((m) => m.id === matchId);
    const previous = match?.status ?? 'pending';
    setStatusLocally(matchId, 'skipped');
    showToast(strings.toast.skipped(match?.posting.company ?? ''));
    try {
      const updated = await backend.skip(matchId);
      setMatches((current) => current.map((m) => (m.id === matchId ? updated : m)));
    } catch (cause) {
      setStatusLocally(matchId, previous);
      showToast(strings.errors.generic, 'danger');
    }
  }, [backend, matches, setStatusLocally, showToast]);

  const matchById = useCallback(
    (id: string) => matches.find((match) => match.id === id),
    [matches],
  );

  const value = useMemo<HeraldState>(() => ({
    phase, mode, backend, credentials,
    profile, preferences, matches, stats, releases,
    refreshing, error, toast,
    connect, useThisDevice, disconnect, completeOnboarding,
    refresh, uploadResume, updateProfile, updatePreferences,
    approve, submit, skip,
    showToast, matchById,
  }), [
    phase, mode, backend, credentials, profile, preferences, matches, stats, releases,
    refreshing, error, toast, connect, useThisDevice, disconnect, completeOnboarding, refresh,
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
