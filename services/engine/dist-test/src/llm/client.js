import Anthropic from '@anthropic-ai/sdk';
import { sleep } from '../http.js';
export class LlmUnavailableError extends Error {
    constructor(message) {
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
    config;
    log;
    anthropic;
    inFlight = 0;
    queue = [];
    constructor(config, log) {
        this.config = config;
        this.log = log;
        const apiKey = process.env[config.llm.apiKeyEnv];
        this.anthropic = apiKey ? new Anthropic({ apiKey }) : null;
        if (!this.anthropic) {
            this.log.warn('no LLM API key found; scoring and cover letters are disabled', {
                expectedEnv: config.llm.apiKeyEnv,
            });
        }
    }
    get available() {
        return this.anthropic !== null;
    }
    async complete(request) {
        if (!this.anthropic) {
            throw new LlmUnavailableError(`No API key in ${this.config.llm.apiKeyEnv}. Set it and restart the engine.`);
        }
        await this.acquire();
        try {
            return await this.withRetry(async () => {
                const message = await this.anthropic.messages.create({
                    model: request.model,
                    max_tokens: request.maxTokens ?? this.config.llm.maxOutputTokens,
                    temperature: request.temperature ?? 0,
                    ...(request.system ? { system: request.system } : {}),
                    messages: [
                        { role: 'user', content: request.prompt },
                        ...(request.prefill ? [{ role: 'assistant', content: request.prefill }] : []),
                    ],
                });
                const text = message.content
                    .filter((block) => block.type === 'text')
                    .map((block) => block.text)
                    .join('');
                return request.prefill ? request.prefill + text : text;
            });
        }
        finally {
            this.release();
        }
    }
    /** Completes and parses strict JSON, retrying once if the first reply is not. */
    async completeJson(request, validate) {
        const raw = await this.complete({ ...request, prefill: request.prefill ?? '{' });
        try {
            return validate(JSON.parse(extractJson(raw)));
        }
        catch (first) {
            this.log.debug('LLM returned unparseable JSON, retrying once', { err: String(first) });
            const retry = await this.complete({
                ...request,
                prompt: `${request.prompt}\n\nYour previous reply could not be parsed as JSON. Reply with the JSON object only.`,
                prefill: '{',
                temperature: 0,
            });
            return validate(JSON.parse(extractJson(retry)));
        }
    }
    async withRetry(operation) {
        const maxAttempts = 4;
        let lastError;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                return await operation();
            }
            catch (cause) {
                lastError = cause;
                const status = cause.status;
                // Rate limits and transient server errors are worth waiting out; a 400
                // means the request itself is wrong and will not improve on retry.
                const retryable = status === 429 || status === 408 || (status != null && status >= 500) || status === undefined;
                if (!retryable || attempt === maxAttempts - 1)
                    throw cause;
                const delay = Math.round(2 ** attempt * 1500 * (0.75 + Math.random() * 0.5));
                this.log.debug('LLM retry', { attempt, status, delay });
                await sleep(delay);
            }
        }
        throw lastError;
    }
    /** Caps concurrent requests at `llm.concurrency` to respect the rate limit. */
    acquire() {
        if (this.inFlight < this.config.llm.concurrency) {
            this.inFlight++;
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            this.queue.push(() => {
                this.inFlight++;
                resolve();
            });
        });
    }
    release() {
        this.inFlight--;
        this.queue.shift()?.();
    }
}
/** Pulls the first balanced JSON object out of a reply, tolerating code fences. */
export function extractJson(text) {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
    const body = fenced ? fenced[1] : text;
    const start = body.indexOf('{');
    if (start === -1)
        return body.trim();
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < body.length; i++) {
        const char = body[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === '\\') {
            escaped = true;
            continue;
        }
        if (char === '"') {
            inString = !inString;
            continue;
        }
        if (inString)
            continue;
        if (char === '{')
            depth++;
        else if (char === '}') {
            depth--;
            if (depth === 0)
                return body.slice(start, i + 1);
        }
    }
    return body.slice(start).trim();
}
//# sourceMappingURL=client.js.map