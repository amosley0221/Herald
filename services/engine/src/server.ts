import { randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { MatchStatus, Preferences, Profile, TodayStats } from '@herald/core';
import type { LoadedConfig } from './config.js';
import type { Repository } from './db.js';
import { errorFields, type Logger } from './log.js';
import { ApplyError, ApplyService, startOfLocalDay } from './pipeline/apply.js';
import type { Crawler } from './pipeline/crawl.js';
import { ResumeParseError, type ResumeParser } from './resume/parse.js';
import type { ReleaseFeed } from './releases.js';
import type { Scheduler } from './scheduler.js';

/** Largest resume the upload endpoint accepts. */
const MAX_RESUME_BYTES = 10 * 1024 * 1024;

const PreferencesPatchSchema = z.object({
  roles: z.array(z.string()).optional(),
  locations: z.array(z.string()).optional(),
  remote: z.boolean().optional(),
  minSalary: z.number().nonnegative().nullable().optional(),
  threshold: z.number().int().min(0).max(100).optional(),
  instant: z.boolean().optional(),
  digest: z.boolean().optional(),
  digestHour: z.number().int().min(0).max(23).optional(),
  tailorLetter: z.boolean().optional(),
  dailySubmitCap: z.number().int().min(0).max(200).optional(),
  timezone: z.string().optional(),
  seniority: z.array(z.string()).optional(),
  excludeKeywords: z.array(z.string()).optional(),
}).strict();

const ProfilePatchSchema = z.object({
  fullName: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  portfolio: z.string().nullable().optional(),
  linkedin: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  skills: z.array(z.string()).optional(),
  titles: z.array(z.string()).optional(),
  years: z.number().nullable().optional(),
  workAuthorization: z.string().nullable().optional(),
  availability: z.string().nullable().optional(),
}).strict();

const SubmitBodySchema = z.object({
  fields: z.record(z.string(), z.string()).optional(),
  coverLetter: z.string().optional(),
}).strict();

const DeviceSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(['android', 'ios', 'desktop']),
  appVersion: z.string().min(1),
}).strict();

export interface ServerDeps {
  config: LoadedConfig;
  repo: Repository;
  crawler: Crawler;
  applyService: ApplyService;
  resumeParser: ResumeParser;
  releases: ReleaseFeed;
  scheduler: Scheduler;
  log: Logger;
  version: string;
}

