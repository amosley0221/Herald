import { useEffect, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { Match, PreparedApplication } from '@herald/core';
import {
  joinMeta, payRange, relativeTime, statusLabel, statusTone, strings,
} from '@herald/core';
import { Badge, Button, EmptyState, Label } from '../components/primitives';
import { useHerald } from '../state';

/**
 * The detail pane.
 *
 * Shows the match, or — once Approve is pressed — the Review layout in the same
 * pane, which is the desktop's equivalent of the phone's Review screen. Approve
 * only prepares; nothing is sent until Submit is pressed here.
 */
export function Detail({ match }: { match: Match | null }) {
  const { reviewing } = useHerald();

  if (!match) {
    return <EmptyState>Select a match to read it.</EmptyState>;
  }
  return reviewing ? <Review match={match} /> : <MatchDetail match={match} />;
}

function MatchDetail({ match }: { match: Match }) {
  const { approve, skip, setReviewing, showToast } = useHerald();
  const [busy, setBusy] = useState(false);
  const { posting } = match;
  const pay = payRange(posting.payMin, posting.payMax, posting.payCurrency, posting.pay);

  const onApprove = async () => {
    setBusy(true);
    try {
      await approve(match.id);
      setReviewing(true);
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : strings.errors.generic, 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="detail__headline">
        <span className="detail__score">{match.score}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 22, fontWeight: 500, lineHeight: 1.3, margin: 0 }}>{posting.title}</h1>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>
            {joinMeta(posting.company, posting.location, pay)}
          </p>
          <p className="label label--tight" style={{ margin: '4px 0 0' }}>
            {joinMeta(posting.source, relativeTime(new Date(posting.postedAt)))}
          </p>
        </div>
      </div>

      <div className="detail__columns">
        <div>
          <Label tone="gold">{strings.detail.why}</Label>
          <div style={{ marginTop: 12 }}>
            {match.why.length === 0 ? (
              <p className="muted" style={{ fontSize: 14 }}>No reasons were recorded.</p>
            ) : match.why.map((reason) => (
              <div className="bullet" key={reason}>
                <span className="gold">·</span>
                <span>{reason}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <Label>{strings.detail.gaps}</Label>
          <div style={{ marginTop: 12 }}>
            {match.gaps.map((gap) => (
              <div className="bullet muted" key={gap}>
                <span>·</span>
                <span>{gap}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {match.blockedReason ? (
        <div className="notice notice--danger">{match.blockedReason}</div>
      ) : null}

      <div className="row-actions" style={{ marginTop: 'var(--cp-space-3)' }}>
        {match.status === 'pending' ? (
          <>
            <Button onClick={() => void onApprove()} disabled={busy}>
              {busy ? strings.detail.preparing : strings.detail.approve}
            </Button>
            <Button variant="ghost" onClick={() => void skip(match.id)} disabled={busy}>
              {strings.detail.skip}
            </Button>
          </>
        ) : match.status === 'approved' ? (
          <Button onClick={() => setReviewing(true)}>{strings.review.title}</Button>
        ) : (
          <Badge tone={statusTone(match.status)}>{statusLabel(match.status)}</Badge>
        )}
        <Button variant="ghost" onClick={() => void openUrl(posting.url)}>Open posting</Button>
      </div>
    </div>
  );
}

/**
 * Review before submitting, laid out as the design specifies for desktop:
 * fields in two columns, the cover letter beneath, Submit and Back at the end.
 */
function Review({ match }: { match: Match }) {
  const { approve, submit, setReviewing } = useHerald();
  const [prepared, setPrepared] = useState<PreparedApplication | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [letter, setLetter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Approve is idempotent on the engine, so re-entering Review returns the
  // stored preparation instead of paying for a second cover letter.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await approve(match.id);
        if (cancelled) return;
        setPrepared(result);
        setLetter(result.coverLetter ?? '');
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : strings.errors.generic);
      }
    })();
    return () => { cancelled = true; };
    // Keyed on the match alone: re-running on every `approve` identity change
    // would re-prepare the application on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.id]);

  if (error) return <div className="notice notice--danger">{error}</div>;
  if (!prepared) return <EmptyState>{strings.detail.preparing}</EmptyState>;

  const missingRequired = prepared.fields.some(
    (field) => field.required && !(edits[field.key] ?? field.value).trim(),
  );

  const onSubmit = async () => {
    setSubmitting(true);
    try {
      await submit(match.id, edits, letter || undefined);
      setReviewing(false);
    } catch {
      // `submit` already raised the toast and rolled the status back.
      setSubmitting(false);
    }
  };

  return (
    <div className="stack">
      <div>
        <h1 className="display" style={{ fontSize: 22 }}>{strings.review.title.toUpperCase()}</h1>
        <p className="muted" style={{ margin: '6px 0 0', fontSize: 14 }}>
          {strings.review.subtitle(match.posting.title, match.posting.company, match.posting.source)}
        </p>
      </div>

      {prepared.manualOnly ? (
        <div className="notice notice--danger">{prepared.manualReason ?? strings.review.manualOnly}</div>
      ) : prepared.degraded ? (
        <div className="notice notice--gold">{strings.review.degraded}</div>
      ) : null}

      <div className="kv-grid">
        {prepared.fields.map((field) => (
          <div className="kv-row" key={field.key}>
            <Label className="label--tight">
              {field.label}{field.required ? ' *' : ''}
            </Label>
            {field.kind === 'textarea' ? (
              <textarea
                defaultValue={field.value}
                aria-label={field.label}
                onChange={(event) => setEdits((current) => ({ ...current, [field.key]: event.target.value }))}
                rows={3}
              />
            ) : (
              <input
                defaultValue={field.value}
                aria-label={field.label}
                readOnly={field.kind === 'file'}
                onChange={(event) => setEdits((current) => ({ ...current, [field.key]: event.target.value }))}
              />
            )}
          </div>
        ))}
      </div>

      {prepared.coverLetter != null ? (
        <div>
          <Label className="label--tight">{strings.review.coverLetter}</Label>
          <div className="letter" style={{ marginTop: 8 }}>
            <textarea
              value={letter}
              aria-label={strings.review.coverLetter}
              onChange={(event) => setLetter(event.target.value)}
            />
          </div>
        </div>
      ) : null}

      <div className="row-actions">
        {prepared.manualOnly ? (
          <Button onClick={() => void openUrl(match.posting.applyUrl)}>
            {strings.review.openPosting}
          </Button>
        ) : (
          <Button onClick={() => void onSubmit()} disabled={submitting || missingRequired}>
            {submitting ? strings.review.submitting : strings.review.submit}
          </Button>
        )}
        <Button variant="ghost" onClick={() => setReviewing(false)} disabled={submitting}>
          {strings.review.back}
        </Button>
      </div>
    </div>
  );
}
