import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import {
  HeraldClient, HeraldError, motion, strings,
  type Match, type MatchStatus, type PreparedApplication, type Preferences,
  type Profile, type ReleaseIndex, type ResumeUpload, type TodayStats,
} from '@herald/core';
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
export type Phase = 'loading' | 'unpaired' | 'ready';

interface ToastState {
  message: string;
  tone: 'default' | 'danger';
}

interface HeraldState {
  phase: Phase;
  client: HeraldClient | null;
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
  const [client, setClient] = useState<HeraldClient | null>(null);

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

  useEffect(() => {
    const stored = loadCredentials();
    if (!stored) {
      setPhase('unpaired');
      return;
    }
    setCredentials(stored);
    setClient(new HeraldClient({ baseUrl: stored.baseUrl, token: stored.token }));
    setPhase('ready');
  }, []);

  const refresh = useCallback(async () => {
    if (!client) return;
    setRefreshing(true);
    try {
      const [matchList, todayStats, preferenceState] = await Promise.all([
        client.listMatches({ limit: 200 }),
        client.todayStats(),
        client.getPreferences(),
      ]);
      setMatches(matchList);
      setStats(todayStats);
      setPreferences(preferenceState);
      setError(null);
      // Expected to 404 before a resume is uploaded, and the release feed is
      // optional, so neither failure is worth surfacing.
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
    // The engine crawls hourly; polling every two minutes keeps an app left
    // open on a second monitor roughly current without hammering it.
    const timer = setInterval(() => { void refresh(); }, 120_000);
    return () => clearInterval(timer);
  }, [client, refresh]);

  const connect = useCallback(async (next: EngineCredentials) => {
    const candidate = new HeraldClient({ baseUrl: next.baseUrl, token: next.token });
    await candidate.health();
    await candidate.getPreferences();
    saveCredentials(next);
    setCredentials(next);
    setClient(candidate);
    setPhase('ready');
  }, []);

  const disconnect = useCallback(() => {
    clearCredentials();
    setCredentials(null);
    setClient(null);
    setProfile(null);
    setPreferences(null);
    setMatches([]);
    setStats(null);
    setSelectedId(null);
    setPhase('unpaired');
  }, []);

  const runCrawl = useCallback(async () => {
    if (!client) return;
    try {
      await client.runCrawl();
      showToast('Crawl started');
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : strings.errors.generic, 'danger');
    }
  }, [client, showToast]);

  const uploadResume = useCallback(async (file: ResumeUpload): Promise<string[]> => {
    if (!client) throw new Error(strings.errors.offline);
    const result = await client.uploadResume(file);
    setProfile(result.profile);
    return result.warnings;
  }, [client]);

  const updateProfile = useCallback(async (patch: Partial<Profile>) => {
    if (!client) return;
    setProfile(await client.updateProfile(patch));
  }, [client]);

  const updatePreferences = useCallback(async (patch: Partial<Preferences>) => {
    if (!client || !preferences) return;
    const previous = preferences;
    // Optimistic, so the threshold slider re-splits the list as it moves.
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
    } catch {
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
    view, setView, selectedId, select, reviewing, setReviewing,
    profile, preferences, matches, stats, releases,
    refreshing, error, toast,
    connect, disconnect, refresh, runCrawl,
    uploadResume, updateProfile, updatePreferences,
    approve, submit, skip,
    showToast, matchById,
  }), [
    phase, client, credentials, view, selectedId, select, reviewing,
    profile, preferences, matches, stats, releases, refreshing, error, toast,
    connect, disconnect, refresh, runCrawl, uploadResume, updateProfile,
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
