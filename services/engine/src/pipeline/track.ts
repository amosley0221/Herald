import { readFileSync, existsSync } from 'node:fs';
import { z } from 'zod';
import { canTransition } from '@herald/core';
import type { LoadedConfig } from '../config.js';
import type { Repository } from '../db.js';
import type { LlmClient } from '../llm/client.js';
import type { PromptLibrary } from '../llm/prompts.js';
import { errorFields, type Logger } from '../log.js';

const ClassificationSchema = z.object({
  classification: z.enum(['interview', 'rejected', 'acknowledgement', 'unrelated']),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

/**
 * Below this, a classification is recorded in the log but does not move the
 * match. A wrongly-applied `rejected` silently deletes a live opportunity from
 * the user's tracker, so the bar for acting is deliberately high.
 */
const ACT_THRESHOLD = 0.8;

interface GmailCredentials {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  token_uri?: string;
}

interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  body: string;
  receivedAt: string;
}

/** Key holding the timestamp of the last mailbox sweep. */
const LAST_SWEEP_KEY = 'track.lastSweepAt';

/**
 * Watches the user's mailbox for replies to applications and moves matches to
 * `interview` or `rejected`.
 *
 * Read-only and label-scoped: only messages the user has filtered into the
 * configured label are ever fetched, so Herald never reads the rest of the
 * inbox. The feature is off unless explicitly configured.
 */
export class ReplyTracker {
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: LoadedConfig,
    private readonly repo: Repository,
    private readonly llm: LlmClient,
    private readonly prompts: PromptLibrary,
    private readonly log: Logger,
  ) {}

  get enabled(): boolean {
    return this.config.tracking.enabled
      && this.config.tracking.provider === 'gmail'
      && this.config.tracking.gmailCredentialsFile != null;
  }

  async sweep(): Promise<{ read: number; updated: number }> {
    if (!this.enabled) return { read: 0, updated: 0 };
    if (!this.llm.available) {
      this.log.warn('reply tracking needs a model to classify messages; skipping sweep');
      return { read: 0, updated: 0 };
    }

    const applied = this.repo.listMatches({ status: ['applied', 'interview'] });
    if (applied.length === 0) return { read: 0, updated: 0 };

    const since = this.repo.get(LAST_SWEEP_KEY);
    let messages: GmailMessage[];
    try {
      messages = await this.fetchMessages(since ? new Date(since) : new Date(Date.now() - 7 * 86_400_000));
    } catch (cause) {
      this.log.error('could not read the mailbox', errorFields(cause));
      return { read: 0, updated: 0 };
    }

    let updated = 0;
    for (const message of messages) {
      // Only consider messages plausibly from a company we applied to, so the
      // model is not asked to classify unrelated mail.
      const match = applied.find((m) => mentionsCompany(message, m.posting.company));
      if (!match) continue;

      try {
        const verdict = await this.llm.completeJson(
          {
            model: this.config.llm.scoreModel,
            prompt: this.prompts.render('classify-reply', {
              title: match.posting.title,
              company: match.posting.company,
              appliedAt: match.submittedAt ?? match.createdAt,
              from: message.from,
              subject: message.subject,
              body: message.body.slice(0, 4_000),
            }),
            maxTokens: 400,
            temperature: 0,
          },
          (value) => ClassificationSchema.parse(value),
        );

        const target = verdict.classification === 'interview' ? 'interview'
          : verdict.classification === 'rejected' ? 'rejected'
          : null;

        this.repo.appendLog({
          matchId: match.id,
          at: new Date().toISOString(),
          action: 'prepared',
          detail: `Reply from ${message.from}: ${verdict.classification} (${verdict.confidence.toFixed(2)}) — ${verdict.reason}`,
          payload: null,
        });

        if (!target) continue;
        if (verdict.confidence < ACT_THRESHOLD) {
          this.log.info('classification below the action threshold; leaving status as is', {
            matchId: match.id, classification: verdict.classification, confidence: verdict.confidence,
          });
          continue;
        }
        if (!canTransition(match.status, target)) continue;

        this.repo.updateMatchStatus(match.id, target);
        updated++;
        this.log.info('match status updated from a reply', { matchId: match.id, status: target });
      } catch (cause) {
        this.log.warn('could not classify a reply', errorFields(cause));
      }
    }

    this.repo.set(LAST_SWEEP_KEY, new Date().toISOString());
    return { read: messages.length, updated };
  }

  // ── Gmail ────────────────────────────────────────────────────────────────

  private async fetchMessages(since: Date): Promise<GmailMessage[]> {
    const accessToken = await this.getAccessToken();
    const label = this.config.tracking.gmailLabel;
    const after = Math.floor(since.getTime() / 1000);
    const query = `label:${label} after:${after}`;

    const list = await this.gmail<{ messages?: Array<{ id: string }> }>(
      `/users/me/messages?q=${encodeURIComponent(query)}&maxResults=50`,
      accessToken,
    );

    const messages: GmailMessage[] = [];
    for (const { id } of list.messages ?? []) {
      const detail = await this.gmail<GmailApiMessage>(`/users/me/messages/${id}?format=full`, accessToken);
      messages.push(toMessage(detail));
    }
    return messages;
  }

  private async gmail<T>(path: string, accessToken: string): Promise<T> {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Gmail ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  private async getAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.accessToken && this.accessToken.expiresAt > now + 60) return this.accessToken.value;

    const path = this.config.tracking.gmailCredentialsFile!;
    if (!existsSync(path)) throw new Error(`Gmail credentials not found at ${path}`);
    const credentials = JSON.parse(readFileSync(path, 'utf8')) as GmailCredentials;

    const res = await fetch(credentials.token_uri ?? 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: credentials.client_id,
        client_secret: credentials.client_secret,
        refresh_token: credentials.refresh_token,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) throw new Error(`Gmail token refresh failed: ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.accessToken = { value: body.access_token, expiresAt: now + body.expires_in };
    return body.access_token;
  }
}

interface GmailApiMessage {
  id: string;
  threadId: string;
  internalDate?: string;
  payload?: GmailPart;
}

interface GmailPart {
  mimeType?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string };
  parts?: GmailPart[];
}

function toMessage(api: GmailApiMessage): GmailMessage {
  const headers = api.payload?.headers ?? [];
  const header = (name: string) =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
  return {
    id: api.id,
    threadId: api.threadId,
    from: header('From'),
    subject: header('Subject'),
    body: extractBody(api.payload),
    receivedAt: api.internalDate ? new Date(Number(api.internalDate)).toISOString() : new Date().toISOString(),
  };
}

/** Walks the MIME tree for the first text/plain part, falling back to HTML. */
function extractBody(part: GmailPart | undefined): string {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) return decodeBase64Url(part.body.data);
  for (const child of part.parts ?? []) {
    const found = extractBody(child);
    if (found) return found;
  }
  if (part.mimeType === 'text/html' && part.body?.data) {
    return decodeBase64Url(part.body.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return '';
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

/** Cheap pre-filter so only plausibly-relevant mail reaches the classifier. */
export function mentionsCompany(message: GmailMessage, company: string): boolean {
  const needle = company.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  if (!needle) return false;
  const haystack = `${message.from} ${message.subject} ${message.body.slice(0, 500)}`.toLowerCase();
  if (haystack.includes(needle)) return true;
  // Match the domain too: "no-reply@dukeenergy.com" for "Duke Energy".
  const collapsed = needle.replace(/\s+/g, '');
  return collapsed.length > 3 && haystack.includes(collapsed);
}
