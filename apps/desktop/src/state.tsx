import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import {
  HeraldClient, HeraldError, motion, strings,
  type HeraldBackend,
  type Match, type MatchStatus, type PreparedApplication, type Preferences,
  type Profile, type ReleaseIndex, type ResumeUpload, type TodayStats,
} from '@herald/core';
import { createBackend, settings as engineSettings, setApiKey } from './engine/platform';
import {
  clearCredentials, loadCredentials, saveCredentials, type EngineCredentials,
} from './lib/storage';

/**
 * Desktop state.
 *
 * The same shape as the phone's provider, and deliberately so: both apps are
 * thin clients over one engine, and keeping the two state layers parallel means
 * a change to the contract surfaces in both at once.
 */

export type View = 'today' | 'matches' | 'tracker' | 'preferences' | 'releases';
export type Phase = 'loading' | 'setup' | 'ready';

/** Where the work happens. `local` is this machine; `paired` is a hosted engine. */
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

  view: View;
  setView: (view: View) => void;
  /** The match the detail pane is showing, if any. */
  selectedId: string | null;
  select: (id: string | null) => void;
  /** True when the detail pane is showing the Review layout. */
  reviewing: boolean;
  setReviewing: (value: boolean) => void;

  profile: Profile | null;
  preferences: Preferences | null;
  matches: Match[];
  stats: TodayStats | null;
  releases: ReleaseIndex | null;

  refreshing: boolean;
  error: string | null;
  toast: ToastState | null;

  connect: (credentials: EngineCredentials) => Promise<void>;
  /** Run on this machine, with the given Anthropic key. */
  useThisMachine: (apiKey: string) => Promise<void>;
  disconnect: () => void;
  refresh: () => Promise<void>;
  runCrawl: () => Promise<void>;

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

  const [view, setView] = useState<View>('today');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);

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

  // Selecting a different match always leaves the Review layout, so an
  // in-progress review cannot be silently retargeted at another posting.
  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    setReviewing(false);
  }, []);

  // A stored pairing wins, because choosing one was deliberate and the engine
  // holds the data. Otherwise this machine does the work, which needs a key.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = loadCredentials();
      if (stored) {
        setCredentials(stored);
        setMode('paired');
        setBackend(new HeraldClient({ baseUrl: stored.baseUrl, token: stored.token }));
        setPhase('ready');
        return;
      }

      const apiKey = await engineSettings.getApiKey();
      if (cancelled) return;
      if (!apiKey) {
        setPhase('setup');
        return;
      }
      setMode('local');
      setBackend(createBackend());
      setPhase('ready');
    })();
    return () => { cancelled = true; };
  }, []);

  const useThisMachine = useCallback(async (apiKey: string) => {
    await setApiKey(apiKey);
    setCredentials(null);
    setMode('local');
    setBackend(createBackend());
    setPhase('ready');
  }, []);

  const refresh = useCallback(async () => {
    if (!backend) return;
    setRefreshing(true);
    try {
      const [matchList, todayStats, preferenceState] = await Promise.all([
        backend.listMatches({ limit: 200 }),
        backend.todayStats(),
        backend.getPreferences(),
      ]);
      setMatches(matchList);
      setStats(todayStats);
      setPreferences(preferenceState);
      setError(null);
      // Expected to 404 before a resume is uploaded, and the release feed is
      // optional, so neither failure is worth surfacing.
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
    // The engine crawls hourly; polling every two minutes keeps an app left
    // open on a second monitor roughly current without hammering it.
    const timer = setInterval(() => { void refresh(); }, 120_000);
    return () => clearInterval(timer);
  }, [backend, refresh]);

  const connect = useCallback(async (next: EngineCredentials) => {
    const candidate = new HeraldClient({ baseUrl: next.baseUrl, token: next.token });
    await candidate.health();
    await candidate.getPreferences();
    saveCredentials(next);
    setCredentials(next);
    setBackend(candidate);
    setPhase('ready');
  }, []);

  const disconnect = useCallback(async () => {
    clearCredentials();
    setCredentials(null);
    setBackend(null);
    setProfile(null);
    setPreferences(null);
    setMatches([]);
    setStats(null);
    setSelectedId(null);

    // Unpairing falls back to this machine rather than stranding the user, as
    // long as there is a key to work with.
    const apiKey = await engineSettings.getApiKey();
    if (apiKey) {
      setMode('local');
      setBackend(createBackend());
      setPhase('ready');
      return;
    }
    setMode('local');
    setBackend(null);
    setPhase('setup');
  }, []);

  const runCrawl = useCallback(async () => {
    if (!backend) return;
    try {
      await backend.runCrawl();
      showToast('Crawl started');
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : strings.errors.generic, 'danger');
    }
  }, [backend, showToast]);

  const uploadResume = useCallback(async (file: ResumeUpload): Promise<string[]> => {
    if (!backend) throw new Error(strings.errors.offline);
    const result = await backend.uploadResume(file);
    setProfile(result.profile);
    return result.warnings;
  }, [backend]);

  const updateProfile = useCallback(async (patch: Partial<Profile>) => {
    if (!backend) return;
    setProfile(await backend.updateProfile(patch));
  }, [backend]);

  const updatePreferences = useCallback(async (patch: Partial<Preferences>) => {
    if (!backend || !preferences) return;
    const previous = preferences;
    // Optimistic, so the threshold slider re-splits the list as it moves.
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
      // A 200 does not always mean it went in: the engine reports `needs_you`
      // when it hit a CAPTCHA or a login wall.
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
    } catch {
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
    view, setView, selectedId, select, reviewing, setReviewing,
    profile, preferences, matches, stats, releases,
    refreshing, error, toast,
    connect, useThisMachine, disconnect, refresh, runCrawl,
    uploadResume, updateProfile, updatePreferences,
    approve, submit, skip,
    showToast, matchById,
  }), [
    phase, mode, backend, credentials, view, selectedId, select, reviewing,
    profile, preferences, matches, stats, releases, refreshing, error, toast,
    connect, useThisMachine, disconnect, refresh, runCrawl, uploadResume, updateProfile,
    updatePreferences, approve, submit, skip, showToast, matchById,
  ]);

  return <HeraldContext.Provider value={value}>{children}</HeraldContext.Provider>;
}

export function useHerald(): HeraldState {
  const context = useContext(HeraldContext);
  if (!context) throw new Error('useHerald must be used inside a HeraldProvider');
  return context;
}

/** The Approve-now / Digest split the threshold defines. */
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

/** Everything decided, newest first — what the Tracker lists. */
export function useTracker(): Match[] {
  const { matches } = useHerald();
  return useMemo(
    () => matches
      .filter((match) => match.status !== 'pending')
      .sort((a, b) => (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt)),
    [matches],
  );
}
