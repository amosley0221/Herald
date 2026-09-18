import { useEffect, useState, type ReactNode } from 'react';
import type { BadgeTone, Match } from '@herald/core';
import {
  joinMeta, payRange, relativeTime, statusLabel, statusTone,
} from '@herald/core';

/**
 * The Crowned Pixel component set for the desktop app.
 *
 * Styling lives in `app.css` against the generated tokens, so these components
 * carry structure and behaviour only — there are no inline colours or sizes to
 * drift from the phone.
 */

export function Emblem({ size = 28, tint = 'var(--cp-gold)' }: { size?: number; tint?: string }) {
  // A 7×3 grid of 20px squares on a 24px pitch, top row reduced to four
  // merlons. Matches design/assets/emblem-flat-gold.svg.
  const cells: Array<[number, number]> = [
    [12, 12], [60, 12], [108, 12], [156, 12],
    ...[36, 60].flatMap((y) => [12, 36, 60, 84, 108, 132, 156].map((x) => [x, y] as [number, number])),
  ];
  return (
    <svg width={size} height={(size * 68) / 188} viewBox="0 12 188 68" aria-hidden="true">
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={20} height={20} fill={tint} />
      ))}
    </svg>
  );
}

export function Label({ children, tone, className = '' }: {
  children: ReactNode; tone?: 'gold' | 'bone'; className?: string;
}) {
  const toneClass = tone === 'gold' ? ' label--gold' : tone === 'bone' ? ' label--bone' : '';
  return <span className={`label${toneClass} ${className}`.trim()}>{children}</span>;
}

export function Button({
  children, onClick, variant = 'solid', disabled = false, type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'solid' | 'outline' | 'ghost';
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button type={type} className={`btn btn--${variant} transition`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

const BADGE_CLASS: Record<BadgeTone, string> = {
  solid: 'badge badge--solid',
  gold: 'badge badge--gold',
  success: 'badge badge--success',
  danger: 'badge badge--danger',
  muted: 'badge',
};

export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: BadgeTone }) {
  return <span className={BADGE_CLASS[tone]}>{children}</span>;
}

export function Tag({ children, onRemove }: { children: ReactNode; onRemove?: () => void }) {
  return (
    <span className="tag">
      {children}
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label={`Remove ${String(children)}`}>×</button>
      ) : null}
    </span>
  );
}

export function Switch({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (next: boolean) => void;
}) {
  return (
    <div className="switch">
      <span style={{ fontSize: 15, fontWeight: 400 }}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className="switch__control"
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

export function Slider({ value, min, max, onChange, label }: {
  value: number; min: number; max: number; onChange: (next: number) => void; label: string;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      value={value}
      aria-label={label}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}

export function SectionLabel({ children, tone }: { children: ReactNode; tone?: 'gold' }) {
  return (
    <div className="section-label">
      <Label tone={tone}>{children}</Label>
    </div>
  );
}

export function StatGrid({ stats }: { stats: Array<{ label: string; value: string }> }) {
  return (
    <div className="stat-grid">
      {stats.map((stat) => (
        <div key={stat.label} className="stat-cell">
          <span className="stat-cell__value">{stat.value}</span>
          <Label>{stat.label}</Label>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

/**
 * A row in the list pane. `variant` carries the Approve-now / Digest split:
 * an instant row leads with a 24px gold score and a pay/source line, a digest
 * row compacts to 18px stone and two lines.
 */
export function MatchRow({ match, variant = 'instant', selected = false, onClick }: {
  match: Match;
  variant?: 'instant' | 'digest';
  selected?: boolean;
  onClick: () => void;
}) {
  const { posting } = match;
  const instant = variant === 'instant';
  const pay = payRange(posting.payMin, posting.payMax, posting.payCurrency, posting.pay);

  return (
    <button type="button" className="row transition" aria-selected={selected} onClick={onClick}>
      <span className={`row__score row__score--${variant}`}>{match.score}</span>
      <span className="row__body">
        <span className="row__title">{posting.title}</span>
        <span className="row__meta">{joinMeta(posting.company, posting.location)}</span>
        {instant ? (
          <span className="row__meta label label--tight" style={{ fontSize: 11 }}>
            {joinMeta(pay, posting.source, relativeTime(new Date(posting.postedAt)))}
          </span>
        ) : null}
      </span>
      {match.status !== 'pending' ? (
        <Badge tone={statusTone(match.status)}>{statusLabel(match.status)}</Badge>
      ) : null}
    </button>
  );
}

export function TrackerRow({ match, selected = false, onClick }: {
  match: Match; selected?: boolean; onClick: () => void;
}) {
  const decided = match.submittedAt ?? match.decidedAt ?? match.createdAt;
  return (
    <button type="button" className="row transition" aria-selected={selected} onClick={onClick}>
      <span className="row__body">
        <span className="row__title">{match.posting.title}</span>
        <span className="row__meta">{joinMeta(match.posting.company, shortDate(decided))}</span>
      </span>
      <Badge tone={statusTone(match.status)}>{statusLabel(match.status)}</Badge>
    </button>
  );
}

function shortDate(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}

/** Bottom-anchored, hairline-bordered, leading gold interpunct, 2.4s dwell. */
export function Toast({ message, tone = 'default' }: {
  message: string | null; tone?: 'default' | 'danger';
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(message != null);
  }, [message]);

  if (!message) return null;
  return (
    <div
      className="toast transition"
      role="status"
      aria-live="polite"
      style={{ opacity: visible ? 1 : 0 }}
    >
      <span className={tone === 'danger' ? 'danger' : 'gold'}>·</span>
      <span>{message}</span>
    </div>
  );
}
