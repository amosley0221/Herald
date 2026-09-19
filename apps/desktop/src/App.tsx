import { useEffect, useState } from 'react';
import {
  clockTime, heraldDate, isSubmitted, strings, thousands,
} from '@herald/core';
import {
  Button, Emblem, EmptyState, Label, MatchRow, SectionLabel, StatGrid, Toast, TrackerRow,
} from './components/primitives';
import { Detail } from './panes/Detail';
import { PreferencesPane } from './panes/Preferences';
import { ReleasesPane } from './panes/Releases';
import { PairingCode, Setup } from './panes/Setup';
import { currentVersion } from './lib/updates';
import { getLastSeenVersion, setLastSeenVersion } from './lib/storage';
import { useFeed, useHerald, useTracker, type View } from './state';

const NAV: Array<{ view: View; label: string }> = [
  { view: 'today', label: strings.nav.today },
  { view: 'matches', label: strings.nav.matches },
  { view: 'tracker', label: strings.nav.tracker },
  { view: 'preferences', label: strings.nav.preferences },
];

/**
 * The desktop shell: a 200px sidebar, a 380px list, and a fluid detail pane,
 * divided by hairlines.
 *
 * Tracker swaps the list to applications and Preferences swaps it to the
 * settings form, per the handoff — the detail pane stays where it is so the
 * layout never reflows under the user.
 */
export function App() {
  const { phase, view, toast } = useHerald();

  if (phase === 'loading') return <div style={{ height: '100%', background: 'var(--cp-onyx)' }} />;
  if (phase === 'setup') {
    return (
      <>
        <Setup />
        <Toast message={toast?.message ?? null} tone={toast?.tone} />
      </>
    );
  }

  return (
    <div className="shell">
      <Sidebar />
      <div className="pane pane--list">
        {view === 'today' ? <TodayList /> : null}
        {view === 'matches' ? <MatchesList /> : null}
        {view === 'tracker' ? <TrackerList /> : null}
        {view === 'preferences' ? <PreferencesPane /> : null}
        {view === 'releases' ? <ReleasesPane /> : null}
      </div>
      <div className="pane pane--detail">
        <DetailPane />
      </div>
      <Toast message={toast?.message ?? null} tone={toast?.tone} />
    </div>
  );
}

