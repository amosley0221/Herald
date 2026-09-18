import { useEffect, useState } from 'react';
import type { ReleaseEntry } from '@herald/core';
import { strings, toRoman } from '@herald/core';
import { Button, EmptyState, Label } from '../components/primitives';
import {
  applyUpdate, checkForUpdate, currentVersion, downloadUpdate, type UpdateState,
} from '../lib/updates';
import { useHerald } from '../state';

/**
 * What's new, and the update control.
 *
 * Renders the same release feed the phone reads, in Herald's style: version in
 * Cinzel, date as roman numerals, notes in Jost 300, hairline between versions.
 */
export function ReleasesPane() {
  const { releases, showToast } = useHerald();
  const [version, setVersion] = useState('—');
  const [update, setUpdate] = useState<UpdateState>({ status: 'idle' });

  useEffect(() => {
    void currentVersion().then(setVersion);
  }, []);

  const onCheck = async () => {
    setUpdate({ status: 'checking' });
    const result = await checkForUpdate();
    setUpdate(result);
    if (result.status === 'none') showToast(strings.releases.upToDate);
    if (result.status === 'failed') showToast(result.error, 'danger');
  };

  const onDownload = async () => {
    if (update.status !== 'available') return;
    setUpdate({ status: 'downloading', version: update.version, percent: null });
    const result = await downloadUpdate((percent) => {
      setUpdate({ status: 'downloading', version: update.version, percent });
    });
    setUpdate(result);
    if (result.status === 'failed') showToast(result.error, 'danger');
  };

  return (
    <div>
      <div className="pane__header">
        <h1 className="display" style={{ fontSize: 22 }}>{strings.releases.title.toUpperCase()}</h1>
        <Label>{strings.releases.current(version)}</Label>
      </div>

      <div style={{ padding: 'var(--cp-space-3)', borderBottom: '1px solid var(--cp-line)' }}>
        <UpdateControl state={update} onCheck={onCheck} onDownload={onDownload} />
      </div>

      {!releases || releases.releases.length === 0 ? (
        <EmptyState>{strings.releases.empty}</EmptyState>
      ) : (
        releases.releases.map((release) => (
          <ReleaseSection key={release.version} release={release} current={release.version === version} />
        ))
      )}
    </div>
  );
}

function UpdateControl({ state, onCheck, onDownload }: {
  state: UpdateState; onCheck: () => void; onDownload: () => void;
}) {
  switch (state.status) {
    case 'checking':
      return <p className="muted" style={{ margin: 0, fontSize: 13 }}>{strings.releases.checking}</p>;
    case 'available':
      return (
        <div className="update-banner">
          <span style={{ flex: 1, fontSize: 13 }}>{strings.today.updateAvailable(state.version)}</span>
          <Button variant="outline" onClick={onDownload}>{strings.today.updateAction}</Button>
        </div>
      );
    case 'downloading':
      return (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {state.percent != null ? `${strings.releases.downloading} ${state.percent}%` : strings.releases.downloading}
        </p>
      );
    case 'ready':
      return (
        <div className="update-banner">
          <span style={{ flex: 1, fontSize: 13 }}>{strings.releases.restartToApply}</span>
          <Button onClick={() => void applyUpdate()}>Restart</Button>
        </div>
      );
    case 'failed':
      return (
        <div className="row-actions">
          <Button variant="outline" onClick={onCheck}>{strings.errors.retry}</Button>
          <span className="muted" style={{ fontSize: 13 }}>{state.error}</span>
        </div>
      );
    default:
      return <Button variant="outline" onClick={onCheck}>Check for updates</Button>;
  }
}

function ReleaseSection({ release, current }: { release: ReleaseEntry; current: boolean }) {
  return (
    <div
      className="stack stack--tight"
      style={{ padding: 'var(--cp-space-3)', borderBottom: '1px solid var(--cp-line)' }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 }}>
        <span className="display" style={{ fontSize: 20, color: current ? 'var(--cp-gold)' : 'var(--cp-bone)' }}>
          {release.version}
        </span>
        <Label className="label--tight">{romanDate(release.date)}</Label>
      </div>

      <Notes markdown={release.notesMarkdown} />

      {release.patches?.length ? (
        <div className="stack stack--tight">
          {release.patches.map((patch) => (
            <div key={patch.number} className="stack" style={{ gap: 6 }}>
              <Label tone="gold" className="label--tight">{strings.releases.patch(patch.number)}</Label>
              <Notes markdown={patch.notesMarkdown} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Renders the Keep-a-Changelog subset the notes actually use: `###` headings
 * and `-` bullets. A full Markdown renderer would be a dependency and a second
 * type system for one pane.
 */
function Notes({ markdown }: { markdown: string }) {
  const lines = markdown.split('\n').map((line) => line.trim()).filter(Boolean);
  return (
    <div>
      {lines.map((line, index) => {
        if (line.startsWith('#')) {
          return (
            <div key={index} style={{ marginTop: index === 0 ? 0 : 12, marginBottom: 6 }}>
              <Label className="label--tight">{line.replace(/^#+\s*/, '')}</Label>
            </div>
          );
        }
        if (line.startsWith('-') || line.startsWith('*')) {
          return (
            <div className="bullet" key={index}>
              <span className="gold">·</span>
              <span>{stripInlineMarkdown(line.replace(/^[-*]\s*/, ''))}</span>
            </div>
          );
        }
        return (
          <p key={index} style={{ fontSize: 14, margin: '0 0 8px' }}>
            {stripInlineMarkdown(line)}
          </p>
        );
      })}
    </div>
  );
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

/** `2026-09-18` -> `18 · IX · MMXXVI`, matching the Today dateline. */
function romanDate(iso: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!parts) return iso;
  return `${Number(parts[3])} · ${toRoman(Number(parts[2]))} · ${toRoman(Number(parts[1]))}`;
}
