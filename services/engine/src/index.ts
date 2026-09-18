import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { openDatabase, Repository } from './db.js';
import { createLogger, errorFields } from './log.js';
import { LlmClient } from './llm/client.js';
import { PromptLibrary } from './llm/prompts.js';
import { Notifier } from './notify/index.js';
import { ApplyService } from './pipeline/apply.js';
import { Crawler } from './pipeline/crawl.js';
import { Scorer } from './pipeline/score.js';
import { ReplyTracker } from './pipeline/track.js';
import { ReleaseFeed } from './releases.js';
import { ResumeParser } from './resume/parse.js';
import { Scheduler } from './scheduler.js';
import { createServer, defaultPreferences } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(config.logging.level, { svc: 'herald-engine' });
  const version = readVersion();

  log.info('starting', {
    version,
    config: config.configPath ?? '(defaults)',
    dataDir: config.paths.dataDir,
    sources: config.sources.filter((s) => s.enabled).length,
  });

  const db = openDatabase(config.paths.database);
  const repo = new Repository(db);

  // A fresh install has no preferences row; seed one so every read downstream
  // can assume it exists.
  if (!repo.getPreferences()) {
    repo.savePreferences(defaultPreferences(config));
    log.info('seeded default preferences');
  }

  const llm = new LlmClient(config, log);
  const prompts = new PromptLibrary(config.paths.promptDir);
  const scorer = new Scorer(config, llm, prompts, log);
  const notifier = new Notifier(config, repo, log);
  const crawler = new Crawler(config, repo, scorer, notifier, log);
  const applyService = new ApplyService(config, repo, llm, prompts, notifier, log);
  const resumeParser = new ResumeParser(config, llm, prompts, log);
  const tracker = new ReplyTracker(config, repo, llm, prompts, log);
  const releases = new ReleaseFeed(config, log);
  const scheduler = new Scheduler(config, repo, crawler, notifier, tracker, log);

  const app = await createServer({
    config, repo, crawler, applyService, resumeParser, releases, scheduler, log, version,
  });

  await app.listen({ host: config.server.host, port: config.server.port });
  log.info('listening', { url: `http://${config.server.host}:${config.server.port}` });

  scheduler.start();

  const shutdown = async (signal: string) => {
    log.info('shutting down', { signal });
    scheduler.stop();
    crawler.abort();
    // Close the server first so no new work arrives, then release the browser
    // and the database handle.
    await app.close().catch((cause) => log.warn('server close failed', errorFields(cause)));
    await applyService.close().catch((cause) => log.warn('browser close failed', errorFields(cause)));
    db.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    // Log rather than crash: a rejected push or a flaky source should not take
    // down a service whose whole job is to be awake at 07:00.
    log.error('unhandled rejection', errorFields(reason));
  });
}

function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

main().catch((cause) => {
  // Config errors land here and are the most common startup failure, so print
  // them plainly rather than as a JSON log line the user has to decode.
  process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
  process.exit(1);
});
