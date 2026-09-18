import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { PairingPayload } from '@herald/core';
import { strings } from '@herald/core';
import { Button, Emblem, Label } from '../components/primitives';
import { useHerald } from '../state';

/**
 * Connecting the desktop app to an engine.
 *
 * Once connected, this same screen is where the phone pairs from: the engine
 * hands back its public address and token, and they are rendered as a QR code
 * for the phone's camera. That is the only time the token is ever displayed.
 */
export function Setup() {
  const { connect } = useHerald();
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:8787');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await connect({ baseUrl: normalizeUrl(baseUrl), token: token.trim() });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : strings.setup.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="setup" onSubmit={onSubmit}>
      <Emblem size={40} />
      <div>
        <h1 className="display" style={{ fontSize: 28 }}>{strings.brand.wordmark}</h1>
        <Label>{strings.setup.title}</Label>
      </div>

      <p style={{ fontSize: 16, lineHeight: 1.6, margin: 0 }}>
        Point Herald at your engine. The token is the one `npm run init` printed
        when you set the engine up.
      </p>

      <div className="stack stack--tight">
        <Label>{strings.setup.baseUrl}</Label>
        <input
          className="field"
          value={baseUrl}
          aria-label={strings.setup.baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="https://herald.example.com"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="stack stack--tight">
        <Label>{strings.setup.token}</Label>
        <input
          className="field"
          type="password"
          value={token}
          aria-label={strings.setup.token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Access token"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="row-actions">
        <Button type="submit" disabled={busy || !baseUrl.trim() || !token.trim()}>
          {strings.setup.connect}
        </Button>
      </div>

      {error ? <p className="danger" style={{ fontSize: 13, margin: 0 }}>{error}</p> : null}
    </form>
  );
}

/**
 * The pairing QR the phone scans.
 *
 * The payload comes from the engine's `/pairing` endpoint rather than from
 * whatever was typed here, so the phone gets the address the engine knows it is
 * reachable at — which is rarely `127.0.0.1`.
 */
export function PairingCode() {
  const { credentials } = useHerald();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [payload, setPayload] = useState<PairingPayload | null>(null);

  useEffect(() => {
    if (!credentials || !revealed) return;
    let cancelled = false;
    void (async () => {
      try {
        // `/pairing` is used by this one screen only, so it is fetched directly
        // rather than widening the shared client's contract for it.
        const response = await fetch(`${credentials.baseUrl}/pairing`, {
          headers: { Authorization: `Bearer ${credentials.token}` },
        });
        if (!response.ok) throw new Error(`Engine replied ${response.status}`);
        const data = (await response.json()) as PairingPayload;
        if (cancelled) return;
        setPayload(data);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : strings.errors.generic);
      }
    })();
    return () => { cancelled = true; };
  }, [credentials, revealed]);

  useEffect(() => {
    if (!payload || !canvas.current) return;
    void QRCode.toCanvas(canvas.current, JSON.stringify(payload), {
      width: 220,
      margin: 0,
      color: { dark: '#0C0A09', light: '#EDE8DC' },
    }).catch(() => setError('Could not render the pairing code.'));
  }, [payload]);

  if (!revealed) {
    return (
      <div className="stack stack--tight">
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>{strings.setup.pairingBody}</p>
        <Button variant="outline" onClick={() => setRevealed(true)}>Show pairing code</Button>
      </div>
    );
  }

  return (
    <div className="stack stack--tight">
      <Label>{strings.setup.pairingTitle}</Label>
      {error ? (
        <p className="danger" style={{ fontSize: 13, margin: 0 }}>{error}</p>
      ) : (
        <>
          <div className="pairing-qr">
            <canvas ref={canvas} />
          </div>
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>{strings.setup.pairingBody}</p>
          <Button variant="ghost" onClick={() => { setRevealed(false); setPayload(null); }}>
            Hide
          </Button>
        </>
      )}
    </div>
  );
}

/** Accepts `herald.example.com` as readily as a full URL. */
function normalizeUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const isLocal = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(trimmed);
  return `${isLocal ? 'http' : 'https'}://${trimmed}`;
}