function Sidebar() {
  const { view, setView, stats, refreshing, runCrawl } = useHerald();
  const [version, setVersion] = useState('');

  useEffect(() => {
    void currentVersion().then(setVersion);
  }, []);

  const lastCrawl = stats?.lastCrawlAt ? new Date(stats.lastCrawlAt) : null;

  return (
    <nav className="sidebar">
      <div className="sidebar__emblem">
        <Emblem size={28} />
      </div>

      <div className="sidebar__nav">
        {NAV.map((item) => (
          <button
            key={item.view}
            type="button"
            className="nav-item transition"
            aria-current={view === item.view ? 'page' : undefined}
            onClick={() => setView(item.view)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="sidebar__footer">
        <p style={{ margin: 0 }}>
          {lastCrawl
            ? `Last crawl · ${clockTime(lastCrawl.getHours(), lastCrawl.getMinutes())} / ${thousands(stats?.lastCrawlRead ?? 0)} postings read`
            : 'No crawl has run yet.'}
        </p>
        <div style={{ marginTop: 'var(--cp-space-2)', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
          <Button variant="ghost" onClick={() => void runCrawl()} disabled={refreshing}>
            Crawl now
          </Button>
          {version ? <Label className="label--tight">{version}</Label> : null}
        </div>
      </div>
    </nav>
  );
}

function DetailPane() {
  const { view, selectedId, matchById, credentials } = useHerald();

  // Preferences and What's new fill the list pane, so the detail pane carries
  // the pairing code — the one thing the phone needs from the desktop app.
  if (view === 'preferences' || view === 'releases') {
    return credentials ? <PairingCode /> : null;
  }
  if (view === 'today') return <TodaySummary />;
  return <Detail match={selectedId ? matchById(selectedId) ?? null : null} />;
}

// ── Today ───────────────────────────────────────────────────────────────────

function TodayList() {
  const { selectedId, select, preferences } = useHerald();
  const { pending } = useFeed();
  const threshold = preferences?.threshold ?? 85;

  return (
    <div>
      <div className="pane__header">
        <h1 className="display" style={{ fontSize: 22 }}>{strings.today.title.toUpperCase()}</h1>
        <Label className="label--tight">{strings.today.awaiting(pending.length)}</Label>
      </div>
      {pending.length === 0 ? (
        <EmptyState>{strings.today.emptyPending}</EmptyState>
      ) : (
        pending.map((match) => (
          <MatchRow
            key={match.id}
            match={match}
            variant={match.score >= threshold ? 'instant' : 'digest'}
            selected={selectedId === match.id}
            onClick={() => select(match.id)}
          />
        ))
      )}
    </div>
  );
}

function TodaySummary() {
  const { stats, preferences, error, showToast } = useHerald();
  const { instant } = useFeed();
  const read = stats?.read ?? 0;

  // The one-time "what's new" toast after an update lands.
  useEffect(() => {
    void (async () => {
      const version = await currentVersion();
      const lastSeen = getLastSeenVersion();
      if (lastSeen && lastSeen !== version) showToast(strings.today.updatedToast(version));
      if (lastSeen !== version) setLastSeenVersion(version);
    })();
  }, [showToast]);

  return (
    <div className="stack">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 }}>
        <h1 className="display" style={{ fontSize: 28 }}>{strings.today.title.toUpperCase()}</h1>
        <span className="display muted" style={{ fontSize: 13 }}>
          {heraldDate(new Date(), preferences?.timezone)}
        </span>
      </div>

      {error ? <div className="notice notice--danger">{error}</div> : null}

      <StatGrid
        stats={[
          { label: strings.today.stats.read, value: thousands(read) },
          { label: strings.today.stats.matched, value: String(stats?.matched ?? 0) },
          { label: strings.today.stats.applied, value: String(stats?.applied ?? 0) },
          { label: strings.today.stats.pending, value: String(stats?.pending ?? 0) },
        ]}
      />

      <p className="muted" style={{ fontSize: 14, margin: 0, maxWidth: 640 }}>
        {read > 0 ? strings.today.sentence(thousands(read), instant.length) : strings.today.empty}
      </p>
    </div>
  );
}

// ── Matches ─────────────────────────────────────────────────────────────────

function MatchesList() {
  const { selectedId, select, preferences } = useHerald();
  const { instant, digest, pending, threshold } = useFeed();
  const digestTime = clockTime(preferences?.digestHour ?? 7);

  return (
    <div>
      <div className="pane__header">
        <h1 className="display" style={{ fontSize: 22 }}>{strings.matches.title.toUpperCase()}</h1>
        <Label className="label--tight">{strings.matches.pending(pending.length)}</Label>
      </div>

      {pending.length === 0 ? (
        <EmptyState>{strings.matches.empty}</EmptyState>
      ) : (
        <>
          <SectionLabel tone="gold">{strings.matches.approveNow(threshold)}</SectionLabel>
          {instant.length === 0 ? (
            <EmptyState>{strings.matches.emptyAboveThreshold}</EmptyState>
          ) : (
            instant.map((match) => (
              <MatchRow
                key={match.id}
                match={match}
                variant="instant"
                selected={selectedId === match.id}
                onClick={() => select(match.id)}
              />
            ))
          )}

          {digest.length > 0 ? (
            <>
              <SectionLabel>{strings.matches.digest(digestTime)}</SectionLabel>
              {digest.map((match) => (
                <MatchRow
                  key={match.id}
                  match={match}
                  variant="digest"
                  selected={selectedId === match.id}
                  onClick={() => select(match.id)}
                />
              ))}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

// ── Tracker ─────────────────────────────────────────────────────────────────

function TrackerList() {
  const { selectedId, select } = useHerald();
  const decided = useTracker();
  const appliedCount = decided.filter((match) => isSubmitted(match.status)).length;

  return (
    <div>
      <div className="pane__header">
        <h1 className="display" style={{ fontSize: 22 }}>{strings.tracker.title.toUpperCase()}</h1>
        <Label className="label--tight">{strings.tracker.applied(appliedCount)}</Label>
      </div>
      {decided.length === 0 ? (
        <EmptyState>{strings.tracker.empty}</EmptyState>
      ) : (
        decided.map((match) => (
          <TrackerRow
            key={match.id}
            match={match}
            selected={selectedId === match.id}
            onClick={() => select(match.id)}
          />
        ))
      )}
    </div>
  );
}