export async function createServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { config, repo, crawler, applyService, resumeParser, releases, scheduler, log, version } = deps;

  const app = Fastify({ logger: false, bodyLimit: MAX_RESUME_BYTES });

  await app.register(cors, {
    // The desktop app runs from a tauri:// or localhost origin; the phone sends
    // no Origin header at all. An empty list means same-origin only.
    origin: config.server.corsOrigins.length > 0 ? config.server.corsOrigins : true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  });
  await app.register(multipart, { limits: { fileSize: MAX_RESUME_BYTES, files: 1 } });

  // Confirmation screenshots are served so the Tracker can show them.
  mkdirSync(config.paths.screenshots, { recursive: true });
  await app.register(fastifyStatic, {
    root: config.paths.screenshots,
    prefix: '/screenshots/',
    decorateReply: false,
  });

  // ── Auth ─────────────────────────────────────────────────────────────────

  const expectedToken = config.auth.token;
  if (!expectedToken) {
    throw new Error('No auth token configured. Run `npm run init -w @herald/engine` to generate one.');
  }

  app.addHook('onRequest', async (request, reply) => {
    // Health is unauthenticated so the pairing screen can probe reachability
    // before it has a token to try.
    if (request.url === '/health') return;

    const header = request.headers.authorization ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!constantTimeEquals(provided, expectedToken)) {
      await reply.code(401).send({ code: 'unauthorized', message: 'Invalid or missing token.' });
    }
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof ApplyError) {
      const status = error.code === 'not_found' ? 404 : error.code === 'cap_reached' ? 429 : 409;
      return reply.code(status).send({ code: error.code, message: error.message });
    }
    if (error instanceof ResumeParseError) {
      return reply.code(400).send({ code: error.code, message: error.message });
    }
    if (error instanceof z.ZodError) {
      return reply.code(400).send({
        code: 'invalid_request',
        message: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
    }
    log.error('request failed', { url: request.url, ...errorFields(error) });
    return reply.code(500).send({ code: 'internal', message: 'Something went wrong.' });
  });

  // ── Health & pairing ─────────────────────────────────────────────────────

  app.get('/health', async () => ({ ok: true as const, version }));

  app.get('/status', async () => ({
    version,
    ...scheduler.status(),
    crawling: crawler.isRunning,
    lastCrawl: repo.lastCrawl(),
    devices: repo.listDevices().length,
  }));

  /** Payload the desktop app renders as a QR code for the phone to scan. */
  app.get('/pairing', async () => ({
    baseUrl: config.server.publicUrl ?? `http://${config.server.host}:${config.server.port}`,
    token: expectedToken,
  }));

  // ── Profile & resume ─────────────────────────────────────────────────────

  app.get('/profile', async (_request, reply) => {
    const stored = repo.getProfile();
    if (!stored) return reply.code(404).send({ code: 'no_profile', message: 'No resume has been uploaded yet.' });
    return stored.profile;
  });

  app.put('/profile', async (request) => {
    const patch = ProfilePatchSchema.parse(request.body);
    const stored = repo.getProfile();
    const base: Profile = stored?.profile ?? emptyProfile();
    const updated: Profile = { ...base, ...patch };
    repo.saveProfile(updated);
    return updated;
  });

  app.post('/resume', async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ code: 'no_file', message: 'No resume file was uploaded.' });

    const buffer = await file.toBuffer();
    const existing = repo.getProfile();
    const { result, text } = await resumeParser.parse(buffer, file.filename, file.mimetype, existing?.profile ?? null);

    // Keep the original file: it is what gets uploaded to application forms.
    mkdirSync(config.paths.resumes, { recursive: true });
    const stored = resolve(config.paths.resumes, `resume-${Date.now()}${extname(file.filename) || '.pdf'}`);
    writeFileSync(stored, buffer);

    repo.saveProfile(result.profile, stored, text);
    log.info('resume stored', { fileName: file.filename, bytes: buffer.byteLength });
    return result;
  });

  // ── Preferences ──────────────────────────────────────────────────────────

  app.get('/preferences', async () => repo.getPreferences() ?? defaultPreferences(config));

  app.put('/preferences', async (request) => {
    const patch = PreferencesPatchSchema.parse(request.body);
    const current = repo.getPreferences() ?? defaultPreferences(config);
    const updated: Preferences = { ...current, ...patch };
    repo.savePreferences(updated);
    // The digest hour or timezone may have moved; re-arm the job now rather
    // than waiting for a restart.
    scheduler.rescheduleDigest();
    return updated;
  });

  // ── Matches ──────────────────────────────────────────────────────────────

  app.get('/matches', async (request) => {
    const query = request.query as { status?: string | string[]; limit?: string; since?: string };
    const status = query.status
      ? (Array.isArray(query.status) ? query.status : [query.status]) as MatchStatus[]
      : undefined;
    return repo.listMatches({
      ...(status ? { status } : {}),
      minScore: config.matching.feedFloor,
      ...(query.limit ? { limit: Math.min(500, Number(query.limit) || 100) } : {}),
      ...(query.since ? { since: query.since } : {}),
    });
  });

  app.get('/matches/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const match = repo.getMatch(id);
    if (!match) return reply.code(404).send({ code: 'not_found', message: 'No such match.' });
    return match;
  });

  app.post('/matches/:id/approve', async (request) => {
    const { id } = request.params as { id: string };
    return applyService.approve(id);
  });

  app.post('/matches/:id/submit', async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body ? SubmitBodySchema.parse(request.body) : {};
    return applyService.submit(id, body);
  });

  app.post('/matches/:id/skip', async (request) => {
    const { id } = request.params as { id: string };
    return applyService.skip(id);
  });

  app.get('/matches/:id/log', async (request) => {
    const { id } = request.params as { id: string };
    return repo.listLog(id);
  });

  // ── Stats ────────────────────────────────────────────────────────────────

  app.get('/stats/today', async (): Promise<TodayStats> => {
    const preferences = repo.getPreferences();
    const dayStart = startOfLocalDay(preferences?.timezone);
    const last = repo.lastCrawl();
    const all = repo.listMatches({ minScore: config.matching.feedFloor });

    return {
      read: repo.readSince(dayStart),
      matched: all.filter((m) => m.createdAt >= dayStart).length,
      applied: all.filter((m) => m.submittedAt != null && m.submittedAt >= dayStart).length,
      pending: all.filter((m) => m.status === 'pending').length,
      lastCrawlAt: last?.finishedAt ?? null,
      lastCrawlRead: last?.read ?? 0,
    };
  });

  // ── Devices ──────────────────────────────────────────────────────────────

  app.post('/devices', async (request) => {
    const device = DeviceSchema.parse(request.body);
    repo.registerDevice(device.token, device.platform, device.appVersion);
    return { ok: true as const };
  });

  app.delete('/devices/:token', async (request) => {
    const { token } = request.params as { token: string };
    repo.removeDevice(token);
    return { ok: true as const };
  });

  // ── Crawl & releases ─────────────────────────────────────────────────────

  app.post('/crawl', async (_request, reply) => {
    if (crawler.isRunning) {
      return reply.code(409).send({ code: 'already_running', message: 'A crawl is already in progress.' });
    }
    // Fire and forget: a crawl takes minutes and the client only needs to know
    // it started.
    void crawler.run().catch((cause) => log.error('manual crawl failed', errorFields(cause)));
    return { started: true as const };
  });

  app.get('/releases', async (_request, reply) => {
    const feed = await releases.get();
    if (!feed) {
      return reply.code(503).send({ code: 'no_feed', message: 'No release feed is configured.' });
    }
    return feed;
  });

  return app;
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length, so compare against a padded copy and fold the length check in.
  if (bufferA.length !== bufferB.length) {
    timingSafeEqual(bufferB, bufferB);
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

export function emptyProfile(): Profile {
  return {
    fullName: null, email: null, phone: null, location: null, portfolio: null,
    linkedin: null, summary: null, skills: [], titles: [], years: null,
    workAuthorization: null, availability: null, resumeFileName: null, resumeUpdatedAt: null,
  };
}

/**
 * Preferences a brand-new install starts from. Deliberately permissive: with no
 * roles and no locations set, nothing is filtered out before scoring, so the
 * user sees results on day one and narrows from there.
 */
export function defaultPreferences(config: LoadedConfig): Preferences {
  return {
    roles: [],
    locations: [],
    remote: true,
    minSalary: null,
    threshold: 85,
    instant: true,
    digest: true,
    digestHour: 7,
    tailorLetter: true,
    dailySubmitCap: 15,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    seniority: [],
    excludeKeywords: [],
    includeElsewhere: false,
  };
}
