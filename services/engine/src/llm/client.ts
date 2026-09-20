import Anthropic from '@anthropic-ai/sdk';
import type { LoadedConfig } from '../config.js';
import type { Logger } from '../log.js';
import { sleep } from '../http.js';

export interface CompletionRequest {
  model: string;
  system?: string;
  prompt: string;
  maxTokens?: number;
  /**
   * Text the assistant turn is forced to start with. Prefilling `{` makes the
   * model continue a JSON object instead of prefacing it with prose.
   */
  prefill?: string;
}

export class LlmUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmUnavailableError';
  }
}

/**
 * Thin wrapper over the Anthropic SDK.
 *
 * The model ids, token ceiling and concurrency all come from config; nothing
 * about the provider is assumed beyond the API shape.
 */
export class LlmClient {
  private readonly anthropic: Anthropic | null;
  private inFlight = 0;
  private readonly queue: Array<() => void> = [];

  constructor(
    private readonly config: LoadedConfig,
    private readonly log: Logger,
  ) {
    const apiKey = process.env[config.llm.apiKeyEnv];
    this.anthropic = apiKey ? new Anthropic({ apiKey }) : null;
    if (!this.anthropic) {
      this.log.warn('no LLM API key found; scoring and cover letters are disabled', {
        expectedEnv: config.llm.apiKeyEnv,
      });
    }
  }

  get available(): boolean {
    return this.anthropic !== null;
  }

  async complete(request: CompletionRequest): Promise<string> {
    if (!this.anthropic) {
      throw new LlmUnavailableError(
        `No API key in ${this.config.llm.apiKeyEnv}. Set it and restart the engine.`,
      );
    }
    await this.acquire();
    try {
      return await this.withRetry(async () => {
        const message = await this.anthropic!.messages.create({
          model: request.model,
          max_tokens: request.maxTokens ?? this.config.llm.maxOutputTokens,
          ...(request.system ? { system: request.system } : {}),
          messages: [
            { role: 'user', content: request.prompt },
            ...(request.prefill ? [{ role: 'assistant' as const, content: request.prefill }] : []),
          ],
        });
        const text = message.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('');
        return request.prefill ? request.prefill + text : text;
      });
    } finally {
      this.release();
    }
  }

  /** Completes and parses strict JSON, retrying once if the first reply is not. */
  async completeJson<T>(request: CompletionRequest, validate: (value: unknown) => T): Promise<T> {
    const raw = await this.complete({ ...request, prefill: request.prefill ?? '{' });
    try {
      return validate(JSON.parse(extractJson(raw)));
    } catch (first) {
      this.log.debug('LLM returned unparseable JSON, retrying once', { err: String(first) });
      const retry = await this.complete({
        ...request,
        prompt: `${request.prompt}\n\nYour previous reply could not be parsed as JSON. Reply with the JSON object only.`,
        prefill: '{',
      });
      return validate(JSON.parse(extractJson(retry)));
    }
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    const maxAttempts = 4;
    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (cause) {
        lastError = cause;
        const status = (cause as { status?: number }).status;
        // Rate limits and transient server errors are worth waiting out; a 400
        // means the request itself is wrong and will not improve on retry.
        const retryable = status === 429 || status === 408 || (status != null && status >= 500) || status === undefined;
        if (!retryable || attempt === maxAttempts - 1) throw cause;
        const delay = Math.round(2 ** attempt * 1500 * (0.75 + Math.random() * 0.5));
        this.log.debug('LLM retry', { attempt, status, delay });
        await sleep(delay);
      }
    }
    throw lastError;
  }

  /** Caps concurrent requests at `llm.concurrency` to respect the rate limit. */
  private acquire(): Promise<void> {
    if (this.inFlight < this.config.llm.concurrency) {
      this.inFlight++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.inFlight++;
        resolve();
      });
    });
  }

  private release(): void {
    this.inFlight--;
    this.queue.shift()?.();
  }
}

/** Pulls the first balanced JSON object out of a reply, tolerating code fences. */
export function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf('{');
  if (start === -1) return body.trim();

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < body.length; i++) {
    const char = body[i]!;
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  return body.slice(start).trim();
}
