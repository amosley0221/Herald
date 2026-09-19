import { useRef, useState } from 'react';
import { clockTime, strings, thousands } from '@herald/core';
import { Button, Label, Slider, Switch, Tag } from '../components/primitives';
import { useHerald } from '../state';

/**
 * The preferences form.
 *
 * On desktop this replaces the list pane, per the handoff. Changes save as they
 * are made — nothing here is only valid as a set, so a Save button would just
 * be a second thing to forget.
 */
export function PreferencesPane() {
  const {
    preferences, profile, mode, pairing, updatePreferences, updateProfile, uploadResume,
    showToast, disconnect, setView, startSharing, stopSharing,
  } = useHerald();
  const [newRole, setNewRole] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  if (!preferences) {
    return <p className="empty">{strings.errors.offline}</p>;
  }

  const addRole = () => {
    const role = newRole.trim();
    if (!role || preferences.roles.includes(role)) return;
    void updatePreferences({ roles: [...preferences.roles, role] });
    setNewRole('');
  };

  const onResume = async (file: File) => {
    try {
      const warnings = await uploadResume({
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        data: file,
      });
      showToast(warnings[0] ?? 'Resume updated');
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : strings.errors.generic, 'danger');
    }
  };

  return (
    <div>
      <div className="pane__header">
        <h1 className="display" style={{ fontSize: 22 }}>{strings.preferences.title.toUpperCase()}</h1>
      </div>

      <Section label={strings.preferences.roles}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {preferences.roles.map((role) => (
            <Tag
              key={role}
              onRemove={() => void updatePreferences({ roles: preferences.roles.filter((r) => r !== role) })}
            >
              {role}
            </Tag>
          ))}
        </div>
        <div className="row-actions">
          <input
            className="field"
            value={newRole}
            aria-label={strings.preferences.addRole}
            placeholder={strings.preferences.addRole}
            onChange={(event) => setNewRole(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') addRole(); }}
          />
          <Button variant="outline" onClick={addRole} disabled={!newRole.trim()}>Add</Button>
        </div>
      </Section>

      <Section label={strings.preferences.location}>
        <input
          className="field"
          defaultValue={preferences.locations.join(', ')}
          aria-label={strings.preferences.location}
          placeholder="Charlotte, NC"
          onBlur={(event) => {
            const locations = event.target.value.split(',').map((p) => p.trim()).filter(Boolean);
            void updatePreferences({ locations });
          }}
        />
        <Switch
          label="Include remote roles"
          checked={preferences.remote}
          onChange={(next) => void updatePreferences({ remote: next })}
        />
      </Section>

      <Section label={strings.preferences.minSalary}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
          <span className="display gold" style={{ fontSize: 28 }}>
            {preferences.minSalary != null ? `$${thousands(preferences.minSalary)}` : '—'}
          </span>
          <input
            className="field"
            type="number"
            defaultValue={preferences.minSalary ?? ''}
            aria-label={strings.preferences.minSalary}
            placeholder="No minimum"
            onBlur={(event) => {
              const raw = event.target.value.replace(/[^\d]/g, '');
              void updatePreferences({ minSalary: raw ? Number(raw) : null });
            }}
          />
        </div>
      </Section>

      <Section label={strings.preferences.threshold}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span className="display gold" style={{ fontSize: 40 }}>{preferences.threshold}</span>
          <span className="muted" style={{ fontSize: 14 }}>{strings.onboarding.threshold.explainer}</span>
        </div>
        <Slider
          label={strings.preferences.threshold}
          value={preferences.threshold}
          min={60}
          max={99}
          onChange={(next) => void updatePreferences({ threshold: next })}
        />
      </Section>

      <Section>
        <Switch
          label={strings.onboarding.threshold.instant}
          checked={preferences.instant}
          onChange={(next) => void updatePreferences({ instant: next })}
        />
        <Switch
          label={strings.onboarding.threshold.digest(clockTime(preferences.digestHour))}
          checked={preferences.digest}
          onChange={(next) => void updatePreferences({ digest: next })}
        />
        <Switch
          label={strings.onboarding.threshold.tailor}
          checked={preferences.tailorLetter}
          onChange={(next) => void updatePreferences({ tailorLetter: next })}
        />
      </Section>

      <Section label={strings.preferences.dailyCap}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span className="display gold" style={{ fontSize: 28 }}>{preferences.dailySubmitCap}</span>
          <span className="muted" style={{ fontSize: 13 }}>
            Herald never submits more than this many applications in a day.
          </span>
        </div>
        <Slider
          label={strings.preferences.dailyCap}
          value={preferences.dailySubmitCap}
          min={0}
          max={50}
          onChange={(next) => void updatePreferences({ dailySubmitCap: next })}
        />
      </Section>

      <Section label="Resume">
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {profile?.resumeFileName ?? 'No resume uploaded yet.'}
        </p>
        <input
          ref={fileInput}
          type="file"
          accept=".pdf,.docx,.txt"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onResume(file);
            event.target.value = '';
          }}
        />
        <Button variant="outline" onClick={() => fileInput.current?.click()}>
          {profile?.resumeFileName ? 'Replace resume' : strings.onboarding.upload.cta}
        </Button>
      </Section>

      {profile ? (
        <Section label="Application details">
          <LabelledInput
            label={strings.review.fields.authorization}
            value={profile.workAuthorization}
            placeholder="US citizen · no sponsorship"
            onSave={(next) => void updateProfile({ workAuthorization: next })}
          />
          <LabelledInput
            label={strings.review.fields.availability}
            value={profile.availability}
            placeholder="Two weeks"
            onSave={(next) => void updateProfile({ availability: next })}
          />
        </Section>
      ) : null}

      {mode === 'local' ? (
        <Section label="Share with your phone">
          <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
            {pairing
              ? `Herald is answering on port ${pairing.port}. On your phone, choose "Connect to an engine instead" and enter this machine\u2019s address on your network, with the token below.`
              : 'Let the Herald app on your phone use this machine\u2019s engine, so both show the same matches. Both devices need to be on the same network.'}
          </p>

          {pairing ? (
            <>
              <div className="stack stack--tight">
                <Label>Token</Label>
                <input
                  className="field"
                  readOnly
                  value={pairing.token}
                  aria-label="Pairing token"
                  onFocus={(event) => event.currentTarget.select()}
                />
              </div>
              <div className="row-actions">
                <Button variant="ghost" onClick={() => void stopSharing()}>Stop sharing</Button>
              </div>
            </>
          ) : (
            <div className="row-actions">
              <Button
                variant="outline"
                onClick={() => void (async () => {
                  try {
                    await startSharing();
                  } catch (cause) {
                    showToast(cause instanceof Error ? cause.message : strings.errors.generic, 'danger');
                  }
                })()}
              >
                Start sharing
              </Button>
            </div>
          )}
        </Section>
      ) : null}

      <Section>
        <div className="row-actions">
          <Button variant="outline" onClick={() => setView('releases')}>
            {strings.preferences.about}
          </Button>
          <Button variant="ghost" onClick={disconnect}>{strings.preferences.signOut}</Button>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Sources are configured on the engine. Herald reads every board listed
          there once an hour.
        </p>
      </Section>
    </div>
  );
}

function Section({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div
      className="stack stack--tight"
      style={{
        padding: 'var(--cp-space-3)',
        borderBottom: '1px solid var(--cp-line)',
      }}
    >
      {label ? <Label>{label}</Label> : null}
      {children}
    </div>
  );
}

/** A profile field no resume carries but most application forms ask for. */
function LabelledInput({ label, value, placeholder, onSave }: {
  label: string; value: string | null; placeholder: string; onSave: (next: string | null) => void;
}) {
  return (
    <div className="stack stack--tight" style={{ gap: 6 }}>
      <Label className="label--tight">{label}</Label>
      <input
        className="field"
        defaultValue={value ?? ''}
        aria-label={label}
        placeholder={placeholder}
        onBlur={(event) => onSave(event.target.value.trim() || null)}
      />
    </div>
  );
}
